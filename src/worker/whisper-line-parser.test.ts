import { describe, expect, it } from "vitest";
import { parseWhisperLine, parseWhisperOutput } from "./whisper-line-parser";

describe("parseWhisperLine", () => {
  it("parses a real whisper.cpp segment line (from the project's own README example)", () => {
    expect(parseWhisperLine("[00:00:00.000 --> 00:00:00.850]   And so my")).toEqual({
      startMs: 0,
      endMs: 850,
      text: "And so my",
    });
  });

  it("parses timestamps spanning hours/minutes/seconds", () => {
    const result = parseWhisperLine("[01:02:03.456 --> 01:02:05.000]  hello");
    expect(result?.startMs).toBe(((1 * 3600 + 2 * 60 + 3) * 1000) + 456);
    expect(result?.endMs).toBe(((1 * 3600 + 2 * 60 + 5) * 1000));
  });

  it("returns null for non-segment lines (logs, timing summaries, etc.)", () => {
    expect(parseWhisperLine("whisper_full: processing 16000 samples")).toBeNull();
    expect(parseWhisperLine("system_info: n_threads = 4")).toBeNull();
    expect(parseWhisperLine("")).toBeNull();
  });

  it("handles an empty segment text", () => {
    expect(parseWhisperLine("[00:00:00.000 --> 00:00:01.000]")).toEqual({
      startMs: 0,
      endMs: 1000,
      text: "",
    });
  });
});

describe("parseWhisperOutput", () => {
  it("extracts only the segment lines from a multi-line capture, in order", () => {
    const output = [
      "whisper_init_from_file_with_params_no_state: loading model",
      "[00:00:00.000 --> 00:00:00.850]   And so my",
      "[00:00:00.850 --> 00:00:01.590]   fellow",
      "whisper_print_timings: load time = 100.00 ms",
      "[00:00:01.590 --> 00:00:04.140]   Americans, ask",
    ].join("\n");

    expect(parseWhisperOutput(output)).toEqual([
      { startMs: 0, endMs: 850, text: "And so my" },
      { startMs: 850, endMs: 1590, text: "fellow" },
      { startMs: 1590, endMs: 4140, text: "Americans, ask" },
    ]);
  });

  it("returns an empty array when there are no segment lines", () => {
    expect(parseWhisperOutput("just some log lines\nno segments here")).toEqual([]);
  });
});
