/**
 * The blog fixture's post metadata: what the template's SEO settings derive
 * (the title, description and image its bindings give, and the post's
 * address), handed to `buildMetadata` with the post, as the hand-written post
 * page hands it its own fallbacks.
 *
 * So a rebuilt post carries the same title, description, canonical address,
 * social image and robots rule as the hand-written one: `buildMetadata` reads
 * the post's own `seo` overrides first, and what the template derives fills
 * the blanks. Every other entry keeps the route's own metadata.
 *
 * @module blog-fixture/metadata
 */
import type { BlocksPageConfig } from "@nextlyhq/blocks-react/next";
import { buildMetadata, type SeoMetaInput } from "nextly/runtime";

import { JOURNAL } from "./collections";

type PageMetadata = NonNullable<BlocksPageConfig["metadata"]>;

/** A stored text, or null for anything else. */
const textOf = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

/**
 * The post's `seo` group as `buildMetadata` reads it, field by field from the
 * stored value, so a group missing or holding another shape is no overrides.
 */
function seoOf(group: unknown): SeoMetaInput {
  const read = (key: string): unknown =>
    typeof group === "object" && group !== null
      ? Reflect.get(group, key)
      : undefined;
  return {
    metaTitle: textOf(read("metaTitle")),
    metaDescription: textOf(read("metaDescription")),
    ogImage: read("ogImage"),
    canonical: textOf(read("canonical")),
    noindex: read("noindex") === true,
  };
}

/** `metadata`, with the fixture's posts given `buildMetadata` instead. */
export function withJournalMetadata(
  metadata: PageMetadata | undefined
): PageMetadata {
  return async (entry, context, derived) => {
    if (context.collection === JOURNAL.posts) {
      return buildMetadata({ seo: seoOf(entry.seo) }, { fallback: derived });
    }
    return metadata === undefined
      ? {}
      : await metadata(entry, context, derived);
  };
}
