const assert = require("node:assert/strict");
const fs = require("node:fs/promises"), path = require("node:path"), http = require("node:http");
const { execFileSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { showReadingTools } = require("../e2e/android/fixtures.cjs");
const { wave, plugin } = require("../e2e/android/cloud-speech-fixtures.cjs");
const { systemPicker } = require("./android-system-picker.cjs");
const pkg = "xyz.koodoreader.custom.android", output = path.join(__dirname, "..", "dist", "android-device");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
const configKeys = ["readerConfig", "recordLocation", "readingTime", "readingStats", "recentBooks", "customAzureStyles", "customAzureDegrees", "aiModelConfig", "multiRoleVoiceBooks"];

async function main() {
  const report = { passed: false, checks: [], errors: [], requests: { azure: 0, mimo: 0, roles: 0 } };
  const mode = { status: 200, invalid: false, delay: 0, seconds: 6, analysisStatus: 200, analysisDelay: 0 };
  const synthesized = [];
  const synthesisRequests = [], plans = new Map();
  const server = http.createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    if (request.url.startsWith("/v1beta/")) {
      report.requests.roles++;
      const delay = mode.analysisDelay, status = mode.analysisStatus;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (response.destroyed) return;
      if (status !== 200) { response.writeHead(status); response.end("Synthetic analysis failure"); return; }
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const input = JSON.parse(body.contents[0].parts[0].text);
      const roles = Object.fromEntries(input.sentences.map((item, index) => [item.id, ["narrator", "male", "female", "child"][index % 4]]));
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ roles }) }] } }] })); return;
    }
    const azure = request.url.startsWith("/azure"), source = azure ? "azure" : "mimo";
    const body = Buffer.concat(chunks).toString(); report.requests[source]++;
    const payload = azure ? null : JSON.parse(body), text = azure ? body : payload.messages[0].content;
    synthesisRequests.push({ source, text });
    const { status, delay, invalid, seconds } = { ...mode, ...plans.get(text) };
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (response.destroyed) return;
    if (status !== 200) { response.writeHead(status); response.end("Synthetic failure"); return; }
    let valid = request.headers[azure ? "ocp-apim-subscription-key" : "api-key"] === "synthetic-cloud-key";
    if (azure) valid &&= body.includes("<speak") && body.includes('name="zh-CN-XiaoxiaoNeural"') && body.includes('style="cheerful" styledegree="1.5"') && body.includes('rate="+25%"') && request.headers["x-microsoft-outputformat"] === "audio-16khz-128kbitrate-mono-mp3";
    else {
      valid &&= payload.model === "mimo-v2.5-tts" && payload.messages[0].role === "assistant" && payload.audio.voice === "冰糖" && payload.audio.format === "mp3";
    }
    if (!valid) { response.writeHead(400); response.end("Synthetic contract mismatch"); return; }
    synthesized.push(source);
    const audio = invalid ? Buffer.from("invalid audio") : wave(seconds);
    response.writeHead(200, { "Content-Type": azure ? "audio/mpeg" : "application/json" });
    response.end(azure ? audio : JSON.stringify({ choices: [{ message: { audio: { data: audio.toString("base64") } } }] }));
  });
  const devices = await android.devices({ omitDriverInstall: true });
  const selected = devices.filter(item => !process.env.ANDROID_SERIAL || item.serial() === process.env.ANDROID_SERIAL);
  assert.equal(selected.length, 1, "Connect one unlocked device, or select ANDROID_SERIAL");
  const device = selected[0];
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const fixtures = [plugin("azure", `http://localhost:${port}/azure`), plugin("mimo", `http://localhost:${port}/mimo`)];
  let page, baseline, preferences, fixtureBook, monitor;
  const checked = name => { report.checks.push(name); console.log(`PASS ${name}`); };
  const storage = data => page.evaluate(async data => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, data);
  const rows = async () => Object.fromEntries(await Promise.all(["books", "notes", "bookmarks", "words", "plugins"].map(async dbName => [dbName, (await storage({ channel: "database-command", dbName, statement: "getAllStatement" })).sort((left, right) => String(left.key).localeCompare(String(right.key)))])));
  const speech = data => page.evaluate(data => window.Capacitor.Plugins.KoodoSpeech.execute(data), data);
  const state = () => speech({ action: "state" });
  const tap = locator => systemPicker(page, device).tap(locator);
  const cacheCount = async () => (await device.shell(`run-as ${pkg} ls cache/cloud-speech`)).toString().trim().split(/\s+/).filter(Boolean).length;
  const released = async () => {
    await expect.poll(cacheCount).toBe(0);
    assert.ok(!(await device.shell(`dumpsys activity services ${pkg}`)).toString().includes("isForeground=true"));
    assert.ok(!(await device.shell("dumpsys power")).toString().split("\n").some(line => line.includes("PARTIAL_WAKE_LOCK") && line.includes(`${pkg}:speech`)));
  };
  const panel = () => page.locator(".android-speech");
  const open = async () => { await showReadingTools(page); await page.getByRole("button", { name: "Text to speech", exact: true }).click(); await expect(panel()).toBeVisible(); };
  try {
    await fs.mkdir(output, { recursive: true });
    execFileSync(process.env.ADB_PATH || "adb", ["-s", device.serial(), "reverse", `tcp:${port}`, `tcp:${port}`]);
    await device.shell(`am start -n ${pkg}/.MainActivity`);
    page = await (await device.webView({ pkg })).page(); page.setDefaultTimeout(15000);
    page.on("pageerror", error => report.errors.push(error.message));
    await expect(page.locator(".android-header")).toBeVisible();
    baseline = await rows(); preferences = (await storage({ channel: "preferences", action: "read" })).values;
    fixtureBook = baseline.books.find(item => item.name === "安卓章节样本"); assert.ok(fixtureBook);
    for (const data of fixtures) await storage({ channel: "database-command", dbName: "plugins", statement: "saveStatement", data });
    await page.evaluate(key => {
      const positions = JSON.parse(localStorage.getItem("recordLocation") || "{}"); delete positions[key]; localStorage.setItem("recordLocation", JSON.stringify(positions));
    }, fixtureBook.key);
    await page.reload(); await page.locator(".book-list-item").filter({ hasText: fixtureBook.name }).locator(".book-item-cover").click(); await open();
    await panel().getByLabel("Speech service", { exact: true }).selectOption("azure");
    await expect(panel().getByLabel("Voice", { exact: true })).toHaveValue("zh-CN-XiaoxiaoNeural");
    await panel().locator(".custom-emotion select").first().selectOption("cheerful");
    await panel().locator(".custom-emotion select").last().selectOption("1.5");
    await panel().getByLabel("Speed", { exact: true }).selectOption("1.25");
    mode.status = 401;
    await tap(panel().getByRole("button", { name: "Read aloud", exact: true }));
    await expect.poll(async () => (await state()).error).toBe("ANDROID_SPEECH_AUTH"); await released();
    mode.status = 429;
    await panel().getByRole("button", { name: "Read aloud", exact: true }).click();
    await expect.poll(async () => (await state()).error).toBe("ANDROID_SPEECH_QUOTA"); await released();
    mode.status = 200;
    await tap(panel().getByRole("button", { name: "Read aloud", exact: true }));
    await expect.poll(async () => (await state()).status).toBe("playing");
    await expect.poll(cacheCount).toBe(2);
    await tap(panel().getByRole("button", { name: "Pause", exact: true }));
    const paused = await state(), calls = report.requests.azure;
    await page.waitForTimeout(900); assert.equal((await state()).index, paused.index);
    await tap(panel().getByRole("button", { name: "Resume", exact: true }));
    await expect.poll(async () => (await state()).status).toBe("playing"); assert.equal(report.requests.azure, calls);
    checked("Azure native SSML playback retries authentication failure and physically pauses/resumes cached audio");
    await panel().getByRole("button", { name: "Next segment", exact: true }).click();
    await expect.poll(async () => (await state()).index).toBeGreaterThan(paused.index);
    await panel().getByRole("button", { name: "Close", exact: true }).click();
    const before = (await state()).index;
    await device.shell("input keyevent KEYCODE_HOME");
    await expect.poll(async () => (await state()).index, { timeout: 15000 }).toBeGreaterThan(before);
    monitor = await device.open("shell:cmd media_session monitor KoodoSpeech");
    let monitoring = false;
    monitor.on("data", data => { if (data.toString().includes("Monitoring session")) monitoring = true; });
    await expect.poll(() => monitoring).toBe(true);
    await monitor.write(Buffer.from("pause\n")); await expect.poll(async () => (await state()).status).toBe("paused");
    await monitor.write(Buffer.from("play\n")); await expect.poll(async () => (await state()).status).toBe("playing");
    await monitor.write(Buffer.from("q\n")); await monitor.close(); monitor = undefined;
    await device.shell(`am start -n ${pkg}/.MainActivity`); await open();
    await panel().getByRole("button", { name: "Stop", exact: true }).click(); await released();
    checked("Azure queue generates the next segment while Home is visible and stops without residual audio cache or wake lock");
    await panel().getByLabel("Speech service", { exact: true }).selectOption("mimo");
    await panel().getByLabel("Voice", { exact: true }).selectOption("冰糖");
    await panel().getByLabel("Speed", { exact: true }).selectOption("1.25");
    await tap(panel().getByRole("button", { name: "Read aloud", exact: true }));
    await expect.poll(async () => (await state()).status).toBe("playing");
    await fs.writeFile(path.join(output, "cloud-mimo-playing.png"), await device.screenshot());
    await speech({ action: "pause" }); const mimoIndex = (await state()).index;
    await page.waitForTimeout(700); assert.equal((await state()).index, mimoIndex);
    await speech({ action: "resume" }); await expect.poll(async () => (await state()).status).toBe("playing");
    await device.shell(`am start -n ${pkg}.test/xyz.koodoreader.custom.android.SpeechFocusProbeActivity --es mode transient`);
    await expect.poll(async () => (await state()).status).toBe("idle");
    await device.shell("input keyevent KEYCODE_BACK"); await device.shell(`am start -n ${pkg}/.MainActivity`);
    await page.waitForTimeout(800); assert.equal((await state()).status, "idle");
    await panel().getByRole("button", { name: "Read aloud", exact: true }).click(); await expect.poll(async () => (await state()).status).toBe("playing");
    await speech({ action: "stop" }); await released();
    checked("MiMo synthesis supports playback speed, cached resume and cross-UID audio-focus interruption without unsolicited restart");
    mode.invalid = true;
    await panel().getByRole("button", { name: "Read aloud", exact: true }).click();
    await expect.poll(async () => (await state()).status).toBe("error"); await released(); mode.invalid = false;
    checked("invalid cloud audio enters retryable error and releases playback resources");
    mode.delay = 5000;
    const waiting = report.requests.mimo;
    await panel().getByRole("button", { name: "Read aloud", exact: true }).click();
    await expect.poll(() => report.requests.mimo).toBeGreaterThan(waiting);
    await panel().getByRole("button", { name: "Pause", exact: true }).click();
    await expect.poll(async () => (await state()).status).toBe("paused");
    mode.delay = 0;
    await panel().getByRole("button", { name: "Resume", exact: true }).click();
    await expect.poll(async () => (await state()).status, { timeout: 15000 }).toBe("playing");
    await speech({ action: "stop" }); await released();
    checked("pausing an unfinished synthesis can resume with a fresh native request");
    mode.delay = 5000;
    const pending = report.requests.mimo;
    await panel().getByRole("button", { name: "Read aloud", exact: true }).click();
    await expect.poll(() => report.requests.mimo).toBeGreaterThan(pending);
    await expect.poll(async () => (await state()).status).toBe("buffering");
    await panel().getByRole("button", { name: "Stop", exact: true }).click();
    await page.waitForTimeout(5500); assert.equal((await state()).status, "idle"); await released(); mode.delay = 0;
    checked("stopping during synthesis cancels native work and ignores the delayed result");
    mode.seconds = 1;
    await speech({ action: "start", source: "mimo", bookKey: fixtureBook.key, title: "Cloud speech QA", text: ["短队列。".repeat(300)], voice: "冰糖", speed: 1, config: fixtures[1].voiceList[0].config });
    await expect.poll(async () => (await state()).status, { timeout: 12000 }).toBe("completed"); await released();
    checked("cloud queue completion removes temporary clips, media notification and foreground service");

    const text = Array.from({ length: 4 }, (_, index) => `预生成测试第${index + 1}段。` + "测".repeat(800));
    const requestsFor = part => synthesisRequests.filter(request => request.text === part).length;
    const startPrefetch = () => speech({ action: "start", source: "mimo", bookKey: fixtureBook.key, title: "Cloud prefetch QA", text, voice: "冰糖", speed: 1, config: fixtures[1].voiceList[0].config });
    mode.seconds = 4;
    plans.set(text[2], { delay: 2000 }); plans.set(text[3], { delay: 5000 });
    await startPrefetch();
    await expect.poll(cacheCount).toBe(2);
    assert.equal((await state()).index, 0);
    assert.equal(requestsFor(text[0]), 1); assert.equal(requestsFor(text[1]), 1); assert.equal(requestsFor(text[2]), 0);
    await speech({ action: "pause" });
    await page.waitForTimeout(500);
    assert.equal((await state()).index, 0); assert.equal(await cacheCount(), 2);
    await speech({ action: "resume" });
    await expect.poll(async () => (await state()).status).toBe("playing");
    assert.equal(requestsFor(text[0]), 1); assert.equal(requestsFor(text[1]), 1);
    checked("cloud playback prepares exactly one following segment and cached pause/resume sends no duplicate request");
    await expect.poll(async () => (await state()).index, { timeout: 8000 }).toBe(1);
    await expect.poll(() => requestsFor(text[2])).toBe(1);
    assert.equal(requestsFor(text[1]), 1); assert.ok(await cacheCount() <= 2);
    await speech({ action: "next" });
    await expect.poll(async () => (await state()).status).toBe("buffering");
    assert.equal((await state()).index, 2);
    await expect.poll(async () => (await state()).status).toBe("playing");
    await expect.poll(() => requestsFor(text[3])).toBe(1);
    assert.equal(requestsFor(text[2]), 1); assert.ok(await cacheCount() <= 2);
    checked("automatic progression reuses prepared audio and Next adopts slow prefetch without resubmitting");
    await speech({ action: "stop" }); await released();
    await page.waitForTimeout(5500);
    assert.equal((await state()).status, "idle"); await released();
    checked("stopping in-flight prefetch discards its delayed result without reviving audio or cache");

    plans.clear(); plans.set(text[1], { delay: 2000 }); mode.seconds = 6;
    const pendingPrefetch = requestsFor(text[1]);
    await startPrefetch();
    await expect.poll(() => requestsFor(text[1])).toBe(pendingPrefetch + 1);
    await speech({ action: "pause" });
    await page.waitForTimeout(2500);
    assert.equal((await state()).status, "paused"); assert.equal((await state()).index, 0);
    assert.equal(await cacheCount(), 1); assert.equal(requestsFor(text[1]), pendingPrefetch + 1);
    await speech({ action: "resume" });
    await expect.poll(cacheCount).toBe(2);
    assert.equal(requestsFor(text[1]), pendingPrefetch + 2);
    await speech({ action: "stop" }); await released();
    checked("pausing cancels pending prefetch, ignores late audio and only resubmits after explicit resume");

    plans.clear(); plans.set(text[1], { status: 429 }); mode.seconds = 3;
    const failedPrefetch = requestsFor(text[1]);
    await startPrefetch();
    await expect.poll(() => requestsFor(text[1])).toBe(failedPrefetch + 1);
    await page.waitForTimeout(400);
    assert.equal((await state()).status, "playing"); assert.equal((await state()).index, 0);
    await expect.poll(async () => (await state()).error, { timeout: 6000 }).toBe("ANDROID_SPEECH_QUOTA");
    assert.equal(requestsFor(text[1]), failedPrefetch + 1); await released();
    checked("failed prefetch preserves current audio, then reports quota error without automatically retrying");
    plans.clear(); await speech({ action: "stop" });
    await page.evaluate(endpoint => {
      const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
      Object.assign(config, { aiAssistanceModel: "android-role-qa", androidSpeechSource: "azure" });
      localStorage.setItem("readerConfig", JSON.stringify(config));
      const models = JSON.parse(localStorage.getItem("aiModelConfig") || "{}");
      models["android-role-qa"] = { key: "android-role-qa", displayName: "Gemini roles QA", config: { endpoint, modelId: "gemini-roles-qa", apiKey: "synthetic-ai-key", providerId: "google" } };
      localStorage.setItem("aiModelConfig", JSON.stringify(models));
    }, `http://localhost:${port}/v1beta`);
    await page.reload(); await open();
    await panel().getByRole("switch", { name: /AI multi-role speech/ }).click();
    await panel().getByLabel("Male voice", { exact: true }).selectOption(JSON.stringify([fixtures[1].key, "冰糖"]));
    await panel().getByLabel("Female voice", { exact: true }).selectOption(JSON.stringify([fixtures[0].key, "zh-CN-XiaoxiaoNeural"]));
    await panel().getByLabel("Child voice", { exact: true }).selectOption(JSON.stringify([fixtures[1].key, "冰糖"]));
    await panel().getByLabel("Speed", { exact: true }).selectOption("1.25");
    mode.analysisStatus = 503;
    const beforeRoles = synthesized.length;
    await panel().getByRole("button", { name: "Read aloud", exact: true }).click();
    await expect(panel().getByRole("alert")).toBeVisible(); assert.equal(synthesized.length, beforeRoles);
    mode.analysisStatus = 200; mode.analysisDelay = 4000;
    const analysisCalls = report.requests.roles;
    await panel().getByRole("button", { name: "Read aloud", exact: true }).click();
    await expect.poll(() => report.requests.roles).toBeGreaterThan(analysisCalls);
    await panel().getByRole("button", { name: "Stop", exact: true }).click();
    await page.waitForTimeout(4500); assert.equal(synthesized.length, beforeRoles); assert.equal((await state()).status, "idle");
    checked("Gemini analysis errors allow retry and stopping delayed analysis never starts cloud synthesis");
    mode.analysisDelay = 0; mode.seconds = 8;
    const roleStart = synthesized.length;
    await tap(panel().getByRole("button", { name: "Read aloud", exact: true }));
    for (const [index, role] of ["narrator", "male", "female", "child"].entries()) {
      await expect.poll(async () => { const value = await state(); return value.status === "playing" ? value.role : ""; }, { timeout: 30000 }).toBe(role);
      assert.equal((await state()).multiRole, true); assert.equal(synthesized[roleStart + index], index % 2 ? "mimo" : "azure");
      if (index === 1) {
        await expect.poll(cacheCount).toBe(2);
        const calls = synthesized.length;
        await speech({ action: "pause" }); await speech({ action: "resume" });
        await expect.poll(async () => (await state()).status).toBe("playing"); assert.equal(synthesized.length, calls);
      }
      if (index < 3) await speech({ action: "next" });
    }
    await fs.writeFile(path.join(output, "cloud-roles-playing.png"), await device.screenshot());
    await speech({ action: "stop" }); await released();
    checked("Gemini role labels drive narrator, male, female and child playback across Azure/MiMo with cached resume");
    await panel().getByRole("button", { name: "Close", exact: true }).click(); await open();
    await expect(panel().getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expect(panel().getByLabel("Male voice", { exact: true })).toHaveValue(JSON.stringify([fixtures[1].key, "冰糖"]));
    checked("role voice selections and the per-book switch survive panel closure");
    assert.deepEqual(report.errors, []); report.passed = true;
  } catch (error) {
    report.error = error.message;
    if (page) await fs.writeFile(path.join(output, "cloud-speech-failure.png"), await device.screenshot()).catch(() => {});
    throw error;
  } finally {
    try {
      if (page && preferences) {
        if (monitor) { await monitor.write(Buffer.from("q\n")).catch(() => {}); await monitor.close().catch(() => {}); monitor = undefined; }
        await speech({ action: "stop" });
        if (await panel().count()) await panel().getByRole("button", { name: "Close", exact: true }).click();
        if (await page.locator(".android-reader").count()) { await showReadingTools(page); await page.getByRole("button", { name: "Exit reader", exact: true }).click(); }
        for (const item of fixtures) {
          await storage({ channel: "database-command", dbName: "plugins", statement: "deleteStatement", data: item.key });
          const original = baseline.plugins.find(record => record.key === item.key);
          if (original) await storage({ channel: "database-command", dbName: "plugins", statement: "saveStatement", data: original });
        }
        await page.evaluate(({ original, keys }) => { for (const key of keys) { if (original[key] === undefined) localStorage.removeItem(key); else localStorage.setItem(key, original[key]); } }, { original: preferences, keys: configKeys });
        await expect.poll(async () => { const saved = (await storage({ channel: "preferences", action: "read" })).values; return configKeys.every(key => saved[key] === preferences[key]); }).toBe(true);
        const restored = await rows();
        for (const dbName of Object.keys(baseline)) assert.equal(hash(restored[dbName]), hash(baseline[dbName]), `Restored ${dbName} records differ`);
        await released(); await page.reload();
        checked("all original plugins, preferences, reading positions and primary records are restored");
      }
    } catch (error) { report.passed = false; report.cleanupError = error.message; throw error; }
    finally {
      try { execFileSync(process.env.ADB_PATH || "adb", ["-s", device.serial(), "reverse", "--remove", `tcp:${port}`]); } catch {}
      await fs.writeFile(path.join(output, "cloud-speech-report.json"), JSON.stringify(report, null, 2));
      await Promise.all(devices.map(item => item.close())); await new Promise(resolve => server.close(resolve));
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
