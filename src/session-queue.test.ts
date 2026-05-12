import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TimelineEvent } from "./message-store.js";
import {
  createSessionQueue,
  removeSessionQueue,
  getSessionQueue,
  sessionQueueCount,
  trackMessageOwner,
  getMessageOwner,
  routeToSession,
  broadcastOutbound,
  notifySessionWaiters,
  pingSessionsHoldingMessage,
  deliverDirectMessage,
  deliverReminderEvent,
  resetSessionQueuesForTest,
  HEARTBEAT_PAYLOAD,
} from "./session-queue.js";
import { createSession, resetSessions } from "./session-manager.js";
import {
  setGovernorSid,
  resetRoutingModeForTest,
} from "./routing-mode.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: 100,
    timestamp: new Date().toISOString(),
    event: "message",
    from: "user",
    content: { type: "text", text: "hello" },
    ...overrides,
  };
}

function replyEvent(replyTo: number, id = 200): TimelineEvent {
  return makeEvent({
    id,
    content: { type: "text", text: "reply", reply_to: replyTo },
  });
}

function callbackEvent(target: number, id = 300): TimelineEvent {
  return makeEvent({
    id,
    event: "callback",
    content: { type: "cb", data: "yes", target },
  });
}

function reactionEvent(target: number, id = 400): TimelineEvent {
  return makeEvent({
    id,
    event: "reaction",
    content: { type: "reaction", target, added: ["👍"] },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session-queue", () => {
  beforeEach(() => {
    resetSessionQueuesForTest();
    resetRoutingModeForTest();
  });

  // -------------------------------------------------------------------------
  // Queue lifecycle
  // -------------------------------------------------------------------------

  describe("queue lifecycle", () => {
    it("creates a queue for a session", () => {
      expect(createSessionQueue(1)).toBe(true);
      expect(getSessionQueue(1)).toBeDefined();
      expect(sessionQueueCount()).toBe(1);
    });

    it("rejects duplicate creation", () => {
      createSessionQueue(1);
      expect(createSessionQueue(1)).toBe(false);
    });

    it("removes a session queue", () => {
      createSessionQueue(1);
      expect(removeSessionQueue(1)).toBe(true);
      expect(getSessionQueue(1)).toBeUndefined();
      expect(sessionQueueCount()).toBe(0);
    });

    it("returns false when removing nonexistent queue", () => {
      expect(removeSessionQueue(99)).toBe(false);
    });

    it("returns undefined for nonexistent session", () => {
      expect(getSessionQueue(42)).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Message ownership
  // -------------------------------------------------------------------------

  describe("message ownership", () => {
    it("tracks and retrieves owner", () => {
      trackMessageOwner(500, 2);
      expect(getMessageOwner(500)).toBe(2);
    });

    it("returns 0 for untracked message", () => {
      expect(getMessageOwner(999)).toBe(0);
    });

    it("ignores sid 0", () => {
      trackMessageOwner(500, 0);
      expect(getMessageOwner(500)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Routing — targeted
  // -------------------------------------------------------------------------

  describe("targeted routing", () => {
    it("routes reply-to to owning session", () => {
      createSessionQueue(1);
      createSessionQueue(2);
      trackMessageOwner(50, 1);
      routeToSession(replyEvent(50));
      expect(getSessionQueue(1)?.pendingCount()).toBe(1);
      expect(getSessionQueue(2)?.pendingCount()).toBe(0);
    });

    it("routes callback to owning session", () => {
      createSessionQueue(1);
      createSessionQueue(2);
      trackMessageOwner(60, 2);
      routeToSession(callbackEvent(60));
      expect(getSessionQueue(1)?.pendingCount()).toBe(0);
      expect(getSessionQueue(2)?.pendingCount()).toBe(1);
    });

    it("routes reaction to owning session", () => {
      createSessionQueue(1);
      createSessionQueue(2);
      trackMessageOwner(70, 1);
      routeToSession(reactionEvent(70));
      expect(getSessionQueue(1)?.pendingCount()).toBe(1);
      expect(getSessionQueue(2)?.pendingCount()).toBe(0);
    });

    it("drops targeted event when owner has no queue", () => {
      createSessionQueue(1);
      trackMessageOwner(80, 3); // session 3 has no queue
      routeToSession(replyEvent(80));
      expect(getSessionQueue(1)?.pendingCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Routing — ambiguous (governor)
  // -------------------------------------------------------------------------

  describe("ambiguous routing", () => {
    it("broadcasts to all sessions when no governor is set", () => {
      createSessionQueue(1);
      createSessionQueue(2);
      routeToSession(makeEvent());
      expect(getSessionQueue(1)?.pendingCount()).toBe(1);
      expect(getSessionQueue(2)?.pendingCount()).toBe(1);
    });

    it("routes to the only session when no governor is set", () => {
      createSessionQueue(1);
      routeToSession(makeEvent({ id: 10 }));
      expect(getSessionQueue(1)?.pendingCount()).toBe(1);
    });

    it("no-ops when no session queues exist", () => {
      routeToSession(makeEvent());
    });

    it("routes to the governor session", () => {
      setGovernorSid(2);
      createSessionQueue(1);
      createSessionQueue(2);
      routeToSession(makeEvent());
      expect(getSessionQueue(1)?.pendingCount()).toBe(0);
      expect(getSessionQueue(2)?.pendingCount()).toBe(1);
    });

    it("broadcasts when governor session has no queue", () => {
      setGovernorSid(99);
      createSessionQueue(1);
      createSessionQueue(2);
      routeToSession(makeEvent());
      // Fallback: broadcast to all
      expect(getSessionQueue(1)?.pendingCount()).toBe(1);
      expect(getSessionQueue(2)?.pendingCount()).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Dequeue from session queue
  // -------------------------------------------------------------------------

  describe("session queue dequeue", () => {
    it("dequeues events from session queue", () => {
      createSessionQueue(1);
      routeToSession(makeEvent({ id: 10 }));
      const q = getSessionQueue(1);
      const evt = q?.dequeue();
      expect(evt?.id).toBe(10);
    });

    it("dequeueBatch drains response + 1 message", () => {
      createSessionQueue(1);
      routeToSession(callbackEvent(0, 10));
      routeToSession(callbackEvent(0, 11));
      routeToSession(makeEvent({ id: 20 }));
      routeToSession(makeEvent({ id: 21 }));
      const q = getSessionQueue(1);
      const batch = q?.dequeueBatch() ?? [];
      expect(batch).toHaveLength(3);
      expect(q?.pendingCount()).toBe(1);
    });

    it("tracks consumed IDs", () => {
      createSessionQueue(1);
      routeToSession(makeEvent({ id: 42 }));
      const q = getSessionQueue(1);
      q?.dequeue();
      expect(q?.isConsumed(42)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Voice patch forwarding
  // -------------------------------------------------------------------------

  describe("notifySessionWaiters", () => {
    it("wakes waiters on all session queues", async () => {
      createSessionQueue(1);
      createSessionQueue(2);
      const q1 = getSessionQueue(1);
      const q2 = getSessionQueue(2);
      const p1 = q1?.waitForEnqueue();
      const p2 = q2?.waitForEnqueue();
      notifySessionWaiters();
      await p1;
      await p2;
      // If we got here, both resolved
    });

    it("waitForEnqueueSince resolves when enqueue happens after version snapshot", async () => {
      createSessionQueue(1);
      const q1 = getSessionQueue(1);
      const version = q1?.getWakeVersion() ?? 0;

      routeToSession(makeEvent({ id: 999 }));

      await q1?.waitForEnqueueSince(version);
      const batch = q1?.dequeueBatch() ?? [];
      expect(batch).toHaveLength(1);
      expect(batch[0]?.id).toBe(999);
    });
  });

  // -------------------------------------------------------------------------
  // pingSessionsHoldingMessage — wakes Monitor watchers post-transcription
  // -------------------------------------------------------------------------

  describe("pingSessionsHoldingMessage", () => {
    let cacheDir: string;
    let prevXdg: string | undefined;

    beforeEach(() => {
      cacheDir = mkdtempSync(join(tmpdir(), "ping-test-"));
      prevXdg = process.env.XDG_CACHE_HOME;
      process.env.XDG_CACHE_HOME = cacheDir;
      resetSessions();
      resetSessionQueuesForTest();
    });

    afterEach(() => {
      if (prevXdg === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = prevXdg;
      try { rmSync(cacheDir, { recursive: true, force: true }); } catch { /* ignore */ }
      resetSessions();
      resetSessionQueuesForTest();
    });

    it("appends a tick to the watch file of the session holding the message", () => {
      const s = createSession("Scout");
      createSessionQueue(s.sid);
      // Enqueue a voice-shaped event so the queue holds messageId=42.
      const evt: TimelineEvent = {
        id: 42,
        timestamp: new Date().toISOString(),
        event: "message",
        from: "user",
        content: { type: "voice", text: undefined },
      };
      routeToSession(evt);
      const watchFile = s.watchFile!;
      // Drain whatever the initial enqueue tick wrote.
      const baselineLen = readFileSync(watchFile, "utf8").length;

      pingSessionsHoldingMessage(42);

      const after = readFileSync(watchFile, "utf8");
      // A single heartbeat line should have been appended.
      expect(after.length).toBe(baselineLen + HEARTBEAT_PAYLOAD.length);
      expect(after.endsWith(HEARTBEAT_PAYLOAD)).toBe(true);
    });

    it("is a no-op when no session queue holds the given message", () => {
      const s = createSession("Scout");
      createSessionQueue(s.sid);
      const watchFile = s.watchFile!;
      const baseline = readFileSync(watchFile, "utf8");

      // No event was routed for messageId=999 — nothing should be appended.
      pingSessionsHoldingMessage(999);

      expect(readFileSync(watchFile, "utf8")).toBe(baseline);
    });

    it("only pings sessions whose queue actually holds the message", () => {
      const a = createSession("A");
      const b = createSession("B");
      createSessionQueue(a.sid);
      createSessionQueue(b.sid);
      // Track ownership so routeToSession routes to A specifically (via reply
      // semantics) — easier to just inject directly.
      const aQueue = getSessionQueue(a.sid)!;
      aQueue.enqueue({
        id: 77,
        timestamp: new Date().toISOString(),
        event: "message",
        from: "user",
        content: { type: "voice", text: undefined },
      });
      const bWatchBefore = readFileSync(b.watchFile!, "utf8");
      const aWatchBefore = readFileSync(a.watchFile!, "utf8");

      pingSessionsHoldingMessage(77);

      // A got the heartbeat; B did not.
      expect(readFileSync(a.watchFile!, "utf8").length).toBe(aWatchBefore.length + HEARTBEAT_PAYLOAD.length);
      expect(readFileSync(b.watchFile!, "utf8")).toBe(bWatchBefore);
    });
  });

  // -------------------------------------------------------------------------
  // Cross-session outbound forwarding (governor-only)
  // -------------------------------------------------------------------------

  describe("broadcastOutbound", () => {
    it("forwards to governor only, skipping other sessions", () => {
      createSessionQueue(1);
      createSessionQueue(2);
      createSessionQueue(3);
      setGovernorSid(2);
      const evt = makeEvent({ id: 500, event: "sent", from: "bot" as const });
      broadcastOutbound(evt, 1);
      expect(getSessionQueue(1)?.pendingCount()).toBe(0); // sender excluded
      expect(getSessionQueue(2)?.pendingCount()).toBe(1); // governor receives
      expect(getSessionQueue(3)?.pendingCount()).toBe(0); // non-governor excluded
    });

    it("no-ops when no governor is set", () => {
      createSessionQueue(1);
      createSessionQueue(2);
      // govSid === 0 → skip
      const evt = makeEvent({ id: 500, event: "sent", from: "bot" as const });
      broadcastOutbound(evt, 1);
      expect(getSessionQueue(1)?.pendingCount()).toBe(0);
      expect(getSessionQueue(2)?.pendingCount()).toBe(0);
    });

    it("no-ops when sender is the governor", () => {
      createSessionQueue(1);
      createSessionQueue(2);
      setGovernorSid(1);
      const evt = makeEvent({ id: 501, event: "sent", from: "bot" as const });
      broadcastOutbound(evt, 1); // sender === governor → skip
      expect(getSessionQueue(1)?.pendingCount()).toBe(0);
      expect(getSessionQueue(2)?.pendingCount()).toBe(0);
    });

    it("no-ops when no sessions exist", () => {
      setGovernorSid(2);
      const evt = makeEvent({ id: 502, event: "sent", from: "bot" as const });
      broadcastOutbound(evt, 1); // governor queue doesn't exist → no-op
    });

    it("wakes governor queue waiter", async () => {
      createSessionQueue(1);
      createSessionQueue(2);
      setGovernorSid(2);
      const q2 = getSessionQueue(2);
      const waiter = q2?.waitForEnqueue();
      const evt = makeEvent({ id: 503, event: "sent", from: "bot" as const });
      broadcastOutbound(evt, 1);
      await waiter;
      // waiter resolved → governor queue woke
    });

    it("no-ops when governor queue does not exist", () => {
      setGovernorSid(99); // governor sid has no queue
      createSessionQueue(1);
      createSessionQueue(2);
      const evt = makeEvent({ id: 504, event: "sent", from: "bot" as const });
      broadcastOutbound(evt, 1);
      expect(getSessionQueue(1)?.pendingCount()).toBe(0);
      expect(getSessionQueue(2)?.pendingCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Ownership cleanup on remove
  // -------------------------------------------------------------------------

  describe("ownership cleanup on removeSessionQueue", () => {
    it("removes ownership entries for the closed session", () => {
      createSessionQueue(1);
      createSessionQueue(2);
      trackMessageOwner(100, 1);
      trackMessageOwner(200, 1);
      trackMessageOwner(300, 2);
      removeSessionQueue(1);
      expect(getMessageOwner(100)).toBe(0);
      expect(getMessageOwner(200)).toBe(0);
      expect(getMessageOwner(300)).toBe(2); // other session untouched
    });

    it("no-ops cleanup when session not found", () => {
      trackMessageOwner(100, 1);
      removeSessionQueue(99); // doesn't exist
      expect(getMessageOwner(100)).toBe(1); // untouched
    });
  });

  // -------------------------------------------------------------------------
  // Direct message delivery
  // -------------------------------------------------------------------------

  describe("deliverDirectMessage", () => {
    it("delivers a DM to the target session queue", () => {
      createSessionQueue(1);
      createSessionQueue(2);
      const delivered = deliverDirectMessage(1, 2, "hello");
      expect(delivered).toBe(true);

      const q = getSessionQueue(2);
      const batch = q?.dequeueBatch() ?? [];
      expect(batch).toHaveLength(1);
      expect(batch[0].event).toBe("direct_message");
      expect(batch[0].content.type).toBe("direct_message");
      expect(batch[0].content.text).toBe("hello");
      expect(batch[0].sid).toBe(1);
    });

    it("returns false when target queue does not exist", () => {
      createSessionQueue(1);
      expect(deliverDirectMessage(1, 99, "hi")).toBe(false);
    });

    it("assigns negative IDs to avoid collision", () => {
      createSessionQueue(2);
      deliverDirectMessage(1, 2, "a");
      deliverDirectMessage(1, 2, "b");

      const q = getSessionQueue(2);
      // DMs are lightweight — both drain in a single batch
      const batch = q?.dequeueBatch() ?? [];
      expect(batch).toHaveLength(2);
      expect(batch[0].id).toBeLessThan(0);
      expect(batch[1].id).toBeLessThan(0);
      expect(batch[0].id).not.toBe(batch[1].id);
    });

    it("does not enqueue to sender", () => {
      createSessionQueue(1);
      createSessionQueue(2);
      deliverDirectMessage(1, 2, "hi");

      const q1 = getSessionQueue(1);
      expect(q1?.dequeueBatch()).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // deliverReminderEvent
  // -------------------------------------------------------------------------

  describe("deliverReminderEvent", () => {
    it("happy path: delivers reminder event into session queue and returns true", () => {
      createSessionQueue(5);
      const reminderEvent = {
        id: -99001,
        event: "reminder",
        from: "system",
        routing: "ambiguous",
        content: {
          type: "reminder",
          text: "Check CI",
          reminder_id: "abc123",
          recurring: false,
          trigger: "startup" as const,
        },
      };

      const result = deliverReminderEvent(5, reminderEvent);

      expect(result).toBe(true);
      const q = getSessionQueue(5);
      const batch = q?.dequeueBatch() ?? [];
      expect(batch).toHaveLength(1);
      expect(batch[0].event).toBe("reminder");
      expect(batch[0].from).toBe("system");
      expect(batch[0].id).toBe(-99001);
      expect(batch[0].content.type).toBe("reminder");
    });

    it("missing queue: returns false when session has no queue", () => {
      // SID 99 has no queue
      const reminderEvent = {
        id: -99002,
        event: "reminder",
        from: "system",
        routing: "ambiguous",
        content: {
          type: "reminder",
          text: "Deploy check",
          reminder_id: "xyz",
          recurring: false,
          trigger: "startup" as const,
        },
      };

      const result = deliverReminderEvent(99, reminderEvent);

      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Reset
  // -------------------------------------------------------------------------

  describe("reset", () => {
    it("clears all queues and ownership", () => {
      createSessionQueue(1);
      trackMessageOwner(100, 1);
      resetSessionQueuesForTest();
      expect(sessionQueueCount()).toBe(0);
      expect(getMessageOwner(100)).toBe(0);
    });
  });

  // ── v8 heartbeat side-effect ────────────────────────────────
  describe("heartbeat write", () => {
    it("appends a heartbeat line to the session's watch file on each enqueue", async () => {
      const { createSession, unlinkWatchFile, getSession } = await import("./session-manager.js");
      const { statSync, existsSync, readFileSync } = await import("node:fs");
      const HEARTBEAT = HEARTBEAT_PAYLOAD;
      const session = createSession("Worker");
      try {
        createSessionQueue(session.sid);
        // Make this session the governor so ambiguous events route to it
        // (the route path goes through enqueueAndPing → file write).
        setGovernorSid(session.sid);
        const wf = getSession(session.sid)?.watchFile;
        expect(wf).toBeDefined();
        expect(existsSync(wf!)).toBe(true);
        expect(statSync(wf!).size).toBe(0);

        routeToSession(makeEvent({ id: 1001 }));
        expect(statSync(wf!).size).toBe(HEARTBEAT.length);
        expect(readFileSync(wf!, "utf8")).toBe(HEARTBEAT);

        routeToSession(makeEvent({ id: 1002 }));
        routeToSession(makeEvent({ id: 1003 }));
        expect(statSync(wf!).size).toBe(HEARTBEAT.length * 3);
        expect(readFileSync(wf!, "utf8")).toBe(HEARTBEAT.repeat(3));
      } finally {
        unlinkWatchFile(session.watchFile);
        removeSessionQueue(session.sid);
      }
    });
  });
});
