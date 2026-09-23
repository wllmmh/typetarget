import { afterEach, describe, expect, it, vi } from "vitest";
import { loadWhisperModuleFactory } from "./whisper-module";

const overrides = { print: vi.fn(), printErr: vi.fn() };

type GlueModule = { print: unknown; printErr: unknown; onRuntimeInitialized: () => void; onAbort: (reason: unknown) => void };
const globalModule = () => (self as unknown as { Module: GlueModule }).Module;

afterEach(() => {
  vi.unstubAllGlobals();
  delete (self as unknown as { Module?: unknown }).Module;
});

describe("loadWhisperModuleFactory", () => {
  it("does not require SharedArrayBuffer (the vendored build is single-threaded)", async () => {
    vi.stubGlobal("SharedArrayBuffer", undefined);
    vi.stubGlobal("importScripts", () => setTimeout(() => globalModule().onRuntimeInitialized(), 0));

    const factory = await loadWhisperModuleFactory("libmain.js");

    await expect(factory(overrides)).resolves.toBeDefined();
  });

  it("presets the global Module with the overrides, then resolves once the runtime is initialized", async () => {
    const importScripts = vi.fn(() => {
      // What the real glue script does: read the pre-populated global, later attach
      // Embind exports to it and call onRuntimeInitialized.
      const module = globalModule();
      expect(module.print).toBe(overrides.print);
      expect(module.printErr).toBe(overrides.printErr);
      setTimeout(() => {
        Object.assign(module, { init: () => 1 });
        module.onRuntimeInitialized();
      }, 0);
    });
    vi.stubGlobal("importScripts", importScripts);

    const factory = await loadWhisperModuleFactory("libmain.js");
    const module = await factory(overrides);

    expect(importScripts).toHaveBeenCalledWith("libmain.js");
    expect(module.init("model")).toBe(1);
  });

  it("imports the glue script only once across factory calls", async () => {
    const importScripts = vi.fn(() => setTimeout(() => globalModule().onRuntimeInitialized(), 0));
    vi.stubGlobal("importScripts", importScripts);

    const factory = await loadWhisperModuleFactory("libmain.js");
    const [first, second] = await Promise.all([factory(overrides), factory(overrides)]);

    expect(importScripts).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);
  });

  it("rejects when the runtime aborts during startup", async () => {
    vi.stubGlobal("importScripts", () => setTimeout(() => globalModule().onAbort("out of memory"), 0));

    const factory = await loadWhisperModuleFactory("libmain.js");

    await expect(factory(overrides)).rejects.toThrow(/aborted: out of memory/);
  });

  it("rejects when the glue script fails to load", async () => {
    vi.stubGlobal("importScripts", () => {
      throw new Error("NetworkError");
    });

    const factory = await loadWhisperModuleFactory("libmain.js");

    await expect(factory(overrides)).rejects.toThrow("NetworkError");
  });

  it("rejects when the runtime fails asynchronously after the script loaded", async () => {
    vi.stubGlobal("importScripts", () => {
      setTimeout(() => {
        const event = new Event("unhandledrejection") as PromiseRejectionEvent;
        Object.assign(event, { reason: "EvalError: unsafe-eval blocked" });
        self.dispatchEvent(event);
      }, 0);
    });

    const factory = await loadWhisperModuleFactory("libmain.js");

    await expect(factory(overrides)).rejects.toThrow(/failed to start: EvalError: unsafe-eval blocked/);
  });
});
