import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { isAndroid } from "../../utils/platform";

export const isAndroidEink = () =>
  isAndroid && ConfigService.getReaderConfig("isEinkMode") === "yes";
