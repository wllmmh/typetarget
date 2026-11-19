/**
 * Line breaks for TypeTarget's own boxes (the new-file box and the editor tab), whose text is
 * saved as a .txt file. Without them an hour of transcript is one line of hundreds of
 * kilobytes, which many text editors can't open. A page's own text boxes never get them: a
 * line break there can be dropped or act like Enter (docs/adr/0023-line-breaks-in-saved-transcripts.md).
 *
 * A space becomes a line break, so the text keeps its length and slices of it line up with
 * the unwrapped text.
 */

/** No line goes past this many characters, unless a single word does. */
export const MAX_LINE_LENGTH = 80;
/** A line this long ends at the next sentence end rather than running on to MAX_LINE_LENGTH. */
export const SENTENCE_BREAK_MIN = 60;

/** A sentence's last word: ending in . ! ? … (or their full-width forms), maybe with a closing quote or bracket. */
const SENTENCE_END = /[.!?…。！？]["'”’)\]]*$/u;

/** The column after `word`, written from `column`. */
const advance = (column: number, word: string): number => {
  const newline = word.lastIndexOf("\n");
  return newline === -1 ? column + word.length : word.length - newline - 1;
};

/**
 * `text` with some of its spaces turned into line breaks, for appending at `column` (the
 * number of characters already on the line it goes onto).
 */
export const wrapLines = (text: string, column: number): string => {
  const [first = "", ...rest] = text.split(" ");
  let wrapped = first;
  let col = advance(column, first);
  let previous = first;
  for (const word of rest) {
    const breaks = col > 0 && (col + 1 + word.length > MAX_LINE_LENGTH || (col >= SENTENCE_BREAK_MIN && SENTENCE_END.test(previous)));
    wrapped += `${breaks ? "\n" : " "}${word}`;
    col = advance(breaks ? 0 : col + 1, word);
    previous = word;
  }
  return wrapped;
};

/** The number of characters between the last line break before `offset` and `offset`. */
export const columnAt = (value: string, offset: number): number => {
  const before = value.slice(0, offset);
  return before.length - before.lastIndexOf("\n") - 1;
};
