import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, type WhisperModelId } from "../domain/models";
import { MODEL_FILES } from "./model-urls";

describe("MODEL_FILES", () => {
  it("points every Whisper model at its own file on the whisper.cpp mirror, pinned to one commit, with a SHA-256", () => {
    const whisperIds = Object.values(MODEL_CATALOG)
      .filter((model) => model.provider === "whisper-cpp")
      .map((model) => model.id as WhisperModelId);

    for (const id of whisperIds) {
      expect(MODEL_FILES[id].url).toMatch(new RegExp(`^https://huggingface\\.co/ggerganov/whisper\\.cpp/resolve/[0-9a-f]{40}/ggml-${id.replace(".", "\\.")}\\.bin$`));
      expect(MODEL_FILES[id].sha256).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(Object.keys(MODEL_FILES).sort()).toEqual([...whisperIds].sort());
  });
});
