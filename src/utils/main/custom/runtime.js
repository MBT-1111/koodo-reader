const fs = require("fs");
const path = require("path");

const isInside = (root, target) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === "" || (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative));
};

// Must run before electron-store, logging, sessions or any reader module loads.
const configureRuntime = (app, config, testRoot = process.env.KRC_TEST_PROFILE) => {
  const profile = path.join(app.getPath("appData"), config.profileName);
  app.setName(config.productName);
  if (!testRoot) {
    fs.mkdirSync(profile, { recursive: true });
    app.setPath("userData", profile);
    app.setPath("sessionData", profile);
    return { testing: false, profile };
  }
  if (!path.isAbsolute(testRoot) || !path.basename(testRoot).startsWith("krc-test-") || isInside(profile, testRoot)) throw new Error("CUSTOM_UNSAFE_TEST_PROFILE");
  const marker = path.join(testRoot, ".krc-test-profile");
  if (fs.existsSync(testRoot) && (fs.lstatSync(testRoot).isSymbolicLink() || (fs.readdirSync(testRoot).length && !fs.existsSync(marker)))) throw new Error("CUSTOM_TEST_PROFILE_NOT_EMPTY");
  fs.mkdirSync(testRoot, { recursive: true });
  if (path.resolve(testRoot).toLowerCase() !== fs.realpathSync(testRoot).toLowerCase()) throw new Error("CUSTOM_TEST_PROFILE_LINK");
  fs.writeFileSync(marker, "Koodo Reader Custom isolated tests\n", { flag: "a", mode: 0o600 });
  for (const [name, directory] of Object.entries({ appData: "app-data", userData: "profile", sessionData: "session", temp: "temp", logs: "logs", crashDumps: "crashes" })) {
    const target = path.join(testRoot, directory);
    fs.mkdirSync(target, { recursive: true });
    app.setPath(name, target);
  }
  return { testing: true, profile: app.getPath("userData"), root: testRoot };
};

const assertOfficialUpdateAllowed = (config) => {
  if (!config.allowOfficialUpdates) throw new Error("CUSTOM_OFFICIAL_UPDATE_DISABLED");
};

const assertTestPath = (runtime, target, readRoots = []) => {
  if (!runtime.testing) return;
  if (typeof target !== "string" || !path.isAbsolute(target)) throw new Error("CUSTOM_TEST_PATH_ESCAPE");
  let ancestor = path.resolve(target);
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) throw new Error("CUSTOM_TEST_PATH_ESCAPE");
    ancestor = parent;
  }
  const resolved = path.resolve(fs.realpathSync(ancestor), path.relative(ancestor, path.resolve(target)));
  if (![runtime.root, ...readRoots].some((root) => isInside(root, resolved))) throw new Error("CUSTOM_TEST_PATH_ESCAPE");
};

module.exports = { configureRuntime, isInside, assertOfficialUpdateAllowed, assertTestPath };
