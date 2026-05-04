/**
 * Per-request async context.
 *
 * The MCP streamable-http transport gives each connected client a UUID
 * (`transport.sessionId`). Tool handlers (e.g., `session/start`) need to
 * know that ID so the bridge can bind a freshly-created bridge session to
 * the underlying HTTP transport. When the transport's `onclose` later
 * fires (Claude Code process exits, network drops, etc.), the bridge
 * looks up sessions by that ID and tears them down automatically — no
 * more orphaned sessions waiting for a 24-hour health timeout.
 *
 * Implementation: `AsyncLocalStorage` populated in `index.ts` around each
 * call to `transport.handleRequest()`. Any code path inside that call
 * (sync or async) can read the current HTTP session ID via
 * `getCurrentHttpSessionId()`. Code outside an HTTP request (e.g., the
 * stdio transport, the poller) gets `undefined` and skips the binding.
 */

import { AsyncLocalStorage } from "node:async_hooks";

interface RequestContext {
  httpSessionId?: string;
}

const _als = new AsyncLocalStorage<RequestContext>();

/**
 * Run `fn` inside a request-scoped context. The given `httpSessionId`
 * (may be undefined for non-HTTP transports) is available to any code
 * called from inside `fn` via `getCurrentHttpSessionId()`.
 */
export function runWithHttpContext<T>(
  httpSessionId: string | undefined,
  fn: () => T,
): T {
  return _als.run({ httpSessionId }, fn);
}

/**
 * Read the HTTP session ID for the current request, if any. Returns
 * undefined when called outside an HTTP request (stdio, scheduled jobs,
 * polling loops, etc.).
 */
export function getCurrentHttpSessionId(): string | undefined {
  return _als.getStore()?.httpSessionId;
}
