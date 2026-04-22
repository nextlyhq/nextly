/**
 * Author query helpers.
 *
 * "Authors" are users in this template (users-as-authors pattern;
 * migrated in Task 17). These helpers go through `nextly.users` - the
 * dedicated user namespace backed by UserQueryService - because the
 * generic `nextly.find({ collection: "users" })` path routes through
 * the dynamic-collection registry and fails with
 *   NotFoundError: Schema for collection "users" not found in registry
 * since `users` is a static system table, not a dynamic collection.
 *
 * We keep the `getAuthorBySlug` / `getAllAuthorSlugs` names to match
 * the frontend mental model and the `/authors/[slug]` URL.
 */

import { getNextly } from "@revnixhq/nextly";

import type { Author } from "./types";

/**
 * Shape the user doc into the public Author projection. We never return
 * email, password, or role fields - those stay server-side.
 */
function toAuthor(doc: Record<string, unknown>): Author {
  return {
    id: doc.id as string,
    name: (doc.name as string | undefined) ?? "",
    slug: (doc.slug as string | undefined) ?? "",
    bio: (doc.bio as string | null | undefined) ?? null,
    avatarUrl: (doc.avatarUrl as string | null | undefined) ?? null,
  };
}

export async function getAuthorBySlug(slug: string): Promise<Author | null> {
  // nextly.users.find() doesn't support a `where` filter - it only exposes
  // full-text `search`. For a slug (which must be exact) we list users
  // and filter client-side. Author counts on a blog template are small
  // (typically <50) so the full page fetch is cheap.
  const nextly = await getNextly();
  const result = await nextly.users.find({ limit: 1000 });
  const match = (result.docs as unknown as Record<string, unknown>[]).find(
    d => (d.slug as string | undefined) === slug
  );
  return match ? toAuthor(match) : null;
}

export async function getAllAuthorSlugs(): Promise<string[]> {
  const nextly = await getNextly();
  const result = await nextly.users.find({ limit: 1000 });
  return (result.docs as unknown as Record<string, unknown>[])
    .map(d => d.slug as string | undefined)
    .filter((s): s is string => typeof s === "string" && s.length > 0);
}
