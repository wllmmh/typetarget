/**
 * Content script entry: injected on demand via chrome.scripting (activeTab-scoped)
 * rather than declared as a persistent content_scripts entry — see AGENTS.md
 * "Content script permissions". All of the wiring lives in bridge.ts, which is
 * idempotent because this file is re-executed on every injection.
 */
import { installContentBridge } from "./bridge";

installContentBridge();
