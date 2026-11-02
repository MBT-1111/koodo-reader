const { expect } = require("@playwright/test");
const { readingFixtures, showReadingTools } = require("./fixtures.cjs");

async function seedPhoneNotes(page, count = 3) {
  const fixtures = await readingFixtures();
  await page.locator("#import-book-box").setInputFiles(fixtures.slice(0, 2));
  await expect(page.locator(".book-list-item")).toHaveCount(2);
  await page.locator(".book-list-item").filter({ hasText: fixtures[0].title }).locator(".book-item-cover").click();
  await expect(page.locator("#page-area")).toHaveAttribute("aria-busy", "false");
  await page.frameLocator("#page-area > iframe").locator("p").first().evaluate((paragraph) => {
    const doc = paragraph.ownerDocument;
    const range = doc.createRange();
    range.selectNodeContents(paragraph);
    const selection = doc.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    paragraph.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerType: "touch" }));
  });
  await page.locator(".popup-menu-box .note-option").click();
  await page.locator(".editor-box").fill("QA phone note 1");
  await page.locator(".note-button-container").getByText("Confirm", { exact: true }).click();
  await expect(page.locator(".editor-box")).toBeHidden();
  await showReadingTools(page);
  await page.getByRole("button", { name: "Exit reader", exact: true }).click();
  const result = await page.evaluate(async (count) => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("localforage");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const read = (key) => new Promise((resolve, reject) => {
      const request = db.transaction("keyvaluepairs").objectStore("keyvaluepairs").get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const template = (await read("notes"))[0];
      const books = await read("books");
      const other = books.find((book) => book.key !== template.bookKey);
      const stamp = Number(template.key);
      const notes = Array.from({ length: count }, (_, index) => ({ ...template, key: String(stamp + index), bookKey: index === 1 ? other.key : template.bookKey, notes: `QA phone note ${index + 1}`, tag: [index % 2 ? "Beta" : "Alpha"] }));
      notes.push({ ...template, key: String(stamp + count), notes: "", tag: ["Alpha"] });
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("keyvaluepairs", "readwrite");
        transaction.objectStore("keyvaluepairs").put(notes, "notes");
        transaction.oncomplete = resolve;
        transaction.onerror = () => reject(transaction.error);
      });
      localStorage.setItem("noteTags", JSON.stringify(["Alpha", "Beta"]));
      return { book: template.bookKey, otherBook: other.key };
    } finally { db.close(); }
  }, count);
  await page.reload();
  await page.locator(".android-bottom-nav").getByRole("button", { name: "Notes", exact: true }).click();
  return result;
}

module.exports = { seedPhoneNotes };
