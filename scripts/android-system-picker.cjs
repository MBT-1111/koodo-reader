const assert = require("node:assert/strict");
const { expect } = require("@playwright/test");
const shared = "/sdcard/Download/KoodoReaderCustomTest";

function systemPicker(page, device) {
  const dump = "/data/local/tmp/koodo-system-picker.xml";
  const nodes = async () => {
    await device.shell(`uiautomator dump --compressed ${dump}`);
    return [...(await device.shell(`cat ${dump}`)).toString().matchAll(/<node\b[^>]+>/g)].map(([node]) => Object.fromEntries([...node.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, k, v]) => [k, v])));
  };
  const tapNode = async (matches) => {
    let node;
    await expect.poll(async () => { node = (await nodes()).find(matches); return !!node; }, { timeout: 90000 }).toBe(true);
    const [l, t, r, b] = node.bounds.match(/\d+/g).map(Number);
    await device.shell(`input tap ${Math.round((l + r) / 2)} ${Math.round((t + b) / 2)}`);
  };
  const tap = async (locator) => {
    await locator.scrollIntoViewIfNeeded();
    const view = (await nodes()).find((node) => node.class === "android.webkit.WebView"); assert.ok(view);
    await expect.poll(() => locator.evaluate((element) => {
      const rect = element.getBoundingClientRect(), hit = element.ownerDocument.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
      return hit === element || element.contains(hit);
    })).toBe(true);
    const [left, top, right] = view.bounds.match(/\d+/g).map(Number), rect = await locator.boundingBox();
    const scale = (right - left) / await page.evaluate(() => innerWidth);
    await device.shell(`input tap ${Math.round(left + (rect.x + rect.width / 2) * scale)} ${Math.round(top + (rect.y + rect.height / 2) * scale)}`);
  };
  const folder = async () => {
    await tapNode((node) => /^(Show roots|显示根目录|显示根位置)$/.test(node["content-desc"] || ""));
    await tapNode((node) => node["resource-id"] === "android:id/title" && /^(Downloads|下载|下载内容)$/.test(node.text || ""));
    await tapNode((node) => node.text === "KoodoReaderCustomTest");
  };
  const select = async (name) => {
    const matches = (node) => node.text === name || (node["content-desc"] || "").startsWith(`${name},`);
    // DocumentsUI can remember a middle/bottom scroll position when reopening a folder.
    for (const [from, to, attempts] of [[1800, 750, 12], [750, 1800, 24]]) {
      for (let attempt = 0; attempt < attempts; attempt++) {
        if ((await nodes()).some(matches)) { await tapNode(matches); return; }
        await device.shell(`input swipe 540 ${from} 540 ${to} 300`);
      }
    }
    throw new Error("Test document is not visible in the system picker");
  };
  return { nodes, tapNode, tap, folder, select };
}

async function importNativeFixture(page, device, fixture) {
  const extension = fixture.name.split(".").pop().toLowerCase();
  assert.match(extension, /^[a-z0-9]+$/);
  const name = `Koodo-Mapped-Fixture-${Date.now()}.${extension}`;
  await device.shell(`mkdir -p ${shared}`);
  await device.push(fixture.buffer, `${shared}/${name}`);
  await device.shell(`am broadcast -a android.intent.action.MEDIA_SCANNER_SCAN_FILE -d file://${shared}/${name}`);
  const picker = systemPicker(page, device);
  try {
    await picker.tap(page.locator(".import-from-local > button.import-book-box"));
    await picker.folder(); await picker.select(name);
    return name;
  } catch (error) {
    const bytes = Buffer.from((await device.shell(`base64 ${shared}/${name}`)).toString(), "base64");
    assert.ok(bytes.equals(Buffer.from(fixture.buffer)), "Preserve a temporary document whose contents changed");
    await device.shell(`rm -f ${shared}/${name}`);
    throw error;
  }
}
module.exports = { systemPicker, importNativeFixture, shared };
