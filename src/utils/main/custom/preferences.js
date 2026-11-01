const path = require("path");
const { assertTestPath } = require("./runtime");

// Keep renderer preferences outside Chromium's origin-specific localStorage.
const createPreferences = (store, runtime, defaultLocation) => {
  const validateKey = (key) => {
    if (typeof key !== "string" || !key || key.length > 256 || ["__proto__", "constructor", "prototype"].includes(key)) {
      throw new Error("CUSTOM_INVALID_PREFERENCE");
    }
  };
  const validate = (key, value) => {
    validateKey(key);
    if (typeof value !== "string") throw new Error("CUSTOM_INVALID_PREFERENCE");
    if (key === "storageLocation" && value) {
      if (!path.isAbsolute(value) || path.resolve(value) === path.parse(value).root) throw new Error("CUSTOM_INVALID_STORAGE");
      assertTestPath(runtime, value);
    }
  };
  const load = () => store.get("rendererPreferences", null);
  const handle = (request) => {
    if (!request || typeof request !== "object") throw new Error("CUSTOM_INVALID_PREFERENCE");
    if (request.action === "load") return load();
    if (request.action === "initialize") {
      const current = load();
      if (current !== null) return current;
      const values = request.values;
      if (!values || typeof values !== "object" || Array.isArray(values)) throw new Error("CUSTOM_INVALID_PREFERENCE");
      for (const [key, value] of Object.entries(values)) validate(key, value);
      store.set("rendererPreferences", values);
      return values;
    }
    const values = { ...load() };
    validateKey(request.key);
    if (request.action === "set") {
      validate(request.key, request.value);
      values[request.key] = request.value;
    } else if (request.action === "remove") {
      delete values[request.key];
    } else {
      throw new Error("CUSTOM_INVALID_PREFERENCE");
    }
    store.set("rendererPreferences", values);
    return null;
  };
  return {
    handle,
    storageLocation: () => load()?.storageLocation || defaultLocation,
  };
};

module.exports = { createPreferences };
