/**
 * Tracks the currently-selected destination element by an opaque id, scoped to this
 * frame. The background service worker only ever holds { tabId, frameId, elementId }
 * (see domain/messages.ts DestinationRef) — never a DOM node reference, since a node
 * only has meaning inside the frame that owns it (AGENTS.md "Destination selection
 * across tabs"). This module is the one place that translates an elementId back to
 * a live element, and it's the one place that notices the element going away.
 */

let counter = 0;
const nextElementId = (): string => `soundwave-field-el-${++counter}-${Date.now()}`;

const registry = new Map<string, Element>();

export const registerElement = (el: Element): string => {
  const id = nextElementId();
  registry.set(id, el);
  return id;
};

export const getRegisteredElement = (elementId: string): Element | null => {
  const el = registry.get(elementId);
  if (!el) return null;
  if (!el.isConnected) {
    registry.delete(elementId);
    return null;
  }
  return el;
};

export const clearRegistry = (): void => {
  registry.clear();
};
