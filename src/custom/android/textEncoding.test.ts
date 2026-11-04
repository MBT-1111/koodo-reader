import { describe, expect, it } from "vitest";
import { detectBomlessUtf16 } from "./textEncoding";
import { encodedTextFixtures } from "../../../e2e/android/encoding-fixtures.cjs";

const detect = (bytes: Uint8Array) => detectBomlessUtf16(Uint8Array.from(bytes).buffer);
const fixtures = encodedTextFixtures();

describe("Android BOM-less TXT encoding", () => {
  for (const [encoding, expected] of [["utf16le", "UTF-16LE"], ["utf16be", "UTF-16BE"]] as const) {
    const fixture = fixtures.find(item => item.encoding === encoding)!;
    it(`recognizes ${expected} Chinese with aligned whitespace and surrogate pairs`, () => {
      expect(detect(fixture.buffer.subarray(2))).toBe(expected);
    });
    it(`defers truncated or malformed ${expected} to the existing decoder`, () => {
      expect(detect(fixture.buffer.subarray(2, fixture.buffer.length - 1))).toBe("");
      const broken = Buffer.concat([fixture.buffer.subarray(2), encoding === "utf16le" ? Buffer.from([0x00, 0xd8]) : Buffer.from([0xd8, 0x00])]);
      expect(detect(broken)).toBe("");
    });
  }
  for (const fixture of fixtures) {
    it(`preserves the normal ${fixture.encoding} detection path`, () => {
      expect(detect(fixture.buffer)).toBe("");
    });
  }
  it("does not guess short or Chinese-only text without enough byte-order evidence", () => {
    expect(detect(Buffer.from("你好", "utf16le"))).toBe("");
    expect(detect(Buffer.from("中文阅读正文汉字".repeat(12), "utf16le"))).toBe("");
  });
  it("rejects contradictory byte orders and binary NUL/control characters", () => {
    const le = fixtures.find(item => item.encoding === "utf16le")!.buffer.subarray(2);
    const be = fixtures.find(item => item.encoding === "utf16be")!.buffer.subarray(2);
    expect(detect(Buffer.concat([le, be]))).toBe("");
    for (const unit of [0, 1, 0x80, 0xdc00]) {
      const tail = Buffer.alloc(2); tail.writeUInt16LE(unit);
      expect(detect(Buffer.concat([le, tail]))).toBe("");
    }
  });
});
