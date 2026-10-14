import type { SelectHTMLAttributes } from "react";

/** The ▾ every dropdown in the popup ends with. */
export const SelectCaret = () => (
  <span className="select-caret" aria-hidden="true">
    ▾
  </span>
);

/**
 * A native select drawn like the model picker's trigger: the same box (`.select-box`) and the
 * same caret in place of the browser's own arrow, which differs by platform.
 */
export const NativeSelect = (props: Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">) => (
  <div className="native-select">
    <select {...props} className="select-box" />
    <SelectCaret />
  </div>
);
