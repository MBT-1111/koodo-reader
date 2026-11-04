const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path"), http = require("node:http");
const { createHash } = require("node:crypto"), { execFileSync } = require("node:child_process");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { systemPicker } = require("./android-system-picker.cjs");
const { showReadingTools } = require("../e2e/android/fixtures.cjs");
const { wave, plugin } = require("../e2e/android/cloud-speech-fixtures.cjs");
const pkg = process.env.ANDROID_TEST_PACKAGE || "xyz.koodoreader.custom.android", output = path.join(__dirname, "..", "dist", "android-device");
assert.ok(["xyz.koodoreader.custom.android", "xyz.koodoreader.custom.android.restoreqa"].includes(pkg));
const configKeys = ["readerConfig", "recordLocation", "readingTime", "readingStats", "recentBooks", "multiRoleVoiceBooks"];
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");

async function main() {
  await fs.mkdir(output, { recursive: true });
  let devices = await android.devices({ omitDriverInstall: true });
  const selected = devices.filter(item => !process.env.ANDROID_SERIAL || item.serial() === process.env.ANDROID_SERIAL);
  assert.equal(selected.length, 1, "Connect one unlocked test phone or select ANDROID_SERIAL");
  let device = selected[0], page, baseline, preferences, fixtures = [], port, monitor;
  const serial = device.serial(), report = { passed: false, checks: [], errors: [], cases: [] };
  const shell = command => execFileSync(process.env.ADB_PATH || "adb", ["-s", serial, "shell", command], { encoding: "utf8" });
  const checked = text => { report.checks.push(text); console.log(`PASS ${text}`); };
  const attach = async () => {
    page = await (await device.webView({ pkg })).page(); page.setDefaultTimeout(15000);
    page.on("pageerror", error => report.errors.push(error.message));
  };
  const storage = data => page.evaluate(async data => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, data);
  const speech = data => page.evaluate(data => window.Capacitor.Plugins.KoodoSpeech.execute(data), data);
  const state = () => speech({ action: "state" });
  const rows = async () => Object.fromEntries(await Promise.all(["books", "notes", "bookmarks", "words", "plugins"].map(async dbName => [dbName, (await storage({ channel: "database-command", dbName, statement: "getAllStatement" })).sort((a, b) => String(a.key).localeCompare(String(b.key)))])));
  const summaries = value => Object.fromEntries(Object.entries(value).map(([table, records]) => [table, { count: records.length, sha256: hash(records) }]));
  const closeReader = async () => {
    if (await page.locator(".android-speech").count()) await page.locator(".android-speech .android-reader-sheet-heading button").click();
    if (await page.locator(".android-reader").count()) {
      const toggle = page.locator(".android-reader-menu-toggle"); if (await toggle.isVisible()) await toggle.click();
      await page.locator(".android-reader-toolbar > button").first().click();
      await expect(page.locator(".android-header")).toBeVisible();
    }
  };
  const released = async () => {
    await expect.poll(async () => shell(`run-as ${pkg} ls cache/cloud-speech`).trim()).toBe("");
    assert.ok(!shell(`dumpsys activity services ${pkg}`).includes("isForeground=true"));
    assert.ok(!shell("dumpsys power").split("\n").some(line => line.includes("PARTIAL_WAKE_LOCK") && line.includes(`${pkg}:speech`)));
  };
  const received = [];
  let phase = "", seconds = 4;
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const azure = request.url.startsWith("/azure"), body = Buffer.concat(chunks).toString();
    if (request.headers[azure ? "ocp-apim-subscription-key" : "api-key"] !== "synthetic-cloud-key") { response.writeHead(401); response.end(); return; }
    const text = azure ? body : JSON.parse(body).messages[0].content;
    received.push({ phase, text, time: Date.now() });
    const audio = wave(seconds);
    response.writeHead(200, { "Content-Type": azure ? "audio/mpeg" : "application/json" });
    response.end(azure ? audio : JSON.stringify({ choices: [{ message: { audio: { data: audio.toString("base64") } } }] }));
  });
  try {
    await device.shell(`am start -n ${pkg}/xyz.koodoreader.custom.android.MainActivity`); await attach();
    await expect(page.locator(".android-header, .android-reader").first()).toBeVisible(); await closeReader();
    baseline = await rows();
    const baselineFile = path.join(output, pkg.endsWith(".restoreqa") ? "chapter-qa-baseline.json" : "chapter-device-baseline.json");
    if (process.argv.includes("--baseline")) {
      await fs.writeFile(baselineFile, JSON.stringify({ tables: summaries(baseline), preferences: hash((await storage({ channel: "preferences", action: "read" })).values) }, null, 2));
      checked("current library and preferences recorded as hashes without saving credentials"); return;
    }
    const upgrade = JSON.parse(await fs.readFile(baselineFile, "utf8")); assert.deepEqual(summaries(baseline), upgrade.tables);
    preferences = (await storage({ channel: "preferences", action: "read" })).values;
    report.preferencesMatchBeforeUpgrade = hash(preferences) === upgrade.preferences;
    checked("upgrade preserves all primary records and configured plugins");
    const books = ["安卓章节样本", "安卓文本样本"].map(name => { const book = baseline.books.find(item => item.name === name); assert.ok(book, `Missing synthetic fixture ${name}`); return book; });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); port = server.address().port;
    execFileSync(process.env.ADB_PATH || "adb", ["-s", serial, "reverse", `tcp:${port}`, `tcp:${port}`]);
    fixtures = [plugin("azure", `http://localhost:${port}/azure`), plugin("mimo", `http://localhost:${port}/mimo`)];
    for (const data of fixtures) await storage({ channel: "database-command", dbName: "plugins", statement: "saveStatement", data });
    await page.evaluate(keys => {
      const config = JSON.parse(localStorage.getItem("readerConfig") || "{}"); Object.assign(config, { lang: "en", androidSpeechAutoChapters: "no" }); localStorage.setItem("readerConfig", JSON.stringify(config));
      const positions = JSON.parse(localStorage.getItem("recordLocation") || "{}"); for (const key of keys) delete positions[key]; localStorage.setItem("recordLocation", JSON.stringify(positions));
      localStorage.setItem("multiRoleVoiceBooks", JSON.stringify(JSON.parse(localStorage.getItem("multiRoleVoiceBooks") || "[]").filter(key => !keys.includes(key))));
    }, books.map(book => book.key));
    await page.reload();
    for (const [book, source] of [[books[0], "system"], [books[1], "system"], [books[0], "azure"], [books[1], "mimo"]]) {
      phase = `${book.format}-${source}`;
      await page.locator(".book-list-item").filter({ hasText: book.name }).locator(".book-item-cover").click();
      await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
      await showReadingTools(page);
      await page.getByRole("button", { name: "Chapters", exact: true }).click();
      await page.locator(".content-chapter-title").first().click();
      const position = () => page.evaluate(key => JSON.parse(localStorage.getItem("recordLocation") || "{}")[key], book.key);
      await expect.poll(async () => Number((await position())?.chapterDocIndex)).toBe(0);
      const toggle = page.locator(".android-reader-menu-toggle"); if (await toggle.isVisible()) await toggle.click();
      await page.getByRole("button", { name: "Text to speech", exact: true }).click();
      const panel = page.locator(".android-speech");
      await panel.getByLabel("Speech service", { exact: true }).selectOption(source);
      await expect(panel.getByLabel("Voice", { exact: true })).toBeEnabled();
      if (source === "system") {
        const voice = (await speech({ action: "voices" })).voices.find(item => item.locale === "zh-CN" && !item.network); assert.ok(voice);
        await panel.getByLabel("Voice", { exact: true }).selectOption(voice.name);
      }
      await panel.getByLabel("Speed", { exact: true }).selectOption(source === "system" ? "3" : "1");
      await panel.getByRole("checkbox", { name: "Continue to next chapters", exact: true }).check();
      await systemPicker(page, device).tap(panel.getByRole("button", { name: "Read aloud", exact: true }));
      await expect.poll(async () => (await state()).status, { timeout: 20000 }).toBe("playing");
      assert.equal((await state()).chapterDocIndex, 0);
      await speech({ action: "pause" });
      let moves = 0;
      while ((await state()).chapterDocIndex === 0 && moves++ < 500) await speech({ action: "next" });
      assert.ok(moves < 500); assert.equal((await state()).chapterDocIndex, 1);
      await speech({ action: "previous" }); assert.equal((await state()).chapterDocIndex, 0);
      const boundary = (await state()).index;
      assert.equal((await state()).status, "paused");
      const invalid = { action: "start", source: "system", bookKey: book.key, title: "Invalid chapter QA", text: ["one"], voice: "unused", speed: 1, chapterIndex: 0, chapterTitle: "one", followingChapters: [{ index: 0, title: "bad", text: ["two"] }] };
      await assert.rejects(() => speech(invalid)); assert.equal((await state()).index, boundary); assert.equal((await state()).status, "paused");
      await speech({ action: "resume" }); await device.shell("input keyevent KEYCODE_HOME");
      await Promise.all(devices.map(item => item.close())); page = undefined;
      const detachedAt = Date.now(); await new Promise(resolve => setTimeout(resolve, 10000));
      devices = await android.devices({ omitDriverInstall: true }); device = devices.find(item => item.serial() === serial); assert.ok(device); await attach();
      const background = await state(); assert.equal(background.chapterDocIndex, 1); assert.equal(background.status, "playing"); assert.ok(background.index > boundary);
      if (source !== "system") assert.ok(received.some(item => item.phase === phase && item.time > detachedAt && item.text.includes(book.format === "TXT" ? "后续第" : "第二章")), "Next chapter synthesis must run while the debugger is detached");
      // Direct app controls are foreground gestures; background resume uses the media session.
      await device.shell(`am start -n ${pkg}/xyz.koodoreader.custom.android.MainActivity`);
      await expect.poll(async () => Number((await position()).chapterDocIndex), { timeout: 15000 }).toBe(1);
      await speech({ action: "pause" }); const paused = (await state()).index; await page.waitForTimeout(500); assert.equal((await state()).index, paused);
      await speech({ action: "resume" }); await expect.poll(async () => (await state()).status).toBe("playing");
      report.cases.push({ format: book.format, source, backgroundChapter: background.chapterDocIndex, detachedMs: 10000 });
      checked(`${phase}: native chapter transition with debugger detached, paused boundary navigation, invalid input rejection and reading position follows speech`);
      await device.shell(`am start -n ${pkg}/xyz.koodoreader.custom.android.MainActivity`);
      if (source === "azure") {
        await device.shell("input keyevent KEYCODE_HOME");
        monitor = await device.open("shell:cmd media_session monitor KoodoSpeech"); let ready = false;
        monitor.on("data", data => { if (data.toString().includes("Monitoring session")) ready = true; }); await expect.poll(() => ready).toBe(true);
        await monitor.write(Buffer.from("pause\n")); await expect.poll(async () => (await state()).status).toBe("paused");
        await monitor.write(Buffer.from("play\n")); await expect.poll(async () => (await state()).status).toBe("playing");
        await monitor.write(Buffer.from("q\n")); await monitor.close(); monitor = undefined;
        checked("targeted media controls pause and resume the native queue after a chapter transition");
        await device.shell(`am start -n ${pkg}/xyz.koodoreader.custom.android.MainActivity`);
      }
      await closeReader(); assert.equal((await state()).status, "idle"); await released();
    }
    seconds = 1;
    await speech({ action: "start", source: "mimo", bookKey: books[0].key, title: "Chapter completion QA", voice: "冰糖", speed: 1, config: fixtures[1].voiceList[0].config,
      text: ["第一章末句。"], chapterIndex: 0, chapterTitle: "第一章", followingChapters: [{ index: 1, title: "空章", text: [" "] }, { index: 2, title: "末章", text: ["最后一句。"] }] });
    await expect.poll(async () => (await state()).status, { timeout: 10000 }).toBe("completed"); assert.equal((await state()).chapterDocIndex, 2); await released();
    checked("empty chapters are skipped and the final chapter releases audio resources at completion");
    assert.deepEqual(report.errors, []); report.passed = true;
  } catch (error) {
    report.error = error.message; report.phase = phase; report.stack = error.stack;
    if (page) {
      const value = await state().catch(() => ({}));
      report.failedState = { status: value.status, error: value.error, index: value.index, total: value.total, chapterDocIndex: value.chapterDocIndex };
    }
    throw error;
  }
  finally {
    try {
      if (preferences && !page) {
        devices = await android.devices({ omitDriverInstall: true }); device = devices.find(item => item.serial() === serial); assert.ok(device, "Reconnect the test phone to restore its original preferences");
        await device.shell(`am start -n ${pkg}/xyz.koodoreader.custom.android.MainActivity`); await attach();
      }
      if (page && preferences) {
        if (monitor) { await monitor.write(Buffer.from("q\n")).catch(() => {}); await monitor.close().catch(() => {}); }
        await speech({ action: "stop" }); await device.shell(`am start -n ${pkg}/xyz.koodoreader.custom.android.MainActivity`); await closeReader();
        for (const item of fixtures) {
          await storage({ channel: "database-command", dbName: "plugins", statement: "deleteStatement", data: item.key });
          const original = baseline.plugins.find(record => record.key === item.key); if (original) await storage({ channel: "database-command", dbName: "plugins", statement: "saveStatement", data: original });
        }
        await page.evaluate(({ original, keys }) => { for (const key of keys) { if (original[key] === undefined) localStorage.removeItem(key); else localStorage.setItem(key, original[key]); } }, { original: preferences, keys: configKeys });
        await expect.poll(async () => { const saved = (await storage({ channel: "preferences", action: "read" })).values; return configKeys.every(key => saved[key] === preferences[key]); }).toBe(true);
        assert.deepEqual(summaries(await rows()), summaries(baseline)); await released(); await page.reload();
        checked("original plugins, preferences, reading positions, statistics and all primary records are restored");
      }
    } catch (error) { report.passed = false; report.cleanupError = error.message; throw error; }
    finally {
      if (port) { try { execFileSync(process.env.ADB_PATH || "adb", ["-s", serial, "reverse", "--remove", `tcp:${port}`]); } catch {} }
      if (!process.argv.includes("--baseline")) await fs.writeFile(path.join(output, pkg.endsWith(".restoreqa") ? "chapter-qa-report.json" : "chapter-device-report.json"), JSON.stringify(report, null, 2));
      await Promise.all(devices.map(item => item.close())); if (server.listening) await new Promise(resolve => server.close(resolve));
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
