const selectingDocuments = new Set<Document>();

export const beginReaderSelection = (doc: Document) => { selectingDocuments.add(doc); };
export const endReaderSelection = (doc?: Document) => {
  if (doc) selectingDocuments.delete(doc);
  else selectingDocuments.clear();
};

export const hasReaderSelection = (docs: (Document | null)[]): boolean =>
  docs.some((doc) => {
    if (!doc) return false;
    const selection = doc.getSelection();
    return selectingDocuments.has(doc) || !!(selection && !selection.isCollapsed && selection.toString().trim());
  });
