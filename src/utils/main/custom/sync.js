const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { FolderProvider, MegaProvider, MAX_DOCUMENT, writeFlushed, closeStorage } = require("./providers");
const { isInside, assertTestPath } = require("./runtime");

const hash = (value) => crypto.createHash("sha256").update(value).digest("hex");
const atomicWrite = (filename, value) => {
  const temporary = `${filename}.${crypto.randomUUID()}.tmp`;
  try {
    writeFlushed(temporary, JSON.stringify(value));
    fs.renameSync(temporary, filename);
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
};
const readJSON = (filename) => {
  if (!fs.existsSync(filename)) return null;
  try {
    if (fs.statSync(filename).size > 100 * 1024 * 1024) throw new Error();
    return JSON.parse(fs.readFileSync(filename, "utf8"));
  } catch { throw new Error("CUSTOM_LOCAL_STATE_CORRUPT"); }
};
const validDocument = (document) => {
  if (!document || document.format !== "koodo-reader-custom" || document.version !== 1 || !/^[0-9a-f-]{36}$/.test(document.deviceId) || !Number.isSafeInteger(document.sequence) || document.sequence < 0 || !document.entries || typeof document.entries !== "object" || Array.isArray(document.entries) || Buffer.byteLength(JSON.stringify(document)) > MAX_DOCUMENT) throw new Error("CUSTOM_INVALID_DOCUMENT");
};

const createCustomSync = ({ app, safeStorage, dialog, shell, runtime, hasReaders }) => {
  const root = path.join(app.getPath("userData"), "custom-sync");
  fs.mkdirSync(root, { recursive: true });
  const settingsFile = path.join(root, "settings.json");
  let active = null;
  let configuring = false;
  const fingerprints = new Map();
  const timedFetch = (url, options = {}) => fetch(url, {
    ...options,
    signal: AbortSignal.any([AbortSignal.timeout(30000), ...(options.signal ? [options.signal] : [])]),
  });
  const status = () => {
    const config = readJSON(settingsFile);
    return { configured: !!config, provider: config?.provider || "mega", namespace: config?.namespace || "default", autoMinutes: config?.autoMinutes || 0, testing: runtime.testing, busy: !!active || configuring };
  };
  const checkProfile = (storagePath) => {
    if (typeof storagePath !== "string" || !path.isAbsolute(storagePath) || path.parse(storagePath).root === path.resolve(storagePath)) throw new Error("CUSTOM_INVALID_STORAGE");
    assertTestPath(runtime, storagePath);
    return path.resolve(storagePath);
  };
  const scopeFor = (config, storagePath) => hash(JSON.stringify([path.resolve(storagePath), config.provider, config.account, config.namespace]));
  const release = () => {
    if (active) {
      clearTimeout(active.timer);
      active.sender.removeListener?.("destroyed", active.onDestroyed);
    }
    active = null;
  };
  const assertLease = (event, token) => {
    if (!active || active.owner !== event.sender.id || active.token !== token) throw new Error("CUSTOM_SESSION_EXPIRED");
    if (hasReaders()) throw new Error("CUSTOM_CLOSE_READERS");
    active.expires = Date.now() + 180000;
    return active;
  };
  const provider = async (config) => {
    if (config.provider === "folder") return new FolderProvider(config.folder, config.namespace);
    if (runtime.testing) throw new Error("CUSTOM_TEST_NETWORK_BLOCKED");
    if (!safeStorage.isEncryptionAvailable()) throw new Error("CUSTOM_CREDENTIAL_STORAGE_UNAVAILABLE");
    const { Storage } = require("megajs");
    const credentials = JSON.parse(safeStorage.decryptString(Buffer.from(config.session, "base64")));
    credentials.options.fetch = timedFetch;
    const storage = Storage.fromJSON(credentials);
    try { await storage.ready; await storage.reload(true); return new MegaProvider(storage, config.namespace); }
    catch (error) { await closeStorage(storage); throw error; }
  };
  const withProvider = async (config, action) => {
    let instance, timer, finished = false;
    try {
      return await Promise.race([
        (async () => {
          const opened = await provider(config);
          if (finished) { await opened.close(); throw new Error("CUSTOM_PROVIDER_TIMEOUT"); }
          instance = opened;
          return action(instance);
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("CUSTOM_PROVIDER_TIMEOUT")), 60000); }),
      ]);
    } finally { finished = true; clearTimeout(timer); if (instance) await instance.close(); }
  };
  const configure = async (request) => {
    if (active) throw new Error("CUSTOM_SYNC_BUSY");
    const old = readJSON(settingsFile);
    if (!["mega", "folder"].includes(request.provider) || typeof request.namespace !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(request.namespace) || ![0, 5, 15, 30, 60].includes(request.autoMinutes)) throw new Error("CUSTOM_INVALID_SETTINGS");
    let config = { provider: request.provider, namespace: request.namespace, autoMinutes: request.autoMinutes };
    if (request.provider === "folder") {
      const selected = request.folder || (old?.provider === "folder" ? old.folder : "");
      if (typeof selected !== "string" || !path.isAbsolute(selected) || !fs.statSync(selected).isDirectory()) throw new Error("CUSTOM_UNSAFE_FOLDER");
      const folder = fs.realpathSync(selected);
      if (isInside(app.getPath("userData"), folder) || isInside(folder, app.getPath("userData"))) throw new Error("CUSTOM_UNSAFE_FOLDER");
      if (runtime.testing && !isInside(runtime.root, folder)) throw new Error("CUSTOM_TEST_PATH_ESCAPE");
      config = { ...config, folder, account: hash(folder) };
    } else if (!request.email && !request.password && old?.provider === "mega") {
      config = { ...old, ...config };
    } else {
      if (runtime.testing) throw new Error("CUSTOM_TEST_NETWORK_BLOCKED");
      if (!safeStorage.isEncryptionAvailable()) throw new Error("CUSTOM_CREDENTIAL_STORAGE_UNAVAILABLE");
      if (typeof request.email !== "string" || request.email.length > 320 || !/^[^\s@]+@[^\s@]+$/.test(request.email) || typeof request.password !== "string" || !request.password || request.password.length > 4096 || (request.secondFactorCode && !/^\d{6}$/.test(request.secondFactorCode))) throw new Error("CUSTOM_INVALID_SETTINGS");
      const { Storage } = require("megajs");
      const storage = new Storage({ email: request.email.trim(), password: request.password, secondFactorCode: request.secondFactorCode || undefined, keepalive: false, fetch: timedFetch });
      let timer;
      try {
        await Promise.race([storage.ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("CUSTOM_PROVIDER_TIMEOUT")), 60000); })]);
        const session = storage.toJSON();
        delete session.options.password;
        delete session.options.secondFactorCode;
        config = { ...config, session: safeStorage.encryptString(JSON.stringify(session)).toString("base64"), account: hash(request.email.trim().toLowerCase()) };
      } finally { clearTimeout(timer); await closeStorage(storage); }
    }
    atomicWrite(settingsFile, config);
    return status();
  };
  const handle = async (event, request) => {
    if (!request || typeof request !== "object" || Array.isArray(request) || typeof request.action !== "string") throw new Error("CUSTOM_INVALID_REQUEST");
    try {
      if (request.action === "status") return status();
      if (request.action === "choose-folder") {
        const result = await dialog.showOpenDialog({ properties: ["openDirectory", "createDirectory"] });
        return result.canceled ? null : result.filePaths[0];
      }
      if (request.action === "configure") {
        if (configuring) throw new Error("CUSTOM_SYNC_BUSY");
        configuring = true;
        try { return await configure(request); } finally { configuring = false; }
      }
      if (request.action === "disconnect") {
        if (active || configuring) throw new Error("CUSTOM_SYNC_BUSY");
        if (fs.existsSync(settingsFile)) fs.unlinkSync(settingsFile);
        return status();
      }
      if (request.action === "backups") { await shell.openPath(root); return true; }
      const config = readJSON(settingsFile);
      if (!config) throw new Error("CUSTOM_NOT_CONFIGURED");
      if (request.action === "inspect") {
        const scope = scopeFor(config, checkProfile(request.storagePath));
        return readJSON(path.join(root, `${scope}.json`));
      }
      if (request.action === "begin" || request.action === "begin-restore") {
        if (active || configuring) throw new Error("CUSTOM_SYNC_BUSY");
        if (hasReaders()) throw new Error("CUSTOM_CLOSE_READERS");
        const storagePath = checkProfile(request.storagePath), scope = scopeFor(config, storagePath);
        const recoveryFile = path.join(root, `${scope}.recovery.json`);
        if (request.action === "begin" && fs.existsSync(recoveryFile)) {
          if (readJSON(recoveryFile)?.phase === "prepared") fs.unlinkSync(recoveryFile);
          else {
            atomicWrite(settingsFile, { ...config, autoMinutes: 0 });
            throw new Error("CUSTOM_RECOVERY_REQUIRED");
          }
        }
        const token = crypto.randomUUID();
        const lease = { owner: event.sender.id, sender: event.sender, token, storagePath, scope, config, phase: "reading", expires: Date.now() + 180000, timer: null, restoring: request.action === "begin-restore", onDestroyed: null };
        const expire = () => {
          if (active !== lease) return;
          const remaining = lease.expires - Date.now();
          if (remaining <= 0) release(); else lease.timer = setTimeout(expire, remaining);
        };
        lease.timer = setTimeout(expire, 180000);
        lease.onDestroyed = () => { if (active === lease) release(); };
        event.sender.once?.("destroyed", lease.onDestroyed);
        active = lease;
        try {
          if (lease.restoring) {
            const directory = path.join(root, "backups", scope);
            const files = fs.existsSync(directory) ? fs.readdirSync(directory).filter((name) => /^\d+-[a-f0-9-]{36}\.json$/.test(name)).sort().reverse() : [];
            for (const name of files) {
              const backup = readJSON(path.join(directory, name));
              if (backup?.format === "koodo-reader-custom-backup" && backup.version === 1 && backup.kind === "sync") {
                if (backup.checksum !== hash(JSON.stringify(backup.before))) throw new Error("CUSTOM_LOCAL_STATE_CORRUPT");
                return { token, backup: backup.before };
              }
            }
            throw new Error("CUSTOM_NO_BACKUP");
          }
          const documents = await withProvider(config, (p) => p.read());
          assertLease(event, token);
          return { token, checkpoint: readJSON(path.join(root, `${scope}.json`)), documents };
        } catch (error) { if (active === lease) release(); throw error; }
      }
      const lease = assertLease(event, request.token);
      const saveBackup = (kind) => {
        if (!request.backup?.tables || !request.backup?.config || Buffer.byteLength(JSON.stringify(request.backup)) > 100 * 1024 * 1024) throw new Error("CUSTOM_INVALID_REQUEST");
        const directory = path.join(root, "backups", lease.scope);
        fs.mkdirSync(directory, { recursive: true });
        const existing = fs.readdirSync(directory).filter((name) => /^\d+-[a-f0-9-]{36}\.json$/.test(name));
        const stamp = existing.reduce((maximum, name) => Math.max(maximum, Number(name.split("-")[0]) + 1), Date.now());
        atomicWrite(path.join(directory, `${stamp}-${crypto.randomUUID()}.json`), { format: "koodo-reader-custom-backup", version: 1, kind, checksum: hash(JSON.stringify(request.backup)), before: request.backup, checkpoint: readJSON(path.join(root, `${lease.scope}.json`)) });
        // Keep a bounded set of our own verified recovery files.
        const owned = fs.readdirSync(directory).filter((name) => /^\d+-[a-f0-9-]{36}\.json$/.test(name)).sort().reverse();
        const counts = { sync: 0, restore: 0 };
        for (const name of owned) {
          const filename = path.join(directory, name), old = readJSON(filename);
          if (old?.format === "koodo-reader-custom-backup" && old.version === 1 && old.checksum === hash(JSON.stringify(old.before)) && Object.hasOwn(counts, old.kind) && ++counts[old.kind] > 20) fs.unlinkSync(filename);
        }
      };
      if (request.action === "recovery-needed") {
        lease.phase = "recovery";
        atomicWrite(path.join(root, `${lease.scope}.recovery.json`), { phase: "recovery" });
        atomicWrite(settingsFile, { ...lease.config, autoMinutes: 0 });
        return true;
      }
      if (request.action === "applying") {
        if (lease.phase !== "prepared") throw new Error("CUSTOM_INVALID_REQUEST");
        atomicWrite(path.join(root, `${lease.scope}.recovery.json`), { phase: "applying" });
        lease.phase = "applying";
        return true;
      }
      if (request.action === "rollback-complete") {
        if (lease.phase !== "applying") throw new Error("CUSTOM_INVALID_REQUEST");
        atomicWrite(path.join(root, `${lease.scope}.recovery.json`), { phase: "prepared" });
        lease.phase = "prepared";
        return true;
      }
      if (request.action === "stage-restore" && lease.restoring) {
        saveBackup("restore");
        atomicWrite(settingsFile, { ...lease.config, autoMinutes: 0 });
        atomicWrite(path.join(root, `${lease.scope}.recovery.json`), { phase: "prepared" });
        lease.phase = "prepared";
        return true;
      }
      if (request.action === "finish-restore" && lease.restoring) {
        if (lease.phase !== "applying") throw new Error("CUSTOM_INVALID_REQUEST");
        const marker = path.join(root, `${lease.scope}.recovery.json`);
        if (fs.existsSync(marker)) fs.unlinkSync(marker);
        release(); return true;
      }
      if (request.action === "fingerprints") {
        if (!Array.isArray(request.books) || request.books.length > 100000) throw new Error("CUSTOM_INVALID_REQUEST");
        const result = {};
        for (const book of request.books) {
          if (!book || typeof book.key !== "string" || book.key.length > 256 || typeof book.path !== "string" || (book.path && !path.isAbsolute(book.path))) throw new Error("CUSTOM_INVALID_REQUEST");
          if (!book.path) continue;
          assertTestPath(runtime, book.path);
          const stat = await fs.promises.stat(book.path);
          if (!stat.isFile()) throw new Error("CUSTOM_INVALID_BOOK");
          const cacheKey = `${book.path}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
          if (!fingerprints.has(cacheKey)) {
            const digest = crypto.createHash("sha256");
            for await (const chunk of fs.createReadStream(book.path)) {
              digest.update(chunk);
              lease.expires = Date.now() + 180000;
            }
            const after = await fs.promises.stat(book.path);
            if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) throw new Error("CUSTOM_LOCAL_CHANGED");
            fingerprints.set(cacheKey, digest.digest("hex"));
          }
          result[book.key] = fingerprints.get(cacheKey);
        }
        assertLease(event, request.token);
        return result;
      }
      if (request.action === "stage") {
        validDocument(request.document); validDocument(request.checkpoint);
        if (JSON.stringify(request.document.entries) !== JSON.stringify(request.checkpoint.entries) || request.document.deviceId !== request.checkpoint.deviceId || request.document.sequence !== request.checkpoint.sequence || !request.backup?.tables || !request.backup?.config || Buffer.byteLength(JSON.stringify(request.backup)) > 100 * 1024 * 1024) throw new Error("CUSTOM_INVALID_REQUEST");
        if (lease.restoring) throw new Error("CUSTOM_INVALID_REQUEST");
        saveBackup("sync");
        // Persist outgoing revisions before upload, so failed uploads can be retried.
        atomicWrite(path.join(root, `${lease.scope}.json`), request.checkpoint);
        atomicWrite(path.join(root, `${lease.scope}.recovery.json`), { phase: "prepared" });
        lease.phase = "prepared";
        await withProvider(lease.config, (p) => p.append(request.document));
        assertLease(event, request.token);
        return true;
      }
      if (request.action === "complete") {
        if (lease.restoring || lease.phase !== "applying") throw new Error("CUSTOM_INVALID_REQUEST");
        validDocument(request.checkpoint);
        const staged = readJSON(path.join(root, `${lease.scope}.json`));
        if (!staged || staged.sequence !== request.checkpoint.sequence || staged.deviceId !== request.checkpoint.deviceId || JSON.stringify(staged.entries) !== JSON.stringify(request.checkpoint.entries)) throw new Error("CUSTOM_INVALID_REQUEST");
        atomicWrite(path.join(root, `${lease.scope}.json`), request.checkpoint);
        const marker = path.join(root, `${lease.scope}.recovery.json`);
        if (fs.existsSync(marker)) fs.unlinkSync(marker);
        release();
        return true;
      }
      if (request.action === "abort") {
        const marker = path.join(root, `${lease.scope}.recovery.json`);
        if (lease.phase === "prepared" && fs.existsSync(marker)) fs.unlinkSync(marker);
        release(); return true;
      }
      throw new Error("CUSTOM_INVALID_REQUEST");
    } catch (error) {
      const code = typeof error.message === "string" && /^CUSTOM_[A-Z_]+$/.test(error.message) ? error.message : "CUSTOM_PROVIDER_FAILED";
      throw new Error(code);
    }
  };
  return {
    handle, busy: () => !!active || configuring, status,
    authorize(event, token, storagePath) {
      const lease = assertLease(event, token);
      if (checkProfile(storagePath) !== lease.storagePath) throw new Error("CUSTOM_INVALID_STORAGE");
      if (lease.phase !== "applying") throw new Error("CUSTOM_INVALID_REQUEST");
    },
  };
};

module.exports = { createCustomSync, atomicWrite, validDocument };
