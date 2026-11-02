import { getOuterDoc } from "./docUtil";
import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { applyThemeColor, removeThemeColor } from "./themeUtil";
import { StyleHelper } from "../../assets/lib/kookit.min";
import FontUtil from "../file/fontUtil";

export const einkReaderCss = `
html, body { background: #fff !important; background-image: none !important; color: #000 !important; }
body { filter: grayscale(1); }
/* The ID branch raises specificity above the engine's long :not(...) color rules without changing book IDs. */
:is(html, #koodo-eink-reader) :is(body, p, span, div, section, article, li, a, h1, h2, h3, h4, h5, h6, td, th, blockquote, pre, code) { color: #000 !important; text-shadow: none !important; }
*, *::before, *::after { animation-duration: .001ms !important; animation-iteration-count: 1 !important; animation-delay: 0s !important; transition: none !important; scroll-behavior: auto !important; box-shadow: none !important; }
::selection { background: #000 !important; color: #fff !important; }
a { text-decoration: underline; }
`;

class styleUtil {
  // add default css for iframe
  static addDefaultCss(bookKey: string) {
    let doc = getOuterDoc();
    if (!doc) return;
    if (!doc.head) {
      return;
    }
    //get style with id of default-style
    let styleElement = doc.getElementById("default-style");
    if (styleElement) {
      styleElement.textContent = this.getDefaultCss(bookKey);
    } else {
      let css = this.getDefaultCss(bookKey);
      let style = doc.createElement("style");
      style.id = "default-style";
      style.textContent = css;
      doc.head.appendChild(style);
    }
    // inject custom book CSS if enabled
    let customCssElement = doc.getElementById("custom-book-style");
    const isCustomBookCSS =
      ConfigService.getReaderConfig("isCustomBookCSS") === "yes";
    const customBookCSS = ConfigService.getReaderConfig("customBookCSS") || "";
    if (isCustomBookCSS && customBookCSS) {
      if (customCssElement) {
        customCssElement.textContent = customBookCSS;
      } else {
        let customStyle = doc.createElement("style");
        customStyle.id = "custom-book-style";
        customStyle.textContent = customBookCSS;
        doc.head.appendChild(customStyle);
      }
    } else if (customCssElement) {
      customCssElement.textContent = "";
    }
  }
  // get default css for iframe
  static getDefaultCss(bookKey: string) {
    const css = StyleHelper.getDefaultCss(ConfigService, bookKey);
    return ConfigService.getReaderConfig("isEinkMode") === "yes" ? `${css}\n${einkReaderCss}` : css;
  }

  static async applyReaderFonts(rendition: any): Promise<void> {
    if (!rendition?.displayFontUrl) return;

    const fontName = ConfigService.getReaderConfig("fontFamily");
    const subFontName = ConfigService.getReaderConfig("subFontFamily");

    if (fontName && FontUtil.isCustomFont(fontName)) {
      const url = await FontUtil.getFontUrl(fontName);
      if (url) await rendition.displayFontUrl(fontName, url);
    }

    if (subFontName && FontUtil.isCustomFont(subFontName)) {
      const url = await FontUtil.getFontUrl(subFontName);
      if (url) await rendition.displayFontUrl(subFontName, url);
    }
  }

  static applyTheme() {
    if (ConfigService.getReaderConfig("isEinkMode") === "yes") {
      applyThemeColor("#000000");
      return;
    }
    const themeColor = ConfigService.getReaderConfig("themeColor");
    if (themeColor && themeColor !== "default") {
      applyThemeColor(themeColor);
    } else {
      removeThemeColor();
    }
  }
}

export default styleUtil;
