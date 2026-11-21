const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { GenotypePanel, PanelError } = require('../models/GenotypePanel');
const { ConversionError } = require("../services/converters/geneticExcelConverterService");
const { logger } = require('../utils/logger');
const { resolveProfileImportFormat } = require('../utils/profileImportFormat');
const { query } = require('../config/database');
const {converterWorker}=require('../services/converters/converterWorkerExecutor');
const { ConverterUploadCache } = require('../services/converters/converterUploadCache');
const uploadCache = new ConverterUploadCache();
let activeRequests=0;
// Busboy сообщает partsLimit при достижении порога: 100 файлов + options должны проходить целиком.
const storage = {
  _handleFile(req, file, callback) {
    const chunks = []; let size = 0, completed = false;
    const finish = (error, data) => { if (!completed) { completed = true; callback(error, data); } };
    file.stream.on('data', chunk => {
      req.converterBytes = (req.converterBytes || 0) + chunk.length;
      if (req.converterBytes > 50 * 1024 * 1024) { chunks.length = 0; finish(new ConversionError('Общий размер файлов превышает 50 МиБ.', 'FILES_TOO_LARGE', 413)); }
      if (!completed) { chunks.push(chunk); size += chunk.length; }
    });
    file.stream.on('end', () => finish(null, { buffer: Buffer.concat(chunks), size }));
    file.stream.on('error', error => finish(error));
  },
  _removeFile(req, file, callback) { delete file.buffer; callback(null); }
};
const upload = multer({ storage, limits: { files: 100, fileSize: 10 * 1024 * 1024, fieldSize: 2 * 1024 * 1024, fields: 1, parts: 102 } }).array('files', 100);
router.use(authenticate);
router.use(async (req, res, next) => {
  try {
    if (!['admin', 'system_administrator', 'department_head', 'user_analyst', 'analyst'].includes(req.user.role)) throw new PanelError('Нет прав на конвертацию профилей.', 403);
    req.converterWorkspaceMode = require('../services/workspace/workspaceMode').workspaceModeEnabled();
    if (req.converterWorkspaceMode) { req.converterFormat = 'genetic'; req.converterScope = {departmentId:null,organizationId:req.user.organization_id}; return next(); }
    const { rows } = await require('../config/database').query('SELECT id,name,organization_id FROM departments WHERE id=$1 AND is_active=true', [req.activeDepartmentId]);
    const department = rows[0];
    req.converterFormat = resolveProfileImportFormat(department);
    if (!department || !req.converterFormat) throw new PanelError('Выберите отделение «Генетические экспертизы» или «ЧС».', 403);
    req.converterScope = req.converterFormat === 'genetic'
      ? await GenotypePanel.scope({ departmentId: req.activeDepartmentId, organizationId: req.user.organization_id, role: req.user.role })
      : { departmentId: department.id, organizationId: department.organization_id };
    next();
  } catch (error) { respond(req, res, error); }
});
function respond(req, res, error) {
  if (error instanceof PanelError || error instanceof ConversionError) return res.status(error.status).json({ code: error.code, message: error.message });
  if (error instanceof multer.MulterError) return res.status(400).json({ code: error.code, message: 'Превышены ограничения файлов или настроек конвертации.' });
  // Do not log exception messages, input filenames, values, or request bodies.
  const locations=error.locations||String(error.stack||'').split('\n').slice(1).flatMap(line=>line.match(/(?:src|node_modules)\/[A-Za-z0-9_./-]+:\d+:\d+/g)||[]).slice(0,5);
  logger.error('Ошибка конвертера Excel', { code: 'CONVERSION_FAILED', requestId: req.requestId, stage:req.converterStage||'scope',errorType:error.name, errorCode:/^[A-Z0-9_]{1,64}$/.test(error.code||'')?error.code:undefined,locations });
  res.status(500).json({ code: 'CONVERSION_FAILED', message: 'Не удалось обработать Excel-файлы.' });
}
for (const operation of ['preview', 'preview-object', 'export']) router.post(`/${operation}`, (req, res) => {
  if (activeRequests>=2) return res.status(429).set('Retry-After','5').json({code:'CONVERTER_BUSY',message:'Конвертер занят. Повторите через несколько секунд.'});
  if(!require('../services/infrastructure/memoryBudget').backgroundAllowed())return res.status(429).set('Retry-After','5').json({code:'CONVERTER_MEMORY_BUSY',message:'Недостаточно свободной памяти. Повторите после завершения других операций.'});
  if(Number(req.headers['content-length'])>53*1024*1024)return res.status(413).json({code:'FILES_TOO_LARGE',message:'Общий размер файлов превышает 50 МиБ.'});
  activeRequests++;let released=false;
  const release=()=>{if(!released){released=true;activeRequests--;}};
  res.once('finish',release);res.once('close',release);
  const controller=new AbortController(),abort=()=>controller.abort(Object.assign(Error('Операция отменена.'),{code:'CONVERTER_ABORTED'}));
  req.once('aborted',abort);const close=()=>{if(!res.writableEnded)abort();};res.once('close',close);
  upload(req,res,async error=>{
    try {
      if(error)throw error;
      let options;try{options=JSON.parse(req.body.options||'{}');}catch{throw new ConversionError('Некорректные настройки конвертации.');}
      if(!options||typeof options!=='object'||Array.isArray(options))throw new ConversionError('Некорректные настройки конвертации.');
      const { uploadId, rememberFiles, ...conversionOptions } = options;
      const scope = JSON.stringify([req.user.id, req.converterScope.organizationId, req.converterScope.departmentId, req.converterFormat]);
      let files = (req.files || []).map(file => ({
        originalname: require('../utils/uploadFilename').decodeUploadFilename(file.originalname),
        buffer: file.buffer
      }));
      if (uploadId != null) {
        if (typeof uploadId !== 'string' || uploadId.length !== 36 || files.length) throw new ConversionError('Некорректная ссылка на загрузку.');
        files = uploadCache.get(uploadId, scope);
        if (!files) throw new ConversionError('Временная копия файлов истекла. Повторите загрузку.', 'CONVERTER_UPLOAD_EXPIRED', 409);
      }
      if(req.converterFormat==='emergency'&&files.some(f=>!/\.txt$/i.test(f.originalname)))throw new ConversionError('В отделении ЧС конвертер принимает GeneMapper TXT.','FORMAT_NOT_AVAILABLE',403);
      const usePanels = !req.converterWorkspaceMode && conversionOptions.usePanels !== false;
      const panels = usePanels && req.converterFormat === 'genetic' ? await GenotypePanel.list(req.converterScope) : [];
      req.converterStage='conversion';
      const result=await converterWorker.run({files,options:{...conversionOptions,importFormat:req.converterFormat,usePanels,allowEmptyExcelProfiles:req.converterWorkspaceMode},panels,operation},controller.signal);
      if(controller.signal.aborted)return;
      if(result.auditFiles.length){req.converterStage='audit';await logGeneMapperConversion({userId:req.user.id,departmentId:req.converterScope.departmentId,organizationId:req.converterScope.organizationId,ipAddress:req.ip,userAgent:req.get('User-Agent'),details:{operation,files:result.auditFiles}});}
      if(!uploadId && rememberFiles === true && !controller.signal.aborted) {
        const id = uploadCache.put(scope, files);
        if (id) res.set('X-Converter-Upload-Id', id);
      }
      res.set('Cache-Control','private, no-store').type(result.mime);
      if(result.filename){const fallback=result.filename.replace(/[^\x20-\x7e]|["\\]/g,'_'),encoded=encodeURIComponent(result.filename).replace(/[!'()*]/g,c=>`%${c.charCodeAt(0).toString(16).toUpperCase()}`);res.set('Content-Disposition',`attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`);}
      res.send(result.bytes);
    }catch(error){if(!controller.signal.aborted)respond(req,res,error);}
    finally{req.off('aborted',abort);res.off('close',close);}
  });
});

async function logGeneMapperConversion({ userId, departmentId, organizationId, details, ipAddress, userAgent }) {
  await query(`INSERT INTO operation_history
    (user_id,department_id,operation_type,operation_details,ip_address,user_agent)
    VALUES ($1,$2,'GENEMAPPER_CONVERSION',$3,$4,$5)`, [userId, departmentId, JSON.stringify({ organizationId, ...details }), ipAddress, userAgent]);
}
module.exports = router;
