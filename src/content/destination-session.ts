/**
 * Owns the content script's live view of "the current destination": selection mode
 * (hover/click to pick), and once picked, the insertion boundary for that element
 * (AGENTS.md "Destination cursor behavior": capture position at selection time,
 * then only ever advance forward from there — never re-derive from the live
 * selection/cursor, which the user may have moved).
 */
import { findEligibleAncestor } from "./eligible-elements";
import { setHighlighted, clearHighlight } from "./highlight";
import { getRegisteredElement, registerElement } from "./element-registry";
import { insertTranscriptText, toInsertionTarget } from "./insert-text";

export type PickedDestination = {
  elementId: string;
  label: string;
};

class DestinationSession {
  private selecting = false;
  private pickedElementId: string | null = null;
  private insertionOffset = 0;

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
    this.pickedElementId = registerElement(el);
    this.insertionOffset = this.currentValueLength(el);
    this.onPicked?.({ elementId: this.pickedElementId, label: describeElement(el) });
  }

  private currentValueLength(el: HTMLElement): number {
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el.value.length;
    return el.textContent?.length ?? 0;
  }

  onPicked: ((destination: PickedDestination) => void) | null = null;

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

  isDestinationAlive(): boolean {
    if (!this.pickedElementId) return false;
    return getRegisteredElement(this.pickedElementId) !== null;
  }

  clearDestination(): void {
    this.pickedElementId = null;
    this.insertionOffset = 0;
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
  const tag = el.tagName.toLowerCase();
  const label = el.getAttribute("aria-label") ?? el.getAttribute("placeholder") ?? el.getAttribute("name");
  return label ? `${tag} "${label}"` : tag;
};

export const destinationSession = new DestinationSession();
