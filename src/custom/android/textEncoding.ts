// Only override the engine when aligned ASCII/whitespace strongly identifies UTF-16.
// Ambiguous, short and malformed input keeps the engine's normal detection path.
export function detectBomlessUtf16(buffer: ArrayBuffer): "UTF-16LE" | "UTF-16BE" | "" {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < 32 || bytes.length % 2) return "";
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff) || (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)) return "";
  const ascii = (value: number) => value === 9 || value === 10 || value === 13 || (value >= 32 && value <= 126);
  const end = Math.min(bytes.length, 65536);
  let little = 0, big = 0;
  for (let offset = 0; offset < end; offset += 2) {
    if (bytes[offset + 1] === 0 && ascii(bytes[offset])) little++;
    if (bytes[offset] === 0 && ascii(bytes[offset + 1])) big++;
  }
  const dominant = Math.max(little, big);
  if (dominant < 8 || dominant < end / 2 * 0.1 || Math.min(little, big) > dominant * 0.1) return "";
  const littleEndian = little > big, view = new DataView(buffer);
  for (let offset = 0; offset < bytes.length; offset += 2) {
    const unit = view.getUint16(offset, littleEndian);
    if ((unit < 32 && ![9, 10, 12, 13].includes(unit)) || (unit >= 0x7f && unit <= 0x9f) || unit >= 0xfffe) return "";
    if (unit >= 0xd800 && unit <= 0xdbff) {
      if (offset + 3 >= bytes.length) return "";
      const next = view.getUint16(offset + 2, littleEndian);
      if (next < 0xdc00 || next > 0xdfff) return "";
      offset += 2;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return "";
  }
  return littleEndian ? "UTF-16LE" : "UTF-16BE";
}
