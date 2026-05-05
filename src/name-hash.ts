/**
 * Deterministic name → integer hashing for stable resource assignment.
 *
 * Used by `pickRotationVoice(name)` and `assignColor(name, ...)` so that
 * a session named "Scout" always tries the same starting voice and emoji
 * across runs — no global rotation counter, no sid coupling.
 *
 * FNV-1a 32-bit:
 * - Cheap, fast, no crypto dependency.
 * - Distribution is good enough for our pool sizes (≤ 30).
 * - `Math.imul` keeps the multiply within 32-bit signed; `>>> 0` re-coerces
 *   each step to unsigned so JS's number semantics don't overflow into
 *   non-integer territory.
 */

/** FNV-1a 32-bit hash of a UTF-16 codepoint stream. Returns an unsigned int. */
export function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Normalize a session name for hashing. Lower-case + trim so "Scout",
 * " scout ", and "SCOUT" map to the same hash. We don't strip non-alpha
 * characters because the bridge already enforces `[a-zA-Z0-9 ]+` at name
 * validation; whatever survives is fair game.
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Convenience: deterministic index in [0, modulo) keyed by `name`.
 * `modulo` must be a positive integer.
 */
export function hashNameToIndex(name: string, modulo: number): number {
  if (modulo <= 0) return 0;
  return fnv1a32(normalizeName(name)) % modulo;
}
