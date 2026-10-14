import type { ModelSource } from "./model-downloader";

/**
 * GGML model mirror used by whisper.cpp's own download script (see docs/specs/whisper-wasm-provenance.md),
 * pinned to one commit so the files can't change under the hashes below. Each `sha256` is the
 * file's Git LFS object id, which is its SHA-256 (from the Hugging Face API's file listing).
 */
const MODEL_REPO_COMMIT = "5359861c739e955e79d9a303bcbc70fb988958b1";

const fileUrl = (id: string) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/${MODEL_REPO_COMMIT}/ggml-${id}.bin`;

export const MODEL_FILES: ModelSource = {
  "tiny-q5_1": { url: fileUrl("tiny-q5_1"), sha256: "818710568da3ca15689e31a743197b520007872ff9576237bda97bd1b469c3d7" },
  "tiny-q8_0": { url: fileUrl("tiny-q8_0"), sha256: "c2085835d3f50733e2ff6e4b41ae8a2b8d8110461e18821b09a15c40c42d1cca" },
  "tiny": { url: fileUrl("tiny"), sha256: "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21" },
  "base-q5_1": { url: fileUrl("base-q5_1"), sha256: "422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898" },
  "base-q8_0": { url: fileUrl("base-q8_0"), sha256: "c577b9a86e7e048a0b7eada054f4dd79a56bbfa911fbdacf900ac5b567cbb7d9" },
  "base": { url: fileUrl("base"), sha256: "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe" },
  "small-q5_1": { url: fileUrl("small-q5_1"), sha256: "ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb" },
  "small-q8_0": { url: fileUrl("small-q8_0"), sha256: "49c8fb02b65e6049d5fa6c04f81f53b867b5ec9540406812c643f177317f779f" },
  "small": { url: fileUrl("small"), sha256: "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b" },
  "medium-q5_0": { url: fileUrl("medium-q5_0"), sha256: "19fea4b380c3a618ec4723c3eef2eb785ffba0d0538cf43f8f235e7b3b34220f" },
  "medium-q8_0": { url: fileUrl("medium-q8_0"), sha256: "42a1ffcbe4167d224232443396968db4d02d4e8e87e213d3ee2e03095dea6502" },
  "large-v3-turbo-q5_0": { url: fileUrl("large-v3-turbo-q5_0"), sha256: "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2" },
  "large-v3-turbo-q8_0": { url: fileUrl("large-v3-turbo-q8_0"), sha256: "317eb69c11673c9de1e1f0d459b253999804ec71ac4c23c17ecf5fbe24e259a1" },
  "large-v2-q5_0": { url: fileUrl("large-v2-q5_0"), sha256: "3a214837221e4530dbc1fe8d734f302af393eb30bd0ed046042ebf4baf70f6f2" },
  "large-v3-q5_0": { url: fileUrl("large-v3-q5_0"), sha256: "d75795ecff3f83b5faa89d1900604ad8c780abd5739fae406de19f23ecd98ad1" },
};
