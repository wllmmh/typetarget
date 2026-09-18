/**
 * Ensures exactly one offscreen document exists, per Chrome's constraint that an
 * extension can have at most one open at a time
 * (https://developer.chrome.com/docs/extensions/reference/api/offscreen). Guards the
 * check-then-create sequence with a single in-flight promise so concurrent callers
 * (e.g. two rapid start-capture requests) can't both pass the "does it exist?" check
 * and race into `createDocument`, which throws on the loser.
 */

const OFFSCREEN_DOCUMENT_PATH = "src/offscreen/index.html";

let ensurePromise: Promise<void> | null = null;

const hasOffscreenDocument = async (): Promise<boolean> => {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  return contexts.length > 0;
};

export const ensureOffscreenDocument = async (): Promise<void> => {
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    if (await hasOffscreenDocument()) return;
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: [chrome.offscreen.Reason.USER_MEDIA],
      justification: "Captures and plays back the selected tab's audio for local transcription.",
    });
  })();

  try {
    await ensurePromise;
  } finally {
    ensurePromise = null;
  }
};

export const closeOffscreenDocument = async (): Promise<void> => {
  if (await hasOffscreenDocument()) {
    await chrome.offscreen.closeDocument();
  }
};
