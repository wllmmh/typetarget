import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { envelope, type BackgroundToContent } from "../domain/messages";
import { installFakeChrome, type FakeChrome } from "../test/fake-chrome";
import { CONTENT_BRIDGE_FLAG, installContentBridge } from "./bridge";
import { destinationSession } from "./destination-session";

let fake: FakeChrome;
let textarea: HTMLTextAreaElement;

/** Every listener the bridge registered, as Chrome would call them for one message. */
const deliver = (msg: BackgroundToContent) => {
  for (const [listener] of fake.runtime.onMessage.addListener.mock.calls) {
    (listener as (m: unknown, s: unknown, r: (v: unknown) => void) => void)(envelope(msg), {}, () => {});
  }
};

const pick = (el: HTMLElement) => {
  deliver({ kind: "enter-selection-mode" });
  el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
};

beforeEach(() => {
  fake = installFakeChrome();
  textarea = document.createElement("textarea");
  document.body.append(textarea);
});

afterEach(() => {
  destinationSession.stopSelecting();
  destinationSession.clearDestination();
  destinationSession.onPicked = null;
  document.body.innerHTML = "";
  delete (globalThis as Record<string, unknown>)[CONTENT_BRIDGE_FLAG];
  vi.unstubAllGlobals();
});

describe("installContentBridge", () => {
  it("inserts a final once into the destination", () => {
    installContentBridge();
    pick(textarea);

    deliver({ kind: "insert-text", text: "hello", separator: " " });

    expect(textarea.value).toBe("hello");
  });

  it("picks the focused text box when asked by the right-click menu, and reports the pick", () => {
    installContentBridge();
    const onPicked = vi.fn();
    const originalOnPicked = destinationSession.onPicked;
    destinationSession.onPicked = (d) => { onPicked(d); originalOnPicked?.(d); };
    textarea.focus();
    const reply = vi.fn();

    for (const [listener] of fake.runtime.onMessage.addListener.mock.calls) {
      (listener as (m: unknown, s: unknown, r: (v: unknown) => void) => void)(envelope({ kind: "pick-focused-element" }), {}, reply);
    }

    expect(reply).toHaveBeenCalledWith(envelope({ kind: "ok" }));
    expect(onPicked).toHaveBeenCalledWith(expect.objectContaining({ label: "textarea" }));
    expect(fake.runtime.sendMessage).toHaveBeenCalledWith(envelope(expect.objectContaining({ kind: "destination-picked" })));
    expect(textarea.classList.contains("typetarget-destination")).toBe(true);
  });

  it("answers with an error when nothing eligible is focused", () => {
    installContentBridge();
    const reply = vi.fn();

    for (const [listener] of fake.runtime.onMessage.addListener.mock.calls) {
      (listener as (m: unknown, s: unknown, r: (v: unknown) => void) => void)(envelope({ kind: "pick-focused-element" }), {}, reply);
    }

    expect(reply).toHaveBeenCalledWith(envelope(expect.objectContaining({ kind: "error", code: "no-focused-text-box" })));
  });

  it("drops the destination and its outline when the background clears it", () => {
    installContentBridge();
    pick(textarea);

    deliver({ kind: "clear-destination" });

    expect(textarea.classList.contains("typetarget-destination")).toBe(false);
    deliver({ kind: "insert-text", text: "hello", separator: " " });
    expect(textarea.value).toBe("");
  });

  // chrome.scripting.executeScript re-runs the script on every injection, and the user
  // re-enters selection mode each time they choose an output. A second set of listeners
  // meant every final was inserted twice (or once per injection).
  it("ignores a second installation in the same frame, so an injected-again script cannot insert twice", () => {
    expect(installContentBridge()).toBe(true);
    expect(installContentBridge()).toBe(false);
    expect(fake.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);

    pick(textarea);
    deliver({ kind: "insert-text", text: "hello", separator: " " });

    expect(textarea.value).toBe("hello");
  });

  it("reports the destination as unavailable when the picked element is gone", () => {
    installContentBridge();
    pick(textarea);
    textarea.remove();

    deliver({ kind: "insert-text", text: "hello", separator: " " });

    expect(fake.runtime.sendMessage).toHaveBeenCalledWith(
      envelope({ kind: "destination-unavailable", reason: "Destination element is no longer available." }),
    );
  });
});
