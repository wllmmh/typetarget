/**
 * Owns the content script's live view of "the current destination": selection mode
 * (hover/click to pick), and once picked, the insertion boundary for that element
 * (AGENTS.md "Destination cursor behavior": capture position at selection time,
 * then only ever advance forward from there — never re-derive from the live
 * selection/cursor, which the user may have moved).
 */
import { findEligibleAncestor } from "./eligible-elements";
import { setHighlighted, clearHighlight, setDestinationMarker } from "./highlight";
import { getRegisteredElement, registerElement } from "./element-registry";
import { insertTranscriptText, toInsertionTarget } from "./insert-text";
import { setSessionBadge, type BadgeActions } from "./session-badge";
import { createNewFileField } from "./new-file-field";
import { saveTextFile, textOf } from "./save-text-file";
import type { SessionIndicator } from "../domain/messages";

export type PickedDestination = {
  elementId: string;
  label: string;
};

class DestinationSession {
  private selecting = false;
  private pickedElementId: string | null = null;
  private insertionOffset = 0;
  /** The picked element, while its pointer listeners are attached. */
  private trackedElement: HTMLElement | null = null;
  /** The listening timer shown above the destination, while capturing. */
  private indicator: SessionIndicator | null = null;
  /** The "Type to new file" box, while it is the destination (see new-file-field.ts). */
  private newFileField: HTMLTextAreaElement | null = null;

  /** The X and Save buttons beside the badge. */
  private readonly badgeActions: BadgeActions = {
    onClose: () => this.onStopTypingRequested?.(),
    onSave: () => this.saveToFile(),
  };

  private readonly onPointerEnter = () => this.onPointerOverDestination?.(true);
  private readonly onPointerLeave = () => this.onPointerOverDestination?.(false);

  private readonly onMouseOver = (e: MouseEvent) => {
    setHighlighted(findEligibleAncestor(e.target));
  };

  private readonly onClick = (e: MouseEvent) => {
    const el = findEligibleAncestor(e.target);
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    this.pick(el);
  };

  private pick(el: HTMLElement): void {
    this.stopSelecting();
    if (el !== this.newFileField) this.closeNewFileField(); // the output moved to another box in this frame
    this.pickedElementId = registerElement(el);
    this.insertionOffset = this.currentValueLength(el);
    setDestinationMarker(el);
    setSessionBadge(el, this.indicator, this.badgeActions); // a replacement pick in this frame keeps the running timer
    this.trackPointer(el);
    this.onPicked?.({ elementId: this.pickedElementId, label: describeElement(el) });
    // Picking by click or right-click leaves the pointer already inside, so no pointerenter will
    // come until it leaves and returns. Reported after the pick, so the background knows it's
    // the destination's.
    if (el.matches(":hover")) this.onPointerOverDestination?.(true);
  }

  private currentValueLength(el: HTMLElement): number {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.length;
    return el.textContent?.length ?? 0;
  }

  onPicked: ((destination: PickedDestination) => void) | null = null;
  onPointerOverDestination: ((over: boolean) => void) | null = null;
  /** The badge's X was clicked; the background decides, as for the menu's Stop typing. */
  onStopTypingRequested: (() => void) | null = null;

  private trackPointer(el: HTMLElement | null): void {
    this.trackedElement?.removeEventListener("pointerenter", this.onPointerEnter);
    this.trackedElement?.removeEventListener("pointerleave", this.onPointerLeave);
    this.trackedElement = el;
    el?.addEventListener("pointerenter", this.onPointerEnter);
    el?.addEventListener("pointerleave", this.onPointerLeave);
  }

  startSelecting(): void {
    if (this.selecting) return;
    this.selecting = true;
    document.addEventListener("mouseover", this.onMouseOver, true);
    document.addEventListener("click", this.onClick, true);
  }

  stopSelecting(): void {
    if (!this.selecting) return;
    this.selecting = false;
    document.removeEventListener("mouseover", this.onMouseOver, true);
    document.removeEventListener("click", this.onClick, true);
    clearHighlight();
  }

  /**
   * Picks the focused element (or its eligible ancestor) — how the right-click menu picks:
   * the script is injected only after the menu item is chosen, so it never saw the click,
   * but right-clicking a text box focuses it. Returns false if nothing eligible is focused.
   */
  pickFocused(): boolean {
    const el = findEligibleAncestor(document.activeElement);
    if (!el) return false;
    this.pick(el);
    return true;
  }

  /**
   * "Type to new file": opens a text box over the bottom third of the page and picks it. One
   * already open is reused rather than stacked under a second.
   */
  openNewFileField(): void {
    if (!this.newFileField?.isConnected) this.newFileField = createNewFileField();
    this.newFileField.focus();
    this.pick(this.newFileField);
  }

  private closeNewFileField(): void {
    this.newFileField?.remove();
    this.newFileField = null;
  }

  /** Downloads the destination's current text (what was transcribed and typed) as a .txt file. */
  saveToFile(): void {
    const el = this.pickedElementId ? getRegisteredElement(this.pickedElementId) : null;
    if (el instanceof HTMLElement) saveTextFile(textOf(el));
  }

  isDestinationAlive(): boolean {
    if (!this.pickedElementId) return false;
    return getRegisteredElement(this.pickedElementId) !== null;
  }

  clearDestination(): void {
    this.pickedElementId = null;
    this.insertionOffset = 0;
    setDestinationMarker(null);
    this.indicator = null;
    setSessionBadge(null, null, this.badgeActions);
    this.trackPointer(null);
    this.closeNewFileField(); // it exists only to be the output
  }

  /** Shows (or with null, removes) the listening timer above the destination's outline. */
  setIndicator(indicator: SessionIndicator | null): void {
    this.indicator = indicator;
    setSessionBadge(this.pickedElementId ? getRegisteredElement(this.pickedElementId) : null, indicator, this.badgeActions);
  }

  /** Inserts finalized text at the tracked boundary. Returns false if the destination is gone. */
  insert(text: string, separator: string): boolean {
    if (!this.pickedElementId) return false;
    const el = getRegisteredElement(this.pickedElementId);
    if (!el) return false;
    const target = toInsertionTarget(el as HTMLElement);
    if (!target) return false;
    this.insertionOffset = insertTranscriptText(target, text, separator, this.insertionOffset);
    return true;
  }
}

const describeElement = (el: HTMLElement): string => {
  const label = el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.getAttribute("name");
  return label ?? el.tagName.toLowerCase();
};

export const destinationSession = new DestinationSession();
