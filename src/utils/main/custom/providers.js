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
  // Storage.close() sends `sml` (logout), invalidating the session saved on disk.
  // Stop polling locally while keeping the reusable server-side session alive.
  storage.api.close();
};
const megaDirectories = new WeakMap();
const prepareMegaStorage = (storage) => {
  storage.api.keepalive = false;
  const state = { sequence: null };
  megaDirectories.set(storage, state);
  const request = storage.api.request.bind(storage.api);
  const orderTree = (reply) => {
    if (!Array.isArray(reply?.f) || typeof reply.sn !== "string") throw new Error("CUSTOM_MEGA_INVALID_TREE");
    const nodes = new Map(), children = new Map(), ordered = [];
    for (const node of reply.f) {
      if (!node || typeof node.h !== "string" || (node.p && typeof node.p !== "string") || nodes.has(node.h)) throw new Error("CUSTOM_MEGA_INVALID_TREE");
      nodes.set(node.h, node);
      if (node.p) {
        if (!children.has(node.p)) children.set(node.p, []);
        children.get(node.p).push(node);
      }
    }
    for (const node of reply.f) if (!node.p || !nodes.has(node.p)) ordered.push(node);
    for (let index = 0; index < ordered.length; index++) for (const child of children.get(ordered[index].h) || []) ordered.push(child);
    if (ordered.length !== reply.f.length) throw new Error("CUSTOM_MEGA_INVALID_TREE");
    state.sequence = reply.sn;
    // The SDK links a child only when its parent was imported earlier. MEGA's
    // listing order is not reliable, so normalize it before reload imports nodes.
    return { ...reply, f: ordered };
  };
  storage.api.request = (command, callback, attempt) => {
    if (command?.a !== "f" || command.c !== 1) return request(command, callback, attempt);
    if (typeof callback !== "function") return request(command, callback, attempt).then(orderTree);
    return request(command, (error, reply) => {
      if (error) return callback(error);
      let ordered;
      try { ordered = orderTree(reply); } catch (failure) { return callback(failure); }
      callback(null, ordered);
    }, attempt);
  };
  return storage;
};
const catchUpMegaStorage = async (storage) => {
  const state = megaDirectories.get(storage);
  if (!state?.sequence) throw new Error("CUSTOM_MEGA_INVALID_TREE");
  // A full MEGA listing may be a cached baseline. With keepalive disabled we
  // must explicitly consume its server-client changes before looking for files.
  for (let count = 0; count < 32; count++) {
    const query = new URLSearchParams({ sn: state.sequence, sid: storage.api.sid, ssl: "1" });
    const response = await storage.api.fetch(`${storage.api.gateway}sc?${query}`, { method: "POST" });
    if (!response.ok) throw new Error("CUSTOM_MEGA_NETWORK_FAILED");
    const packet = await response.json();
    if (packet === -15) throw new Error("CUSTOM_MEGA_AUTH_FAILED");
    if (typeof packet === "number") throw new Error("CUSTOM_MEGA_NETWORK_FAILED");
    if (!packet || typeof packet !== "object" || (packet.a !== undefined && !Array.isArray(packet.a))) throw new Error("CUSTOM_MEGA_INVALID_TREE");
    if (packet.a?.length) {
      const incoming = new Set(packet.a.flatMap((event) => event?.a === "t" && Array.isArray(event.t?.f) ? event.t.f.map((node) => node.h) : []));
      const events = packet.a.filter((event) => event?.a !== "d" || storage.files[event.n] || incoming.has(event.n));
      // MEGA may repeat a deletion already reflected in the listing. Also,
      // SDK reload() adds another SC listener; apply each packet just once.
      const handlers = storage.api.listeners("sc"), handler = handlers.at(-1);
      if (!handler) throw new Error("CUSTOM_MEGA_INVALID_TREE");
      if (events.length) handler.call(storage.api, events);
    }
    if (typeof packet.sn === "string") state.sequence = packet.sn;
    if (typeof packet.w === "string" && packet.w) return;
    if (packet.w !== undefined && typeof packet.w !== "string") throw new Error("CUSTOM_MEGA_INVALID_TREE");
    if (typeof packet.sn !== "string") throw new Error("CUSTOM_MEGA_INVALID_TREE");
  }
  throw new Error("CUSTOM_PROVIDER_TIMEOUT");
};
const megaTransfer = {
  forceHttps: true,
  maxConnections: 2,
  // A fresh sync can safely retry its immutable snapshot. Do not leave the SDK's
  // background transfer retries running after the enclosing operation has failed.
  handleRetries: (_attempt, error, done) => done(error),
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
    for (const file of selected) documents.push(decode(file.name, await file.downloadBuffer(megaTransfer)));
    return documents;
  }
  async append(document) {
    const text = JSON.stringify(document), name = documentName(document, text), buffer = Buffer.from(text);
    if (buffer.length > MAX_DOCUMENT) throw new Error("CUSTOM_DOCUMENT_LIMIT");
    const folders = await this.folders(true);
    let published = folders.flatMap((folder) => folder.children || []).find((file) => !file.directory && file.name === name);
    if (!published) published = await new Promise((resolve, reject) => {
      const stream = folders[0].upload({ ...megaTransfer, name, size: buffer.length }, buffer, (error, file) => error ? reject(error) : resolve(file));
      stream.on("error", reject);
    });
    decode(name, await published.downloadBuffer(megaTransfer));
    for (const file of obsolete(folders.flatMap((folder) => folder.children || []).filter((file) => !file.directory), document.deviceId)) {
      try { if (file.size <= MAX_DOCUMENT) { decode(file.name, await file.downloadBuffer(megaTransfer)); await file.delete(false); } }
      catch { /* Failure to prune history must not invalidate a verified upload. */ }
    }
  }
  async close() { await closeStorage(this.storage); }
}

module.exports = { FolderProvider, MegaProvider, prepareMegaStorage, catchUpMegaStorage, latest, decode, documentName, MAX_DOCUMENT, writeFlushed, closeStorage };
