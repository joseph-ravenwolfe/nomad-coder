import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getApi, toResult, toError, resolveChat } from "../../telegram.js";
import { markdownToV2 } from "../../markdown.js";
import type { TimelineEvent } from "../../message-store.js";
import { dequeue, registerCallbackHook, clearCallbackHook } from "../../message-store.js";
import { createSession, closeSession, setActiveSession, listSessions, activeSessionCount, getSession, setSessionAnnouncementMessage, getSessionAnnouncementMessage } from "../../session-manager.js";
import { getCurrentHttpSessionId } from "../../request-context.js";
import { createSessionQueue, removeSessionQueue, deliverServiceMessage, trackMessageOwner, deliverReminderEvent, getSessionQueue } from "../../session-queue.js";
import { setGovernorSid, getGovernorSid } from "../../routing-mode.js";
import { SERVICE_MESSAGES } from "../../service-messages.js";
import { runInSessionContext } from "../../session-context.js";
import { refreshGovernorCommand } from "../../built-in-commands.js";
import { checkAndConsumeAutoApprove } from "../../auto-approve.js";
import { startPoller, isPollerRunning } from "../../poller.js";
import { fireStartupReminders, buildReminderEvent } from "../../reminder-state.js";
import { registerPendingApproval, clearPendingApproval, isDelegationEnabled, setDelegationEnabled } from "../../agent-approval.js";
import type { ApprovalDecision } from "../../agent-approval.js";

const APPROVAL_TIMEOUT_MS = 120_000;
const APPROVAL_NO = "approve_no";
const APPROVAL_YES = "approve_yes";
const TOGGLE_DELEGATION = "approve_toggle_delegation";

/**
 * Build the inline keyboard for the approval dialog. Two rows:
 *   [✅ Approve, ⛔ Deny]
 *   [delegation toggle]    (only when delegation system enabled in config)
 *
 * Since v8 the operator no longer picks a session tag emoji — it's auto-
 * assigned from the configured pool when the session is created.
 */
function buildApprovalKeyboard(
  delegationEnabled: boolean,
): { inline_keyboard: Record<string, unknown>[][] } {
  const approveButton: Record<string, unknown> = {
    text: "✅ Approve",
    callback_data: APPROVAL_YES,
    style: "primary",
  };
  const denyButton: Record<string, unknown> = {
    text: "⛔ Deny",
    callback_data: APPROVAL_NO,
    style: "danger",
  };
  const toggleButton: Record<string, unknown> = delegationEnabled
    ? { text: "✅ Delegated", callback_data: TOGGLE_DELEGATION }
    : { text: "☐ Delegate", callback_data: TOGGLE_DELEGATION };
  return { inline_keyboard: [[approveButton, denyButton], [toggleButton]] };
}

/**
 * Send an operator approval prompt for a new session. Two buttons: Approve
 * or Deny. The session's tag emoji is auto-assigned at creation time —
 * the operator does not pick one. Returns { approved: true } on approval
 * or { approved: false } on denial / timeout.
 *
 * `colorHint` is preserved on the function signature for backward compat
 * with the agent_approval module; it is no longer used in the UI.
 */
async function requestApproval(
  chatId: number,
  name: string,
  reconnect = false,
  colorHint?: string,
): Promise<{ approved: boolean; color?: string; forceColor?: boolean }> {
  const label = reconnect ? "Session reconnecting:" : "New session requesting access:";
  const reconnectHint = reconnect ? `\nThe agent may have a saved token — approve only if token recovery failed\\.` : "";
  const text = `*${label}* ${markdownToV2(name)}${reconnectHint}`;
  if (checkAndConsumeAutoApprove()) {
    return { approved: true };
  }
  const sent = await getApi().sendMessage(chatId, text, {
    parse_mode: "MarkdownV2",
    reply_markup: buildApprovalKeyboard(isDelegationEnabled()),
  } as Record<string, unknown>);
  const msgId: number = sent.message_id;

  const decision = await new Promise<ApprovalDecision>((resolve) => {
    let resolved = false;
    const resolveOnce = (value: ApprovalDecision) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      clearCallbackHook(msgId);
      resolve(value);
    };
    const ticket = registerPendingApproval(name, resolveOnce, colorHint);
    const timer = setTimeout(() => {
      clearPendingApproval(ticket);
      resolveOnce({ approved: false });
    }, APPROVAL_TIMEOUT_MS);

    // Notify governor of pending approval
    const governorSid = getGovernorSid();
    if (governorSid) {
      deliverServiceMessage(
        governorSid,
        `**Pending approval:**\n**Session:** ${name}\n**Ticket:** ${ticket}\n**Action:** action(type: 'approve', token: <your_token>, ticket: ${ticket})`,
        "pending_approval",
        { name, ticket },
      );
    }

    const handler = (evt: TimelineEvent) => {
      const data: string = evt.content.data ?? "";
      const qid = evt.content.qid;
      if (data === TOGGLE_DELEGATION) {
        // Re-register hook for next click (one-shot: must re-register after each fire)
        registerCallbackHook(msgId, handler);
        setDelegationEnabled(!isDelegationEnabled());
        getApi()
          .editMessageReplyMarkup(chatId, msgId, {
            reply_markup: buildApprovalKeyboard(isDelegationEnabled()),
          } as Record<string, unknown>)
          .catch(() => {});
        if (qid) getApi().answerCallbackQuery(qid).catch(() => {});
        return;
      }
      clearPendingApproval(ticket);
      if (qid) getApi().answerCallbackQuery(qid).catch(() => {});
      if (data === APPROVAL_YES) {
        resolveOnce({ approved: true });
      } else {
        // APPROVAL_NO or anything unexpected → deny
        resolveOnce({ approved: false });
      }
    };
    registerCallbackHook(msgId, handler);
  });

  // Delete the prompt on approval (it's private UI — a public broadcast is
  // sent separately). On denial, edit in-place to show the outcome.
  if (decision.approved) {
    await getApi().deleteMessage(chatId, msgId).catch(() => {});
  } else {
    await getApi().editMessageText(
      chatId,
      msgId,
      `💻 *Session denied:* ${markdownToV2(name)}`,
      { parse_mode: "MarkdownV2" },
    ).catch(() => {});
  }

  return decision;
}

const DESCRIPTION =
  "Call once at the start of every session. Creates a fresh session " +
  "with a unique ID and token. Fresh sessions auto-drain pending messages. " +
  "If you lost your token (e.g. after compaction wiped it from working memory), " +
  "just call this again with the same name — the bridge recognizes your HTTP " +
  "transport and returns your existing token (action: 'recovered'). No operator " +
  "approval needed; queued messages are preserved (pending > 0 if any landed " +
  "during the lapse). " +
  "Returns { token, sid, suffix, sessions_active, action, pending }. " +
  "Call help() first to load the API guide, then call action(type: 'session/start', ...) to join.";

export async function handleSessionStart({ name, color }: { name: string; color?: string }) {
      const chatId = resolveChat();
      if (typeof chatId !== "number") return toError(chatId);

      const isFirstSession = activeSessionCount() === 0;

      // Default name for the first session; trim before any validation
      const trimmedName = name.trim();
      const effectiveName = isFirstSession && !trimmedName ? "Primary" : trimmedName;

      // Second+ sessions must provide a name
      if (!isFirstSession && !effectiveName) {
        return toError({
          code: "NAME_REQUIRED",
          message: "A name is required when starting a second or later session. Pass name: \"<YourName>\" to action(type: 'session/start', ...).",
        });
      }

      // Names must be alphanumeric (letters, digits, spaces only)
      if (effectiveName && !/^[a-zA-Z0-9 ]+$/.test(effectiveName)) {
        return toError({
          code: "INVALID_NAME",
          message: `Session name "${effectiveName}" contains invalid characters. Use letters, digits, and spaces only.`,
        });
      }

      // Name collision handling. Two outcomes:
      //
      // (a) SAME-TRANSPORT IDEMPOTENT RECOVERY: if the existing session was
      //     created on the same MCP HTTP transport that's making this call,
      //     it's the same agent re-asking — almost certainly because compaction
      //     wiped its working memory and it lost its token. Silently return
      //     the existing session's token, sid, watch_file, etc. with
      //     `action: "recovered"` and `pending: <queue size>` (no drain — the
      //     agent will dequeue normally and pick up anything that landed
      //     during the lapse). No operator approval, no chat noise.
      //
      // (b) DIFFERENT-TRANSPORT COLLISION: a parallel `cc` is trying to claim
      //     a name owned by a live agent. Refuse with NAME_CONFLICT and
      //     suggest a unique-suffix name. The HTTP UUID survives compaction
      //     (it's held by the OS process's MCP client, not by the LLM
      //     context), so this guard reliably distinguishes "same agent
      //     forgot" from "different agent intruding."
      const currentHttpId = getCurrentHttpSessionId();
      if (effectiveName) {
        const existingSummary = listSessions().find(
          s => s.name.toLowerCase() === effectiveName.toLowerCase(),
        );
        if (existingSummary) {
          const existing = getSession(existingSummary.sid);
          if (
            existing &&
            // Both undefined (stdio) OR both the same UUID → same agent
            existing.httpSessionId === currentHttpId
          ) {
            // (a) Same-transport idempotent recovery.
            const queue = getSessionQueue(existing.sid);
            const pending = queue?.pendingCount() ?? 0;
            const recoveredToken = existing.sid * 1_000_000 + existing.suffix;
            const fellow = listSessions().filter(s => s.sid !== existing.sid);
            process.stderr.write(
              `[session/start] same-transport recovery sid=${existing.sid} name=${existing.name} pending=${pending}\n`,
            );
            const recovered: Record<string, unknown> = {
              token: recoveredToken,
              sid: existing.sid,
              suffix: existing.suffix,
              sessions_active: activeSessionCount(),
              action: "recovered",
              pending,
              discarded: 0,
              fellow_sessions: fellow,
              connection_token: existing.connectionToken,
              ...(existing.watchFile !== undefined && { watch_file: existing.watchFile }),
            };
            return toResult(recovered);
          }
          // (b) Different-transport collision.
          return toError({
            code: "NAME_CONFLICT",
            message:
              `Session name '${existingSummary.name}' is already in use by an active session (SID ${existingSummary.sid}) on a different agent. ` +
              `Pick a unique name (e.g. '${effectiveName}2', '${effectiveName}3', ...) and retry session/start.`,
          });
        }
      }

      // Approval gate: second+ sessions require operator approval
      let chosenColor: string | undefined = color;
      let decision: { approved: boolean; color?: string; forceColor?: boolean } | undefined;
      if (!isFirstSession) {
        decision = await runInSessionContext(0, () =>
          requestApproval(chatId, effectiveName, false, color),
        );
        if (!decision.approved) {
          return toError({
            code: "SESSION_DENIED",
            message: `Session "${effectiveName}" was denied by the operator.`,
          });
        }
        // If the approval flow returned a color (legacy color-picker path or
        // auto-approve override), use it; otherwise fall back to the agent's
        // hint. The session-manager validates against the active pool.
        if (decision.color !== undefined) chosenColor = decision.color;
      }

      // forceColor = true when the approval flow definitively assigned a color
      // (e.g. legacy operator color-pick). In v8 the operator no longer picks,
      // so this is almost always false — the agent's hint is treated as a
      // suggestion and the session-manager auto-assigns from the pool.
      // httpSessionId binds the bridge session to the current MCP HTTP transport so
      // the streamable-http onclose handler can auto-clean up when Claude Code exits.
      const httpSessionId = getCurrentHttpSessionId();
      const session = createSession(effectiveName, chosenColor, decision?.forceColor ?? false, httpSessionId);
      createSessionQueue(session.sid);
      setActiveSession(session.sid);
      if (!isPollerRunning()) startPoller();

      try {
        // Auto-drain any pending messages (always start fresh)
        let discarded = 0;
        while (dequeue() !== undefined) discarded++;

        const sessionToken = session.sid * 1_000_000 + session.suffix;
        const res: Record<string, unknown> = {
          token: sessionToken,
          sid: session.sid,
          suffix: session.suffix,
          sessions_active: session.sessionsActive,
          action: "fresh",
          pending: 0,
          discarded,
          fellow_sessions: [] as unknown[],
          // connection_token: UUID assigned to this session start instance.
          // Pass it on every dequeue call to enable duplicate-session detection.
          // The bridge alerts the governor (without rejecting) if two callers
          // share the same SID/suffix but present different connection tokens.
          connection_token: session.connectionToken,
          // watch_file: absolute path to the per-session heartbeat file the
          // bridge appends to whenever a new event lands in this session's
          // queue. Wire `Monitor({command: "tail -F <path>", persistent: true})`
          // to wake on new events; call `dequeue({max_wait: 0})` to drain.
          // Replaces the v7 long-poll dequeue pattern. Undefined if FS alloc failed.
          ...(session.watchFile !== undefined && { watch_file: session.watchFile }),
        };
        if (isFirstSession) {
          // First session is the governor by default
          setGovernorSid(session.sid);
          // Send visible announcement with name tag — same format as 2nd+ sessions.
          // buildHeader() intentionally skips single-session mode; compose inline.
          // MarkdownV2: parens are special, must be backslash-escaped.
          const _announcement = await Promise.resolve(
            runInSessionContext(session.sid, () =>
              getApi().sendMessage(
                chatId,
                `💻 *${markdownToV2(effectiveName)}* connected \\(Session ${session.sid}\\)`,
                { parse_mode: "MarkdownV2" },
              ),
            ),
          ).catch(() => undefined);
          const announcementMsgId = _announcement?.message_id;
          if (announcementMsgId !== undefined) {
            trackMessageOwner(announcementMsgId, session.sid);
            setSessionAnnouncementMessage(session.sid, announcementMsgId);
            // Do NOT pin yet — defer until a second session joins
          }
          deliverServiceMessage(
            session.sid,
            `You are SID ${session.sid}. You are the only active session.`,
            "session_orientation",
            { sid: session.sid, name: effectiveName, ...(announcementMsgId !== undefined && { announcement_message_id: announcementMsgId }) },
          );
          deliverServiceMessage(session.sid, SERVICE_MESSAGES.ONBOARDING_TOKEN_SAVE);
          // First session is always governor — no ternary needed.
          deliverServiceMessage(session.sid, SERVICE_MESSAGES.ONBOARDING_ROLE_GOVERNOR);
          if (discarded === 0) deliverServiceMessage(session.sid, SERVICE_MESSAGES.ONBOARDING_NO_PENDING_YET);
        } else if (session.sessionsActive > 1) {
          const allSessions = listSessions();
          res.fellow_sessions = allSessions.filter(s => s.sid !== session.sid);
          if (session.sessionsActive === 2) {
            // Fresh joiners use lowest-SID heuristic (original session is the anchor).
            const governorSid = Math.min(...allSessions.map(s => s.sid));
            setGovernorSid(governorSid);
          }

          // Broadcast a visible announcement so the operator (and other
          // sessions) can reply-to-address this session. The new v8 format
          // already includes the bold name in the body, so we pass
          // _skipHeader: true to suppress the proxy's auto-prefix
          // (avoids the redundant "🟨 Worker\n💻 Worker connected ..." stutter).
          // MarkdownV2: parens must be backslash-escaped.
          const _announcement = await Promise.resolve(
            runInSessionContext(session.sid, () =>
              getApi().sendMessage(
                chatId,
                `💻 *${markdownToV2(effectiveName)}* connected \\(Session ${session.sid}\\)`,
                { parse_mode: "MarkdownV2", _skipHeader: true } as Record<string, unknown>,
              ),
            ),
          ).catch(() => undefined);
          const announcementMsgId = _announcement?.message_id;
          if (announcementMsgId !== undefined) {
            trackMessageOwner(announcementMsgId, session.sid);
            setSessionAnnouncementMessage(session.sid, announcementMsgId);
            // When second session joins, retroactively pin the first session's announcement
            if (session.sessionsActive === 2) {
              for (const fellow of allSessions.filter(s => s.sid !== session.sid)) {
                const fellowAnnouncement = getSessionAnnouncementMessage(fellow.sid);
                if (fellowAnnouncement !== undefined) {
                  getApi().pinChatMessage(chatId, fellowAnnouncement, { disable_notification: true }).catch(() => {});
                }
              }
            }
            getApi().pinChatMessage(chatId, announcementMsgId, { disable_notification: true }).catch(() => {});
          }

          // Notify existing sessions and the new session of the join event
          const governorSid = getGovernorSid();
          const governorSession = allSessions.find(s => s.sid === governorSid);
          const governorLabel = governorSession ? `'${governorSession.name}' (SID ${governorSid})` : `SID ${governorSid}`;

          for (const fellow of allSessions.filter(s => s.sid !== session.sid)) {
            const isGovernor = fellow.sid === governorSid;
            const text = isGovernor
              ? SERVICE_MESSAGES.SESSION_JOINED.text(effectiveName, session.sid)
              : SERVICE_MESSAGES.SESSION_JOINED_FELLOW.text(effectiveName, session.sid, governorLabel);
            const eventType = isGovernor
              ? SERVICE_MESSAGES.SESSION_JOINED.eventType
              : SERVICE_MESSAGES.SESSION_JOINED_FELLOW.eventType; // both share "session_joined" — intentional, same bridge event
            deliverServiceMessage(
              fellow.sid,
              text,
              eventType,
              { sid: session.sid, name: effectiveName, governor_sid: governorSid, ...(announcementMsgId !== undefined && { announcement_message_id: announcementMsgId }) },
            );
          }

          // Notify the new session of its role
          const newIsGovernor = session.sid === governorSid;
          const roleNote = newIsGovernor
            ? `You are the governor (SID ${session.sid}). Ambiguous messages will be routed to you. Call help(topic: 'guide') for trust and routing guidance.`
            : `You are SID ${session.sid}. ${governorLabel} is your first escalation point. Ambiguous messages go to them. Call help(topic: 'guide') for trust and routing guidance.`;
          deliverServiceMessage(
            session.sid,
            roleNote,
            "session_orientation",
            { sid: session.sid, name: effectiveName, governor_sid: governorSid, ...(announcementMsgId !== undefined && { announcement_message_id: announcementMsgId }) },
          );
          deliverServiceMessage(session.sid, SERVICE_MESSAGES.ONBOARDING_TOKEN_SAVE);
          // session_orientation already carries role info (governor vs participant) for multi-session.
          // Skip onboarding_role here to avoid duplication.
          if (discarded === 0) deliverServiceMessage(session.sid, SERVICE_MESSAGES.ONBOARDING_NO_PENDING_YET);
        }
        void refreshGovernorCommand();

        // Fire startup reminders for the new session
        const startupFired = runInSessionContext(session.sid, () => fireStartupReminders(session.sid));
        for (const r of startupFired) {
          deliverReminderEvent(session.sid, buildReminderEvent(r));
        }

        return toResult(res);
      } catch (err) {
        // Rollback: clean up orphaned session on failure
        removeSessionQueue(session.sid);
        closeSession(session.sid);
        setActiveSession(0);
        return toError(err);
      }
}

export function register(server: McpServer) {
  server.registerTool(
    "session_start",
    {
      description: DESCRIPTION,
      inputSchema: {
        name: z
          .string()
          .default("")
          .describe(
            "Human-friendly session name, used as topic prefix. " +
            "Encouraged when multiple sessions are active.",
          ),
        color: z
          .string()
          .optional()
          .describe(
            "Optional preferred session-tag emoji from the operator's pool. " +
            "Honored only when the requested emoji is in the active pool and " +
            "no other session currently holds it; otherwise the bridge auto-" +
            "assigns a random unused entry. The operator no longer picks; " +
            "approval is a simple yes/no dialog.",
          ),
      },
    },
    handleSessionStart,
  );
}
