/**
 * `beforeValidate` hook: a new post that names no byline is credited to the
 * profile of the account that writes it.
 *
 * A post's `byline` is the public author a reader is shown, a profile in
 * `authors`; its `author` is the account that owns it. An account's profile
 * is the author whose `account` is that account, so a writer with a profile is
 * credited without picking themselves. A writer with none, a post that names
 * its byline, an update, and a write with no signed-in user (the seed, which
 * sets the byline it means) are left as they are.
 *
 * Runs before validation, as the featured-image check does, so the read goes
 * through the Direct API outside the write itself. Where the hook context has
 * no Direct API (some CLI paths), the post is saved without a byline rather
 * than refused: an editor can still choose one.
 */
import type { HookHandler } from "nextly/config";

export const bylineFromCreator: HookHandler = async ({
  operation,
  data,
  user,
  req,
}) => {
  if (operation !== "create" || !data || !user) return data;
  const named =
    data.byline !== undefined && data.byline !== null && data.byline !== "";
  if (named) return data;
  const nextly = req?.nextly;
  if (!nextly) return data;
  try {
    const profile = await nextly.find({
      collection: "authors",
      where: { account: { equals: user.id } },
      limit: 1,
      depth: 0,
    });
    const id = profile.items[0]?.id;
    return typeof id === "string" ? { ...data, byline: id } : data;
  } catch (error) {
    // A post is never refused for want of a credit; the editor can set one.
    console.error(
      "[blog] bylineFromCreator: could not read the writer's author profile.",
      error
    );
    return data;
  }
};
