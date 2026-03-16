/**
 * Routing mode state for multi-session ambiguous message dispatch.
 *
 * Three modes:
 *   - load_balance — route to the first idle session (lowest SID wins ties)
 *   - cascade      — offer one-at-a-time in priority order (Phase 4)
 *   - governor     — designate one session as classifier (Phase 4)
 *
 * Default: load_balance (simplest, safest). Stored in-memory only;
 * resets on MCP restart.
 */

export type RoutingMode = "load_balance" | "cascade" | "governor";

let _mode: RoutingMode = "load_balance";
let _governorSid = 0;

// ---------------------------------------------------------------------------
// Accessors
// ---------------------------------------------------------------------------

export function getRoutingMode(): RoutingMode {
  return _mode;
}

export function setRoutingMode(mode: RoutingMode, governorSid = 0): void {
  _mode = mode;
  _governorSid = mode === "governor" ? governorSid : 0;
}

export function getGovernorSid(): number {
  return _governorSid;
}

// ---------------------------------------------------------------------------
// Reset (testing only)
// ---------------------------------------------------------------------------

export function resetRoutingModeForTest(): void {
  _mode = "load_balance";
  _governorSid = 0;
}
