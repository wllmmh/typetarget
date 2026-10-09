import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/react";
import { envelope, type BackgroundToContent } from "../domain/messages";
import { installFakeChrome, type FakeChrome } from "../test/fake-chrome";
import { CONTENT_BRIDGE_FLAG, installContentBridge } from "./bridge";
import { destinationSession } from "./destination-session";

// jsdom never makes a trusted event, so these tests' clicks stand in for the user's own.
vi.mock("./user-event", () => ({ isUserEvent: vi.fn(() => true) }));

let fake: FakeChrome;

/** The new-file box and the badge are attached to <html>, outside <body> where `screen` looks. */
const page = () => within(document.documentElement);
let textarea: HTMLTextAreaElement;

/** Every listener the bridge registered, as Chrome would call them for one message. */
const deliver = (msg: BackgroundToContent) => {
  for (const [listener] of fake.runtime.onMessage.addListener.mock.calls) {
    (listener as (m: unknown, s: unknown, r: (v: unknown) => void) => void)(envelope(msg), {}, () => {});
  }
};

const pick = (el: HTMLElement) => {
  deliver({ kind: "enter-selection-mode", showIndicators: true });
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
  destinationSession.setShowIndicators(true);
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
      (listener as (m: unknown, s: unknown, r: (v: unknown) => void) => void)(envelope({ kind: "pick-focused-element", showIndicators: true }), {}, reply);
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
      (listener as (m: unknown, s: unknown, r: (v: unknown) => void) => void)(envelope({ kind: "pick-focused-element", showIndicators: true }), {}, reply);
    }

    expect(reply).toHaveBeenCalledWith(envelope(expect.objectContaining({ kind: "error", code: "no-focused-text-box" })));
  });

  it("opens a new-file box when asked by the right-click menu, and reports it as the pick", () => {
    installContentBridge();

    deliver({ kind: "open-new-file-field" });

    const field = page().getByRole("textbox", { name: "TypeTarget new file" });
    expect(document.activeElement).toBe(field);
    expect(fake.runtime.sendMessage).toHaveBeenCalledWith(envelope(expect.objectContaining({ kind: "destination-picked", label: "TypeTarget new file" })));
    deliver({ kind: "insert-text", text: "hello", separator: " " });
    expect(field).toHaveValue("hello");
  });

  it("asks the background to stop typing when the badge's X is clicked", () => {
    installContentBridge();
    textarea.getBoundingClientRect = () => new DOMRect(40, 100, 200, 60); // jsdom does no layout; hidden buttons can't be clicked
    pick(textarea);
    deliver({ kind: "set-session-indicator", indicator: { state: "stopped" } });

    page().getByRole("button", { name: "Stop typing here" }).click();

    expect(fake.runtime.sendMessage).toHaveBeenCalledWith(envelope({ kind: "stop-typing-requested" }));
  });

  it("asks the background to open the new-file box's text in a new tab", () => {
    installContentBridge();
    vi.spyOn(HTMLTextAreaElement.prototype, "getBoundingClientRect").mockReturnValue(new DOMRect(12, 400, 800, 200)); // jsdom does no layout
    deliver({ kind: "open-new-file-field" });
    deliver({ kind: "insert-text", text: "hello", separator: " " });
    deliver({ kind: "set-session-indicator", indicator: { state: "stopped" } });

    page().getByRole("button", { name: "Open in new tab" }).click();

    expect(fake.runtime.sendMessage).toHaveBeenCalledWith(envelope({ kind: "open-in-new-tab", text: "hello" }));
    vi.restoreAllMocks();
  });

  it("draws nothing on the picked field when told indicators are off, and draws them when turned back on", () => {
    installContentBridge();
    deliver({ kind: "enter-selection-mode", showIndicators: false });
    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));

    expect(textarea.classList.contains("typetarget-destination")).toBe(false);
    deliver({ kind: "set-page-indicators", show: true });
    expect(textarea.classList.contains("typetarget-destination")).toBe(true);
  });

  it("keeps the editor tab's indicators whatever the setting, since websites can't see it", () => {
    installContentBridge(undefined, { alwaysShowIndicators: true });
    deliver({ kind: "enter-selection-mode", showIndicators: false });
    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    deliver({ kind: "set-page-indicators", show: false });

    expect(textarea.classList.contains("typetarget-destination")).toBe(true);
  });

  it("ignores messages from senders it wasn't told to accept", () => {
    // The editor page runs the bridge and also hears the popup's own "clear-destination" request.
    installContentBridge((sender) => sender.id === "background");
    const listener = fake.runtime.onMessage.addListener.mock.calls[0]?.[0] as (m: unknown, s: unknown, r: (v: unknown) => void) => void;
    listener(envelope({ kind: "enter-selection-mode", showIndicators: true }), { id: "background" }, () => {});
    textarea.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    const reply = vi.fn();

    listener(envelope({ kind: "clear-destination" }), { id: "popup" }, reply);

    expect(textarea.classList.contains("typetarget-destination")).toBe(true);
    expect(reply).not.toHaveBeenCalled();
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
