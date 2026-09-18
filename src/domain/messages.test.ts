import { describe, expect, it } from "vitest";
import { envelope, isEnvelope, type PopupRequest } from "./messages";

describe("message envelope", () => {
  it("round-trips a payload", () => {
    const request: PopupRequest = { kind: "get-state" };
    const wrapped = envelope(request);
    expect(isEnvelope<PopupRequest>(wrapped)).toBe(true);
    expect(wrapped.payload).toEqual(request);
  });

  it("rejects messages from other extensions/sources", () => {
    expect(isEnvelope({ source: "some-other-extension", payload: {} })).toBe(false);
    expect(isEnvelope({ payload: {} })).toBe(false);
    expect(isEnvelope(null)).toBe(false);
    expect(isEnvelope("not an object")).toBe(false);
  });
});
