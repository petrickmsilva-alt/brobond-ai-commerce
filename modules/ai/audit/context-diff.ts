/**
 * Context snapshot diffing — PR007.1 (AI Context Audit).
 *
 * Pure, framework-free and dependency-free utility to compare two persisted
 * `AIGeneratedMessage.contextSnapshot` values (or any pair of
 * JSON-compatible structures) and report the fields that differ.
 *
 * Output paths are dotted from the snapshot root, e.g.:
 *
 *   creator.score      82 → 91
 *   product.margin     3550 → 3990
 *   trend.keyword      "streetwear" → "y2k"
 *
 * Determinism contract: same pair of inputs → same list of diffs, in the
 * same order (keys are visited in sorted order at every level). The inputs
 * are never mutated.
 *
 * No external libraries are used — this is a small recursive walker over
 * plain JSON values.
 */

export interface ContextDiffEntry {
  /** Dotted field path from the snapshot root (e.g. "creator.score"). */
  path: string;
  /** Value in snapshot A (`undefined` when the field is absent in A). */
  before: unknown;
  /** Value in snapshot B (`undefined` when the field is absent in B). */
  after: unknown;
}

/** Path used when the two roots differ wholesale (e.g. object vs `null`). */
export const ROOT_DIFF_PATH = "(root)";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively collect diffs between `a` and `b` under `path`.
 * Appends entries to `out` in deterministic (sorted-key) order.
 */
function collectDiffs(path: string, a: unknown, b: unknown, out: ContextDiffEntry[]): void {
  // Fast path: primitives (and reference-identical values) — Object.is also
  // treats NaN === NaN and distinguishes +0 / -0, which is fine for JSON.
  if (Object.is(a, b)) return;

  const aObject = isPlainObject(a);
  const bObject = isPlainObject(b);

  // Both plain objects → recurse key by key (sorted for determinism).
  if (aObject && bObject) {
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).sort();
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      const hasA = Object.prototype.hasOwnProperty.call(a, key);
      const hasB = Object.prototype.hasOwnProperty.call(b, key);
      if (!hasA) {
        out.push({ path: childPath, before: undefined, after: b[key] });
      } else if (!hasB) {
        out.push({ path: childPath, before: a[key], after: undefined });
      } else {
        collectDiffs(childPath, a[key], b[key], out);
      }
    }
    return;
  }

  // Both arrays → compare element by element.
  if (Array.isArray(a) && Array.isArray(b)) {
    const max = Math.max(a.length, b.length);
    for (let index = 0; index < max; index += 1) {
      const childPath = `${path}.${index}`;
      if (index >= a.length) {
        out.push({ path: childPath, before: undefined, after: b[index] });
      } else if (index >= b.length) {
        out.push({ path: childPath, before: a[index], after: undefined });
      } else {
        collectDiffs(childPath, a[index], b[index], out);
      }
    }
    return;
  }

  // Any other combination (leaf change, type change, object vs array, …)
  // is reported as a single field-level diff.
  out.push({ path: path || ROOT_DIFF_PATH, before: a, after: b });
}

/**
 * Compare two context snapshots field by field.
 *
 * @returns one entry per differing field, ordered deterministically; an
 *          empty array when the snapshots are equal.
 */
export function compareContextSnapshots(a: unknown, b: unknown): ContextDiffEntry[] {
  const diffs: ContextDiffEntry[] = [];
  collectDiffs("", a, b, diffs);
  return diffs;
}
