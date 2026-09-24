import { describe, expect, it } from "vitest";
import { API_KEY_MIN_LENGTH, isPlausibleApiKey } from "./api-key";

describe("isPlausibleApiKey", () => {
  it("accepts a key at or above the minimum length", () => {
    expect(isPlausibleApiKey("a".repeat(API_KEY_MIN_LENGTH))).toBe(true);
    expect(isPlausibleApiKey("a".repeat(API_KEY_MIN_LENGTH + 10))).toBe(true);
  });

  it("rejects a key shorter than the minimum length", () => {
    expect(isPlausibleApiKey("a".repeat(API_KEY_MIN_LENGTH - 1))).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isPlausibleApiKey("")).toBe(false);
  });

  it("trims surrounding whitespace before measuring length", () => {
    expect(isPlausibleApiKey(`  ${"a".repeat(API_KEY_MIN_LENGTH)}  `)).toBe(true);
    expect(isPlausibleApiKey("   ")).toBe(false);
  });
});
