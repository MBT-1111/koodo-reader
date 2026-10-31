const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MAX_DOCUMENT = 20 * 1024 * 1024;
const filePattern = /^([0-9a-f-]{36})-(\d{16})-([0-9a-f]{16})\.json$/;
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
const writeFlushed = (filename, data) => {
  const descriptor = fs.openSync(filename, "wx", 0o600);
  try { fs.writeFileSync(descriptor, data); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
};
const closeStorage = async (storage) => {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(() => storage.close()).catch(() => undefined),
      new Promise((resolve) => { timer = setTimeout(resolve, 3000); }),
    ]);
  } finally { clearTimeout(timer); }
};
const documentName = (document, text) => `${document.deviceId}-${String(document.sequence).padStart(16, "0")}-${sha(text).slice(0, 16)}.json`;

// Keep tied latest generations so an actor fork is not silently discarded.
const latest = (files) => {
  const generations = new Map();
  for (const file of files) {
    const match = filePattern.exec(file.name);
    if (match) generations.set(match[1], Math.max(generations.get(match[1]) || 0, Number(match[2])));
  }
  return files.filter((f) => { const m = filePattern.exec(f.name); return m && Number(m[2]) === generations.get(m[1]); });
};
const decode = (name, buffer) => {
  const match = filePattern.exec(name);
  if (!match || buffer.length > MAX_DOCUMENT || sha(buffer).slice(0, 16) !== match[3]) throw new Error("CUSTOM_CORRUPT_DOCUMENT");
  let document;
  try { document = JSON.parse(buffer.toString("utf8")); } catch { throw new Error("CUSTOM_CORRUPT_DOCUMENT"); }
  if (document.deviceId !== match[1] || document.sequence !== Number(match[2])) throw new Error("CUSTOM_CORRUPT_DOCUMENT");
  return document;
};
const obsolete = (files, deviceId) => {
  const owned = files.filter((file) => filePattern.exec(file.name)?.[1] === deviceId);
  const generations = [...new Set(owned.map((file) => Number(filePattern.exec(file.name)[2])))].sort((a, b) => b - a);
  const keep = new Set(generations.slice(0, 3));
  return owned.filter((file) => !keep.has(Number(filePattern.exec(file.name)[2])));
};
const ensureFolder = (root) => {
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error("CUSTOM_UNSAFE_FOLDER");
  fs.mkdirSync(root, { recursive: true });
  return fs.realpathSync(root);
};

class FolderProvider {
  constructor(root, namespace) { this.root = ensureFolder(path.join(root, `KoodoReaderCustom-v1-${namespace}`)); }
  async read() {
    const files = fs.readdirSync(this.root).filter((name) => filePattern.test(name)).map((name) => ({ name }));
    if (files.length > 20000) throw new Error("CUSTOM_HISTORY_LIMIT");
    const selected = latest(files);
    if (selected.length > 1024) throw new Error("CUSTOM_DEVICE_LIMIT");
    let size = 0;
    return selected.map(({ name }) => {
      const filename = path.join(this.root, name), stat = fs.lstatSync(filename);
      size += stat.size;
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DOCUMENT || size > 100 * 1024 * 1024) throw new Error("CUSTOM_DOCUMENT_LIMIT");
      return decode(name, fs.readFileSync(filename));
    });
  }
  async append(document) {
    const text = JSON.stringify(document), name = documentName(document, text);
    if (Buffer.byteLength(text) > MAX_DOCUMENT) throw new Error("CUSTOM_DOCUMENT_LIMIT");
    const destination = path.join(this.root, name), temporary = path.join(this.root, `${crypto.randomUUID()}.tmp`);
    if (fs.existsSync(destination)) decode(name, fs.readFileSync(destination));
    else try {
      writeFlushed(temporary, text);
      fs.renameSync(temporary, destination);
    } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    decode(name, fs.readFileSync(destination));
    for (const file of obsolete(fs.readdirSync(this.root).map((name) => ({ name })), document.deviceId)) {
      const filename = path.join(this.root, file.name), stat = fs.lstatSync(filename);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_DOCUMENT) continue;
      // Only prune verified snapshots created by this protocol and this actor.
      try { decode(file.name, fs.readFileSync(filename)); fs.unlinkSync(filename); } catch { /* Retain unrecognized/corrupt history for recovery. */ }
    }
  }
  async close() {}
}

class MegaProvider {
  constructor(storage, namespace) { this.storage = storage; this.name = `KoodoReaderCustom-v1-${namespace}`; }
  async folders(create = false) {
    const matches = (this.storage.root.children || []).filter((f) => f.directory && f.name === this.name);
    if (matches.length) return matches.sort((a, b) => String(a.nodeId).localeCompare(String(b.nodeId)));
    return create ? [await this.storage.root.mkdir(this.name)] : [];
  }
  async read() {
    const folders = await this.folders();
    const files = folders.flatMap((folder) => (folder.children || []).filter((f) => !f.directory && filePattern.test(f.name)));
    if (files.length > 20000) throw new Error("CUSTOM_HISTORY_LIMIT");
    const selected = latest(files);
    if (selected.length > 1024 || selected.reduce((sum, file) => sum + (file.size || MAX_DOCUMENT + 1), 0) > 100 * 1024 * 1024 || selected.some((file) => file.size > MAX_DOCUMENT)) throw new Error("CUSTOM_DOCUMENT_LIMIT");
    const documents = [];
    for (const file of selected) documents.push(decode(file.name, await file.downloadBuffer({ maxConnections: 1 })));
    return documents;
  }
  async append(document) {
    const text = JSON.stringify(document), name = documentName(document, text), buffer = Buffer.from(text);
    if (buffer.length > MAX_DOCUMENT) throw new Error("CUSTOM_DOCUMENT_LIMIT");
    const folders = await this.folders(true);
    let published = folders.flatMap((folder) => folder.children || []).find((file) => !file.directory && file.name === name);
    if (!published) published = await new Promise((resolve, reject) => {
      const stream = folders[0].upload({ name, size: buffer.length }, buffer, (error, file) => error ? reject(error) : resolve(file));
      stream.on("error", reject);
    });
    decode(name, await published.downloadBuffer({ maxConnections: 1 }));
    for (const file of obsolete(folders.flatMap((folder) => folder.children || []).filter((file) => !file.directory), document.deviceId)) {
      try { if (file.size <= MAX_DOCUMENT) { decode(file.name, await file.downloadBuffer({ maxConnections: 1 })); await file.delete(false); } }
      catch { /* Failure to prune history must not invalidate a verified upload. */ }
    }
  }
  async close() { await closeStorage(this.storage); }
}

module.exports = { FolderProvider, MegaProvider, latest, decode, documentName, MAX_DOCUMENT, writeFlushed, closeStorage };
