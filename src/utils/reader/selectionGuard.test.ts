import { afterEach, describe, expect, it } from "vitest";
import { beginReaderSelection, endReaderSelection, hasReaderSelection } from "./selectionGuard";

const documentWith = (text = "", collapsed = !text) => ({ getSelection: () => ({ isCollapsed: collapsed, toString: () => text }) }) as Document;
afterEach(() => endReaderSelection());
describe("selection protection during speech", () => {
  it("protects the drag before the browser has created a text range", () => {
    const doc = documentWith();
    beginReaderSelection(doc);
    expect(hasReaderSelection([doc])).toBe(true);
    endReaderSelection(doc);
    expect(hasReaderSelection([doc])).toBe(false);
  });
  it("keeps a completed selection protected until it is cleared", () => {
    expect(hasReaderSelection([null, documentWith("A quote")])).toBe(true);
    expect(hasReaderSelection([documentWith("A quote", true)])).toBe(false);
    expect(hasReaderSelection([documentWith()])).toBe(false);
  });
  it("releases a drag ending outside its original frame", () => {
    const first = documentWith(), second = documentWith();
    beginReaderSelection(first); beginReaderSelection(second); endReaderSelection();
    expect(hasReaderSelection([first, second])).toBe(false);
  });
});
