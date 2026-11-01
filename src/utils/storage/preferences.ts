interface PreferenceConfig {
  setItem(key: string, value: unknown): void;
  removeItem(key: string): void;
}

interface PreferenceReply {
  ok: boolean;
  value: Record<string, string> | null;
  error?: string;
}

type PreferenceRequest =
  | { action: "load" }
  | { action: "initialize"; values: Record<string, string> }
  | { action: "set"; key: string; value: string }
  | { action: "remove"; key: string };

export const persistPreferences = (
  config: PreferenceConfig,
  storage: Storage,
  send: (request: PreferenceRequest) => PreferenceReply
) => {
  const request = (input: PreferenceRequest) => {
    const result = send(input);
    if (!result?.ok) throw new Error(result?.error || "CUSTOM_PREFERENCES_FAILED");
    return result.value;
  };
  let saved = request({ action: "load" });
  if (saved === null) {
    const values: Record<string, string> = {};
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index)!;
      values[key] = storage.getItem(key)!;
    }
    saved = request({ action: "initialize", values });
  }
  // Hydrate before i18n, Zustand and routes read their initial configuration.
  const values = saved || {};
  for (let index = storage.length - 1; index >= 0; index--) {
    const key = storage.key(index)!;
    if (!Object.hasOwn(values, key)) storage.removeItem(key);
  }
  for (const [key, value] of Object.entries(values)) {
    if (storage.getItem(key) !== value) storage.setItem(key, value);
  }

  const setItem = config.setItem.bind(config);
  const removeItem = config.removeItem.bind(config);
  config.setItem = (key, value) => {
    request({ action: "set", key, value: String(value) });
    setItem(key, value);
  };
  config.removeItem = (key) => {
    request({ action: "remove", key });
    removeItem(key);
  };
};
