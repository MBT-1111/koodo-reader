import { ConfigService } from "../assets/lib/kookit-extra-browser.min";
import { persistPreferences } from "../utils/storage/preferences";
import { clearLegacyNavigationLock } from "../utils/reader/navigationLock";

if (window.electronAPI) {
  persistPreferences(ConfigService, localStorage, (request) =>
    window.electronAPI.sendSync("preferences", request)
  );
}

// Run after hydration and before the store reads the saved navigation pin.
clearLegacyNavigationLock(ConfigService);
