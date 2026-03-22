# 054 — Fix save_profile bugs

## Problem

Three bugs in `save_profile` discovered during dogfood testing:

1. **`animation_default` saved unconditionally** — `getDefaultFrames(sid)` falls back to `DEFAULT_FRAMES` when no custom default is set. The save serializes this hardcoded bounce animation into every profile even when the session never customized it.

2. **Reminder GUIDs persisted** — `save_profile` copies `r.id` (the runtime UUID) into the profile. These IDs are meaningless as templates — `load_profile` already generates fresh UUIDs via `r.id ?? crypto.randomUUID()`. Storing old GUIDs is noise.

3. **Checked-in `profiles/Overseer.json` has both bugs** — contains the hardcoded bounce animation and GUID-laden reminders.

## Changes

### A. `src/animation-state.ts`

Export a new function:

```ts
export function hasSessionDefault(sid: number): boolean {
  return _sessionDefaults.has(sid);
}
```

### B. `src/tools/save_profile.ts`

1. Import `hasSessionDefault` from `../animation-state.js`.
2. Only save `animation_default` when `hasSessionDefault(_sid)` is true:

```ts
if (hasSessionDefault(_sid)) {
  data.animation_default = [...animationDefault];
  sections.push("animation_default");
}
```

3. Strip `id` from reminder serialization:

```ts
data.reminders = reminders.map(r => ({
  text: r.text,
  delay_seconds: r.delay_seconds,
  recurring: r.recurring,
}));
```

### C. `src/profile-store.ts`

Remove `id` from `ReminderDef`:

```ts
export interface ReminderDef {
  text: string;
  delay_seconds: number;
  recurring: boolean;
}
```

### D. `src/tools/load_profile.ts`

The load side already handles missing IDs (`r.id ?? crypto.randomUUID()`). After removing `id` from `ReminderDef`, simplify to always generate:

```ts
id: crypto.randomUUID(),
```

### E. `profiles/Overseer.json`

Remove `animation_default` key entirely. Strip `id` from each reminder object.

### F. Tests

- Update `src/profile-store.test.ts` — any test that includes `id` in reminder data should be updated.
- Add a test: saving a profile without a custom animation default should NOT include `animation_default`.
- Add a test: saved reminders should NOT contain `id`.

## Acceptance criteria

- [ ] `pnpm build` clean
- [ ] `pnpm test` — all pass, no regressions
- [ ] `pnpm lint` clean
- [ ] `profiles/Overseer.json` has no `animation_default` and no reminder `id` fields
- [ ] Saving a profile without custom animation default omits `animation_default`
- [ ] Saved reminders never contain `id`

## Files

| File | Action |
|---|---|
| `src/animation-state.ts` | Add `hasSessionDefault` export |
| `src/tools/save_profile.ts` | Conditional animation, strip reminder id |
| `src/profile-store.ts` | Remove `id` from `ReminderDef` |
| `src/tools/load_profile.ts` | Always generate UUID |
| `profiles/Overseer.json` | Clean up |
| `src/profile-store.test.ts` | Update tests |
| `changelog/unreleased.md` | Document fix |
