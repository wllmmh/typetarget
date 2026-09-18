import { describe, expect, it } from "vitest";
import { TranscriptStabilizer, hypothesisDelta } from "./stabilizer";

describe("TranscriptStabilizer.onHypothesis", () => {
  it("emits a partial event for each growing hypothesis", () => {
    const stabilizer = new TranscriptStabilizer();

    expect(stabilizer.onHypothesis("The quarterly", 1)).toEqual({
      type: "partial",
      text: "The quarterly",
      timestamp: 1,
    });
    expect(stabilizer.onHypothesis("The quarterly revenue", 2)).toEqual({
      type: "partial",
      text: "The quarterly revenue",
      timestamp: 2,
    });
    expect(stabilizer.onHypothesis("The quarterly revenue numbers", 3)).toEqual({
      type: "partial",
      text: "The quarterly revenue numbers",
      timestamp: 3,
    });
  });

  it("does not re-emit an identical repeated hypothesis", () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.onHypothesis("hello", 1);

    expect(stabilizer.onHypothesis("hello", 2)).toBeNull();
  });

  it("treats a punctuation-only change as a new partial (not swallowed as identical)", () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.onHypothesis("hello", 1);

    expect(stabilizer.onHypothesis("hello.", 2)).toEqual({ type: "partial", text: "hello.", timestamp: 2 });
  });

  it("returns null for an empty hypothesis", () => {
    const stabilizer = new TranscriptStabilizer();
    expect(stabilizer.onHypothesis("", 1)).toBeNull();
    expect(stabilizer.onHypothesis("   ", 2)).toBeNull();
  });

  it("trims whitespace before comparing/emitting", () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.onHypothesis("hello", 1);
    expect(stabilizer.onHypothesis("  hello  ", 2)).toBeNull();
  });
});

describe("TranscriptStabilizer.onFinal", () => {
  it("emits a single final event and does not duplicate prior partials", () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.onHypothesis("The quarterly", 1);
    stabilizer.onHypothesis("The quarterly revenue", 2);
    stabilizer.onHypothesis("The quarterly revenue numbers", 3);

    const final = stabilizer.onFinal("The quarterly revenue numbers", 4);

    expect(final).toEqual({ type: "final", text: "The quarterly revenue numbers", timestamp: 4 });
  });

  it("returns null for an empty final result", () => {
    const stabilizer = new TranscriptStabilizer();
    expect(stabilizer.onFinal("", 1)).toBeNull();
    expect(stabilizer.onFinal("   ", 1)).toBeNull();
  });

  it("resets partial tracking so the next utterance starts fresh", () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.onHypothesis("first utterance", 1);
    stabilizer.onFinal("first utterance", 2);

    // Same text again for a *new* utterance should still emit (not swallowed as
    // "identical to last partial", since onFinal cleared that state).
    expect(stabilizer.onHypothesis("first utterance", 3)).toEqual({
      type: "partial",
      text: "first utterance",
      timestamp: 3,
    });
  });
});

describe("TranscriptStabilizer.reset", () => {
  it("clears partial tracking", () => {
    const stabilizer = new TranscriptStabilizer();
    stabilizer.onHypothesis("hello", 1);
    stabilizer.reset();

    expect(stabilizer.onHypothesis("hello", 2)).toEqual({ type: "partial", text: "hello", timestamp: 2 });
  });
});

describe("hypothesisDelta", () => {
  it("returns only the newly-added suffix for a growing refinement", () => {
    expect(hypothesisDelta("The quarterly", "The quarterly revenue")).toBe(" revenue");
  });

  it("returns the full next string when it's not a refinement of the previous one", () => {
    expect(hypothesisDelta("completely different", "totally unrelated text")).toBe("totally unrelated text");
  });

  it("returns the full string when there was no previous hypothesis", () => {
    expect(hypothesisDelta("", "hello")).toBe("hello");
  });
});
