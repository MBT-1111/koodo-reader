// Window placement is optional metadata. A locked config file must not prevent
// the remaining close handler from running or replace the last saved settings.
const persistWindowState = (store, values, reportError) => {
  try {
    if (Object.entries(values).some(([key, value]) => store.get(key) !== value)) {
      store.set(values);
    }
    return true;
  } catch (error) {
    // Keep paths and configuration values out of the log.
    const code = typeof error?.code === "string" && /^E[A-Z_]+$/.test(error.code) ? error.code : "UNKNOWN";
    reportError(code);
    return false;
  }
};

module.exports = { persistWindowState };
