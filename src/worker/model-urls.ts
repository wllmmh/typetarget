import type { ModelSource } from "./model-downloader";

/**
 * GGML model mirror used by whisper.cpp's own download script (see docs/specs/whisper-wasm-provenance.md),
 * pinned to one commit so the files can't change under the hashes below. Each `sha256` is the
 * file's Git LFS object id, which is its SHA-256 (from the Hugging Face API's file listing).
 */
const MODEL_REPO_COMMIT = "5359861c739e955e79d9a303bcbc70fb988958b1";

const fileUrl = (id: string) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REPO_COMMIT}/ggml-${id}.bin`;

export const MODEL_FILES: ModelSource = {
  "tiny.en": { url: fileUrl("tiny.en"), sha256: "921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f" },
  "tiny.en-q5_1": { url: fileUrl("tiny.en-q5_1"), sha256: "c77c5766f1cef09b6b7d47f21b546cbddd4157886b3b5d6d4f709e91e66c7c2b" },
  "base.en": { url: fileUrl("base.en"), sha256: "a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002" },
  "tiny.en-q8_0": { url: fileUrl("tiny.en-q8_0"), sha256: "5bc2b3860aa151a4c6e7bb095e1fcce7cf12c7b020ca08dcec0c6d018bb7dd94" },
  "base.en-q5_1": { url: fileUrl("base.en-q5_1"), sha256: "4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f" },
  "base.en-q8_0": { url: fileUrl("base.en-q8_0"), sha256: "a4d4a0768075e13cfd7e19df3ae2dbc4a68d37d36a7dad45e8410c9a34f8c87e" },
  "small.en-q5_1": { url: fileUrl("small.en-q5_1"), sha256: "bfdff4894dcb76bbf647d56263ea2a96645423f1669176f4844a1bf8e478ad30" },
  "small.en-q8_0": { url: fileUrl("small.en-q8_0"), sha256: "67a179f608ea6114bd3fdb9060e762b588a3fb3bd00c4387971be4d177958067" },
  "small.en": { url: fileUrl("small.en"), sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d" },
  "medium.en-q5_0": { url: fileUrl("medium.en-q5_0"), sha256: "76733e26ad8fe1c7a5bf7531a9d41917b2adc0f20f2e4f5531688a8c6cd88eb0" },
  "medium.en-q8_0": { url: fileUrl("medium.en-q8_0"), sha256: "43fa2cd084de5a04399a896a9a7a786064e221365c01700cea4666005218f11c" },
};
