// Legacy byte fragments generated with Python's standard gb18030/big5 codecs.
// Runtime fixture generation needs only Buffer; it does not depend on a converter package.
const legacy = {
  gb18030: ["tdrSu9XCILHgwuvR6dak", "xOO6w6OsysC956Gj1tDOxLbOwuS6zcCp1bnX1rf7lTSyNZUwhTLQ6NKqsaOz1tX9yLehow==", "tdq2/tXCILzM0PjUxLbB", "uvPQ+NXCvdq1xLq619bSstOm1f3It8/Uyr6jrLK7xNyz9s/WwtLC66Gj"],
  big5: ["ssSkQLO5IL1zvVjF58PS", "s2+sT8FjxemkpKTlvlzFqrT6uNWhQbzQwkm7ULp+pnKlsra3pb+9VMXjpdyhQw==", "ssSkR7O5IMR+xPK+XMWq", "q+HE8rO5uGCkXa1uq0+vZK3sqNOqusFjxemk5aZyoUGko6/gpViye7bDvVihQw=="],
};
const anchors = {
  gb18030: ["你好，世界。中文段落和扩展字符𠮷🙂需要保持正确。", "后续章节的汉字也应正确显示，不能出现乱码。"],
  big5: ["這是繁體中文閱讀測試，標點與漢字必須正確顯示。", "後續章節也要保留原來的繁體文字，不能出現亂碼。"],
};
const simple = ["第一章 编码验证", anchors.gb18030[0], "第二章 继续阅读", anchors.gb18030[1]];
function text(parts, paragraphsPerChapter) {
  return [parts[0], ...Array.from({ length: paragraphsPerChapter }, (_, index) => `${parts[1]} ${index + 1}`), parts[2], ...Array.from({ length: paragraphsPerChapter }, (_, index) => `${parts[3]} ${index + 1}`)].join("\n\n");
}
function encodedTextFixtures(paragraphsPerChapter = 35) {
  const content = text(simple, paragraphsPerChapter), utf16 = Buffer.from(content, "utf16le");
  /** @type {Array<[string, Buffer]>} */
  const buffers = [
    ["utf8", Buffer.from(content, "utf8")],
    ["utf8-bom", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(content, "utf8")])],
    ["utf16le", Buffer.concat([Buffer.from([0xff, 0xfe]), utf16])],
    ["utf16be", Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(utf16).swap16()])],
  ];
  for (const encoding of ["gb18030", "big5"]) {
    const parts = legacy[encoding].map(value => Buffer.from(value, "base64"));
    const list = [parts[0], ...Array.from({ length: paragraphsPerChapter }, (_, index) => Buffer.concat([parts[1], Buffer.from(` ${index + 1}`)])), parts[2], ...Array.from({ length: paragraphsPerChapter }, (_, index) => Buffer.concat([parts[3], Buffer.from(` ${index + 1}`)]))];
    buffers.push([encoding, Buffer.concat(list.flatMap((part, index) => index ? [Buffer.from("\n\n"), part] : [part]))]);
  }
  return buffers.map(([encoding, buffer]) => ({ encoding, name: `Koodo-Encoding-${encoding}.txt`, title: `Koodo-Encoding-${encoding}`, mimeType: "text/plain", buffer,
    anchor: (anchors[encoding] || anchors.gb18030)[0], secondAnchor: (anchors[encoding] || anchors.gb18030)[1] }));
}
module.exports = { encodedTextFixtures };
