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
 *
 * Once the check can run, it never passes an image it could not check: an
 * image that cannot be read, or no longer exists, blocks the save as surely
 * as one without alt text, so a post cannot publish past the rule by way of
 * a failed read.
 */
import { NextlyError } from "nextly";
import type { HookHandler } from "nextly/config";

/** A rejection the writer sees against the field they can fix. */
const featuredImageError = (message: string) =>
  NextlyError.validation({
    errors: [{ path: "featuredImage", code: "REQUIRED", message }],
  });

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

  // Read through the media API, which returns the media row (`MediaFile`)
  // with its `altText`. `disableErrors` makes a deleted image `null`, answered
  // below, so only a read that truly failed reaches the catch.
  let media;
  try {
    media = await nextly.media.findByID({ id: mediaId, disableErrors: true });
  } catch (error) {
    console.error(
      `[blog] requireFeaturedAlt: could not read media ${mediaId} to check its alt text.`,
      error
    );
    throw featuredImageError(
      "The featured image could not be checked for alt text. Try saving again, or choose the image again."
    );
  }

  if (!media) {
    throw featuredImageError(
      "The featured image no longer exists. Choose another image."
    );
  }

  // Missing / empty altText blocks the save with a clear message to the
  // writer - they can fix it by editing the media entry in the admin.
  if (!media.altText) {
    throw featuredImageError(
      "Featured image must have alt text. Edit the media entry and add a description."
    );
  }
  return data;
};
