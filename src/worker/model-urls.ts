import type { ModelSource } from "./model-downloader";

/** GGML model mirror used by whisper.cpp's own download script (see docs/whisper-wasm-provenance.md). */
export const MODEL_URLS: ModelSource = {
  "tiny.en": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
  "tiny.en-q5_1": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en-q5_1.bin",
  "base.en": "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
};
