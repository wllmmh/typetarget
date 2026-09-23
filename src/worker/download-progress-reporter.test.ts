import { describe, expect, it, vi } from "vitest";
import { createDownloadProgressReporter } from "./download-progress-reporter";

describe("createDownloadProgressReporter", () => {
  it("reports once per whole percent instead of once per chunk", () => {
    const emit = vi.fn();
    const report = createDownloadProgressReporter(emit);

    // 1000 chunks of 100 bytes over a 100 kB total: one call per percent (0..100), not 1000.
    for (let i = 1; i <= 1000; i++) report({ receivedBytes: i * 100, totalBytes: 100_000 });

    expect(emit).toHaveBeenCalledTimes(101);
  });

  it("always reports the final chunk, so the UI can't be left just short of complete", () => {
    const emit = vi.fn();
    const report = createDownloadProgressReporter(emit);

    report({ receivedBytes: 999, totalBytes: 1000 }); // 99%
    report({ receivedBytes: 1000, totalBytes: 1000 }); // still 100 -> but complete

    expect(emit).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenLastCalledWith({ receivedBytes: 1000, totalBytes: 1000 });
  });

  it("reports every chunk when the total size is unknown", () => {
    const emit = vi.fn();
    const report = createDownloadProgressReporter(emit);

    report({ receivedBytes: 10, totalBytes: 0 });
    report({ receivedBytes: 20, totalBytes: 0 });

    expect(emit).toHaveBeenCalledTimes(2);
  });
});
