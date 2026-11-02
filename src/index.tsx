import { initNativeStorage } from "./custom/android/bootstrap";

async function start() {
  try {
    await initNativeStorage();
  } catch {
    const { showStorageStartupError } = await import("./components/storageStartupError/component");
    await showStorageStartupError();
    return;
  }
  await import("./app");
}

void start();
