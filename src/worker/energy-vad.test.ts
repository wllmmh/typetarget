import { describe, expect, it } from "vitest";
import { EnergyVad } from "./energy-vad";

const silentFrame = (length = 160): Float32Array => new Float32Array(length); // all zeros
const loudFrame = (length = 160, amplitude = 0.5): Float32Array => new Float32Array(length).fill(amplitude);

describe("EnergyVad", () => {
  it("starts in silence", () => {
    const vad = new EnergyVad();
    expect(vad.getState()).toBe("silence");
  });

  it("does not fire speech-start until the hold window elapses", () => {
    const vad = new EnergyVad({ energyThreshold: 0.02, speechHoldMs: 150, silenceHoldMs: 500 });

    expect(vad.processFrame(loudFrame(), 0)).toBeNull();
    expect(vad.getState()).toBe("silence");
    expect(vad.processFrame(loudFrame(), 100)).toBeNull();
    expect(vad.processFrame(loudFrame(), 160)).toEqual({ type: "speech-start", timestamp: 160 });
    expect(vad.getState()).toBe("speech");
  });

  it("does not fire speech-end until the silence hold window elapses", () => {
    const vad = new EnergyVad({ energyThreshold: 0.02, speechHoldMs: 0, silenceHoldMs: 500 });
    vad.processFrame(loudFrame(), 0); // enters speech immediately (speechHoldMs: 0)
    expect(vad.getState()).toBe("speech");

    expect(vad.processFrame(silentFrame(), 100)).toBeNull();
    expect(vad.getState()).toBe("speech");
    expect(vad.processFrame(silentFrame(), 600)).toEqual({ type: "speech-end", timestamp: 600 });
    expect(vad.getState()).toBe("silence");
  });

  it("does not fragment an utterance on a brief dip below threshold", () => {
    const vad = new EnergyVad({ energyThreshold: 0.02, speechHoldMs: 0, silenceHoldMs: 500 });
    vad.processFrame(loudFrame(), 0);
    expect(vad.getState()).toBe("speech");

    // Brief dip, shorter than silenceHoldMs.
    vad.processFrame(silentFrame(), 100);
    vad.processFrame(loudFrame(), 200);

    expect(vad.getState()).toBe("speech");
  });

  it("reset() clears state and hold timers", () => {
    const vad = new EnergyVad({ energyThreshold: 0.02, speechHoldMs: 0, silenceHoldMs: 500 });
    vad.processFrame(loudFrame(), 0);
    expect(vad.getState()).toBe("speech");

    vad.reset();
    expect(vad.getState()).toBe("silence");

    // Hold timers should restart from scratch, not resume from before reset.
    expect(vad.processFrame(loudFrame(), 1000)).toEqual({ type: "speech-start", timestamp: 1000 });
  });
});
