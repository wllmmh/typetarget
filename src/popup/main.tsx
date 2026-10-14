import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { t } from "../domain/i18n";

// The HTML says "en" and left to right; the text is in whichever language chrome.i18n picked.
document.documentElement.lang = chrome.i18n.getUILanguage();
document.documentElement.dir = t("textDirection");

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Popup root element missing");

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
