import type { CapacitorConfig } from "@capacitor/cli";
import build from "./src/custom/build.json";

const config: CapacitorConfig = {
  // Android package segments must be valid Java identifiers.
  appId: "xyz.koodoreader.custom.android",
  appName: build.productName,
  webDir: "build-android",
  android: {
    // Match Vite's existing Chromium target, including the bundled PDF renderer.
    minWebViewVersion: 130,
    allowMixedContent: false,
  },
  plugins: {
    SystemBars: { insetsHandling: "native" },
  },
};

export default config;
