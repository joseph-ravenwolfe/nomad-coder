# Docs: Multi-Session Agent Protocol

## Type

Documentation

## Description

Update `docs/behavior.md` and `docs/communication.md` with multi-session rules so agents know how to behave when multiple sessions are active. This is the "agent protocol" — behavioral rules for handling ambiguous messages, name tags, and inter-session awareness.

## What to Add

### behavior.md additions

Under a new `## Multi-Session Behavior` section:

- **Ambiguous message protocol:** When you dequeue a message with `routing: "ambiguous"`, consider whether it's for you based on conversational context. If clearly not for you, use `route_message` to forward. If unsure, handle it — governor is the fallback and it's OK to handle ambiguous messages.
- **Name tag awareness:** In multi-session mode, all your outbound messages will have a `🤖 YourName` header injected automatically. You don't need to add it yourself.
- **Session identity:** Use the name returned by `session_start` in your internal context. Other sessions are listed in `fellow_sessions`.
- **Don't assume you're alone:** When `sessions_active > 1`, another agent may be working in parallel. Coordinate via `route_message` or `send_direct_message` if needed.

### communication.md additions

Under the existing loop flow:

- **Multi-session loop:** Same flow, but check `routing` field on dequeued events. Handle `"targeted"` messages normally. For `"ambiguous"` messages, apply the protocol above.
- **Governor responsibilities:** If you're the governor (session 1), ambiguous messages come to you by default. Triage and route as needed.

## Acceptance Criteria

- [ ] `behavior.md` has a "Multi-Session Behavior" section
- [ ] Ambiguous message protocol documented
- [ ] Name tag behavior documented
- [ ] `communication.md` updated with multi-session loop notes
- [ ] Governor responsibilities documented
- [ ] No markdownlint errors
