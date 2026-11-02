import { saveAs } from "file-saver";
import { Buffer } from "buffer";
import { isNativeAndroid } from "../platform";
import { saveNativeDocument } from "../../custom/android/storage";

export type ExportResult = "success" | "failed" | "cancel";

export async function saveExportFile(blob: Blob, name: string): Promise<ExportResult> {
  if (!isNativeAndroid) {
    saveAs(blob, name);
    return "success";
  }
  try {
    const bytes = await blob.arrayBuffer();
    const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
    const result = await saveNativeDocument({
      name: name.replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, "_").slice(0, 255) || "KoodoReader-export",
      mime: blob.type.split(/[;,]/)[0] || "application/octet-stream",
      size: bytes.byteLength, sha256, data: Buffer.from(bytes).toString("base64"),
    });
    if (result.status === "cancel") return "cancel";
    return result.status === "success" && result.size === bytes.byteLength && result.sha256 === sha256 ? "success" : "failed";
  } catch {
    return "failed";
  }
}
