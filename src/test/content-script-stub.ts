/**
 * Stand-in for @crxjs/vite-plugin's `?script&iife` import transform, which only runs
 * inside `vite build`/`vite dev` (see vite.config.ts) — Vitest's own Vite pipeline
 * doesn't load the crx plugin, so the real specifier is unresolvable under test.
 * The real transform's contract is "resolves to a string: the built file's path"
 * (see node_modules/@crxjs/vite-plugin/client.d.ts); this reproduces exactly that
 * contract with a fixed path, so code under test that imports the real specifier can
 * be aliased to this file instead (see vitest.config.ts resolve.alias).
 */
export default "src/content/main.js";
