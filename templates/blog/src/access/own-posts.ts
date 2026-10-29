/**
 * Access control: who may change which posts.
 *
 * Anyone who may publish posts (`publish-posts`) changes every post; anyone
 * else changes only the posts whose `author` is them. The line is a grant the
 * Roles screen shows, never a role's name, so an admin moves it there: give a
 * role `publish-posts` and its holders edit and delete every post. A site
 * that wants publishers limited to their own posts too drops the first check
 * in `ownPostsUnlessPublisher`.
 *
 * The filter only narrows. The caller still needs the operation's own grant
 * (`update-posts`, `delete-posts`), which Nextly checks before any rule and
 * which `hasPermission` repeats here so the rule reads plainly; a filter never
 * admits someone without it. Nextly applies the filter in the database query:
 * a post outside it is refused and left unchanged, and an update that would
 * move a post outside it, by giving it another author, is refused.
 */
import type { AccessControlContext, AccessControlFunction } from "nextly";

import { hasPermission } from "./has-permission";

/** Whether the caller may publish posts, which also lets them change every post. */
export const mayPublishPosts: AccessControlFunction = ({ permissions }) =>
  permissions.includes("publish-posts");

/**
 * A Posts `update` or `delete` rule: `true` for a caller who may publish
 * posts, the posts they wrote for any other caller holding the operation's
 * grant, and `false` for a caller without the grant or without a user.
 */
export const ownPostsUnlessPublisher = async (ctx: AccessControlContext) => {
  if (!(await hasPermission(ctx))) return false;
  if (await mayPublishPosts(ctx)) return true;
  if (!ctx.user) return false;
  return { author: { equals: ctx.user.id } };
};
