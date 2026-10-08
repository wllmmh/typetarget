import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, type WhisperModelId } from "../domain/models";
import { MODEL_URLS } from "./model-urls";

describe("MODEL_URLS", () => {
  it("points every Whisper model at its own file on the whisper.cpp mirror", () => {
    const whisperIds = Object.values(MODEL_CATALOG)
      .filter((model) => model.provider === "whisper-cpp")
      .map((model) => model.id as WhisperModelId);

    for (const id of whisperIds) {
      expect(MODEL_URLS[id]).toBe(`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${id}.bin`);
    }
    expect(Object.keys(MODEL_URLS).sort()).toEqual([...whisperIds].sort());
  });
});
