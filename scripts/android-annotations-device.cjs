const { showReadingTools, hideReadingTools } = require("../e2e/android/fixtures.cjs");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");
const { readingFixtures } = require("../e2e/android/fixtures.cjs");

const appId = "xyz.koodoreader.custom.android";
const output = path.join(__dirname, "..", "dist", "android-device");
const dump = "/data/local/tmp/koodo-annotations.xml";
const styleKeys = ["fontSize", "backgroundColor", "textColor"];

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  const report = { checks: [], passed: false };
  let device, page, originalStyle;
  try {
    const selected = devices.filter((candidate) => !process.env.ANDROID_SERIAL || candidate.serial() === process.env.ANDROID_SERIAL);
    assert.equal(selected.length, 1, "Connect one device or select it with ANDROID_SERIAL");
    device = selected[0];
    device.setDefaultTimeout(20000);
    const errors = [];
    const checked = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
    const start = async () => {
      await device.shell(`am start -n ${appId}/.MainActivity`);
      page = await (await device.webView({ pkg: appId })).page();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.context().route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.hostname === "localhost" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
      });
      await expect(page.locator(".android-header, .android-reader").first()).toBeVisible();
      if (await page.locator(".android-reader").isVisible()) {
        await showReadingTools(page);
        await page.locator(".android-reader-toolbar button").first().click();
      }
      await expect(page.locator(".android-header")).toBeVisible();
    };
    const native = (request) => page.evaluate(async (data) => (await window.Capacitor.Plugins.KoodoStorage.execute(data)).value, request);
    const savedStyle = () => page.evaluate((keys) => {
      const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
      return Object.fromEntries(keys.map((key) => [key, config[key]]));
    }, styleKeys);
    const nodes = async () => {
      await device.shell(`uiautomator dump ${dump}`);
      const xml = (await device.shell(`cat ${dump}`)).toString();
      return [...xml.matchAll(/<node\b[^>]+>/g)].map(([node]) => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value])));
    };
    const screenPoint = async (point) => {
      const webview = (await nodes()).find((node) => node.class === "android.webkit.WebView");
      assert.ok(webview, "Visible native WebView");
      const [left, top, right] = webview.bounds.match(/\d+/g).map(Number);
      const scale = (right - left) / await page.evaluate(() => innerWidth);
      return { x: Math.round(left + point.x * scale), y: Math.round(top + point.y * scale) };
    };
    const tap = async (locator) => {
      await expect(locator).toBeVisible();
      const bounds = await locator.boundingBox();
      const point = await screenPoint({ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
      await device.shell(`input tap ${point.x} ${point.y}`);
    };
    const selectText = async (index) => {
      await hideReadingTools(page);
      const frame = page.frameLocator("#page-area > iframe");
      const point = await frame.locator("body").evaluate((body, index) => {
        const doc = body.ownerDocument, view = doc.defaultView;
        const paragraphs = [...body.querySelectorAll("p")].filter((p) => [...p.getClientRects()].some((r) => r.left >= 0 && r.left < view.innerWidth && r.top >= 0 && r.top < view.innerHeight - 40));
        const p = paragraphs[index];
        if (!p) throw new Error("Missing visible fixture paragraph");
        const walker = doc.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let text;
        while ((text = walker.nextNode())) {
          if (text.textContent.length > 12) break;
        }
        if (!text) throw new Error("Missing fixture text");
        const range = doc.createRange();
        range.setStart(text, 8);
        range.setEnd(text, 9);
        const rect = range.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, index);
      const frameBox = await page.locator("#page-area > iframe").boundingBox();
      const physical = await screenPoint({ x: frameBox.x + point.x, y: frameBox.y + point.y });
      await device.shell(`input touchscreen swipe ${physical.x} ${physical.y} ${physical.x} ${physical.y} 800`);
      await expect.poll(() => frame.locator("body").evaluate((body) => body.ownerDocument.getSelection()?.toString() || "")).not.toBe("");
      await expect(page.locator(".popup-menu-box .highlight-option")).toBeVisible();
      return frame.locator("body").evaluate((body) => body.ownerDocument.getSelection().toString());
    };
    const open = async () => {
      await page.locator(".book-list-item").filter({ hasText: "安卓章节样本" }).first().locator(".book-item-cover").click();
      await expect(page.frameLocator("#page-area > iframe").locator("body")).toContainText("安卓手机离线阅读样本");
      await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
      await showReadingTools(page);
    };
    const close = async () => {
      await showReadingTools(page);
      await page.locator(".android-reader-toolbar button").first().click();
      await expect(page).toHaveURL(/#\/manager\/home/);
    };
    await start();
    originalStyle = await savedStyle();
    if (!await page.locator(".book-list-item").filter({ hasText: "安卓章节样本" }).count()) {
      await page.locator("#import-book-box").setInputFiles((await readingFixtures())[0]);
    }
    await open();
    await page.getByRole("button", { name: "Chapters", exact: true }).click();
    await page.locator(".content-chapter-title").filter({ hasText: "第一章" }).click();
    await expect(page.locator(".android-reader-backdrop")).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
      const key = location.hash.split("?")[0].split("/").pop();
      return JSON.parse(localStorage.getItem("recordLocation") || "{}")[key]?.percentage;
    })).toBe("0");
    const paragraph = () => page.frameLocator("#page-area > iframe").locator("p").first();
    const initialRenderedSize = await paragraph().evaluate((p) => getComputedStyle(p).fontSize);
    const bookKey = page.url().split("?")[0].split("/").pop();
    const records = () => native({ channel: "database-command", statement: "getByBookKeyStatement", dbName: "notes", data: bookKey });
    const baseline = new Set((await records()).map((note) => note.key));
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator(".setting-panel-container").getByText("Font", { exact: true }).click();
    const slider = page.locator(".font-size-setting").filter({ hasText: "Font size" }).locator('input[type="range"]');
    const bounds = await slider.boundingBox();
    const current = Number(await slider.inputValue());
    const min = Number(await slider.getAttribute("min")), max = Number(await slider.getAttribute("max"));
    const x = (value) => bounds.x + 8 + (value - min) / (max - min) * (bounds.width - 16);
    const from = await screenPoint({ x: x(current), y: bounds.y + bounds.height / 2 });
    const to = await screenPoint({ x: x(current < 23 ? 25 : 20), y: bounds.y + bounds.height / 2 });
    await device.shell(`input touchscreen swipe ${from.x} ${from.y} ${to.x} ${to.y} 500`);
    const chosenSize = await slider.inputValue();
    assert.notEqual(chosenSize, String(current));
    // Android's existing text scaling may differ from the declared CSS pixel size.
    await expect.poll(() => paragraph().evaluate((p) => getComputedStyle(p).fontSize)).not.toBe(initialRenderedSize);
    const renderedSize = await paragraph().evaluate((p) => getComputedStyle(p).fontSize);
    checked("physical font slider refreshes the rendered text immediately");
    await page.locator(".setting-panel-container").getByText("Theme", { exact: true }).click();
    const presets = page.locator(".preset-theme-item");
    const backgrounds = await presets.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundColor));
    const dark = backgrounds.findIndex((color) => color.match(/\d+/g).slice(0, 3).every((channel) => Number(channel) < 100));
    assert.ok(dark >= 0);
    await tap(presets.nth(dark));
    await page.locator(".setting-panel-container .android-reader-sheet-heading button").click();
    const chosenStyle = await savedStyle();
    const textColor = await page.evaluate((color) => { const span = document.createElement("span"); span.style.color = color; return span.style.color; }, chosenStyle.textColor);
    await expect(page.frameLocator("#page-area > iframe").locator("p").first()).toHaveCSS("color", textColor);
    await expect(page.locator(".background").first()).toHaveCSS("background-color", backgrounds[dark]);
    await close();
    const persisted = JSON.parse((await native({ channel: "preferences", action: "read" })).values.readerConfig);
    for (const key of styleKeys) assert.equal(persisted[key], chosenStyle[key]);
    checked("dark theme foreground and background reach native preferences");
    await open();
    const highlighted = await selectText(0);
    await tap(page.locator(".popup-menu-box .highlight-option"));
    await expect.poll(async () => (await records()).filter((note) => !baseline.has(note.key)).length).toBe(1);
    const highlight = (await records()).find((note) => !baseline.has(note.key));
    assert.equal(highlight.text, highlighted);
    await expect(page.frameLocator("#page-area > iframe").locator(`[data-key="${highlight.key}"]`).first()).toBeAttached();
    checked("native long press and highlight tap save the selected quote to SQLite");
    const quoted = await selectText(1);
    const fullHeight = await page.evaluate(() => innerHeight);
    await tap(page.locator(".popup-menu-box .note-option"));
    const editor = page.locator(".editor-box");
    await expect(editor).toBeFocused();
    await tap(editor);
    await expect.poll(() => page.evaluate(() => innerHeight)).toBeLessThan(fullHeight);
    await expect(page.locator(".note-original-text")).toHaveText(quoted);
    const noteText = "安卓键盘与离线笔记测试";
    await editor.fill(noteText);
    const confirm = page.locator(".note-button-container .book-manage-title").filter({ hasText: "Confirm" });
    await expect(confirm).toBeInViewport();
    // Wait for the native keyboard animation and verify accessibility bounds, too.
    let confirmBounds;
    await expect.poll(async () => {
      const tree = await nodes();
      const node = tree.find((node) => node.package === appId && node.text === "Confirm");
      confirmBounds = node?.bounds.match(/\d+/g).map(Number);
      return !!confirmBounds && confirmBounds[2] > confirmBounds[0] && confirmBounds[3] > confirmBounds[1];
    }, { timeout: 15000 }).toBe(true);
    const geometry = await page.evaluate(() => {
      const box = document.querySelector(".popup-box-container").getBoundingClientRect();
      const save = [...document.querySelectorAll(".note-button-container .book-manage-title")].find((element) => element.textContent.includes("Confirm")).getBoundingClientRect();
      return { height: innerHeight, visualHeight: visualViewport.height, boxBottom: box.bottom, saveBottom: save.bottom };
    });
    await expect(editor).toBeFocused();
    assert.ok(geometry.height < fullHeight, "System keyboard must remain open until Save");
    assert.ok(geometry.boxBottom <= Math.min(geometry.height, geometry.visualHeight) + 1, JSON.stringify(geometry));
    assert.ok(geometry.saveBottom <= Math.min(geometry.height, geometry.visualHeight) + 1, JSON.stringify(geometry));
    report.keyboardGeometry = geometry;
    await fs.writeFile(path.join(output, "annotations-keyboard.png"), await device.screenshot());
    await device.shell(`input tap ${Math.round((confirmBounds[0] + confirmBounds[2]) / 2)} ${Math.round((confirmBounds[1] + confirmBounds[3]) / 2)}`);
    await expect.poll(async () => (await records()).filter((note) => !baseline.has(note.key)).length).toBe(2);
    const note = (await records()).find((record) => !baseline.has(record.key) && record.notes === noteText);
    assert.equal(note?.text, quoted);
    assert.ok(JSON.parse(note.range));
    await expect(editor).toBeHidden();
    checked("visible system keyboard keeps the quote, editor and save button usable");
    await close();
    await device.shell(`am force-stop ${appId}`);
    await expect.poll(() => device.webViews().filter((view) => view.pkg() === appId).length).toBe(0);
    await start();
    await open();
    for (const record of [highlight, note]) {
      assert.deepEqual((await records()).find((item) => item.key === record.key), record);
      await expect(page.frameLocator("#page-area > iframe").locator(`[data-key="${record.key}"]`).first()).toBeAttached();
    }
    await expect(paragraph()).toHaveCSS("font-size", renderedSize);
    await expect(page.frameLocator("#page-area > iframe").locator("p").first()).toHaveCSS("color", textColor);
    checked("process restart restores the theme, font size and both painted annotations");
    await fs.writeFile(path.join(output, "annotations-restored.png"), await device.screenshot());
    await close();
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    if (device) await fs.writeFile(path.join(output, "annotations-failure.png"), await device.screenshot()).catch(() => {});
    throw error;
  } finally {
    if (page && !page.isClosed() && originalStyle) {
      await page.evaluate((original) => {
        const config = JSON.parse(localStorage.getItem("readerConfig") || "{}");
        for (const key of ["fontSize", "backgroundColor", "textColor"]) {
          if (original[key] === undefined) delete config[key]; else config[key] = original[key];
        }
        localStorage.setItem("readerConfig", JSON.stringify(config));
      }, originalStyle);
      await page.reload();
    }
    if (device) await device.shell(`rm -f ${dump}`).catch(() => {});
    await fs.writeFile(path.join(output, "annotations-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map((candidate) => candidate.close()));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
