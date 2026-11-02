import { Capacitor } from "@capacitor/core";

// The build flag also makes the Android UI available in a browser for testing.
export const isNativeAndroid = Capacitor.getPlatform() === "android";
export const isAndroid =
  import.meta.env.VITE_APP_TARGET === "android" ||
  isNativeAndroid;
