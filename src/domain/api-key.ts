/**
 * API keys for network transcription providers, shared so the popup's "API Keys" dialog
 * and the service worker's validation cannot drift apart (same reason as tuning.ts).
 *
 * Deliberately broader than EngineProvider (models.ts): the popup's dialog offers a
 * field for Groq before any engine exists to route to it (see models.ts's EngineProvider
 * comment), so a key entered early for a not-yet-wired-up provider isn't lost.
 */

export type ApiKeyProvider = "gemini-live";

export const API_KEY_PROVIDER_NAMES: Record<ApiKeyProvider, string> = {
  "gemini-live": "Gemini",
  // groq: "Groq",
};

/** Short enough to catch an obvious mistake (a stray character, a whitespace-only
 * paste), long enough not to reject a real key. Deliberately not asserting any one
 * provider's exact format (e.g. a fixed prefix/length) - that isn't ours to know, and
 * getting it wrong would reject a real key rather than catch a fake one. */
export const API_KEY_MIN_LENGTH = 8;

export const isPlausibleApiKey = (key: string): boolean => key.trim().length >= API_KEY_MIN_LENGTH;
