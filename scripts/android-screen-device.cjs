const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { createHash } = require("node:crypto");
const { execFileSync } = require("node:child_process");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { showReadingTools, hideReadingTools } = require("../e2e/android/fixtures.cjs");

const pkg = "xyz.koodoreader.custom.android", output = path.join(__dirname, "..", "dist", "android-device");
const configKeys = ["readerConfig", "recordLocation", "readingTime", "readingStats", "recentBooks"];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

async function main() {
  await fs.mkdir(output, { recursive: true });
  let devices = await android.devices({ omitDriverInstall: true });
  const selected = devices.filter(device => !process.env.ANDROID_SERIAL || device.serial() === process.env.ANDROID_SERIAL);
  assert.equal(selected.length, 1, "Connect one unlocked test phone or select ANDROID_SERIAL");
  let device = selected[0];
  const serial = device.serial(), report = { passed: false, checks: [], errors: [] };
  let page, preferences, baseline;
  const shell = command => execFileSync(process.env.ADB_PATH || "adb", ["-s", serial, "shell", command], { encoding: "utf8" });
  const attach = async () => {
    page = await (await device.webView({ pkg })).page(); page.setDefaultTimeout(15000);
    page.on("pageerror", error => report.errors.push(error.message));
  };
  const withoutDebugger = async check => {
    // The attached WebView debugger itself holds the screen on, even in the library.
    await Promise.all(devices.map(item => item.close())); page = undefined;
    try { await check(); }
    finally {
      devices = await android.devices({ omitDriverInstall: true });
      device = devices.find(item => item.serial() === serial);
      assert.ok(device, "Test phone disconnected"); await attach();
    }
  };
  const storage = data => page.evaluate(async data => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, data);
  const checked = name => { report.checks.push(name); console.log(`PASS ${name}`); };
  const fingerprint = async () => {
    const tables = {};
    for (const dbName of ["books", "notes", "bookmarks", "words", "plugins"]) {
      const rows = await storage({ channel: "database-command", dbName, statement: "getAllStatement" });
      tables[dbName] = { count: rows.length, sha256: hash(rows.sort((a, b) => String(a.key).localeCompare(String(b.key)))) };
    }
    return { tables, preferences: hash((await storage({ channel: "preferences", action: "read" })).values) };
  };
  const windowKeepsScreenOn = async () => {
    const dump = shell("dumpsys window windows");
    const app = dump.split(/\n\s*Window #\d+ /).find(block => block.split("\n")[0].includes(`${pkg}/`) && block.split("\n")[0].includes("MainActivity"));
    assert.ok(app, "MainActivity window must be present");
    const flags = /\bfl=([0-9a-f]+)\b/i.exec(app);
    return /\bKEEP_SCREEN_ON\b/.test(app) || !!(flags && (parseInt(flags[1], 16) & 0x80));
  };
  const holdsScreen = async () => shell("dumpsys window").split("\n").some(line => /mHoldScreenWindow=/.test(line) && line.includes(`${pkg}/`));
  const closeReader = async () => {
    if (await page.locator(".android-speech").count()) await page.locator(".android-speech").getByRole("button", { name: "Close", exact: true }).click();
    if (await page.locator(".android-reader").count()) {
      await showReadingTools(page);
      await page.getByRole("button", { name: "Exit reader", exact: true }).click();
      await expect(page.locator(".android-header")).toBeVisible();
    }
  };
  try {
    await device.shell(`am start -n ${pkg}/.MainActivity`);
    await attach();
    await expect(page.locator(".android-header, .android-reader").first()).toBeVisible();
    await closeReader();
    baseline = await fingerprint();
    const baselineFile = path.join(output, "screen-baseline.json");
    if (process.argv.includes("--baseline")) {
      await fs.writeFile(baselineFile, JSON.stringify(baseline, null, 2));
      checked("current library and preferences recorded as hashes without saving credentials"); return;
    }
    const upgrade = JSON.parse(await fs.readFile(baselineFile, "utf8"));
    assert.deepEqual(baseline.tables, upgrade.tables, "Upgrade changed library or plugin records");
    report.preferencesMatchBeforeUpgrade = baseline.preferences === upgrade.preferences;
    preferences = (await storage({ channel: "preferences", action: "read" })).values;
    await withoutDebugger(async () => { await expect.poll(windowKeepsScreenOn).toBe(false); });
    checked("upgraded library is preserved and the library window allows normal screen timeout");
    const invalid = await page.evaluate(async () => {
      try { await window.Capacitor.Plugins.KoodoStorage.setKeepScreenOn({ enabled: "yes" }); return false; }
      catch { return true; }
    });
    assert.equal(invalid, true);
    await withoutDebugger(async () => { await expect.poll(windowKeepsScreenOn).toBe(false); });
    checked("screen control rejects non-boolean bridge input without changing window flags");
    for (const name of ["安卓章节样本", "安卓文本样本", "安卓 PDF 样本"]) {
      await page.locator(".book-list-item").filter({ hasText: name }).locator(".book-item-cover").click();
      await expect(page.locator(".android-reader")).toBeVisible();
      await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
      await hideReadingTools(page);
      await withoutDebugger(async () => {
        await expect.poll(windowKeepsScreenOn).toBe(true);
        await expect.poll(holdsScreen).toBe(true);
        if (name === "安卓章节样本") {
          shell("input keyevent KEYCODE_HOME");
          await expect.poll(holdsScreen).toBe(false);
          shell(`am start -n ${pkg}/.MainActivity`);
          await expect.poll(holdsScreen).toBe(true);
          checked("backgrounding permits screen timeout and returning to the reader restores its screen hold");
          const timeout = Number(shell("settings get system screen_off_timeout").trim());
          if (timeout > 0 && timeout <= 60000) {
            await new Promise(resolve => setTimeout(resolve, timeout + 1500));
            assert.match(shell("dumpsys power"), /mWakefulness=Awake/);
            assert.equal(await holdsScreen(), true);
            report.idleMs = timeout + 1500;
            checked("reader remains awake without a debugger or input beyond the existing screen timeout");
          }
        }
      });
      await closeReader();
      await withoutDebugger(async () => {
        await expect.poll(windowKeepsScreenOn).toBe(false);
        await expect.poll(holdsScreen).toBe(false);
      });
      checked(`${name}: reader keeps the screen on and exit clears the window flag`);
    }
    assert.deepEqual(report.errors, []); report.passed = true;
  } catch (error) { report.error = error.message; throw error; }
  finally {
    try {
      if (page && preferences) {
        await closeReader();
        await page.evaluate(({ original, keys }) => {
          for (const key of keys) { if (original[key] === undefined) localStorage.removeItem(key); else localStorage.setItem(key, original[key]); }
        }, { original: preferences, keys: configKeys });
        await expect.poll(async () => {
          const saved = (await storage({ channel: "preferences", action: "read" })).values;
          return configKeys.every(key => saved[key] === preferences[key]);
        }).toBe(true);
        assert.deepEqual((await fingerprint()).tables, baseline.tables);
        await withoutDebugger(async () => { await expect.poll(windowKeepsScreenOn).toBe(false); });
        checked("original reading preferences, progress, statistics and all primary records are preserved");
      }
    } catch (error) { report.passed = false; report.cleanupError = error.message; throw error; }
    finally {
      if (!process.argv.includes("--baseline")) await fs.writeFile(path.join(output, "screen-report.json"), JSON.stringify(report, null, 2));
      await Promise.all(devices.map(item => item.close()));
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
