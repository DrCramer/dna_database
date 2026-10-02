/**
 * API маршруты для работы с профилями сотрудников
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate, adminOnly } = require('../middleware/auth');
const { logger } = require('../utils/logger');
const StaffProfileService = require('../services/staffProfileService');

// Настройка multer для загрузки файлов в память
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel' // .xls
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Неверный формат файла. Разрешены только Excel файлы (.xlsx, .xls)'));
    }
  }
});

/**
 * POST /api/staff-profiles/upload
 * Загрузка Excel файла с профилями сотрудников
 * Доступ: только admin
 */
router.post('/upload', authenticate, adminOnly, upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Файл не был загружен'
      });
    }

    const staffProfileService = new StaffProfileService(req.app.locals.pool);
    
    // Парсинг Excel файла
    const profiles = await staffProfileService.parseExcelFile(
      req.file.buffer,
      req.file.originalname
    );

    // Создание профилей в БД
    const result = await staffProfileService.createProfiles(profiles, req.user.id);

    logger.info('Профили сотрудников загружены', {
      userId: req.user.id,
      filename: req.file.originalname,
      profilesCount: result.summary.created,
      errors: result.summary.failed
    });

    res.json({
      success: true,
      profilesCount: result.summary.created,
      errors: result.errors,
      summary: result.summary
    });
  } catch (error) {
    logger.error('Ошибка загрузки профилей сотрудников', {
      error: error.message,
      userId: req.user?.id,
      filename: req.file?.originalname
    });

    res.status(400).json({
      success: false,
      error: error.message || 'Ошибка загрузки файла',
      details: error.details || {}
    });
  }
});

/**
 * GET /api/staff-profiles
 * Получение списка всех профилей сотрудников
 * Доступ: только admin
 */
router.get('/', authenticate, adminOnly, async (req, res) => {
  try {
    const staffProfileService = new StaffProfileService(req.app.locals.pool);
    const profiles = await staffProfileService.getAllProfiles();

    res.json(profiles);
  } catch (error) {
    logger.error('Ошибка получения профилей сотрудников', {
      error: error.message,
      userId: req.user?.id
    });

    res.status(500).json({
      success: false,
      error: 'Ошибка получения профилей'
    });
  }
});

/**
 * GET /api/staff-profiles/:id
 * Получение профиля сотрудника по ID с локусами
 * Доступ: только admin
 */
router.get('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const profileId = req.params.id;
    
    // Простая валидация UUID формата
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(profileId)) {
      return res.status(400).json({
        success: false,
        error: 'Неверный ID профиля'
      });
    }

    const staffProfileService = new StaffProfileService(req.app.locals.pool);
    const profile = await staffProfileService.getProfileById(profileId);

    res.json(profile);
  } catch (error) {
    logger.error('Ошибка получения профиля сотрудника', {
      error: error.message,
      profileId: req.params.id,
      userId: req.user?.id
    });

    if (error.code === 'DATABASE_ERROR' && error.message.includes('не найден')) {
      return res.status(404).json({
        success: false,
        error: 'Профиль не найден'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Ошибка получения профиля'
    });
  }
});

/**
 * DELETE /api/staff-profiles/:id
 * Удаление профиля сотрудника (мягкое удаление)
 * Доступ: только admin
 */
router.delete('/:id', authenticate, adminOnly, async (req, res) => {
  try {
    const profileId = req.params.id;
    
    // Простая валидация UUID формата
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(profileId)) {
      return res.status(400).json({
        success: false,
        error: 'Неверный ID профиля'
      });
    }

    const staffProfileService = new StaffProfileService(req.app.locals.pool);
    const result = await staffProfileService.deleteProfile(profileId);

    logger.info('Профиль сотрудника удален', {
      profileId,
      userId: req.user.id,
      fullName: result.profile.full_name
    });

    res.json({
      success: true,
      message: 'Профиль успешно удален'
    });
  } catch (error) {
    logger.error('Ошибка удаления профиля сотрудника', {
      error: error.message,
      profileId: req.params.id,
      userId: req.user?.id
    });

    if (error.code === 'DATABASE_ERROR' && error.message.includes('не найден')) {
      return res.status(404).json({
        success: false,
        error: 'Профиль не найден'
      });
    }

    res.status(500).json({
      success: false,
      error: 'Ошибка удаления профиля'
    });
  }
});

module.exports = router;
