import { slugify } from "@/lib/utils";

/**
 * Slug helpers — pure functions used by the products service to derive a
 * tenant-unique slug automatically from the product name.
 */

export const SLUG_MAX_LENGTH = 80;

/** Pattern accepted for user-supplied slugs (kebab-case). */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Derive a base slug from a product name.
 * Falls back to "produto" when the name contains no sluggable characters.
 */
export function baseSlug(name: string): string {
  const slug = slugify(name).slice(0, SLUG_MAX_LENGTH).replace(/-+$/, "");
  return slug || "produto";
}

/**
 * Resolve a unique slug given a predicate that reports whether a candidate is
 * already taken **inside the caller's tenant**. Appends `-2`, `-3`, … until
 * a free candidate is found.
 *
 * The predicate receives fully-formed candidates, so callers can implement it
 * with a single scoped Prisma query per attempt.
 */
export async function resolveUniqueSlug(
  name: string,
  isTaken: (candidate: string) => Promise<boolean>,
  options?: { preferred?: string },
): Promise<string> {
  const base = options?.preferred?.trim() ? baseSlug(options.preferred) : baseSlug(name);

  if (!(await isTaken(base))) return base;

  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base.slice(0, SLUG_MAX_LENGTH - `-${suffix}`.length)}-${suffix}`;
    if (!(await isTaken(candidate))) return candidate;
  }

  // Practically unreachable; guarantees termination.
  return `${base.slice(0, SLUG_MAX_LENGTH - 8)}-${Date.now().toString(36)}`;
}
