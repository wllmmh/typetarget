#!/usr/bin/env node
/**
 * Serves the repo root with COOP/COEP headers, required for SharedArrayBuffer /
 * crossOriginIsolated (needed to benchmark bench/libmain-threaded.js — see
 * HANDOFF.md "Lever 1"). A plain static server does not set these headers, and without
 * them a pthreads build fails at runtime the same way it does in the real extension when
 * the manifest keys are missing (see docs/whisper-wasm-provenance.md).
 *
 * Usage: from the repo root, `node bench/serve.mjs [port]` (default 8000), then open
 * http://localhost:<port>/bench/whisper-bench.html
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = process.cwd();
const CONTENT_TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".json": "application/json",
  ".bin": "application/octet-stream",
  ".css": "text/css",
};

const server = createServer(async (req, res) => {
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");

  const requestPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  // Reject any path that escapes ROOT after normalization (e.g. "/../..."), rather than
  // trusting the browser-supplied URL.
  const filePath = normalize(join(ROOT, requestPath));
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403).end("Forbidden");
    return;
  }

  try {
    const resolved = (await stat(filePath)).isDirectory() ? join(filePath, "index.html") : filePath;
    const body = await readFile(resolved);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[extname(resolved)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});

const port = Number(process.argv[2]) || 8000;
server.listen(port, "localhost", () => {
  console.log(`Serving with COOP/COEP headers on http://localhost:${port}/bench/whisper-bench.html`);
});
