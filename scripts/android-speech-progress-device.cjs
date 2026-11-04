const assert = require("node:assert/strict"), fs = require("node:fs/promises"), path = require("node:path"), http = require("node:http");
const { createHash } = require("node:crypto"), { execFileSync } = require("node:child_process");
const { _android: android } = require("playwright"), { expect } = require("@playwright/test"), JSZip = require("jszip");
const { readingFixtures, showReadingTools, visibleParagraphs } = require("../e2e/android/fixtures.cjs");
const { wave, plugin } = require("../e2e/android/cloud-speech-fixtures.cjs");
const { importNativeFixture, shared } = require("./android-system-picker.cjs");
const primary = "xyz.koodoreader.custom.android", qa = `${primary}.restoreqa`, output = path.resolve(__dirname, "../dist/android-device");
const hash = value => createHash("sha256").update(value).digest("hex");
const chapterText = index => Array.from({ length: 6 }, (_, paragraph) => `${["第一章", "第二章", "第三章"][index]}第${paragraph + 1}段。合成朗读样本，验证角色与进度。`);

async function compactBooks() {
  const source = (await readingFixtures())[0], zip = await JSZip.loadAsync(source.buffer);
  let opf = await zip.file("book.opf").async("string");
  opf = opf.replaceAll("安卓章节样本", "安卓多角色章节样本").replace("</manifest>", '<item id="three" href="three.xhtml" media-type="application/xhtml+xml"/></manifest>').replace("</spine>", '<itemref idref="three"/></spine>');
  zip.file("book.opf", opf);
  for (const [index, file] of ["one", "two", "three"].entries()) zip.file(`${file}.xhtml`, `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>合成章节</title></head><body>${chapterText(index).map(text => `<p>${text}</p>`).join("")}</body></html>`);
  return [
    { name: "安卓多角色章节样本.epub", mimeType: "application/epub+zip", buffer: await zip.generateAsync({ type: "nodebuffer" }) },
    { name: "安卓多角色文本样本.txt", mimeType: "text/plain", buffer: Buffer.from([0, 1, 2].flatMap(index => [["第一章", "第二章", "第三章"][index] + " 合成章节", ...chapterText(index)]).join("\n\n")) },
  ];
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const adb = process.env.ADB_PATH || "adb", aapt = process.env.AAPT_PATH || "aapt";
  let devices = await android.devices({ omitDriverInstall: true }), device = devices.find(item => item.serial() === process.env.ANDROID_SERIAL) || devices[0]; assert.ok(device);
  const serial = device.serial(), owned = [], files = [], report = { passed: false, checks: [], errors: [] };
  const command = args => execFileSync(adb, ["-s", serial, ...args], { encoding: "utf8" });
  const shell = text => command(["shell", text]);
  let page, baseline, port;
  const checked = text => { report.checks.push(text); console.log(`PASS ${text}`); };
  const summary = async target => target.evaluate(async () => {
    const execute = async request => (await window.Capacitor.Plugins.KoodoStorage.execute(request)).value;
    const digest = async text => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(value => value.toString(16).padStart(2, "0")).join("");
    const tables = {};
    for (const dbName of ["books", "notes", "bookmarks", "words", "plugins"]) {
      const rows = await execute({ channel: "database-command", dbName, statement: "getAllStatement" });
      tables[dbName] = { count: rows.length, sha256: await digest(JSON.stringify(rows.sort((a, b) => String(a.key).localeCompare(String(b.key))))) };
    }
    return { tables, preferences: await digest(JSON.stringify((await execute({ channel: "preferences", action: "read" })).values)), credential: await digest(String(await execute({ channel: "credential", slot: "mega", action: "read" }))) };
  });
  const attach = async () => {
    await device.shell(`am start --user 0 -n ${qa}/${primary}.MainActivity`);
    page = await (await device.webView({ pkg: qa })).page(); page.setDefaultTimeout(20000);
    page.on("pageerror", error => report.errors.push(error.message));
    await page.context().route("**/*", route => new URL(route.request().url()).hostname === "localhost" || /^(blob|data):/.test(route.request().url()) ? route.continue() : route.abort());
    await expect(page.locator(".android-header")).toBeVisible();
  };
  const storage = request => page.evaluate(async request => (await window.Capacitor.Plugins.KoodoStorage.execute(request)).value, request);
  const speech = request => page.evaluate(request => window.Capacitor.Plugins.KoodoSpeech.execute(request), request);
  const state = () => speech({ action: "state" });
  const closeReader = async () => {
    if (await page.locator(".android-speech").count()) await page.locator(".android-speech .android-reader-sheet-heading button").click();
    if (await page.locator(".android-reader").count()) { await showReadingTools(page); await page.locator(".android-reader-toolbar > button").first().click(); await expect(page.locator(".android-header")).toBeVisible(); }
  };
  const requests = [];
  let slowThird = false;
  const server = http.createServer(async (request, response) => {
    try {
      const chunks = []; for await (const chunk of request) chunks.push(chunk);
      const raw = Buffer.concat(chunks).toString();
      if (request.url.startsWith("/v1beta/")) {
        const input = JSON.parse(JSON.parse(raw).contents[0].parts[0].text);
        requests.push({ type: "roles", text: input.sentences.map(item => item.text).join("") });
        if (slowThird && input.sentences.some(item => item.text.includes("第三章"))) await new Promise(resolve => setTimeout(resolve, 2000));
        if (response.destroyed) return;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ candidates: [{ finishReason: "STOP", content: { parts: [{ text: JSON.stringify({ roles: Object.fromEntries(input.sentences.map(item => [item.id, "male"])) }) }] } }] })); return;
      }
      const azure = request.url.startsWith("/azure"), text = azure ? raw : JSON.parse(raw).messages[0].content;
      requests.push({ type: azure ? "azure" : "mimo", text });
      const audio = wave(8);
      response.writeHead(200, { "Content-Type": azure ? "audio/mpeg" : "application/json" });
      response.end(azure ? audio : JSON.stringify({ choices: [{ message: { audio: { data: audio.toString("base64") } } }] }));
    } catch { if (!response.destroyed) { response.writeHead(400); response.end(); } }
  });
  try {
    for (const [pkg, name] of [[qa, "speech-follow-qa-debug.apk"], [`${qa}.test`, "speech-follow-qa-test.apk"]]) {
      assert.equal(command(["shell", "pm", "list", "packages", "--user", "0", pkg]).trim(), "", "Preserve an existing QA installation");
      const apk = path.join(output, name), metadata = execFileSync(aapt, ["dump", "badging", apk], { encoding: "utf8" });
      assert.equal(/^package: name='([^']+)'/m.exec(metadata)?.[1], pkg);
    }
    const primaryPage = await (await device.webView({ pkg: primary })).page();
    assert.equal(await primaryPage.locator(".android-reader").count(), 0, "Keep the main app in the library"); baseline = await summary(primaryPage);
    for (const [pkg, name] of [[qa, "speech-follow-qa-debug.apk"], [`${qa}.test`, "speech-follow-qa-test.apk"]]) { command(["install", "--user", "0", path.join(output, name)]); owned.push(pkg); }
    const instrumentation = shell(`am instrument -w ${qa}.test/androidx.test.runner.AndroidJUnitRunner`);
    await fs.writeFile(path.join(output, "follow-qa-instrumentation.log"), instrumentation); assert.match(instrumentation, /OK \(35 tests\)/);
    checked("35 native tests pass in the isolated QA app");
    await attach();
    assert.equal(await storage({ channel: "credential", slot: "mega", action: "read" }), null, "The QA app must never have the real MEGA session");
    await page.evaluate(() => { const config = JSON.parse(localStorage.getItem("readerConfig") || "{}"); config.lang = "en"; localStorage.setItem("readerConfig", JSON.stringify(config)); }); await page.reload();
    await expect(page.locator(".android-header")).toBeVisible();
    const fixtures = [...(await readingFixtures()).slice(0, 2), ...await compactBooks()];
    for (const fixture of fixtures) {
      const before = await storage({ channel: "database-command", dbName: "books", statement: "getAllStatement" });
      const name = await importNativeFixture(page, device, fixture); files.push({ name, sha256: hash(fixture.buffer) });
      await expect(page.locator(".book-list-item")).toHaveCount(before.length + 1, { timeout: 60000 });
      const rows = await storage({ channel: "database-command", dbName: "books", statement: "getAllStatement" });
      const book = rows.find(item => !before.some(row => row.key === item.key)); assert.ok(book);
      await storage({ channel: "database-command", dbName: "books", statement: "saveStatement", data: { ...book, name: fixture.title || fixture.name.replace(/\.[^.]+$/, "") } });
    }
    await page.reload(); await expect(page.locator(".book-list-item")).toHaveCount(4);
    await Promise.all(devices.map(item => item.close())); page = undefined;
    const env = { ...process.env, ANDROID_SERIAL: serial, ANDROID_TEST_PACKAGE: qa };
    for (const [script, args] of [["android-chapter-speech-device.cjs", ["--baseline"]], ["android-chapter-speech-device.cjs", []], ["android-speech-device.cjs", []]]) execFileSync(process.execPath, [path.join(__dirname, script), ...args], { env, stdio: "inherit" });
    checked("isolated system speech and single-voice chapter regressions pass");
    devices = await android.devices({ omitDriverInstall: true }); device = devices.find(item => item.serial() === serial); await attach();
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve)); port = server.address().port; command(["reverse", `tcp:${port}`, `tcp:${port}`]);
    const azure = plugin("azure", `http://localhost:${port}/azure`), mimo = plugin("mimo", `http://localhost:${port}/mimo`);
    const azureConfig = azure.voiceList[0].config, mimoConfig = mimo.voiceList[0].config;
    const roleAI = { native: true, url: `http://localhost:${port}/v1beta/models/qa:generateContent`, headers: { "Content-Type": "application/json", "x-goog-api-key": "synthetic" }, body: { contents: [{ role: "user", parts: [{ text: "" }] }] } };
    const books = await storage({ channel: "database-command", dbName: "books", statement: "getAllStatement" });
    for (const title of ["安卓多角色章节样本", "安卓多角色文本样本"]) {
      const book = books.find(item => item.name === title); assert.ok(book);
      await page.locator(".book-list-item").filter({ hasText: title }).locator(".book-item-cover").click(); await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
      requests.length = 0; slowThird = true;
      const text = chapterText(0);
      await speech({ action: "start", source: "azure", voice: "zh-CN-XiaoxiaoNeural", speed: 1, bookKey: book.key, title, config: azureConfig,
        text, anchors: text, roles: text.map((_, i) => i % 2 ? "male" : "narrator"), roleVoices: { male: { source: "mimo", config: mimoConfig } }, roleAI, saveReadingPosition: true,
        chapterIndex: 0, chapterTitle: "第一章", followingChapters: [1, 2].map(index => ({ index, title: ["第一章", "第二章", "第三章"][index], text: chapterText(index), anchors: chapterText(index) })) });
      await expect.poll(async () => (await state()).status).toBe("playing");
      await expect.poll(async () => (await state()).total, { timeout: 15000 }).toBeGreaterThan(6);
      assert.equal(requests.some(item => item.type === "roles" && item.text.includes("第三章")), false, "Do not analyze more than the next chapter");
      let moves = 0; while ((await state()).chapterDocIndex === 0 && moves++ < 40) await speech({ action: "next" }); assert.ok(moves < 40);
      await expect.poll(() => requests.some(item => item.type === "roles" && item.text.includes("第三章"))).toBe(true);
      await expect.poll(async () => {
        const positions = JSON.parse(await page.evaluate(() => localStorage.getItem("recordLocation")) || "{}");
        return Number(positions[book.key]?.chapterDocIndex);
      }).toBe(1);
      await speech({ action: "stop" }); await page.waitForTimeout(2500); assert.equal((await state()).status, "idle");
      await closeReader(); checked(`${book.format}: multi-role chapter handoff, one-chapter analysis ahead, text following and late-result cancellation`);
    }
    slowThird = false;
    const book = books.find(item => item.name === "安卓多角色文本样本");
    await page.locator(".book-list-item").filter({ hasText: book.name }).locator(".book-item-cover").click(); await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
    const text = chapterText(1)[3];
    await speech({ action: "start", source: "azure", voice: "zh-CN-XiaoxiaoNeural", speed: 1, bookKey: book.key, title: book.name, config: azureConfig, text: [text], anchors: [text], saveReadingPosition: true, chapterIndex: 1, chapterTitle: "第二章", followingChapters: [] });
    await expect.poll(async () => (await state()).status).toBe("playing");
    command(["shell", "am", "force-stop", "--user", "0", qa]); await attach();
    assert.equal((await state()).status, "idle"); const before = requests.length;
    await page.locator(".book-list-item").filter({ hasText: book.name }).locator(".book-item-cover").click(); await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
    await expect.poll(() => visibleParagraphs(page)).toEqual(expect.arrayContaining([expect.stringContaining("第二章第4段。")]));
    assert.equal((await state()).status, "idle"); await page.waitForTimeout(500); assert.equal(requests.length, before); await closeReader();
    checked("force-stopping the QA process restores the reading anchor without restarting audio or requests");
    assert.deepEqual(report.errors, []); report.passed = true;
  } catch (error) { report.error = error.message; throw error; }
  finally {
    try {
      if (port) command(["reverse", "--remove", `tcp:${port}`]);
      for (const pkg of owned.reverse()) command(["shell", "pm", "uninstall", "--user", "0", pkg]);
      for (const file of files) {
        assert.match(file.name, /^Koodo-Mapped-Fixture-\d+\.(epub|txt)$/);
        const bytes = Buffer.from(command(["shell", "base64", `${shared}/${file.name}`]), "base64");
        assert.equal(hash(bytes), file.sha256, "Preserve a temporary document if its contents changed");
        command(["shell", "rm", "-f", `${shared}/${file.name}`]);
      }
      if (baseline) {
        command(["shell", "am", "start", "--user", "0", "-n", `${primary}/.MainActivity`]);
        await Promise.all(devices.map(item => item.close()));
        devices = await android.devices({ omitDriverInstall: true });
        const current = devices.find(item => item.serial() === serial); assert.ok(current, "Reconnect the phone for the final primary-data audit");
        const mainPage = await (await current.webView({ pkg: primary })).page(); assert.deepEqual(await summary(mainPage), baseline);
        assert.equal(await mainPage.locator(".android-reader").count(), 0); await mainPage.evaluate(() => window.Capacitor.Plugins.KoodoStorage.setKeepScreenOn({ enabled: false }));
        checked("owned QA apps removed; primary records, preferences and MEGA credential are unchanged");
      }
    } catch (error) { report.passed = false; report.cleanupError = error.message; throw error; }
    finally { await fs.writeFile(path.join(output, "speech-progress-device-report.json"), JSON.stringify(report, null, 2)); await Promise.all(devices.map(item => item.close())); if (server.listening) await new Promise(resolve => server.close(resolve)); }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
