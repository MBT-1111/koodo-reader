// Run only against a built renderer and an installed Electron dependency.
const { _electron: electron } = require("@playwright/test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { isInside } = require("../src/utils/main/custom/runtime");

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "krc-test-smoke-"));
  const env = { ...process.env, KRC_TEST_PROFILE: root, ELECTRON_IS_DEV: "0" };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    assert.ok(fs.existsSync(path.resolve("build/index.html")), "Compile Windows renderer resources first");
    app = await electron.launch({ args: [path.resolve(".")], env, timeout: 60000 });
    const locations = await app.evaluate(({ app }) => Object.fromEntries(["userData", "sessionData", "temp", "logs", "crashDumps"].map((name) => [name, app.getPath(name)])));
    assert.ok(Object.values(locations).every((directory) => isInside(root, directory)), "All writable Electron locations must be isolated");
    let page = await app.firstWindow();
    page.setDefaultTimeout(60000);
    await page.waitForFunction(() => !!window.electronAPI);
    await page.locator(".header").waitFor();
    assert.equal(await page.locator(".header .icon-account").count(), 0, "Personal build should hide the account entry");
    // The TEST environment indicator shares this container class with Pro promotions.
    const proPromotions = page.locator(".header-report-container").filter({
      hasText: /^\s*(Pro version|Renew Pro|In trial|升级专业版|续费专业版|试用中)\s*$/,
    });
    assert.equal(await proPromotions.count(), 0, "Personal build should hide Pro promotions");
    const invoke = (channel, data) => page.evaluate(({ channel, data }) => window.electronAPI.invoke(channel, data), { channel, data });
    // Use public exports from the renderer's own engine instance, including its persistence adapter.
    const engineChunk = fs.readdirSync(path.resolve("build/static")).find((name) => /^kookit-.*\.js$/.test(name));
    assert.ok(engineChunk, "Built engine chunk must exist");
    const engineUrl = pathToFileURL(path.resolve("build/static", engineChunk)).href;
    const configure = (values, reader = {}) => page.evaluate(async ({ engineUrl, values, reader }) => {
      const config = Object.values(await import(engineUrl)).find((value) => typeof value?.setReaderConfig === "function");
      if (!config) throw new Error("Renderer ConfigService export not found");
      for (const [key, value] of Object.entries(values)) config.setItem(key, value);
      for (const [key, value] of Object.entries(reader)) config.setReaderConfig(key, value);
    }, { engineUrl, values, reader });
    const update = await page.evaluate(async () => {
      try { await window.electronAPI.invoke("update-win-app", { version: "0.0.0" }); return "ALLOWED"; }
      catch (error) { return String(error.message); }
    });
    assert.match(update, /CUSTOM_OFFICIAL_UPDATE_DISABLED/);
    const storagePath = await page.evaluate(() => window.electronAPI.sendSync("storage-location", "ping"));
    assert.ok(isInside(root, storagePath));
    const fixture = path.join(root, "synthetic.epub"), remote = path.join(root, "remote");
    fs.writeFileSync(fixture, "Synthetic sync fixture; never opened by a reader"); fs.mkdirSync(remote);
    const book = { key: "synthetic-book", name: "Synthetic Book", author: "Test", description: "Fixture", md5: "fixture", cover: "", format: "EPUB", publisher: "", size: fs.statSync(fixture).size, page: 1, path: fixture, charset: "utf-8", published: "", modified: "", identifier: "", language: "en", subject: "", rights: "", isbn: "", layout: "" };
    const note = { key: "synthetic-note", bookKey: book.key, date: { year: 2026, month: 10, day: 31 }, chapter: "Test", chapterIndex: 0, text: "Synthetic highlight", cfi: "{}", range: "[]", notes: "Synthetic note", percentage: "0.5", color: "1", tag: [] };
    for (const [dbName, data] of [["books", book], ["notes", note]]) await invoke("database-command", { statement: "saveStatement", statementType: "string", executeType: "run", dbName, data, storagePath });
    await configure({
      readingTime: JSON.stringify({ "synthetic-book": 6 }),
      readingStats: JSON.stringify({ "2026-10-31": ["synthetic-book-6"] }),
      recordLocation: JSON.stringify({ "synthetic-book": { percentage: "0.5", cfi: "fixture" } }),
    });
    await invoke("custom-sync", { action: "configure", provider: "folder", namespace: "smoke", autoMinutes: 0, folder: remote });
    // A synthetic second connection exercises target selection without contacting MEGA.
    const syncSettingsFile = path.join(locations.userData, "custom-sync", "settings.json");
    const syncSettings = JSON.parse(fs.readFileSync(syncSettingsFile, "utf8"));
    const profileSecret = await app.evaluate(({ safeStorage }) => safeStorage.encryptString("synthetic-profile-token").toString("base64"));
    syncSettings.connections.mega = { provider: "mega", namespace: "smoke-mega", autoMinutes: 0, email: "fixture@example.invalid", account: "synthetic-mega", session: profileSecret };
    fs.writeFileSync(syncSettingsFile, JSON.stringify(syncSettings));
    await page.locator(".header .icon-sync.setting-icon").click();
    assert.equal(await page.locator('select[name="vex-select"] option').count(), 2, "Header chooser must offer both saved connections");
    await page.locator('select[name="vex-select"]').selectOption("folder");
    assert.ok((await page.locator('select[name="vex-select"] option:checked').textContent()).includes(remote), "Header chooser must identify the saved destination");
    await page.locator(".vex-dialog-button-primary").click();
    await page.getByText(/^(Personal sync completed|自有同步已完成)$/).waitFor();
    assert.ok(!page.url().includes("/login"), "Header sync should use the selected personal target");
    const folder = path.join(remote, "KoodoReaderCustom-v1-smoke");
    const firstGeneration = fs.readdirSync(folder).filter((name) => name.endsWith(".json")).sort();
    assert.equal(firstGeneration.length, 1);
    await page.locator(".icon-setting.setting-icon").click();
    assert.equal(await page.locator(".setting-dialog-sidebar-item").filter({ hasText: /^(Account|账户)$/ }).count(), 0);
    await page.locator(".setting-dialog-sidebar-item").filter({ hasText: /Sync and backup|同步与备份|同步和备份/ }).click();
    assert.equal(await page.locator(".add-source-card").count(), 0, "Only personal sync should be shown");
    const button = page.locator(".custom-sync").getByRole("button", { name: /^(Sync now|立即同步)$/ });
    const providerSelect = page.locator(".custom-sync select").first();
    await providerSelect.selectOption("mega");
    assert.equal(await page.locator('.custom-sync input[type="email"]').inputValue(), "fixture@example.invalid", "Saved account should remain visible");
    await page.locator(".custom-sync").getByLabel(/^(Sync space|同步空间)$/).fill("unsaved-space");
    assert.equal(await button.isDisabled(), true, "Unsaved changes must not sync to a previous target");
    await providerSelect.selectOption("folder");
    assert.equal(await page.locator(".custom-sync").getByLabel(/^(Sync space|同步空间)$/).inputValue(), "smoke");
    assert.equal(await button.isEnabled(), true, "Switching back must restore the saved folder connection");
    await button.click();
    await page.getByText(/^(Everything is up to date|没有需要更新的数据)$/).waitFor();
    await page.waitForTimeout(100);
    assert.deepEqual(fs.readdirSync(folder).filter((name) => name.endsWith(".json")).sort(), firstGeneration, "Unchanged data must not create a new cloud generation");
    assert.ok(fs.readdirSync(folder).some((name) => name.endsWith(".json")), "UI sync should publish a snapshot");
    for (const filename of fs.readdirSync(folder).filter((name) => name.endsWith(".json"))) {
      const text = fs.readFileSync(path.join(folder, filename), "utf8");
      assert.ok(!text.includes(fixture) && !text.includes('"path"') && !text.includes('"apiKey"'), "Snapshot must not contain file paths or credentials");
    }
    const notes = await invoke("database-command", { statement: "getAllStatement", statementType: "string", executeType: "all", dbName: "notes", storagePath });
    assert.equal(notes.length, 1);
    assert.equal(notes[0].text, note.text);
    const blocked = await page.evaluate(async () => {
      try { await window.electronAPI.invoke("generate-tts", {}); return "ALLOWED"; }
      catch (error) { return String(error.message); }
    });
    assert.match(blocked, /CUSTOM_TEST_NETWORK_BLOCKED/);
    await page.evaluate(() => { window.location.hash = "/login"; });
    await page.waitForFunction(() => window.location.hash.startsWith("#/manager"));
    // A relocated library, application preferences and main-process proxy must survive a cold restart.
    const relocated = path.join(root, "relocated-library");
    for (const dbName of ["books", "notes", "bookmarks", "words", "plugins"]) await invoke("close-database", { dbName, storagePath });
    fs.cpSync(storagePath, relocated, { recursive: true });
    const aiModelConfig = JSON.stringify({ "synthetic-model": { key: "synthetic-model", displayName: "Synthetic model", config: {
      endpoint: "http://127.0.0.1:9/v1", modelId: "synthetic", modelName: "Synthetic model", apiKey: "synthetic-key", providerId: "custom",
    } } });
    await configure({ storageLocation: relocated, aiModelConfig }, { appSkin: "night", themeColor: "#0179CA", isEinkMode: "no", isEnableDiscordRPC: "yes", aiService: "synthetic-model" });
    const proxy = { enabled: true, type: "http", host: "127.0.0.1", port: 7890, username: "", password: "" };
    assert.equal((await invoke("set-proxy-config", proxy)).ok, true);
    await page.reload();
    await page.locator(".header").waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");
    await page.locator(".icon-setting.setting-icon").click();
    await page.locator(".setting-dialog-sidebar-item").filter({ hasText: /^(Appearance|外观)$/ }).click();
    const toggleEink = () => page.locator(".setting-dialog-new-title").filter({ hasText: /E-ink mode|E-ink 模式/ }).locator(".single-control-switch").click();
    await toggleEink();
    await page.waitForFunction(() => document.documentElement.dataset.eink === "true");
    await page.waitForFunction(() => getComputedStyle(document.body).color === "rgb(0, 0, 0)");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    const colors = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, text: getComputedStyle(document.body).color }));
    assert.deepEqual(colors, { bg: "rgb(255, 255, 255)", text: "rgb(0, 0, 0)" });
    await page.locator(".icon-setting.setting-icon").click();
    await page.locator(".setting-dialog-sidebar-item").filter({ hasText: /^(Appearance|外观)$/ }).click();
    await toggleEink();
    await page.waitForFunction(() => document.documentElement.dataset.eink === "false");
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "Disabling E-ink restores the saved theme");
    await configure({}, { isEinkMode: "yes" });
    await app.evaluate(({ session }) => session.defaultSession.clearStorageData({ storages: ["localstorage"] }));
    await app.close();
    app = null;
    app = await electron.launch({ args: [path.resolve(".")], env, timeout: 60000 });
    page = await app.firstWindow();
    page.setDefaultTimeout(60000);
    await page.locator(".header").waitFor();
    const movedPaths = await app.evaluate(({ app }) => Object.fromEntries(["userData", "sessionData", "logs", "temp", "crashDumps"].map((name) => [name, app.getPath(name)])));
    assert.equal(movedPaths.userData, path.join(relocated, "app-profile"));
    assert.ok(Object.values(movedPaths).every((directory) => isInside(relocated, directory)), "Settings, browser state, logs and caches must follow the library");
    assert.ok(fs.existsSync(path.join(locations.userData, "profile-location.json")), "Bootstrap must remember the selected profile");
    assert.equal(fs.existsSync(path.join(locations.userData, "config.json")), false, "The original bootstrap location should no longer hold application settings");
    const savedCiphertext = JSON.parse(fs.readFileSync(path.join(movedPaths.userData, "custom-sync", "settings.json"), "utf8")).connections.mega.session;
    assert.equal(await app.evaluate(({ safeStorage }, value) => safeStorage.decryptString(Buffer.from(value, "base64")), savedCiphertext), "synthetic-profile-token", "Credentials must remain decryptable after the profile moves");
    const restored = await page.evaluate(() => ({
      storagePath: window.electronAPI.sendSync("storage-location", "ping"),
      ai: localStorage.getItem("aiModelConfig"),
      reader: JSON.parse(localStorage.getItem("readerConfig") || "{}"),
      eink: document.documentElement.dataset.eink,
      theme: document.documentElement.dataset.theme,
    }));
    assert.equal(restored.storagePath, relocated);
    assert.equal(restored.ai, aiModelConfig);
    assert.equal(restored.reader.isEnableDiscordRPC, "yes");
    assert.equal(restored.reader.aiService, "synthetic-model");
    assert.equal(restored.reader.appSkin, "night");
    assert.equal(restored.reader.themeColor, "#0179CA");
    assert.equal(restored.eink, "true");
    assert.equal(restored.theme, "light");
    assert.deepEqual(await invoke("get-proxy-config"), proxy);
    await page.locator(".icon-setting.setting-icon").click();
    await page.locator(".setting-dialog-sidebar-item").filter({ hasText: /^(More settings|更多设置)$/ }).click();
    await page.getByPlaceholder(/^(Proxy host|代理主机)$/).waitFor();
    assert.equal(await page.getByPlaceholder(/^(Proxy host|代理主机)$/).inputValue(), proxy.host);
    assert.equal(await page.getByPlaceholder(/^(Proxy port|代理端口)$/).inputValue(), String(proxy.port));
    const restartedBooks = await invoke("database-command", { statement: "getAllStatement", statementType: "string", executeType: "all", dbName: "books", storagePath: restored.storagePath });
    assert.equal(restartedBooks.length, 1);
    assert.equal(restartedBooks[0].key, book.key);
    // Exercise the actual migration request and another cold restart.
    const finalLocation = path.join(root, "moved-library"); fs.mkdirSync(finalLocation);
    await invoke("storage-profile", { action: "stage", target: finalLocation, mode: "move" });
    await app.close(); app = null;
    app = await electron.launch({ args: [path.resolve(".")], env, timeout: 60000 });
    page = await app.firstWindow(); page.setDefaultTimeout(60000);
    await page.locator(".header").waitFor();
    assert.equal(await page.evaluate(() => window.electronAPI.sendSync("storage-location", "ping")), finalLocation);
    assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), path.join(finalLocation, "app-profile"));
    assert.equal(await page.evaluate(() => localStorage.getItem("aiModelConfig")), aiModelConfig);
    assert.deepEqual(await invoke("get-proxy-config"), proxy);
    const movedBooks = await invoke("database-command", { statement: "getAllStatement", statementType: "string", executeType: "all", dbName: "books", storagePath: finalLocation });
    assert.equal(movedBooks[0].key, book.key);
    assert.equal(fs.existsSync(relocated), false, "The verified source library should be removed after a successful move");
    fs.mkdirSync(path.resolve("dist"), { recursive: true });
    fs.writeFileSync(path.resolve("dist/custom-smoke.json"), JSON.stringify({ passed: true, source: process.env.GITHUB_SHA || "working-tree", platform: process.platform, checks: ["profile-isolation", "official-update-blocked", "real-database-ipc", "personal-sync-ui", "header-personal-sync", "unchanged-sync-no-upload", "official-account-hidden", "login-route-redirect", "immutable-folder-provider", "credential-exclusion", "tts-network-blocked", "eink-ui-toggle", "eink-theme-restoration", "preferences-cold-restart", "chromium-storage-recovery", "relocated-library-restart", "proxy-restart-and-display", "profile-follows-library", "credential-decryption-after-profile-move", "verified-library-move"] }, null, 2));
    console.info("Custom Windows smoke checks passed (synthetic data only).");
  } finally {
    if (app) await app.close();
    // Retain synthetic profile on failure for CI diagnostics; never touch another profile.
  }
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
