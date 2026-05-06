/** Auto-approve mode for session_start requests. */
export type AutoApproveMode = "none" | "one" | "timed";

interface AutoApproveState {
  mode: AutoApproveMode;
  expiresAt?: number; // ms timestamp, only when mode === "timed"
}

let _state: AutoApproveState = { mode: "none" };
let _timer: ReturnType<typeof setTimeout> | undefined;

/**
 * Returns true when `AUTO_APPROVE_AGENTS` is set to a truthy value (`1` or
 * `true`, case-insensitive). When enabled, all session_start requests are
 * approved unconditionally — bypassing the per-request and timed modes
 * altogether — and the `/approve` panel becomes informational only.
 *
 * Intended for single-operator setups where the approval prompt is just
 * friction (the bridge already gates inbound updates by `ALLOWED_USER_ID`,
 * and every session is the operator's). Not meant for multi-tenant or
 * remote-trust scenarios.
 *
 * Read on every check so launchd config changes take effect on bridge
 * restart without code changes.
 */
export function isPersistentAutoApproveEnabled(): boolean {
  const v = process.env.AUTO_APPROVE_AGENTS;
  if (typeof v !== "string") return false;
  const norm = v.trim().toLowerCase();
  return norm === "1" || norm === "true" || norm === "yes" || norm === "on";
}

/** Activate single-request auto-approve. */
export function activateAutoApproveOne(): void {
  cancelAutoApprove();
  _state = { mode: "one" };
}

const MAX_TIMER_MS = 2_000_000_000;

/** Activate timed auto-approve for `durationMs` milliseconds. */
export function activateAutoApproveTimed(durationMs: number): void {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  cancelAutoApprove();
  _state = { mode: "timed", expiresAt: Date.now() + durationMs };
  const tick = () => {
    const remaining = (_state.expiresAt ?? 0) - Date.now();
    if (remaining > 0) {
      _timer = setTimeout(tick, Math.min(remaining, MAX_TIMER_MS));
      return;
    }
    cancelAutoApprove();
  };
  _timer = setTimeout(tick, Math.min(durationMs, MAX_TIMER_MS));
}

/** Cancel any active auto-approve. */
export function cancelAutoApprove(): void {
  if (_timer !== undefined) {
    clearTimeout(_timer);
    _timer = undefined;
  }
  _state = { mode: "none" };
}

/**
 * Check if a session_start should be auto-approved.
 *
 * When `AUTO_APPROVE_AGENTS` env is set, returns true unconditionally
 * without consuming any per-request "one" token — the env override sits
 * above the per-request and timed modes.
 *
 * Otherwise: consumes a "one" token if active, returns true for active
 * timed mode (expiry-checked), false when no mode is active.
 */
export function checkAndConsumeAutoApprove(): boolean {
  if (isPersistentAutoApproveEnabled()) return true;
  if (_state.mode === "none") return false;
  if (_state.mode === "one") {
    cancelAutoApprove();
    return true;
  }
  if (_state.expiresAt !== undefined && Date.now() >= _state.expiresAt) {
    cancelAutoApprove();
    return false;
  }
  return true;
}

/** Returns the current auto-approve state (for status display). */
export function getAutoApproveState(): Readonly<AutoApproveState> {
  return { ..._state };
}
