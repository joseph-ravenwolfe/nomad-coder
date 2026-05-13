import { toResult, toError } from "../../telegram.js";
import { findSessionsByCcId } from "../../session-manager.js";
import { closeSessionById } from "../../session-teardown.js";
import { refreshGovernorCommand } from "../../built-in-commands.js";

/**
 * Close the bridge session(s) bound to a given Claude Code session UUID.
 *
 * **Why no token.** The SessionEnd hook in `hooks/handlers/session-end.sh`
 * runs in a child shell of the exiting Claude Code process. The hook has
 * the CC `session_id` (via JSON stdin) but does **not** have the bridge
 * token — that lives only in the agent's MCP runtime context. So this
 * action is authenticated by knowledge of the CC session UUID, which is a
 * per-process secret that's already accepted as a CC trust boundary.
 *
 * **Why we need it.** Pre-existing close paths:
 *   1. `session/close` (agent calls it) — agent must have its token, which
 *      it can't read inside an exit hook.
 *   2. MCP HTTP transport `onclose` — fires on clean disconnects but
 *      historically late or not at all on forced exits. This was the
 *      observation that motivated the v8 liveness pinger; we'd rather solve
 *      the root cause cleanly than paper over it with periodic noise.
 *
 * The SessionEnd hook fires on `/exit`, Ctrl-C, `/clear`, logout, and
 * resume — all the clean termination paths. Crashes (segfault, OOM,
 * kill -9) still bypass it; those are caught by the slow long-tail health
 * check in `health-check.ts`.
 *
 * Idempotent: returns `{ closed: false, reason: "not_found" }` if no
 * session matches.
 */
export function handleCloseSessionByCcId({
  cc_session_id,
}: {
  cc_session_id?: string;
}) {
  if (!cc_session_id || typeof cc_session_id !== "string") {
    return toError({
      code: "MISSING_CC_SESSION_ID",
      message: "cc_session_id is required.",
    });
  }

  const matches = findSessionsByCcId(cc_session_id);
  if (matches.length === 0) {
    return toResult({
      closed: false,
      reason: "not_found",
      cc_session_id,
    });
  }

  const closed: Array<{ sid: number; closed: boolean }> = [];
  for (const sid of matches) {
    const result = closeSessionById(sid);
    closed.push({ sid, closed: result.closed });
  }
  void refreshGovernorCommand();

  return toResult({
    closed: closed.some((c) => c.closed),
    sessions: closed,
    cc_session_id,
  });
}
