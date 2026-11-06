/**
 * `beforeChange` hook: a new post that names no author is the caller's own.
 *
 * Posts' update and delete rules let a caller without `publish-posts` change
 * only the posts whose `author` is them, so a post saved with no author could
 * never be changed again by the person who wrote it. Only a publisher may set
 * `author` (its field rule), and a value anyone else sends is dropped before
 * this hook runs, so for them a new post always becomes their own.
 *
 * Runs on create only: an update keeps the author the post has. A write with
 * no signed-in user, such as the seed, sets the author it means to itself.
 */
import type { HookHandler } from "nextly/config";

export const authorIsCreator: HookHandler = async ({
  operation,
  data,
  user,
}) => {
  if (operation !== "create" || !data || !user) return data;
  const named =
    data.author !== undefined && data.author !== null && data.author !== "";
  return named ? data : { ...data, author: user.id };
};
