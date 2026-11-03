const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const writeFlushed = (filename, data) => {
  const descriptor = fs.openSync(filename, "wx", 0o600);
  try { fs.writeFileSync(descriptor, data); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
};
const ensureFolder = (root) => {
  if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw new Error("CUSTOM_UNSAFE_FOLDER");
  fs.mkdirSync(root, { recursive: true });
  return fs.realpathSync(root);
};

class FolderProvider {
  constructor(root, namespace) { this.root = ensureFolder(path.join(root, `KoodoReaderCustom-v1-${namespace}`)); }
  async read() {
    const { filePattern, latest, decode, MAX_DOCUMENT } = await import("./megaTransport.mjs");
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
    const { documentName, decode, obsolete, MAX_DOCUMENT } = await import("./megaTransport.mjs");
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


module.exports = { FolderProvider, writeFlushed };
