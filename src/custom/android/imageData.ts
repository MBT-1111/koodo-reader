import { Buffer } from "buffer";

export const imageMime = (extension: string) =>
  `image/${extension === "jpg" ? "jpeg" : extension === "svg" ? "svg+xml" : extension}`;

export function decodeImageDataUrl(dataUrl: string): { extension: string; arrayBuffer: ArrayBuffer } {
  const match = /^data:image\/(png|jpe?g|webp|gif|bmp|svg\+xml|avif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[2].length % 4 !== 0) throw new Error("ANDROID_STORAGE_IMAGE_DATA");
  const extension = match[1] === "jpeg" ? "jpg" : match[1] === "svg+xml" ? "svg" : match[1];
  return { extension, arrayBuffer: Uint8Array.from(Buffer.from(match[2], "base64")).buffer };
}
