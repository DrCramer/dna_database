const { randomUUID } = require('node:crypto');

class ConverterUploadCache {
  constructor({ maxBytes = 64 * 1024 * 1024, maxEntries = 8, ttlMs = 10 * 60 * 1000 } = {}) {
    this.maxBytes = maxBytes;
    this.maxEntries = maxEntries;
    this.ttlMs = ttlMs;
    this.entries = new Map();
    this.bytes = 0;
  }

  put(scope, files) {
    const bytes = files.reduce((total, file) => total + file.buffer.length, 0);
    if (!scope || !files.length || bytes > this.maxBytes) return null;
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.maxBytes) {
      this.remove(this.entries.keys().next().value);
    }
    const id = randomUUID();
    this.bytes += bytes;
    this.touch(id, { scope, files, bytes });
    return id;
  }

  get(id, scope) {
    const entry = this.entries.get(id);
    if (!entry || entry.scope !== scope) return null;
    if (entry.expiresAt <= Date.now()) {
      this.remove(id);
      return null;
    }
    this.touch(id, entry);
    return entry.files;
  }

  touch(id, entry) {
    clearTimeout(entry.timer);
    entry.expiresAt = Date.now() + this.ttlMs;
    entry.timer = setTimeout(() => this.remove(id), this.ttlMs).unref();
    this.entries.delete(id);
    this.entries.set(id, entry);
  }

  remove(id) {
    const entry = this.entries.get(id);
    if (!entry) return;
    clearTimeout(entry.timer);
    this.bytes -= entry.bytes;
    this.entries.delete(id);
  }
}

module.exports = { ConverterUploadCache };
