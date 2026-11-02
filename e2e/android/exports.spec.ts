import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { seedPhoneNotes } from "./notes-fixtures.cjs";
import { readingFixtures } from "./fixtures.cjs";
import { fontBook } from "./font-fixtures.cjs";

const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function openData(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Data", exact: true }).click();
  await expect(page.locator(".android-data")).toBeVisible();
}

async function download(page: Page, action: () => Promise<unknown>) {
  const waiting = page.waitForEvent("download");
  await action();
  const result = await waiting;
  const bytes = await readFile((await result.path())!);
  await expect(page.locator(".android-data")).toHaveAttribute("aria-busy", "false");
  return { name: result.suggestedFilename(), bytes };
}

test.beforeEach(async ({ page, context }) => {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.hostname === "127.0.0.1" || ["blob:", "data:"].includes(url.protocol) ? route.continue() : route.abort();
  });
  await page.goto("/");
});

test("exports all original files without losing books with identical names", async ({ page }) => {
  const fixtures = [(await readingFixtures())[0], { ...await fontBook(), title: "Android custom font sample", format: "epub" }];
  await page.locator("#import-book-box").setInputFiles(fixtures);
  await expect(page.locator(".book-list-item")).toHaveCount(2);
  await openData(page);
  const result = await download(page, () => page.locator(".android-data-row").filter({ hasText: "Export all books" }).getByRole("button").click());
  const zip = await JSZip.loadAsync(result.bytes);
  expect(result.name).toMatch(/\.zip$/);
  for (const fixture of fixtures) {
    const entry = zip.file(`${fixture.title}.${fixture.format}`)!;
    expect(sha(await entry.async("uint8array"))).toBe(sha(fixture.buffer));
  }
  // Both EPUBs now have the same exported name, but must retain their distinct bytes.
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("localforage"); r.onsuccess = () => resolve(r.result); });
    try {
      const books = await new Promise<Array<{ name: string; format: string }>>((resolve) => { const r = db.transaction("keyvaluepairs").objectStore("keyvaluepairs").get("books"); r.onsuccess = () => resolve(r.result); });
      books.forEach((book) => { book.name = "同名书"; });
      await new Promise<void>((resolve) => { const tx = db.transaction("keyvaluepairs", "readwrite"); tx.objectStore("keyvaluepairs").put(books, "books"); tx.oncomplete = () => resolve(); });
    } finally { db.close(); }
  });
  const renamed = await download(page, () => page.locator(".android-data-row").filter({ hasText: "Export all books" }).getByRole("button").click());
  const renamedZip = await JSZip.loadAsync(renamed.bytes);
  const entries = Object.values(renamedZip.files).filter((entry) => !entry.dir);
  expect(entries).toHaveLength(2);
  expect(new Set(await Promise.all(entries.map(async (entry) => sha(await entry.async("uint8array")))))).toEqual(new Set(fixtures.map((fixture) => sha(fixture.buffer))));
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open("localforage"); r.onsuccess = () => resolve(r.result); });
    try {
      const books = await new Promise<Array<{ key: string }>>((resolve) => { const r = db.transaction("keyvaluepairs").objectStore("keyvaluepairs").get("books"); r.onsuccess = () => resolve(r.result); });
      await new Promise<void>((resolve) => { const tx = db.transaction("keyvaluepairs", "readwrite"); tx.objectStore("keyvaluepairs").delete(books[0].key); tx.oncomplete = () => resolve(); });
    } finally { db.close(); }
  });
  const unexpected: string[] = [];
  page.on("download", (file) => unexpected.push(file.suggestedFilename()));
  await page.locator(".android-data-row").filter({ hasText: "Export all books" }).getByRole("button").click();
  await expect(page.getByText("Failed to export", { exact: true })).toBeVisible();
  expect(unexpected).toEqual([]);
});

test("exports complete notes and highlights in offline JSON, CSV, Markdown and PDF", async ({ page }) => {
  await seedPhoneNotes(page);
  await openData(page);
  const json = await download(page, () => page.getByLabel("Export all notes", { exact: true }).selectOption("json"));
  const archive = await JSZip.loadAsync(json.bytes);
  const records = JSON.parse(await archive.file("all.json")!.async("string"));
  expect(records).toHaveLength(3);
  expect(records.map((note: { notes: string }) => note.notes)).toEqual(["QA phone note 1", "QA phone note 2", "QA phone note 3"]);
  expect(records.every((note: { bookMd5: string; text: string; bookName: string }) => note.bookMd5 && note.text && note.bookName)).toBe(true);
  const csv = await download(page, () => page.getByLabel("Export all notes", { exact: true }).selectOption("csv"));
  const csvZip = await JSZip.loadAsync(csv.bytes);
  expect(await csvZip.file("all.csv")!.async("string")).toContain("QA phone note 2");
  const markdown = await download(page, () => page.getByLabel("Export all highlights", { exact: true }).selectOption("md"));
  expect(markdown.name).toMatch(/\.md$/);
  expect(markdown.bytes.toString("utf8")).toContain("安卓");
  const pdf = await download(page, () => page.getByLabel("Export all highlights", { exact: true }).selectOption("pdf"));
  expect(pdf.name).toMatch(/\.pdf$/);
  expect(pdf.bytes.subarray(0, 5).toString()).toBe("%PDF-");
});

test("keeps empty exports and narrow dark data controls usable", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 320, height: 568 });
  await openData(page);
  await page.locator(".android-data-row").filter({ hasText: "Export all books" }).getByRole("button").click();
  await expect(page.getByText("Nothing to export", { exact: true })).toBeVisible();
  for (const control of await page.locator(".android-data button, .android-data select").all()) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(320);
  }
});
