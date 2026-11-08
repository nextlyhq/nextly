/**
 * `beforeChange` hook: a new post that names no byline is credited to the
 * profile of the account that writes it.
 *
 * A post's `byline` is the public author a reader is shown, a profile in
 * `authors`; its `author` is the account that owns it. An account's profile
 * is the author whose `account` is that account (one at most, since
 * `account` is unique), so a writer with a profile is credited without
 * picking themselves. A writer with none, a post that names its byline, an
 * update, and a write with no signed-in user (the seed, which sets the byline
 * it means) are left as they are.
 *
 * Runs after the field rules, as `authorIsCreator` does: only a caller who
 * may publish posts may choose a byline, and the value anyone else sends is
 * dropped before this hook runs, so their new post is credited to their own
 * profile, never to one they named. In `beforeValidate` it would run before
 * the rules, which would then drop the credit it gave them as well. The
 * lookup goes through the Direct API, outside the write itself. Where the hook context has no Direct
 * API (some CLI paths), the post is saved without a byline rather than
 * refused: an editor can still choose one.
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
