/**
 * The fixture's one read and one write, shared by its routes and its script.
 *
 * The read is cached as a site's public reads are, by `cachedFind` with the
 * collection's tags and no lifetime, so only an expiry of `notes` makes it
 * read the database again. The write is a Direct API update, which expires
 * those tags wherever it runs.
 */
// Registers Nextly's cached reads under Cache Components (see the file).
import "../nextly/cached-read";
import { getNextly, type Nextly } from "nextly";
import { cachedFind, nextlyTags } from "nextly/runtime";

import config from "../nextly.config";

/** The slug of the row both instances read. */
export const NOTE_SLUG = "fixture";

/** The note's value as this instance's cache holds it, or null with no row. */
export function readNote(): Promise<string | null> {
  return cachedFind(
    async () => {
      const nextly = await getNextly({ config });
      const result = await nextly.find({
        collection: "notes",
        where: { slug: { equals: NOTE_SLUG } },
        limit: 1,
        depth: 0,
      });
      const value = result.items[0]?.value;
      return typeof value === "string" ? value : null;
    },
    { tags: nextlyTags("notes"), keyParts: ["notes", NOTE_SLUG] }
  );
}

/** Sets the note's value through the Direct API, creating the row the first time. */
export async function writeNote(nextly: Nextly, value: string): Promise<void> {
  const found = await nextly.find({
    collection: "notes",
    where: { slug: { equals: NOTE_SLUG } },
    limit: 1,
    depth: 0,
  });
  if (found.items.length === 0) {
    await nextly.create({
      collection: "notes",
      data: { title: "Fixture note", slug: NOTE_SLUG, value },
    });
    return;
  }
  await nextly.update({
    collection: "notes",
    where: { slug: { equals: NOTE_SLUG } },
    data: { value },
  });
}
