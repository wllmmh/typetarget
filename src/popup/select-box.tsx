import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type DropdownProps = {
  /** The selected value, shown on the trigger. */
  value: ReactNode;
  disabled: boolean;
  /** The heading that names the menu; the trigger is announced as it followed by the value. */
  labelledBy?: string;
  /** Extra classes on the trigger, e.g. the model picker's missing-key dot. */
  triggerClassName?: string;
  /** The panel's rows; `close` shuts the panel after a choice. */
  children: (close: () => void) => ReactNode;
};

/**
 * Every dropdown in the popup: a trigger drawn like a select and a panel that floats over the
 * popup and scrolls inside itself, since Chrome caps the popup at 600px and the popup must not
 * scroll. Not a native `<select>`: its open list can't be styled to match, and the model picker's
 * group headers hold buttons, which an `<option>` can't.
 */
export const Dropdown = ({ value, disabled, labelledBy, triggerClassName, children }: DropdownProps) => {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerId = useId();

  useEffect(() => {
    if (!open) return;
    // A long list opens on the current choice rather than at its top.
    panelRef.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: "nearest" });
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // A locked menu (e.g. the model while capturing) must not stay open.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  return (
    <div className="select" ref={rootRef}>
      <button
        type="button"
        id={triggerId}
        className={["select-box", triggerClassName].filter(Boolean).join(" ")}
        disabled={disabled}
        aria-expanded={open}
        aria-labelledby={labelledBy ? `${labelledBy} ${triggerId}` : undefined}
        onClick={() => setOpen((wasOpen) => !wasOpen)}
      >
        <span className="select-value">{value}</span>
        <span className="select-caret" aria-hidden="true">
          ▾
        </span>
      </button>
      {open && (
        <div className="select-panel" ref={panelRef}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
};

type DropdownOptionProps = {
  selected: boolean;
  onSelect: () => void;
  lang?: string;
  children: ReactNode;
};

/** A row in a dropdown's panel: a plain button (not role="option"), because a listbox option
 * must not contain interactive content and the model picker's headers do. */
export const DropdownOption = ({ selected, onSelect, lang, children }: DropdownOptionProps) => (
  <button type="button" className="select-option" aria-pressed={selected} lang={lang} onClick={onSelect}>
    {children}
  </button>
);
