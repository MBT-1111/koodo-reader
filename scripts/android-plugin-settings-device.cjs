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
    await device.shell(`am start -n ${pkg}/.MainActivity`);
    page = await (await device.webView({ pkg })).page(); page.setDefaultTimeout(15000);
    page.on("pageerror", error => report.errors.push(error.message));
    await expect(page.locator(".android-header")).toBeVisible();
    const storage = data => page.evaluate(async data => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, data);
    const fingerprint = async () => {
      const tables = {};
      for (const dbName of ["books", "notes", "bookmarks", "words", "plugins"]) {
        const rows = await storage({ channel: "database-command", dbName, statement: "getAllStatement" });
        tables[dbName] = { count: rows.length, sha256: hash(rows.sort((a, b) => String(a.key).localeCompare(String(b.key)))) };
      }
      return { tables, preferences: hash((await storage({ channel: "preferences", action: "read" })).values) };
    };
    const baselineFile = path.join(output, "plugin-settings-baseline.json");
    if (process.argv.includes("--baseline")) {
      await fs.writeFile(baselineFile, JSON.stringify(await fingerprint(), null, 2));
      checked("library and preferences recorded as hashes without saving credentials"); return;
    }
    const baseline = JSON.parse(await fs.readFile(baselineFile, "utf8"));
    if (process.argv.includes("--refresh-preferences")) {
      // Use only after the owner confirms concurrent preference changes; retain the library baseline.
      const current = await fingerprint();
      assert.deepEqual(current.tables, baseline.tables, "Primary records changed before refreshing preferences");
      await fs.copyFile(baselineFile, path.join(output, "plugin-settings-baseline-before-preference-change.json"));
      await fs.writeFile(baselineFile, JSON.stringify({ ...baseline, preferences: current.preferences }, null, 2));
      checked("confirmed owner preference changes retained; library baseline unchanged"); return;
    }
    const beforeInspection = await fingerprint();
    assert.deepEqual(beforeInspection.tables, baseline.tables, "Upgrade changed primary records");
    // Reading and owner actions may update preferences between test runs; never restore an older snapshot.
    report.preferencesMatchRecordedBaseline = beforeInspection.preferences === baseline.preferences;
    checked("upgraded APK retains the complete library and original plugin records");
    const tap = locator => systemPicker(page, device).tap(locator);
    await tap(page.locator(".android-bottom-nav button").last());
    const settings = page.locator(".android-settings");
    await expect(settings.locator(".android-settings-group .icon-detail")).toHaveCount(0);
    await tap(settings.locator(".android-settings-group button").filter({ has: page.locator(".icon-internet") }));
    const plugins = page.locator(".plugin-setting-phone");
    await expect(plugins.locator(".plugin-tab-item")).toHaveCount(4);
    await tap(plugins.locator(".plugin-tab-item").nth(2));
    await expect(plugins).toHaveAttribute("data-plugin-category", "voice");
    await expect(plugins.locator('.plugin-card:not([data-plugin-type="voice"])')).toHaveCount(0);
    await fs.writeFile(path.join(output, "plugins-phone-voice.png"), await device.screenshot());
    checked("phone category buttons filter both installed plugins and the market; About is absent");
    await tap(plugins.locator(".plugin-tab-item").nth(3));
    const market = plugins.locator(".plugin-card-market");
    if (await market.count()) {
      const card = market.first(); await tap(card.getByRole("button").first());
      await expect(card.locator(".plugin-setting-details")).toBeVisible();
      assert.ok(await card.evaluate(element => element.scrollWidth <= element.clientWidth));
    }
    const footer = plugins.locator(".plugin-setting-footer");
    assert.equal(await footer.evaluate(element => getComputedStyle(element).position), "static");
    for (const button of await footer.getByRole("button").all()) {
      await button.scrollIntoViewIfNeeded();
      assert.ok(await button.evaluate(element => {
        const rect = element.getBoundingClientRect(), hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return rect.height >= 44 && (hit === element || element.contains(hit));
      }));
    }
    const boxes = await footer.getByRole("button").evaluateAll(elements => elements.map(element => { const { top, bottom } = element.getBoundingClientRect(); return { top, bottom }; }));
    assert.ok(boxes[0].bottom <= boxes[1].top && boxes[1].bottom <= boxes[2].top);
    assert.ok(await page.locator(".android-settings-content").evaluate(element => element.scrollWidth <= element.clientWidth));
    await fs.writeFile(path.join(output, "plugins-phone-footer.png"), await device.screenshot());
    checked("expanded details and three footer controls wrap without overlap or horizontal scrolling");
    await settings.locator(".setting-close-container").click();
    assert.deepEqual(await fingerprint(), beforeInspection, "UI inspection changed records or current preferences");
    const entry = await page.locator('script[type="module"][src*="/static/"]').getAttribute("src");
    assert.ok((await fs.readFile(path.join(__dirname, "..", "build-android", "index.html"), "utf8")).includes(entry));
    assert.deepEqual(report.errors, []); report.passed = true;
    checked("installed bundle matches the final build and UI inspection retains all current records/preferences");
  } catch (error) { report.error = error.message; throw error; }
  finally {
    if (!process.argv.includes("--baseline") && !process.argv.includes("--refresh-preferences")) await fs.writeFile(path.join(output, "plugin-settings-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map(item => item.close()));
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
