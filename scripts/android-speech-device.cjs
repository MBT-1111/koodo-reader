const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { showReadingTools } = require("../e2e/android/fixtures.cjs");
const { systemPicker } = require("./android-system-picker.cjs");
const { selectSpeechParagraph } = require("../e2e/android/speech-selection.cjs");

const pkg = "xyz.koodoreader.custom.android", testPkg = `${pkg}.test`;
const output = path.join(__dirname, "..", "dist", "android-device");
const hash = (value) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const configKeys = ["readerConfig", "recordLocation", "readingTime", "readingStats", "recentBooks"];

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const selected = devices.filter((candidate) => !process.env.ANDROID_SERIAL || candidate.serial() === process.env.ANDROID_SERIAL);
  assert.equal(selected.length, 1, "Connect one unlocked device, or select ANDROID_SERIAL");
  const device = selected[0], report = { passed: false, checks: [], errors: [] };
  let page, monitor, baseline, preferences, fixture, ownsReader = false;
  const checked = (text) => { report.checks.push(text); console.log(`PASS ${text}`); };
  const storage = (request) => page.evaluate(async (data) => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
  const speech = (request) => page.evaluate((data) => window.Capacitor.Plugins.KoodoSpeech.execute(data), request);
  const state = () => speech({ action: "state" });
  const rows = async () => Object.fromEntries(await Promise.all(["books", "notes", "bookmarks", "words", "plugins"].map(async (dbName) =>
    [dbName, await storage({ channel: "database-command", dbName, statement: "getAllStatement" })])));
  const attach = async () => {
    await device.shell(`am start -n ${pkg}/.MainActivity`);
    page = await (await device.webView({ pkg })).page();
    page.setDefaultTimeout(20000);
    page.on("pageerror", (error) => report.errors.push(error.message));
    await page.context().route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.hostname === "localhost" || ["data:", "blob:"].includes(url.protocol) ? route.continue() : route.abort();
    });
    await expect(page.locator(".android-header, .android-reader").first()).toBeVisible();
  };
  const advance = async () => {
    const before = (await state()).index;
    await expect.poll(async () => (await state()).index, { timeout: 45000 }).toBeGreaterThan(before);
  };
  const closeReader = async () => {
    if (await page.locator(".android-speech").count()) await page.locator(".android-speech").getByRole("button", { name: "Close", exact: true }).click();
    if (await page.locator(".android-reader").count()) {
      await showReadingTools(page);
      await page.getByRole("button", { name: "Exit reader", exact: true }).click();
      await expect(page.locator(".android-header")).toBeVisible();
    }
  };
  try {
    await attach();
    assert.ok((await device.shell("dumpsys window")).toString().match(/mCurrentFocus=.*xyz\.koodoreader\.custom\.android/), "Unlock the phone before running speech QA");
    baseline = await rows(); preferences = (await storage({ channel: "preferences", action: "read" })).values;
    fixture = baseline.books.find((book) => book.name === "安卓章节样本");
    assert.ok(fixture, "Import the existing synthetic Android chapter fixture first");
    if (await page.locator(".android-reader").count()) assert.equal(page.url().split("?")[0].split("/").pop(), fixture.key, "Close unrelated books before speech QA");
    ownsReader = true;
    await closeReader();
    await page.locator(".book-list-item").filter({ hasText: "安卓章节样本" }).first().locator(".book-item-cover").click();
    await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
    await showReadingTools(page);
    // CDP opens the toolbar panel even if another app's picture-in-picture covers it.
    await page.getByRole("button", { name: "Text to speech", exact: true }).click();
    const panel = page.locator(".android-speech"), ui = systemPicker(page, device);
    await expect(panel).toHaveCount(1);
    await panel.getByLabel("Speech service", { exact: true }).selectOption("system");
    await expect(panel.getByLabel("Voice", { exact: true })).toBeEnabled();
    const voice = (await speech({ action: "voices" })).voices.find((item) => item.locale === "zh-CN" && !item.network);
    assert.ok(voice, "Install an offline Chinese system voice before QA");
    report.voice = voice.name;
    await panel.getByLabel("Voice", { exact: true }).selectOption(voice.name);
    await panel.getByLabel("Speed", { exact: true }).selectOption("1.5");
    await ui.tap(panel.getByRole("button", { name: "Read aloud", exact: true }));
    await expect.poll(async () => (await state()).status).toBe("playing");
    await advance(); checked("offline Chinese voice starts by physical touch and advances through native utterance completion");
    const initialTotal = (await state()).total;
    await panel.getByRole("button", { name: "Stop", exact: true }).click();
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await selectSpeechParagraph(page);
    await ui.tap(page.locator(".speech-start-option"));
    await expect.poll(async () => (await state()).status).toBe("playing");
    assert.ok((await state()).total < initialTotal, "Selection must exclude earlier chapter text");
    checked("Read from here physically starts a new native queue at the selected paragraph without pressing Start");
    await ui.tap(panel.getByRole("button", { name: "Pause", exact: true }));
    const paused = await state(); assert.equal(paused.status, "paused");
    await page.waitForTimeout(2000); assert.equal((await state()).index, paused.index);
    await ui.tap(panel.getByRole("button", { name: "Next sentence", exact: true })); assert.equal((await state()).index, paused.index + 1);
    await ui.tap(panel.getByRole("button", { name: "Previous sentence", exact: true })); assert.equal((await state()).index, paused.index);
    await ui.tap(panel.getByRole("button", { name: "Resume", exact: true })); await advance();
    checked("physical pause, sentence skipping and resume preserve the queue");
    await fs.writeFile(path.join(output, "speech-playing.png"), await device.screenshot());
    await ui.tap(panel.getByRole("button", { name: "Close", exact: true }));
    await expect(panel).toHaveCount(0); await advance(); checked("panel closure retains native playback without leaving UI copies");

    const primaryUid = (await device.shell(`pm list packages -U --user 0 ${pkg}`)).toString().match(/package:xyz\.koodoreader\.custom\.android uid:(\d+)/)?.[1];
    assert.ok(primaryUid);
    for (const mode of ["duck", "transient", "gain"]) {
      await device.shell(`run-as ${testPkg} rm -f files/focus-probe.json`);
      await device.shell(`am start -n ${testPkg}/xyz.koodoreader.custom.android.SpeechFocusProbeActivity --es mode ${mode}`);
      let probe;
      await expect.poll(async () => {
        try { probe = JSON.parse((await device.shell(`run-as ${testPkg} cat files/focus-probe.json`)).toString()); }
        catch { return false; }
        return probe.mode === mode && probe.granted;
      }, { timeout: 15000 }).toBe(true);
      assert.notEqual(String(probe.uid), primaryUid);
      await expect.poll(async () => (await state()).status).toBe("paused");
      await device.shell("input keyevent KEYCODE_BACK");
      await device.shell(`am start -n ${pkg}/.MainActivity`);
      await page.waitForTimeout(1500); assert.equal((await state()).status, "paused");
      await speech({ action: "resume" }); await advance();
      checked(`separate-UID ${mode} audio focus pauses speech without unsolicited resume`);
    }

    monitor = await device.open("shell:cmd media_session monitor KoodoSpeech");
    let monitoring = false;
    monitor.on("data", (data) => { if (data.toString().includes("Monitoring session")) monitoring = true; });
    await expect.poll(() => monitoring).toBe(true);
    await device.shell("input keyevent KEYCODE_HOME"); await advance();
    await monitor.write(Buffer.from("pause\n")); await expect.poll(async () => (await state()).status).toBe("paused");
    await monitor.write(Buffer.from("play\n")); await expect.poll(async () => (await state()).status).toBe("playing"); await advance();
    checked("Home playback and targeted system media Pause/Play work outside the WebView");
    if (process.argv.includes("--screen-off")) {
      const before = (await state()).index;
      await device.shell("input keyevent KEYCODE_SLEEP"); await page.waitForTimeout(12000);
      const after = await state(); assert.equal(after.status, "playing"); assert.ok(after.index > before);
      report.screenOff = { before, after: after.index };
      checked("native speech advances while the physical screen is asleep");
      await device.shell("input keyevent KEYCODE_WAKEUP");
      await device.shell("wm dismiss-keyguard");
      console.log("Unlock the phone to finish physical reader-exit QA.");
      await expect.poll(async () => (await device.shell("dumpsys window")).toString().includes("mDreamingLockscreen=true"), { timeout: 120000 }).toBe(false);
    }
    await device.shell(`am start -n ${pkg}/.MainActivity`); await closeReader();
    assert.equal((await state()).status, "idle");
    const services = (await device.shell(`dumpsys activity services ${pkg}`)).toString();
    assert.ok(!services.includes("isForeground=true"));
    assert.ok(!(await device.shell("dumpsys power")).toString().split("\n").some((line) => line.includes("PARTIAL_WAKE_LOCK") && line.includes(`${pkg}:speech`)));
    checked("reader exit stops speech and releases the foreground service and wake lock");
    assert.equal(hash(await rows()), hash(baseline));
    assert.deepEqual(report.errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.message; throw error;
  } finally {
    let cleanupError;
    try {
      if (monitor) { await monitor.write(Buffer.from("q\n")).catch(() => {}); await monitor.close().catch(() => {}); }
      if (page && !page.isClosed() && ownsReader) {
        await speech({ action: "stop" }).catch(() => {});
        await closeReader().catch(() => {});
        if (preferences && fixture) {
          await page.evaluate(({ original, keys }) => {
            for (const key of keys) { if (original[key] === undefined) localStorage.removeItem(key); else localStorage.setItem(key, original[key]); }
          }, { original: preferences, keys: configKeys });
          await expect.poll(async () => {
            const saved = (await storage({ channel: "preferences", action: "read" })).values;
            return configKeys.every((key) => saved[key] === preferences[key]);
          }).toBe(true);
        }
        if (baseline) assert.equal(hash(await rows()), hash(baseline), "Primary records changed");
      }
    } catch (error) {
      report.passed = false; report.cleanupError = error.message; cleanupError = error;
    } finally {
      await fs.writeFile(path.join(output, "speech-report.json"), JSON.stringify(report, null, 2));
      await Promise.all(devices.map((item) => item.close()));
    }
    if (cleanupError) throw cleanupError;
  }
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
