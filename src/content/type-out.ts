/**
 * Writes text into TypeTarget's own new-file box a slice per animation frame, so it reads as
 * typed rather than pasted. A slice is however much of the text is due by then, so any text,
 * however long, is all in within TYPING_DURATION_MS and takes no more frames than a short one.
 */

/** The longest one insertion takes to type out. */
export const TYPING_DURATION_MS = 200;

export type TypeOut = {
  /** Writes whatever is left at once. Safe to call again, or after the text is all in. */
  finish: () => void;
};

/** A hidden tab draws no frames (and throttles its timers), and reduced motion asks for no
 * animation: both get the text in one go. jsdom has no matchMedia. */
const typesAtOnce = (): boolean =>
  document.hidden || (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);

/** Hands `text` to `write` in order, in slices that add up to it. The first slice is written
 * on the next frame, or now when the text goes in at once. */
export const typeOut = (text: string, write: (slice: string) => void): TypeOut => {
  const start = performance.now();
  let written = 0;
  let frame: number | null = null;

  const writeUpTo = (end: number) => {
    if (end <= written) return;
    write(text.slice(written, end));
    written = end;
  };

  const finish = () => {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    document.removeEventListener("visibilitychange", finish);
    writeUpTo(text.length);
  };

  // Timed by performance.now() rather than the frame's timestamp, which in jsdom runs on its own clock.
  const step = () => {
    frame = null;
    const progress = Math.min(1, (performance.now() - start) / TYPING_DURATION_MS);
    writeUpTo(Math.ceil(text.length * progress));
    if (written < text.length) frame = requestAnimationFrame(step);
    else finish();
  };

  if (typesAtOnce()) {
    finish();
  } else {
    // Hiding the tab mid-way stops the frames, so the rest goes in then.
    document.addEventListener("visibilitychange", finish);
    frame = requestAnimationFrame(step);
  }
  return { finish };
};
