/**
 * Shared `beforeValidate` hook used by Posts, Categories, and Tags.
 *
 * Derives a URL-safe slug from `title` or `name` when the slug field is
 * blank. Lives in `src/hooks/` rather than inside a collection because
 * multiple collections share the identical behavior; duplicating the
 * function four times would be worse than a single import.
 */
import type { HookHandler } from "@revnixhq/nextly/config";

export const autoSlug: HookHandler = async ({ data }) => {
  // Prefer `title` (posts), fall back to `name` (authors / categories / tags).
  const source = (data?.title || data?.name) as string | undefined;
  if (data && !data.slug && source) {
    return {
      ...data,
      slug: source
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "-")
        .replace(/[^\w-]/g, ""),
    };
  }
  return data;
};
