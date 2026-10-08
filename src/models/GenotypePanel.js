const { query, transaction } = require('../config/database');
const { ALL_LOCI, LociTypeDetector } = require('../utils/lociTypeDetector');
const { resolveProfileImportFormat } = require('../utils/profileImportFormat');
const detector = new LociTypeDetector();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const referenceIds = `COALESCE((SELECT array_agg(r.reference_set_id ORDER BY r.reference_set_id)
  FROM genotype_panel_references r WHERE r.panel_id=p.id), '{}') AS reference_set_ids`;

class PanelError extends Error {
  constructor(message, status = 400, code = 'INVALID_PANEL') {
    super(message); this.status = status; this.code = code;
  }
}

class GenotypePanel {
  static toJSON(row) {
    return row ? {
      id: row.id, name: row.name, description: row.description,
      lociOrder: row.loci_order, isActive: row.is_active, referenceSetIds: row.reference_set_ids || [],
      organizationId: row.organization_id, departmentId: row.department_id,
      createdAt: row.created_at, updatedAt: row.updated_at
    } : null;
  }

  static catalog() { return ALL_LOCI.map(name => ({ name, type: detector.detectLocusType(name) })); }

  static validate(data) {
    if (typeof data.name !== 'string' || !data.name.trim() || data.name.trim().length > 150) throw new PanelError('Укажите название панели длиной до 150 символов.');
    if (data.description != null && (typeof data.description !== 'string' || data.description.length > 10000)) throw new PanelError('Описание должно быть текстом длиной до 10000 символов.');
    if (!Array.isArray(data.lociOrder) || !data.lociOrder.length || data.lociOrder.length > ALL_LOCI.length) throw new PanelError('Добавьте хотя бы один поддерживаемый локус в упорядоченный список.');
    const lociOrder = data.lociOrder.map(value => {
      if (typeof value !== 'string' || !value.trim()) throw new PanelError('Название локуса не может быть пустым.');
      const name = detector.getCanonicalLocusName(value);
      if (!name) throw new PanelError(`Локус ${value} пока не поддерживается системой. Сначала добавьте его в каталог поддерживаемых локусов.`);
      return name;
    });
    if (new Set(lociOrder).size !== lociOrder.length) throw new PanelError('Локусы в панели не должны повторяться.');
    if (data.isActive !== undefined && typeof data.isActive !== 'boolean') throw new PanelError('Активность панели должна быть логическим значением.');
    if (data.referenceSetIds != null && (!Array.isArray(data.referenceSetIds) || data.referenceSetIds.length > 100 || data.referenceSetIds.some(id => !uuid.test(id)) || new Set(data.referenceSetIds).size !== data.referenceSetIds.length)) throw new PanelError('Некорректный список референсных наборов.');
    return { name: data.name.trim(), description: data.description?.trim() || null, lociOrder, isActive: data.isActive ?? true, referenceSetIds: data.referenceSetIds };
  }

  static async scope(context) {
    const departmentId = context.departmentId || context.activeDepartmentId;
    if (!uuid.test(departmentId || '')) throw new PanelError('Не выбрано активное отделение.', 403);
    const result = await query('SELECT id, name, organization_id FROM departments WHERE id = $1 AND is_active = true', [departmentId]);
    const dept = result.rows[0];
    if (!dept || (context.role !== 'system_administrator' && dept.organization_id !== context.organizationId)) throw new PanelError('Отделение недоступно.', 403);
    if (resolveProfileImportFormat(dept) !== 'genetic') throw new PanelError('Панели доступны для отделения «Генетические экспертизы».', 403);
    return { departmentId, organizationId: dept.organization_id };
  }

  static async list(scope, includeInactive = false) {
    const result = await query(`SELECT p.*, ${referenceIds} FROM genotype_panels p WHERE organization_id = $1 AND department_id = $2 ${includeInactive ? '' : 'AND is_active = true'} ORDER BY lower(name), id`, [scope.organizationId, scope.departmentId]);
    return result.rows.map(this.toJSON);
  }

  static async find(id, scope, activeOnly = false) {
    if (!uuid.test(id || '')) throw new PanelError('Некорректный идентификатор панели.');
    const result = await query(`SELECT p.*, ${referenceIds} FROM genotype_panels p WHERE id = $1 AND organization_id = $2 AND department_id = $3 ${activeOnly ? 'AND is_active = true' : ''}`, [id, scope.organizationId, scope.departmentId]);
    if (!result.rows.length) throw new PanelError('Панель не найдена в активном отделении или недоступна.', 404, 'PANEL_NOT_FOUND');
    return this.toJSON(result.rows[0]);
  }

  static async create(data, scope, userId) {
    const value = this.validate(data);
    return transaction(async client => {
      const result = await client.query(`INSERT INTO genotype_panels (organization_id, department_id, name, description, loci_order, created_by, updated_by, is_active) VALUES ($1,$2,$3,$4,$5,$6,$6,$7) RETURNING *`, [scope.organizationId, scope.departmentId, value.name, value.description, JSON.stringify(value.lociOrder), userId, value.isActive]);
      await this.linkReferences(client, result.rows[0].id, value.referenceSetIds || [], scope, userId);
      return this.toJSON({ ...result.rows[0], reference_set_ids: value.referenceSetIds || [] });
    });
  }

  static async update(id, data, scope, userId) {
    const previous = await this.find(id, scope);
    const value = this.validate(data);
    return transaction(async client => {
      const result = await client.query(`UPDATE genotype_panels SET name=$4, description=$5, loci_order=$6, is_active=$7, updated_by=$8, updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND department_id=$3 RETURNING *`, [id, scope.organizationId, scope.departmentId, value.name, value.description, JSON.stringify(value.lociOrder), value.isActive, userId]);
      if (value.referenceSetIds !== undefined) await this.linkReferences(client, id, value.referenceSetIds, scope, userId);
      return this.toJSON({ ...result.rows[0], reference_set_ids: value.referenceSetIds ?? previous.referenceSetIds });
    });
  }

  static async linkReferences(client, id, ids, scope, userId) {
    if (ids.length) {
      const available = await client.query('SELECT id FROM allele_reference_sets WHERE id=ANY($1::uuid[]) AND organization_id=$2 AND department_id=$3 FOR SHARE', [ids, scope.organizationId, scope.departmentId]);
      if (available.rows.length !== ids.length) throw new PanelError('Справочник недоступен в активном отделении.', 404, 'REFERENCE_NOT_FOUND');
    }
    await client.query('DELETE FROM genotype_panel_references WHERE panel_id=$1', [id]);
    if (ids.length) await client.query(`INSERT INTO genotype_panel_references (panel_id,reference_set_id,organization_id,department_id,linked_by)
      SELECT $1, unnest($2::uuid[]), $3, $4, $5`, [id, ids, scope.organizationId, scope.departmentId, userId]);
  }

  static async deactivate(id, scope, userId) {
    const previous = await this.find(id, scope);
    const result = await query(`UPDATE genotype_panels SET is_active=false, updated_by=$4, updated_at=CURRENT_TIMESTAMP WHERE id=$1 AND organization_id=$2 AND department_id=$3 RETURNING *`, [id, scope.organizationId, scope.departmentId, userId]);
    return this.toJSON({ ...result.rows[0], reference_set_ids: previous.referenceSetIds });
  }

  // Ручной выбор сейчас и detectedPanelId будущего парсера используют один путь.
  static async resolveAssignment({ panelId, detectedPanelId, importFormat, ...context }) {
    const id = panelId || detectedPanelId;
    if (!id) return null;
    if (importFormat !== 'genetic') throw new PanelError('Панель можно назначить только генетическим профилям.');
    const scope = await this.scope(context);
    return this.find(id, scope, true);
  }

  static compareLoci(panel, actual) {
    if (!panel) return [];
    const expected = panel.lociOrder;
    const warnings = [];
    const missing = expected.filter(name => !actual.includes(name));
    const extra = actual.filter(name => !expected.includes(name));
    if (missing.length) warnings.push(`В файле отсутствуют локусы панели: ${missing.join(', ')}.`);
    if (extra.length) warnings.push(`В файле присутствуют дополнительные локусы: ${extra.join(', ')}.`);
    if (actual.filter(name => expected.includes(name)).join('|') !== expected.filter(name => actual.includes(name)).join('|')) warnings.push('Порядок локусов в файле отличается от панели. Анализ использует порядок панели; значения импортируются по заголовкам.');
    return warnings;
  }
}
module.exports = { GenotypePanel, PanelError };
