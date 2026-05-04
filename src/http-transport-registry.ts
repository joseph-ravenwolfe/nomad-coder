/**
 * Registry of currently-live HTTP transports keyed by MCP session UUID.
 *
 * The streamable-http transport assigns each connected client a UUID
 * (`transport.sessionId`) on initialize and clears it via `onclose`. This
 * registry is the canonical source of truth for "is HTTP session X still
 * connected right now?".
 *
 * Two consumers:
 *   1. `index.ts` — owns the lifecycle: `set()` on init, `delete()` on close,
 *      and routes inbound requests via `get()`.
 *   2. `session/start.ts` (handleSessionReconnect) — uses
 *      `isHttpSessionLive()` to refuse a reconnect when the existing bridge
 *      session is already bound to a *different* live HTTP transport
 *      (i.e., a parallel `cc` session is online and owns it). Reconnect is
 *      strictly for re-attaching when the original agent is gone.
 *
 * Extracted into its own module to avoid a circular import between
 * `src/index.ts` (entry point that wires tools) and `src/tools/session/start.ts`
 * (which now needs the liveness probe).
 */

import type { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

export const httpTransports = new Map<string, StreamableHTTPServerTransport>();

/**
 * Returns true iff there is a live `StreamableHTTPServerTransport` registered
 * under the given HTTP session UUID. Used by `handleSessionReconnect` to
 * detect "another agent is still online" before allowing a reconnect.
 */
export function isHttpSessionLive(httpSessionId: string | undefined): boolean {
  if (!httpSessionId) return false;
  return httpTransports.has(httpSessionId);
}
