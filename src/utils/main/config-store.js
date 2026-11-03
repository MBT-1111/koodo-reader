const fs = require("fs");
const path = require("path");

const durableWrite = (filename, data) => {
  const fd = fs.openSync(filename, "w", 0o600);
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
};

// The app's unencrypted electron-store file can be readable/writable on Windows
// while another file handle prevents replacing it by rename. Keep a flushed
// last-good copy before overwriting the existing file in that specific case.
const createConfigStore = (Store, directory, platform = process.platform) => {
  const filename = path.join(directory, "config.json");
  const backup = filename + ".recovery";
  if (fs.existsSync(backup)) {
    let invalid = !fs.existsSync(filename);
    if (!invalid) {
      try { JSON.parse(fs.readFileSync(filename, "utf8")); }
      catch (error) { if (!(error instanceof SyntaxError)) throw error; invalid = true; }
    }
    if (invalid) {
      const previous = fs.readFileSync(backup);
      JSON.parse(previous.toString("utf8"));
      durableWrite(filename, previous);
    }
  }
  const store = new Store({ cwd: directory });
  const atomicWrite = store._write.bind(store);
  store._write = (value) => {
    try { atomicWrite(value); }
    catch (error) {
      if (platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) ||
          error.syscall !== "rename" || typeof error.dest !== "string" ||
          path.resolve(error.dest).toLowerCase() !== path.resolve(store.path).toLowerCase()) throw error;
      const previous = fs.readFileSync(store.path);
      JSON.parse(previous.toString("utf8"));
      const next = store._serialize(value);
      durableWrite(backup, previous);
      try { durableWrite(store.path, next); }
      catch (writeError) {
        // Recovery remains available if a disk error also prevents rollback.
        try { durableWrite(store.path, previous); } catch { /* Keep the backup. */ }
        throw writeError;
      }
    }
  };
  return store;
};

module.exports = { createConfigStore };
