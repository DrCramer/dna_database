const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { GenotypePanel, PanelError } = require('../models/GenotypePanel');
const { GeneticExcelConverterService, ConversionError } = require('../services/geneticExcelConverterService');
const { logger } = require('../utils/logger');
const converter = new GeneticExcelConverterService();
// Busboy сообщает partsLimit при достижении порога: 100 файлов + options должны проходить целиком.
const upload = multer({ storage: multer.memoryStorage(), limits: { files: 100, fileSize: 10 * 1024 * 1024, fieldSize: 2 * 1024 * 1024, fields: 1, parts: 102 } }).array('files', 100);
router.use(authenticate);
router.use(async (req, res, next) => {
  try {
    req.converterScope = await GenotypePanel.scope({ departmentId: req.activeDepartmentId, organizationId: req.user.organization_id, role: req.user.role });
    next();
  } catch (error) { respond(req, res, error); }
});
function respond(req, res, error) {
  if (error instanceof PanelError || error instanceof ConversionError) return res.status(error.status).json({ code: error.code, message: error.message });
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
      for (const file of req.files || []) {
        const decoded = Buffer.from(file.originalname, 'latin1').toString('utf8');
        if (/[ÐÑÃÂ]/.test(file.originalname) && !decoded.includes('\uFFFD')) file.originalname = decoded;
      }
      const result = converter.convert(req.files, options, await GenotypePanel.list(req.converterScope));
      res.set('Cache-Control', 'private, no-store');
      if (operation === 'preview') return res.json(result);
      const buffer = converter.export(result);
      res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').set('Content-Disposition', 'attachment; filename="DNA-normalized.xlsx"').send(buffer);
    } catch (caught) { respond(req, res, caught); }
  });
});
module.exports = router;
