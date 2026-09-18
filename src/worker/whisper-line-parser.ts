/**
 * Parses whisper.cpp's real-time console output format, as printed by
 * `whisper_full` when `params.print_realtime` is true (the mechanism whisper.cpp's
 * official WASM example — examples/whisper.wasm — relies on, since its Embind
 * `full_default` binding has no direct return value; results only arrive via
 * captured stdout, routed through Emscripten's exported `print` runtime method into
 * `Module.print`).
 *
 * Confirmed exact format from whisper.cpp's own README example output:
 *   [00:00:00.000 --> 00:00:00.850]   And so my
 *   [00:00:00.850 --> 00:00:01.590]   fellow
 * i.e. `[HH:MM:SS.mmm --> HH:MM:SS.mmm]` followed by whitespace and the segment text.
 * Source: https://github.com/ggml-org/whisper.cpp (README "Real-time transcription").
 */

const SEGMENT_LINE = /^\[(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})\]\s*(.*)$/;

export type ParsedSegment = {
  startMs: number;
  endMs: number;
  text: string;
};

const timestampToMs = (ts: string): number => {
  const match = /^(\d{2}):(\d{2}):(\d{2})\.(\d{3})$/.exec(ts);
  if (!match) return 0;
  const [, hh, mm, ss, ms] = match;
  return (
    Number(hh) * 3_600_000 +
    Number(mm) * 60_000 +
    Number(ss) * 1_000 +
    Number(ms)
  );
};

/** Parses a single line of whisper.cpp's stdout. Returns null for lines that aren't a segment (logs, timing info, etc.). */
export const parseWhisperLine = (line: string): ParsedSegment | null => {
  const match = SEGMENT_LINE.exec(line.trim());
  if (!match) return null;
  const [, start, end, text] = match;
  if (start === undefined || end === undefined || text === undefined) return null;
  return { startMs: timestampToMs(start), endMs: timestampToMs(end), text };
};

/** Parses every segment line out of a multi-line stdout capture, in order, ignoring non-segment lines. */
export const parseWhisperOutput = (output: string): ParsedSegment[] =>
  output
    .split("\n")
    .map(parseWhisperLine)
    .filter((segment): segment is ParsedSegment => segment !== null);
