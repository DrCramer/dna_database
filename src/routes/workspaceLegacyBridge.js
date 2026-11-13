const express = require('express');
const {
  authenticate
} = require('../middleware/auth');
const {
  workspaceModeEnabled
} = require('../services/workspace/workspaceMode');
const {
  query
} = require('../config/database');
const {
  decodeMasterRow
} = require('../services/converters/masterArrayExcelExportService');
const router = express.Router();
router.use((req, res, next) => workspaceModeEnabled() ? authenticate(req, res, next) : next('router'));
router.use((req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  if (!['GET', 'HEAD'].includes(req.method)) return res.status(409).json({
    code: 'IMPORT_DRAFT_REQUIRED',
    message: 'Используйте загрузку в личный массив и серверный полный поиск. Архивные маршруты записи отключены.'
  });
  next();
});
function dto(p, source) {
  return {
    id: p.id,
    year: p.year,
    internal_number: p.internal_number,
    import_number: p.import_number,
    sample_name: p.expertise_type === 'staff' ? p.internal_number : p.sample_name,
    str_data: p.str_data,
    strData: p.str_data,
    objectNumber: p.internal_number,
    expertiseType: p.expertise_type,
    fullName: p.full_name || null,
    comment: p.comment || '',
    metadata: p.metadata || {},
    master_array_id: p.master_array_id,
    organization_id: p.organization_id,
    department_id: p.department_id || null,
    created_at: p.created_at,
    updated_at: p.updated_at,
    is_active: p.is_active,
    panelId: p.metadata?.panelId || p.panel_id || null,
    panelName: p.metadata?.panelName || null,
    source
  };
}
router.get(['/', '/search', '/accessible', '/master-objects/search', '/:id', '/master-objects/:id'], async (req, res, next) => {
  if (req.params.id && !/^[0-9a-f-]{36}$/i.test(req.params.id)) return next();
  try {
    const org = req.user.organization_id;
    if (!org) return res.status(403).json({
      message: 'Нет организации.'
    });
    const onlyMaster = req.path.startsWith('/master-objects'),
      specific = req.params.id;
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit, 10) || 50)),
      offset = Math.max(0, parseInt(req.query.offset, 10) || 0);
    const params = [org, req.user.id],
      clauses = ["organization_id=$1"];
    if (specific) {
      params.push(specific);
      clauses.push(`id=$${params.length}::uuid`);
    }
    if (req.query.q) {
      params.push('%' + String(req.query.q).replace(/[\\%_]/g, '\\$&') + '%');
      clauses.push(`(internal_number ILIKE $${params.length} ESCAPE '\\' OR sample_name ILIKE $${params.length} ESCAPE '\\')`);
    }
    params.push(limit, offset);
    const source = `SELECT p.id,p.organization_id,p.internal_number,p.sample_name,to_jsonb(p) record,CASE WHEN p.profile_type='master' THEN 'legacy_master' ELSE 'user' END source FROM dna_profiles p WHERE p.is_active=true AND (p.user_id=$2 OR p.profile_type='master')
 UNION ALL SELECT p.id,p.organization_id,p.internal_number,p.sample_name,to_jsonb(p),'master' FROM master_array_profiles p JOIN master_arrays ma ON ma.id=p.master_array_id WHERE p.is_active=true AND ma.is_active=true`;
    const result = await query(`WITH profiles AS (${source}) SELECT * FROM profiles WHERE ${clauses.join(' AND ')} ${onlyMaster ? "AND source IN ('master','legacy_master')" : ''} ORDER BY internal_number,id LIMIT $${params.length - 1} OFFSET $${params.length}`, params);
    const profiles = result.rows.map(row => dto(decodeMasterRow(row.record), row.source));
    if (specific) {
      if (!profiles.length) return res.status(404).json({
        message: 'Профиль не найден.'
      });
      return res.json({
        success: true,
        profile: profiles[0],
        data: profiles[0],
        object: profiles[0]
      });
    }
    res.json({
      success: true,
      profiles,
      data: profiles,
      objects: profiles,
      total: profiles.length,
      limit,
      offset
    });
  } catch (e) {
    res.status(500).json({
      message: 'Не удалось прочитать разрешённые профили.'
    });
  }
});
router.use((req, res) => res.status(410).json({
  message: 'Для текущего рабочего процесса используйте /api/workspace. История доступна в архиве задач.'
}));
module.exports = router;
