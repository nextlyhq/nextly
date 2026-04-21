/**
 * `beforeValidate` hook that enforces alt text on a post's featured image.
 *
 * Rationale: the `media` collection is shared across many use cases, so
 * requiring alt globally creates friction. A blog featured image without
 * alt hurts both accessibility and SEO social cards, so we enforce it at
 * the post level.
 *
 * When the Direct API isn't available in the hook context (bulk imports,
 * migrations, some CLI paths), we log and skip rather than block - better
 * a permissive save than a false positive on code paths that don't
 * populate `req.nextly`. Admin-panel saves always populate it.
 */
import type { HookHandler } from "@revnixhq/nextly/config";

export const requireFeaturedAlt: HookHandler = async ({ data, req }) => {
  if (!data?.featuredImage) return data;
  const mediaRef = data.featuredImage as string | { id?: string };
  const mediaId = typeof mediaRef === "string" ? mediaRef : mediaRef?.id;
  if (!mediaId) return data;

  const nextly = req?.nextly;
  if (!nextly) {
    console.warn(
      "[blog] requireFeaturedAlt: Direct API unavailable on hook context - skipping alt check."
    );
    return data;
  }

  const media = await nextly
    .findByID({ collection: "media", id: mediaId })
    .catch(() => null);

  // Media records use `altText` (stored as alt_text in the database).
  // Missing / empty altText blocks the save with a clear message to the
  // writer - they can fix it by editing the media entry in the admin.
  if (media && !media.altText) {
    throw new Error(
      "Featured image must have alt text. Edit the media entry and add a description."
    );
  }
  return data;
};
