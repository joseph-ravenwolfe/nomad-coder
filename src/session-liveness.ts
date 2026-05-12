/**
 * Server-driven liveness pings for the Monitor-pattern v8 session model.
 *
 * **Why this exists.** In v8 the bridge stopped requiring agents to
 * long-poll `dequeue` — instead each session gets a per-session heartbeat
 * file the agent watches via `tail -F`. The bridge appends a byte on every
 * real event, the agent's Monitor wakes, the agent drains. This is great
 * for cost (an idle session spends ~0 cycles waiting), but it removed the
 * one bit of state we used to detect "agent silently gone" — frequent
 * `lastPollAt` updates from the long-poll loop.
 *
 * The v8 design tried to lean on the HTTP transport's `onclose` event as
 * the canonical disconnect signal, with a 24-hour health threshold as a
 * long-tail safety net. In practice `onclose` doesn't fire reliably (TCP
 * close not flushed on a forced agent exit, network blip without proper
 * shutdown, intermediate proxies holding the connection open). Operators
 * went hours without learning a worker was offline.
 *
 * **What this module does.** Every {@link LIVENESS_PING_INTERVAL_MS} we
 * find sessions whose `lastPollAt` is older than {@link LIVENESS_PING_AFTER_QUIET_MS}
 * and append a single `tick\n` to their watch file — the same on-disk
 * mechanism the regular event-delivery path uses. A live agent reacts to
 * the watch-file write within seconds (Monitor → dequeue), which calls
 * `touchSession()` and refreshes `lastPollAt`. A dead agent's `lastPollAt`
 * stays frozen; the health check then catches up at its lowered threshold
 * and (now) escalates to `closeSessionById`, posting the "disconnected"
 * service message.
 *
 * **Why ping only quiet sessions.** Active sessions with real events get
 * watch-file writes "for free" from `enqueueAndPing` in `session-queue.ts`,
 * so they already refresh `lastPollAt` constantly. Pinging them on a timer
 * would add CC TUI noise (an extra "Monitor event: tick" line per cycle)
 * without changing the liveness signal. By only pinging sessions that
 * have been quiet for ~90 s, the cost stays at roughly one tick per quiet
 * session per cycle, and active sessions see zero extra wakes.
 *
 * The interval is deliberately faster than the health-check tier so that
 * a healthy-but-idle session gets touched at least once before its
 * `lastPollAt` drifts past the unhealthy-threshold.
 */

import { appendFileSync } from "node:fs";
import { listSessions, getSession } from "./session-manager.js";

/** How often the liveness pinger runs. */
export const LIVENESS_PING_INTERVAL_MS = 90_000;

/**
 * Minimum quiet duration before a session is pinged. Sessions that
 * recently dequeued (real event or a previous ping) don't need to be
 * woken again. Set slightly below the interval so a session can be
 * pinged on consecutive ticks if it never responds.
 */
export const LIVENESS_PING_AFTER_QUIET_MS = 90_000;

let _intervalHandle: ReturnType<typeof setInterval> | undefined;

/** Append a single `tick\n` to a session's watch file. Best-effort. */
function writeLivenessByte(watchFile: string, sid: number): void {
  try {
    appendFileSync(watchFile, "tick\n");
  } catch (err) {
    process.stderr.write(
      `[liveness] write failed sid=${sid} file=${watchFile} err=${(err as Error).message}\n`,
    );
  }
}

/**
 * Walk every active session; for each, if quiet for longer than
 * {@link LIVENESS_PING_AFTER_QUIET_MS}, append a heartbeat byte to its
 * watch file. Exposed for tests; the running bridge invokes this on a
 * timer (see {@link startLivenessPings}).
 */
export function runLivenessPingNow(now: number = Date.now()): void {
  const quietCutoff = now - LIVENESS_PING_AFTER_QUIET_MS;
  for (const info of listSessions()) {
    const sess = getSession(info.sid);
    if (!sess || !sess.watchFile) continue;

    // Decide quietness on lastPollAt when present. Sessions that have
    // never polled (just-connected agents) fall back to createdAt — we
    // want to give them a wake-up signal too, in case Monitor is set up
    // before the SessionStart hook has run a dequeue.
    const lastSeenMs =
      sess.lastPollAt ?? new Date(sess.createdAt).getTime();
    if (!Number.isFinite(lastSeenMs)) continue;

    if (lastSeenMs > quietCutoff) continue; // recently active — skip
    writeLivenessByte(sess.watchFile, info.sid);
  }
}

/**
 * Start the periodic liveness pinger. Safe to call multiple times — a
 * second call replaces the existing timer.
 */
export function startLivenessPings(
  intervalMs: number = LIVENESS_PING_INTERVAL_MS,
): void {
  stopLivenessPings();
  _intervalHandle = setInterval(() => { runLivenessPingNow(); }, intervalMs);
  // Don't keep the event loop alive just for liveness — the HTTP server
  // and other timers anchor the process lifetime.
  _intervalHandle.unref();
}

/** Stop the liveness pinger. */
export function stopLivenessPings(): void {
  if (_intervalHandle !== undefined) {
    clearInterval(_intervalHandle);
    _intervalHandle = undefined;
  }
}

/** For tests: returns whether the timer is currently armed. */
export function _isLivenessPingerRunning(): boolean {
  return _intervalHandle !== undefined;
}
