interface NavigationConfig {
  getReaderConfig(key: string): string;
  setReaderConfig(key: string, value: string): void;
}

// Older searches persisted their IME lock and also overwrote the user's pin.
export const clearLegacyNavigationLock = (config: NavigationConfig) => {
  if (config.getReaderConfig("isTempLocked") !== "yes") return;
  config.setReaderConfig("isNavLocked", "no");
  config.setReaderConfig("isTempLocked", "");
};

const composingInputs = new WeakSet<Element>();

export const beginNavigationComposition = (input: HTMLInputElement) => {
  composingInputs.add(input);
};

export const endNavigationComposition = (input: HTMLInputElement) => {
  composingInputs.delete(input);
};

// Blur or removal of the input releases the guard even without compositionend.
export const isNavigationComposing = (activeElement: Element | null): boolean =>
  activeElement !== null && composingInputs.has(activeElement);
