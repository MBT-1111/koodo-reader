const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path");
const { createHash } = require("node:crypto");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { systemPicker } = require("./android-system-picker.cjs");
const pkg = "xyz.koodoreader.custom.android", output = path.join(__dirname, "..", "dist", "android-device");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const selected = devices.filter(item => !process.env.ANDROID_SERIAL || item.serial() === process.env.ANDROID_SERIAL);
  assert.equal(selected.length, 1, "Connect one unlocked phone or select ANDROID_SERIAL");
  const device = selected[0], report = { passed: false, checks: [], errors: [] };
  let page;
  const checked = text => { report.checks.push(text); console.log(`PASS ${text}`); };
  try {
    const attach = async () => {
      await device.shell(`am start -n ${pkg}/.MainActivity`);
      page = await (await device.webView({ pkg })).page(); page.setDefaultTimeout(15000);
      page.on("pageerror", error => report.errors.push(error.message));
      await expect(page.locator(".android-header")).toBeVisible();
    };
    await attach();
    const storage = data => page.evaluate(async data => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, data);
    const fingerprint = async () => {
      const tables = {};
      for (const dbName of ["books", "notes", "bookmarks", "words", "plugins"]) {
        const rows = await storage({ channel: "database-command", dbName, statement: "getAllStatement" });
        tables[dbName] = { count: rows.length, sha256: hash(rows.sort((a, b) => String(a.key).localeCompare(String(b.key)))) };
      }
      return { tables, preferences: hash((await storage({ channel: "preferences", action: "read" })).values) };
    };
    const baselineFile = path.join(output, "stats-baseline.json");
    if (process.argv.includes("--baseline")) {
      await fs.writeFile(baselineFile, JSON.stringify(await fingerprint(), null, 2));
      checked("current library and preferences recorded as hashes without saving credentials"); return;
    }
    const baseline = JSON.parse(await fs.readFile(baselineFile, "utf8"));
    const before = await fingerprint();
    const preferencesBefore = (await storage({ channel: "preferences", action: "read" })).values;
    assert.deepEqual(before.tables, baseline.tables, "Upgrade changed library/plugin records");
    report.preferencesMatchBeforeUpgrade = before.preferences === baseline.preferences;
    checked("upgrade retains books, notes, bookmarks, words and configured plugins");
    const tap = locator => systemPicker(page, device).tap(locator);
    const openStats = async () => {
      await tap(page.locator(".android-bottom-nav button").last());
      const settings = page.locator(".android-settings");
      await tap(settings.locator(".android-settings-group button").filter({ has: page.locator(".icon-chart") }));
      const stats = page.locator(".android-stats");
      await expect(stats).toHaveAttribute("aria-busy", "false");
      await expect(stats.locator(".android-stats-card")).toHaveCount(4);
      await expect(stats.locator(".android-stats-day-summary li")).toHaveCount(7);
      await expect(stats.locator(".android-stats-cell[data-date]")).toHaveCount(90);
      assert.ok(await page.locator(".android-settings-content").evaluate(element => element.scrollWidth <= element.clientWidth));
      return stats;
    };
    const stats = await openStats();
    const values = await stats.locator(".android-stats-card strong").allTextContents();
    await fs.writeFile(path.join(output, "stats-phone-overview.png"), await device.screenshot());
    checked("four saved-data metrics, seven daily values and ninety activity cells fit the installed phone");
    await tap(stats.locator(".android-stats-chart-tabs button").last());
    await expect(stats.locator(".android-stats-chart")).toHaveAttribute("data-chart", "line");
    await expect(stats.locator(".recharts-area")).toHaveCount(1);
    await tap(stats.locator(".android-stats-chart-tabs button").first());
    await expect(stats.locator(".recharts-bar")).toHaveCount(1);
    await tap(stats.locator(".android-stats-toolbar button"));
    await expect(stats).toHaveAttribute("aria-busy", "false");
    assert.deepEqual(await stats.locator(".android-stats-card strong").allTextContents(), values);
    await stats.locator(".android-stats-legend").scrollIntoViewIfNeeded();
    await expect(stats.locator(".android-stats-legend")).toBeInViewport();
    await fs.writeFile(path.join(output, "stats-phone-activity.png"), await device.screenshot());
    await page.locator(".setting-close-container").click();
    assert.deepEqual(await fingerprint(), before, "Viewing/changing charts/refreshing changed stored records");
    checked("chart toggles and refresh work by native touch without writing records or preferences");
    await device.shell(`am force-stop ${pkg}`);
    await attach();
    const reopened = await openStats();
    assert.deepEqual(await reopened.locator(".android-stats-card strong").allTextContents(), values);
    await page.locator(".setting-close-container").click();
    const preferencesAfter = (await storage({ channel: "preferences", action: "read" })).values;
    report.restartChangedPreferenceKeys = [...new Set([...Object.keys(preferencesBefore), ...Object.keys(preferencesAfter)])].filter(key => preferencesBefore[key] !== preferencesAfter[key]);
    // Existing startup code sets totalBooks/isOSNight again, updating upstream sync metadata.
    // During chart inspection above, compare every key; across process startup, exclude only syncRecord.
    const savedPreferences = values => Object.fromEntries(Object.entries(values).filter(([key]) => key !== "syncRecord"));
    assert.deepEqual(hash(savedPreferences(preferencesAfter)), hash(savedPreferences(preferencesBefore)), "Restart changed saved settings or reading counters");
    assert.deepEqual((await fingerprint()).tables, before.tables, "Restart changed library records");
    const entry = await page.locator('script[type="module"][src*="/static/"]').getAttribute("src");
    assert.ok((await fs.readFile(path.join(__dirname, "..", "build-android", "index.html"), "utf8")).includes(entry));
    assert.deepEqual(report.errors, []); report.passed = true;
    checked("restart retains statistics and preferences; installed bundle matches the final build");
  } catch (error) { report.error = error.message; throw error; }
  finally {
    if (!process.argv.includes("--baseline")) await fs.writeFile(path.join(output, "stats-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map(item => item.close()));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
