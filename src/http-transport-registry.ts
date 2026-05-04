/**
 * Registry of currently-live HTTP transports keyed by MCP session UUID.
 *
 * The streamable-http transport assigns each connected client a UUID
 * (`transport.sessionId`) on initialize and clears it via `onclose`. This
 * registry is the canonical source of truth for "is HTTP session X still
 * connected right now?".
 *
 * Owned by `index.ts`: `set()` on init, `delete()` on close, `get()` on
 * inbound request routing.
 *
 * `isHttpSessionLive()` is exposed for code paths that need to distinguish
 * "the original agent is still here" from "abandoned binding from a previous
 * connection" — currently used as a diagnostic; the same-transport
 * idempotency check in `session/start.ts` does its own UUID compare.
 */

import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export const httpTransports = new Map<string, StreamableHTTPServerTransport>();

/**
 * Returns true iff there is a live `StreamableHTTPServerTransport` registered
 * under the given HTTP session UUID.
 */
export function isHttpSessionLive(httpSessionId: string | undefined): boolean {
  if (!httpSessionId) return false;
  return httpTransports.has(httpSessionId);
}
