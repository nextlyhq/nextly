/**
 * Author query helpers.
 *
 * "Authors" are users in this template (users-as-authors pattern;
 * migrated in Task 17). These helpers query the `users` collection but
 * keep the `getAuthorBySlug` / `getAllAuthorSlugs` names to match the
 * frontend mental model and the `/authors/[slug]` URL.
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
  const nextly = await getNextly();
  const result = await nextly.find({
    collection: "users",
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 0,
  });
  return result.docs[0] ? toAuthor(result.docs[0]) : null;
}

export async function getAllAuthorSlugs(): Promise<string[]> {
  const nextly = await getNextly();
  const result = await nextly.find({
    collection: "users",
    limit: 1000,
    depth: 0,
  });
  return result.docs
    .map(d => d.slug as string | undefined)
    .filter((s): s is string => typeof s === "string" && s.length > 0);
}
