import { beforeEach, describe, expect, it, vi } from "vitest";
import { Buffer } from "buffer";

const mocks = vi.hoisted(() => ({ saveAs: vi.fn(), saveNativeDocument: vi.fn(), platform: { native: true } }));
vi.mock("file-saver", () => ({ saveAs: mocks.saveAs }));
vi.mock("../platform", () => ({ get isNativeAndroid() { return mocks.platform.native; } }));
vi.mock("../../custom/android/storage", () => ({ saveNativeDocument: mocks.saveNativeDocument }));
import { saveExportFile } from "./saveExportFile";

beforeEach(() => { vi.resetAllMocks(); mocks.platform.native = true; });

describe("platform export saving", () => {
  it("sends exact UTF-8 bytes and verifies the native completion", async () => {
    const text = "中文笔记\n离线导出";
    mocks.saveNativeDocument.mockImplementation(async (request) => ({ status: "success", size: request.size, sha256: request.sha256 }));
    expect(await saveExportFile(new Blob([text], { type: "text/csv,charset=UTF-8" }), "笔记/导出.csv")).toBe("success");
    const request = mocks.saveNativeDocument.mock.calls[0][0];
    expect(Buffer.from(request.data, "base64").toString("utf8")).toBe(text);
    expect(request).toMatchObject({ name: "笔记_导出.csv", mime: "text/csv", size: Buffer.byteLength(text) });
    expect(request.sha256).toHaveLength(64);
    expect(mocks.saveAs).not.toHaveBeenCalled();
  });

  it("waits for system completion and preserves cancellation", async () => {
    let finish!: (result: { status: "cancel" }) => void;
    mocks.saveNativeDocument.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const saving = saveExportFile(new Blob(["book"]), "book.epub");
    await vi.waitFor(() => expect(mocks.saveNativeDocument).toHaveBeenCalledOnce());
    finish({ status: "cancel" });
    expect(await saving).toBe("cancel");
  });

  it("reports native failures and mismatched saved bytes", async () => {
    mocks.saveNativeDocument.mockRejectedValueOnce(new Error("provider failed"));
    expect(await saveExportFile(new Blob(["book"]), "book.epub")).toBe("failed");
    mocks.saveNativeDocument.mockResolvedValueOnce({ status: "success", size: 4, sha256: "wrong" });
    expect(await saveExportFile(new Blob(["book"]), "book.epub")).toBe("failed");
  });

  it("keeps the existing desktop and browser download path", async () => {
    mocks.platform.native = false;
    const blob = new Blob(["book"]);
    expect(await saveExportFile(blob, "book.epub")).toBe("success");
    expect(mocks.saveAs).toHaveBeenCalledWith(blob, "book.epub");
    expect(mocks.saveNativeDocument).not.toHaveBeenCalled();
  });
});
