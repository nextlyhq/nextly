/**
 * Helpers that turn a write's facts into a {@link RevalidationIntent}, honoring
 * the target's `revalidate` config. Kept out of the mutation service so the
 * config-gating logic is small and unit-testable without a database.
 */
import {
  computeEntryRevalidation,
  computeSingleRevalidation,
} from "./compute-tags";
import type { RevalidateConfig, RevalidationIntent } from "./types";

/**
 * Read a string-valued field from a document, returning undefined when it is
 * absent or not a string — so a slug/locale read never forces an unsafe cast.
 */
export function readStringField(
  doc: Record<string, unknown> | null | undefined,
  field: string
): string | undefined {
  const value = doc?.[field];
  return typeof value === "string" ? value : undefined;
}

/**
 * The revalidation intent for an entry write, or undefined when revalidation is
 * disabled for the collection. Configured extra tags are merged with the derived
 * `nextly:*` tags.
 */
export function buildEntryRevalidationIntent(
  collectionName: string,
  revalidateConfig: RevalidateConfig | undefined,
  fields: {
    id: string;
    slug?: string;
    previousSlug?: string;
    locale?: string;
  }
): RevalidationIntent | undefined {
  if (revalidateConfig?.disable) return undefined;
  return computeEntryRevalidation({
    collection: collectionName,
    id: fields.id,
    slug: fields.slug,
    previousSlug: fields.previousSlug,
    locale: fields.locale,
    extraTags: revalidateConfig?.tags,
  });
}

/**
 * The revalidation intent for a single write, or undefined when revalidation is
 * disabled for the single.
 */
export function buildSingleRevalidationIntent(
  slug: string,
  revalidateConfig: RevalidateConfig | undefined
): RevalidationIntent | undefined {
  if (revalidateConfig?.disable) return undefined;
  return computeSingleRevalidation({ slug, extraTags: revalidateConfig?.tags });
}

/**
 * Narrow a loosely-typed collection/single metadata object to its optional
 * `revalidate` config without an unsafe cast, so the write site can read the
 * opt-out and extra tags whether or not the metadata carries them.
 */
export function readRevalidateConfig(
  meta: unknown
): RevalidateConfig | undefined {
  if (meta && typeof meta === "object" && "revalidate" in meta) {
    const value = (meta as { revalidate?: unknown }).revalidate;
    if (value && typeof value === "object") return value;
  }
  return undefined;
}
