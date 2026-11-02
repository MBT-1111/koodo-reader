const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const { _android: android } = require("playwright");
const { expect } = require("@playwright/test");

const appId = "xyz.koodoreader.custom.android";
const output = path.join(__dirname, "..", "dist", "android-device");
const shelfName = `Android UI QA ${Date.now()}`;
const fixtureTitle = "Android native storage fixture";
const report = { checks: [], passed: false };

async function main() {
  await fs.mkdir(output, { recursive: true });
  const devices = await android.devices({ omitDriverInstall: true });
  let device, page;
  const errors = [];
  const checked = (name) => { report.checks.push(name); console.log(`PASS ${name}`); };
  try {
    const selected = devices.filter((candidate) => !process.env.ANDROID_SERIAL || candidate.serial() === process.env.ANDROID_SERIAL);
    assert.equal(selected.length, 1, "Connect one device or select it with ANDROID_SERIAL");
    device = selected[0];
    device.setDefaultTimeout(20000);
    const start = async () => {
      await device.shell(`am start -n ${appId}/.MainActivity`);
      page = await (await device.webView({ pkg: appId })).page();
      page.setDefaultTimeout(15000);
      page.on("pageerror", (error) => errors.push(error.message));
      await page.context().route("**/*", (route) => {
        const url = new URL(route.request().url());
        return url.hostname === "localhost" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
      });
      await expect(page.locator(".android-bottom-nav")).toBeVisible();
    };
    const nativePreferences = () => page.evaluate(async () => (await window.Capacitor.Plugins.KoodoStorage.execute({ channel: "preferences", action: "read" })).value);
    const back = () => device.shell("input keyevent KEYCODE_BACK");
    const tap = async (locator) => {
      await locator.scrollIntoViewIfNeeded();
      await device.shell("uiautomator dump /data/local/tmp/koodo-library-ui.xml");
      const xml = (await device.shell("cat /data/local/tmp/koodo-library-ui.xml")).toString();
      const node = [...xml.matchAll(/<node\b[^>]+>/g)].map(([node]) => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, key, value]) => [key, value]))).find((node) => node.class === "android.webkit.WebView");
      assert.ok(node, "Native WebView bounds must be available");
      const [left, top, right] = node.bounds.match(/\d+/g).map(Number);
      const rect = await locator.boundingBox();
      assert.ok(rect);
      const scale = (right - left) / await page.evaluate(() => innerWidth);
      await device.shell(`input tap ${Math.round(left + (rect.x + rect.width / 2) * scale)} ${Math.round(top + (rect.y + rect.height / 2) * scale)}`);
    };
    const nav = (name) => page.locator(".android-bottom-nav").getByRole("button", { name, exact: true });
    await device.shell(`am force-stop ${appId}`);
    await start();
    await expect(page.locator(".android-bottom-nav button")).toHaveCount(4);
    await expect(page.locator(".book-list-item").filter({ hasText: fixtureTitle })).toBeVisible();
    const count = await page.locator(".book-list-item").count();
    assert.ok(count > 0, "Run test:android:device first to seed its synthetic EPUB");
    checked("four phone tabs and existing native library load");

    await tap(page.locator(".android-header").getByRole("button", { name: "Search", exact: true }));
    const search = page.getByPlaceholder("Search my library");
    await search.fill(fixtureTitle);
    await search.press("Enter");
    await expect(page.locator(".book-list-item")).toHaveCount(1);
    await expect(page.locator(".book-item-title")).toHaveText(fixtureTitle);
    // Android first dismisses its keyboard; the next Back closes library search.
    if ((await device.shell("dumpsys input_method")).toString().includes("mInputShown=true")) await back();
    await back();
    await expect(search).toBeHidden();
    await expect(page.locator(".book-list-item")).toHaveCount(count);
    checked("physical search entry and native Back restore the library");

    await tap(nav("Shelf"));
    await tap(page.getByRole("button", { name: "New shelf", exact: true }));
    await page.getByLabel("New shelf", { exact: true }).fill(shelfName);
    await tap(page.getByRole("button", { name: "Confirm", exact: true }));
    await expect(page.locator(".android-shelf-list")).toContainText(shelfName);
    await expect.poll(async () => JSON.parse((await nativePreferences()).values.shelfList || "{}")[shelfName]).toEqual([]);
    await device.shell(`am force-stop ${appId}`);
    await start();
    await tap(nav("Shelf"));
    const shelf = page.locator(".android-shelf-list button").filter({ hasText: shelfName });
    await expect(shelf).toBeVisible();
    checked("phone shelf creation persists across process restart");

    await tap(shelf);
    await expect(page.locator(".android-shelf-breadcrumb")).toContainText(shelfName);
    await back();
    await expect(page.locator(".android-shelves")).toBeVisible();
    await tap(page.getByRole("button", { name: "Manage shelf", exact: true }));
    await expect(page.locator(".backup-page-container")).toBeInViewport();
    await back();
    await expect(page.locator(".backup-page-container")).toBeHidden();
    await expect(page).toHaveURL(/#\/manager\/shelf/);
    checked("native Back closes shelf management and returns from a shelf");

    await tap(page.getByRole("button", { name: "Manage shelf", exact: true }));
    await tap(page.locator(".cloud-drive-item").filter({ hasText: shelfName }).locator(".icon-trash-line"));
    await tap(page.locator(".delete-dialog-container .add-dialog-confirm"));
    await expect(page.locator(".sort-shelf-label").filter({ hasText: shelfName })).toHaveCount(0);
    await back();
    await back();
    await expect(page).toHaveURL(/#\/manager\/home/);
    await expect(page.locator(".book-list-item")).toHaveCount(count);
    checked("deleting the test shelf preserves the book library");

    await tap(nav("Notes"));
    await tap(page.locator(".android-note-tabs").getByRole("button", { name: "Highlights", exact: true }));
    await expect(page).toHaveURL(/#\/manager\/highlight/);
    await expect(nav("Notes")).toHaveAttribute("aria-current", "page");
    await back();
    await tap(nav("Settings"));
    await expect(page.locator(".setting-dialog-container")).toBeVisible();
    await back();
    await expect(page.locator(".setting-dialog-container")).toBeHidden();
    checked("physical Notes and Settings navigation supports native Back");

    const resume = page.getByRole("button", { name: `Continue reading ${fixtureTitle}`, exact: true });
    await expect(resume).toBeVisible();
    const percentage = Number(await resume.locator("progress").getAttribute("value"));
    await tap(resume);
    await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("recordLocation") || "{}")[location.hash.split("?")[0].split("/").pop()].percentage);
    assert.equal(Number(restored), percentage);
    await back();
    await expect(page).toHaveURL(/#\/manager\/home/);
    checked("physical Continue reading opens its saved position");
    await fs.writeFile(path.join(output, "ui-home.png"), await device.screenshot());
    assert.deepEqual(errors, []);
    report.passed = true;
  } catch (error) {
    report.error = error.message;
    if (device) await fs.writeFile(path.join(output, "ui-failure.png"), await device.screenshot()).catch(() => {});
    throw error;
  } finally {
    // Remove only this run's synthetic shelf, including after a failed check.
    if (page && !page.isClosed()) {
      await page.evaluate((name) => {
        const shelves = JSON.parse(localStorage.getItem("shelfList") || "{}");
        if (!Object.hasOwn(shelves, name)) return;
        delete shelves[name];
        localStorage.setItem("shelfList", JSON.stringify(shelves));
        const sorted = JSON.parse(localStorage.getItem("sortedShelfList") || "[]");
        localStorage.setItem("sortedShelfList", JSON.stringify(sorted.filter((title) => title !== name)));
        document.dispatchEvent(new Event("visibilitychange"));
      }, shelfName).catch(() => {});
    }
    await fs.writeFile(path.join(output, "ui-report.json"), JSON.stringify(report, null, 2));
    await Promise.all(devices.map((device) => device.close()));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
