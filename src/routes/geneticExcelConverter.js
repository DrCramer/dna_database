const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { GenotypePanel, PanelError } = require('../models/GenotypePanel');
const { GeneticExcelConverterService, ConversionError } = require("../services/converters/geneticExcelConverterService");
const { logger } = require('../utils/logger');
const { AlleleReferenceService } = require("../services/profiles/alleleReferenceService");
const { ReferenceError } = require('../utils/alleleReferenceImport');
const { ALL_LOCI } = require('../utils/lociTypeDetector');
const { normalizedExcelFilename } = require('../utils/normalizedExcelLayout');
const { geneMapperExportResult } = require('../services/converters/geneMapperSourceAdapter');
const { resolveProfileImportFormat } = require('../utils/profileImportFormat');
const JSZip = require('jszip');
const { query } = require('../config/database');
const converter = new GeneticExcelConverterService();
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
  if (error instanceof PanelError || error instanceof ConversionError || error instanceof ReferenceError) return res.status(error.status).json({ code: error.code, message: error.message });
  if (error instanceof multer.MulterError) return res.status(400).json({ code: error.code, message: 'Превышены ограничения файлов или настроек конвертации.' });
  logger.error('Ошибка конвертера Excel', { code: 'CONVERSION_FAILED', requestId: req.requestId });
  res.status(500).json({ code: 'CONVERSION_FAILED', message: 'Не удалось обработать Excel-файлы.' });
}
for (const operation of ['preview', 'export']) router.post(`/${operation}`, (req, res) => {
  if (Number(req.headers['content-length']) > 53 * 1024 * 1024) return res.status(413).json({ code: 'FILES_TOO_LARGE', message: 'Общий размер файлов превышает 50 МиБ.' });
  upload(req, res, async error => {
    try {
      if (error) throw error;
      let options;
      try { options = JSON.parse(req.body.options || '{}'); } catch { throw new ConversionError('Некорректные настройки конвертации.'); }
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new ConversionError('Некорректные настройки конвертации.');
      for (const file of req.files || []) {
        const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
        if (/[ÐÑÃÂ]/.test(file.originalname) && !decoded.includes('\uFFFD')) file.originalname = decoded;
      }
      if (req.converterFormat === 'emergency' && req.files.some(file => !/\.txt$/i.test(file.originalname))) throw new ConversionError('В отделении ЧС конвертер принимает GeneMapper TXT. Готовый Excel загружайте обычным способом.', 'FORMAT_NOT_AVAILABLE', 403);
      const panels = req.converterFormat === 'genetic' ? await GenotypePanel.list(req.converterScope) : [];
      const references = req.converterFormat === 'genetic' ? await AlleleReferenceService.load(req.converterScope, options.reference, panels, ALL_LOCI) : null;
      const result = converter.convert(req.files, { ...options, importFormat: req.converterFormat }, panels, references);
      if (result.preparedFiles.length) {
        const legacy = legacyResult(result);
        result.legacyCanImport = legacy.canImport;
        result.legacyCanUpload = legacy.canImport && legacy.profiles.every(profile => profile.year != null);
        await logGeneMapperConversion({ userId: req.user.id,
          departmentId: req.converterScope.departmentId, organizationId: req.converterScope.organizationId, ipAddress: req.ip, userAgent: req.get('User-Agent'),
          details: { operation, files: result.files.filter(file => file.geneMapper).map(file => ({ fileId: file.id, filename: file.name, year: file.year,
            panels: file.geneMapper.panelNames, summary: file.geneMapper.summary,
            haploidDuplicatesConfirmed: options.files?.[file.id]?.confirmHaploidDuplicates === true,
            excludedObjects: file.geneMapper.samples.filter(sample => !sample.exportable).map(sample => ({ name: sample.sampleName, category: sample.classification, status: sample.status })) })) }
        });
      }
      res.set('Cache-Control', 'private, no-store');
      if (operation === 'preview') {
        // Готовые XLSX создаются сразу; исходные файлы и результаты не пишутся на диск.
        for (const file of result.preparedFiles) if (file.ready) file.base64 = converter.export(geneMapperExportResult(result, file.fileId), options.export).toString('base64');
        return res.json(result);
      }
      if (options.export?.fileId) {
        let selected;
        try { selected = geneMapperExportResult(result, options.export.fileId); } catch (error) { throw new ConversionError(error.message, 'UNRESOLVED_CONVERSION', 409); }
        return sendExcel(res, converter.export(selected, options.export), selected.filename, true);
      }
      if (result.preparedFiles.length && !options.export?.legacyOnly) {
        const zip = new JSZip();
        const ready = result.preparedFiles.filter(file => file.ready);
        if (!ready.length) throw new ConversionError('Нет допустимых профилей для экспорта.', 'UNRESOLVED_CONVERSION', 409);
        for (const file of ready) zip.file(file.filename, converter.export(geneMapperExportResult(result, file.fileId), options.export));
        return res.type('application/zip').set('Content-Disposition', 'attachment; filename="GeneMapper_Export.zip"').send(await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
      }
      const legacy = options.export?.legacyOnly ? legacyResult(result) : result;
      const buffer = converter.export(legacy, options.export);
      sendExcel(res, buffer, normalizedExcelFilename(legacy.profiles));
    } catch (caught) { respond(req, res, caught); }
  });
});
async function logGeneMapperConversion({ userId, departmentId, organizationId, details, ipAddress, userAgent }) {
  await query(`INSERT INTO operation_history
    (user_id,department_id,operation_type,operation_details,ip_address,user_agent)
    VALUES ($1,$2,'GENEMAPPER_CONVERSION',$3,$4,$5)`, [userId, departmentId, JSON.stringify({ organizationId, ...details }), ipAddress, userAgent]);
}
function legacyResult(result) {
  const fileIds = new Set(result.files.filter(file => !file.geneMapper).map(file => file.id));
  const profiles = result.profiles.filter(profile => profile.sources.every(source => fileIds.has(source.fileId)));
  const canImport = profiles.length > 0 && !result.issues.some(issue => issue.hard && (fileIds.has(issue.fileId) || issue.profileKey && profiles.some(profile => profile.key === issue.profileKey)));
  return { ...result, profiles, canImport };
}
function sendExcel(res, buffer, filename, geneMapper = false) {
  const fallback = geneMapper ? filename.replace(/[^\x20-\x7e]|["\\]/g, '_') : 'DNA-normalized.xlsx';
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
  return res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`).send(buffer);
}
module.exports = router;
