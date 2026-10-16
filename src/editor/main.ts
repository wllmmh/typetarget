/**
 * The tab opened by the "Type to new file" box's Open in new tab: a full-page text box that
 * takes over as the output, starting with the box's text. An extension page can't be injected
 * into, so it runs the content bridge itself; the background still sends it insert-text and
 * the badge like any other destination frame. Once this box is picked, the background
 * releases the old one, which closes it. The badge's Move back to page reverses this: the box
 * reopens on that page with this one's text, and this tab closes.
 */
import { installContentBridge } from "../content/bridge";
import { destinationSession } from "../content/destination-session";
import { envelope, isEnvelope, type EditorReply, type EditorToBackground } from "../domain/messages";
import { isFromServiceWorker } from "../domain/sender";
import { t } from "../domain/i18n";

installContentBridge(isFromServiceWorker, { alwaysShowIndicators: true });
destinationSession.typesOutEverywhere = true;

const start = async (field: HTMLTextAreaElement): Promise<void> => {
  const raw: unknown = await chrome.runtime.sendMessage(envelope<EditorToBackground>({ kind: "editor-ready" }));
  const reply = isEnvelope<EditorReply>(raw) && raw.payload.kind === "editor-text" ? raw.payload : null;
  field.value = reply?.text ?? "";
  const originTabId = reply?.originTabId ?? null;
  if (originTabId !== null) {
    destinationSession.onMoveBackRequested = (text) =>
      void chrome.runtime.sendMessage(envelope<EditorToBackground>({ kind: "move-back-requested", originTabId, text }));
  }
  field.focus();
  field.setSelectionRange(field.value.length, field.value.length);
  destinationSession.pickFocused(); // reported to the background through the bridge, like any pick
};

document.documentElement.lang = chrome.i18n.getUILanguage();
document.documentElement.dir = t("textDirection");
document.title = t("editorTitle");

const field = document.getElementById("text");
if (field instanceof HTMLTextAreaElement) {
  field.setAttribute("aria-label", t("editorTitle"));
  field.placeholder = t("transcriptPlaceholder");
  void start(field);
}
