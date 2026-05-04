Startup — Post-Session-Start

Token: opaque integer returned by session/start. Required for all session-bound calls. Save it now.
Recovery: if token is lost (e.g. compaction wiped it), just call action(type: 'session/start', name: '<same name>') again — the bridge recognizes your HTTP transport and returns the existing token (action: 'recovered'). No separate reconnect verb.
Missed messages: action(type: 'message/history', count: 20) after recovery.

Profile (optional): action(type: 'profile/load', key: '<name>') — restores voice, animation presets, and reminders. Skip if no profile exists.

Next step: help(topic: 'quick_start') → dequeue loop, send basics, DM pattern.

Discover: help() → tool index · help(topic: 'guide') → full comms guide · help(topic: '<tool>') → per-tool docs.
Compression: help(topic: 'compression') → message brevity tiers.
