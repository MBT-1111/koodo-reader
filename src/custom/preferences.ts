import { ConfigService } from "../assets/lib/kookit-extra-browser.min";
import { persistPreferences } from "../utils/storage/preferences";

if (window.electronAPI) {
  persistPreferences(ConfigService, localStorage, (request) =>
    window.electronAPI.sendSync("preferences", request)
  );
}
