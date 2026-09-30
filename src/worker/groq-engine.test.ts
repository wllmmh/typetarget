import { describe, expect, it, vi } from "vitest";
import { GROQ_TRANSCRIPTIONS_URL, GroqEngine } from "./groq-engine";

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const createEngine = (apiKey: string | null, respond: () => Response) => {
  const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => respond());
  const engine = new GroqEngine({ getApiKey: () => apiKey, fetch: fetchFn });
  return { engine, fetchFn };
};

const lastRequest = (fetchFn: ReturnType<typeof createEngine>["fetchFn"]) => {
  const [url, init] = fetchFn.mock.calls.at(-1) ?? [];
  if (!(init?.body instanceof FormData)) throw new Error("expected a multipart body");
  return { url, init, form: init.body };
};

describe("GroqEngine.load", () => {
  it("reports an error and rejects when no API key is set", async () => {
    const { engine } = createEngine(null, () => jsonResponse(200, { text: "" }));

    await expect(engine.load("groq-whisper-large-v3-turbo")).rejects.toThrow(/Groq API key/);
    expect(engine.getStatus()).toMatchObject({ state: "error" });
  });

  it("refuses a model that belongs to another provider", async () => {
    const { engine } = createEngine("gsk_test_key", () => jsonResponse(200, { text: "" }));

    await expect(engine.load("tiny.en")).rejects.toThrow(/non-Groq/);
  });

  it("is ready once a key is set, without contacting the network", async () => {
    const { engine, fetchFn } = createEngine("gsk_test_key", () => jsonResponse(200, { text: "" }));

    await engine.load("groq-whisper-large-v3-turbo");

    expect(engine.getStatus()).toEqual({ state: "ready", modelId: "groq-whisper-large-v3-turbo" });
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe("GroqEngine.transcribe", () => {
  it("uploads the utterance as WAV with the Groq model id and returns the trimmed text", async () => {
    const { engine, fetchFn } = createEngine("gsk_test_key", () => jsonResponse(200, { text: " Hello there. " }));
    await engine.load("groq-whisper-large-v3-turbo");

    const result = await engine.transcribe(new Float32Array(16_000));

    expect(result).toEqual({ text: "Hello there." });
    const { url, init, form } = lastRequest(fetchFn);
    expect(url).toBe(GROQ_TRANSCRIPTIONS_URL);
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ Authorization: "Bearer gsk_test_key" });
    expect(form.get("model")).toBe("whisper-large-v3-turbo");
    expect(form.get("language")).toBe("en");
    const file = form.get("file");
    expect(file).toBeInstanceOf(Blob);
    expect((file as Blob).type).toBe("audio/wav");
    expect((file as Blob).size).toBe(44 + 16_000 * 2);
  });

  it("maps the non-turbo model to Groq's whisper-large-v3", async () => {
    const { engine, fetchFn } = createEngine("gsk_test_key", () => jsonResponse(200, { text: "ok" }));
    await engine.load("groq-whisper-large-v3");

    await engine.transcribe(new Float32Array(160));

    expect(lastRequest(fetchFn).form.get("model")).toBe("whisper-large-v3");
  });

  it("reads the key at request time, so a key changed mid-session is used next", async () => {
    let apiKey = "gsk_first_key";
    const fetchFn = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => jsonResponse(200, { text: "ok" }));
    const engine = new GroqEngine({ getApiKey: () => apiKey, fetch: fetchFn });
    await engine.load("groq-whisper-large-v3-turbo");

    apiKey = "gsk_second_key";
    await engine.transcribe(new Float32Array(160));

    expect(fetchFn.mock.calls.at(-1)?.[1]?.headers).toEqual({ Authorization: "Bearer gsk_second_key" });
  });

  it("explains a rejected key rather than surfacing a bare status", async () => {
    const { engine } = createEngine("gsk_bad_key", () => jsonResponse(401, { error: { message: "Invalid API Key" } }));
    await engine.load("groq-whisper-large-v3-turbo");

    await expect(engine.transcribe(new Float32Array(160))).rejects.toThrow(/rejected the API key/);
  });

  it("surfaces Groq's own error message for other failures", async () => {
    const { engine } = createEngine("gsk_test_key", () => jsonResponse(429, { error: { message: "Rate limit reached" } }));
    await engine.load("groq-whisper-large-v3-turbo");

    await expect(engine.transcribe(new Float32Array(160))).rejects.toThrow("Groq transcription failed: Rate limit reached");
  });

  it("falls back to the HTTP status when the error body is not JSON", async () => {
    const { engine } = createEngine("gsk_test_key", () => new Response("Bad Gateway", { status: 502 }));
    await engine.load("groq-whisper-large-v3-turbo");

    await expect(engine.transcribe(new Float32Array(160))).rejects.toThrow("Groq transcription failed: HTTP 502");
  });

  it("rejects a success response without a text field", async () => {
    const { engine } = createEngine("gsk_test_key", () => jsonResponse(200, { transcript: "hi" }));
    await engine.load("groq-whisper-large-v3-turbo");

    await expect(engine.transcribe(new Float32Array(160))).rejects.toThrow(/unexpected response/);
  });

  it("refuses to transcribe before load", async () => {
    const { engine, fetchFn } = createEngine("gsk_test_key", () => jsonResponse(200, { text: "" }));

    await expect(engine.transcribe(new Float32Array(160))).rejects.toThrow(/not loaded/);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
