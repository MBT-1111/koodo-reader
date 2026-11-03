import crypto from "crypto";
import { Buffer } from "buffer";

const MAX_DOCUMENT = 20 * 1024 * 1024;
const filePattern = /^([0-9a-f-]{36})-(\d{16})-([0-9a-f]{16})\.json$/;
const sha = (value) => crypto.createHash("sha256").update(value).digest("hex");
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
    if (packet.a?.length) storage.api.emit("sc", packet.a);
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


export { MegaProvider, prepareMegaStorage, catchUpMegaStorage, latest, decode, documentName, obsolete, filePattern, MAX_DOCUMENT, closeStorage };
