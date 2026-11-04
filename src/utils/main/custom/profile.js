const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { isInside, assertTestPath } = require("./runtime");
const { atomicWrite } = require("./sync");

const PROFILE = "app-profile";
const BOOTSTRAP = "profile-location.json";
const MARKER = ".koodo-profile.json";
const transient = (name) => [BOOTSTRAP, "SingletonLock", "SingletonSocket", "SingletonCookie", "lockfile"].includes(name);
const json = (filename) => fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, "utf8")) : null;
const digest = (filename) => {
  const hash = crypto.createHash("sha256"), buffer = Buffer.alloc(65536), descriptor = fs.openSync(filename, "r");
  try {
    let size;
    while ((size = fs.readSync(descriptor, buffer, 0, buffer.length, null))) hash.update(buffer.subarray(0, size));
    return hash.digest("hex");
  } finally { fs.closeSync(descriptor); }
};
const location = (runtime, value) => {
  if (typeof value !== "string" || !path.isAbsolute(value) || path.resolve(value) === path.parse(value).root) throw new Error("CUSTOM_PROFILE_INVALID_PATH");
  assertTestPath(runtime, value);
  return path.resolve(value);
};
const copyVerified = (source, destination, skip = () => false, copy = true) => {
  if (copy) fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(destination, entry.name);
    if (skip(from)) continue;
    if (entry.isSymbolicLink()) throw new Error("CUSTOM_PROFILE_UNSAFE_LINK");
    if (entry.isDirectory()) copyVerified(from, to, skip, copy);
    else if (entry.isFile()) {
      if (copy) fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
      if (digest(from) !== digest(to)) throw new Error("CUSTOM_PROFILE_COPY_FAILED");
    }
  }
};
const ownedProfile = (directory) => json(path.join(directory, MARKER))?.format === "koodo-reader-custom-profile";
const configurePaths = (app, profile) => {
  for (const [name, directory] of Object.entries({ userData: profile, sessionData: profile, logs: path.join(profile, "logs"), temp: path.join(profile, "temp"), crashDumps: path.join(profile, "crashes") })) {
    fs.mkdirSync(directory, { recursive: true });
    app.setPath(name, directory);
  }
};
const updateProfile = (profile, storagePath, migration, restoreLibrary = false) => {
  const config = json(path.join(profile, "config.json")) || {};
  config.rendererPreferences = { ...config.rendererPreferences, storageLocation: storagePath };
  if (restoreLibrary) {
    const imported = json(path.join(storagePath, "config", "config.json")) || {};
    for (const [key, value] of Object.entries(imported)) if (key !== "storageLocation" && typeof value === "string") config.rendererPreferences[key] = value;
  }
  atomicWrite(path.join(profile, "config.json"), config);
  atomicWrite(path.join(profile, MARKER), { format: "koodo-reader-custom-profile", version: 1, ...(migration ? { migration } : {}) });
};
const relocateScopes = (profile, library, oldStorage, newStorage) => {
  const saved = json(path.join(profile, "custom-sync", "settings.json"));
  const connections = saved?.provider ? [saved] : Object.values(saved?.connections || {});
  for (const config of connections) {
    const scope = (storage) => crypto.createHash("sha256").update(JSON.stringify([path.resolve(storage), config.provider, config.account, config.namespace])).digest("hex");
    const before = scope(oldStorage);
    if (config.provider === "folder" && typeof config.folder === "string" && isInside(oldStorage, config.folder)) {
      config.folder = path.join(newStorage, path.relative(oldStorage, config.folder));
      config.account = crypto.createHash("sha256").update(config.folder).digest("hex");
    }
    const after = scope(newStorage);
    for (const [from, to] of [
      ...[".json", ".recovery.json"].map((suffix) => [path.join(profile, "custom-sync", before + suffix), path.join(profile, "custom-sync", after + suffix)]),
      [path.join(profile, "custom-sync", "backups", before), path.join(profile, "custom-sync", "backups", after)],
      [path.join(library, "sync-backups", before), path.join(library, "sync-backups", after)],
    ]) if (from !== to && fs.existsSync(from)) fs.renameSync(from, to);
  }
  if (saved) atomicWrite(path.join(profile, "custom-sync", "settings.json"), saved);
};

// Called only after the stable bootstrap-profile single-instance lock is acquired,
// and before electron-store, Chromium sessions or native databases are opened.
const activateProfile = (app, runtime) => {
  const bootstrapProfile = runtime.bootstrapProfile || runtime.profile;
  const bootstrapFile = path.join(bootstrapProfile, BOOTSTRAP);
  const bootstrap = json(bootstrapFile);
  const sourceProfile = location(runtime, bootstrap?.profile || bootstrapProfile);
  if (!fs.existsSync(sourceProfile)) throw new Error("CUSTOM_PROFILE_UNAVAILABLE");
  const config = json(path.join(sourceProfile, "config.json"));
  const oldStorage = location(runtime, config?.rendererPreferences?.storageLocation || bootstrap?.storage || path.join(sourceProfile, "uploads", "data"));
  const pending = bootstrap?.pending;
  const storage = location(runtime, pending?.target || oldStorage);
  if (pending && (!["move", "switch"].includes(pending.mode) || pending.source !== sourceProfile || pending.storage !== oldStorage)) throw new Error("CUSTOM_PROFILE_INVALID_PATH");
  const defaultStorage = path.join(bootstrapProfile, "uploads", "data");
  if (!pending && sourceProfile === bootstrapProfile && storage === defaultStorage) {
    runtime.storagePath = storage;
    configurePaths(app, sourceProfile);
    return;
  }
  if (!fs.existsSync(storage) || !fs.statSync(storage).isDirectory()) throw new Error("CUSTOM_PROFILE_UNAVAILABLE");
  const profile = path.join(storage, PROFILE);
  if (sourceProfile !== profile && (isInside(sourceProfile, storage) || isInside(storage, sourceProfile) && pending?.mode !== "move")) throw new Error("CUSTOM_PROFILE_INVALID_PATH");
  let copied = false;
  if (pending?.mode === "move") {
    if (isInside(oldStorage, storage) || isInside(storage, oldStorage) || isInside(oldStorage, bootstrapProfile)) throw new Error("CUSTOM_PROFILE_INVALID_PATH");
    const proof = { source: sourceProfile, storage: oldStorage, config: digest(path.join(sourceProfile, "config.json")) };
    if (fs.readdirSync(storage).length) {
      // Resume a publication interrupted before the bootstrap pointer was committed.
      if (JSON.stringify(json(path.join(profile, MARKER))?.migration) !== JSON.stringify(proof)) throw new Error("CUSTOM_PROFILE_FOLDER_NOT_EMPTY");
      copyVerified(oldStorage, storage, (file) => file === path.join(oldStorage, PROFILE) || file === path.join(oldStorage, "sync-backups"), false);
    } else {
      const staging = location(runtime, path.join(path.dirname(storage), `.krc-move-${crypto.randomUUID()}`));
      fs.mkdirSync(staging);
      try {
        copyVerified(oldStorage, staging, (file) => file === path.join(oldStorage, PROFILE));
        copyVerified(sourceProfile, path.join(staging, PROFILE), (file) => transient(path.basename(file)) || file === oldStorage);
        updateProfile(path.join(staging, PROFILE), storage, proof);
        relocateScopes(path.join(staging, PROFILE), staging, oldStorage, storage);
        // Remove only the verified, still-empty selected directory, then publish on the same volume.
        fs.rmdirSync(storage);
        fs.renameSync(staging, storage);
      } finally {
        if (fs.existsSync(staging) && isInside(path.dirname(storage), staging) && path.basename(staging).startsWith(".krc-move-")) fs.rmSync(staging, { recursive: true, force: true });
      }
    }
    copied = true;
  } else if (sourceProfile !== profile) {
    if (fs.existsSync(profile)) {
      if (!ownedProfile(profile) || !fs.existsSync(path.join(profile, "config.json"))) throw new Error("CUSTOM_PROFILE_CONFLICT");
      // An explicitly selected existing library keeps its own settings.
      if (sourceProfile === bootstrapProfile) copyVerified(sourceProfile, path.join(profile, `previous-profile-${crypto.randomUUID()}`), (file) => transient(path.basename(file)));
    } else {
      const staging = location(runtime, path.join(storage, `.krc-profile-${crypto.randomUUID()}`));
      fs.mkdirSync(staging);
      try {
        copyVerified(sourceProfile, staging, (file) => transient(path.basename(file)) || pending?.mode === "switch" && file === oldStorage);
        updateProfile(staging, storage, undefined, pending?.mode === "switch");
        fs.renameSync(staging, profile);
      } finally {
        if (fs.existsSync(staging) && isInside(storage, staging) && path.basename(staging).startsWith(".krc-profile-")) fs.rmSync(staging, { recursive: true, force: true });
      }
      copied = true;
    }
    updateProfile(profile, storage);
  }
  // The pointer is committed only after the complete profile and library are available.
  // Reopening an established profile does not require replacing an unchanged pointer.
  if (bootstrap?.version !== 1 || bootstrap.profile !== profile || bootstrap.storage !== storage || pending) {
    atomicWrite(bootstrapFile, { version: 1, profile, storage });
  }
  runtime.profile = profile;
  runtime.storagePath = storage;
  configurePaths(app, profile);
  // Originals are removed only after verified copies have been published. A locked
  // leftover is retained rather than making the new profile unusable.
  try {
    if (pending?.mode === "move" && copied) fs.rmSync(oldStorage, { recursive: true, force: true });
    if (sourceProfile === bootstrapProfile && sourceProfile !== profile) {
      const preserve = pending?.mode === "switch" && isInside(bootstrapProfile, oldStorage) ? oldStorage : null;
      const clean = (directory) => {
        for (const name of fs.readdirSync(directory)) if (!transient(name)) {
          const target = path.resolve(directory, name);
          if (!isInside(bootstrapProfile, target) || isInside(target, profile)) throw new Error("CUSTOM_PROFILE_INVALID_PATH");
          if (target === preserve) continue;
          if (preserve && isInside(target, preserve)) clean(target);
          else fs.rmSync(target, { recursive: true, force: true });
        }
      };
      clean(sourceProfile);
    }
  } catch { runtime.cleanupPending = true; }
};

const cancelStorage = (runtime) => {
  const filename = path.join(runtime.bootstrapProfile || runtime.profile, BOOTSTRAP), saved = json(filename);
  if (saved?.pending) { delete saved.pending; atomicWrite(filename, saved); }
};

const clearLibrary = (runtime, selected) => {
  const storage = location(runtime, selected), profile = location(runtime, runtime.profile);
  if (fs.existsSync(storage)) for (const name of fs.readdirSync(storage)) {
    const target = path.resolve(storage, name);
    if (!isInside(storage, target)) throw new Error("CUSTOM_PROFILE_INVALID_PATH");
    if (!isInside(target, profile)) fs.rmSync(target, { recursive: true, force: true });
  }
  const sync = path.join(profile, "custom-sync");
  fs.mkdirSync(sync, { recursive: true });
  for (const name of fs.readdirSync(sync)) {
    const target = path.resolve(sync, name);
    if (!isInside(sync, target)) throw new Error("CUSTOM_PROFILE_INVALID_PATH");
    fs.rmSync(target, { recursive: true, force: true });
  }
};

const stageStorage = (runtime, target, mode) => {
  if (!["move", "switch"].includes(mode)) throw new Error("CUSTOM_PROFILE_INVALID_PATH");
  const selected = location(runtime, target), source = runtime.profile, storage = runtime.storagePath;
  if (!fs.statSync(selected).isDirectory() || fs.realpathSync(selected).toLowerCase() !== selected.toLowerCase() || selected === storage || isInside(source, selected) || isInside(selected, source) || isInside(storage, selected) || isInside(selected, storage)) throw new Error("CUSTOM_PROFILE_INVALID_PATH");
  if (mode === "move" && fs.readdirSync(selected).length) throw new Error("CUSTOM_PROFILE_FOLDER_NOT_EMPTY");
  if (mode === "switch" && !fs.existsSync(path.join(selected, "config"))) throw new Error("CUSTOM_PROFILE_INVALID_LIBRARY");
  const profile = path.join(selected, PROFILE);
  if (fs.existsSync(profile) && !ownedProfile(profile)) throw new Error("CUSTOM_PROFILE_CONFLICT");
  atomicWrite(path.join(runtime.bootstrapProfile || source, BOOTSTRAP), { version: 1, profile: source, storage, pending: { source, storage, target: selected, mode } });
};

module.exports = { activateProfile, stageStorage, cancelStorage, clearLibrary, PROFILE, BOOTSTRAP, MARKER };
