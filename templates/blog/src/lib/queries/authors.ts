/**
 * Author query helpers.
 */

import { getNextly } from "@revnixhq/nextly";

import type { Author } from "./types";

// depth: 1 populates the avatar Media relationship. Other fields on
// authors are scalar, so no deeper walk is needed.
export async function getAuthorBySlug(slug: string): Promise<Author | null> {
  const nextly = await getNextly();
  const result = await nextly.find({
    collection: "authors",
    where: { slug: { equals: slug } },
    limit: 1,
    depth: 1,
  });
  return result.docs[0] ? (result.docs[0] as unknown as Author) : null;
}

export async function getAllAuthorSlugs(): Promise<string[]> {
  const nextly = await getNextly();
  const result = await nextly.find({
    collection: "authors",
    limit: 1000,
    depth: 0,
  });
  return result.docs.map(d => d.slug as string);
}
