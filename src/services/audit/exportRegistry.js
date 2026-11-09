const fs = require('node:fs/promises');
const path = require('node:path');
const fail = (status) => Object.assign(new Error(status === 403 ? 'Экспорт недоступен.' : 'Экспорт не найден или истёк.'), { status });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
class ExportRegistry {
  constructor(directory) { this.directory = directory; }
  async register(id, filename, owner) {
    if (!uuid.test(id) || path.basename(filename) !== filename || !owner.userId || !owner.departmentId || !owner.organizationId) throw fail(403);
    await fs.mkdir(this.directory, { recursive: true });
    await fs.writeFile(path.join(this.directory, id + '.json'), JSON.stringify({ filename, ...owner, expiresAt: Date.now() + 24 * 3600 * 1000 }), { mode: 0o600, flag: 'wx' });
  }
  async get(id, context) {
    if (!uuid.test(id)) throw fail(404);
    try {
      const metadataPath = path.join(this.directory, id + '.json');
      if (!(await fs.lstat(metadataPath)).isFile()) throw fail(404);
      const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
      if (metadata.userId !== context?.userId || metadata.departmentId !== context?.departmentId || metadata.organizationId !== context?.organizationId) throw fail(403);
      if (!Number.isFinite(metadata.expiresAt) || metadata.expiresAt <= Date.now() || path.basename(metadata.filename) !== metadata.filename) throw fail(404);
      const filePath = path.join(this.directory, metadata.filename), stats = await fs.lstat(filePath);
      if (!stats.isFile()) throw fail(404);
      return { filePath, filename: metadata.filename, size: stats.size, mimeType: metadata.filename.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
    } catch (error) { if (error.status) throw error; throw fail(404); }
  }
}
module.exports = { ExportRegistry };
