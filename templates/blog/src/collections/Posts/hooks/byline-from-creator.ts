/**
 * The hooks that credit a new post to the profile of the account that writes
 * it, when the post names no byline.
 *
 * A post's `byline` is the public author a reader is shown, a profile in the
 * authors collection; its `author` is the account that owns it. An account's
 * profile is the author whose `account` is that account (one at most, since
 * `account` is unique), so a writer with a profile is credited without
 * picking themselves. A writer with none, a post that names its byline, an
 * update, and a write with no signed-in user (the seed, which sets the byline
 * it means) are left as they are.
 *
 * Made for one authors collection, named by its slug, so a site that installs
 * the collections under other slugs credits from its own.
 *
 * - `beforeChange` runs after the field rules, as `authorIsCreator` does:
 *   only a caller who may publish posts may choose a byline, and the value
 *   anyone else sends is dropped before this hook runs, so their new post is
 *   credited to their own profile, never to one they named. In
 *   `beforeValidate` it would run before the rules, which would then drop the
 *   credit it gave them as well.
 * - A write made inside its caller's own transaction (a batch written in one)
 *   is not looked up there. The hook context offers that transaction only as a
 *   raw database handle, and the Direct API reads on a pooled connection of
 *   its own, which on SQLite waits behind the transaction and on PostgreSQL
 *   and MySQL can't see what it wrote. So `beforeChange` leaves the post for
 *   `afterChange`, which credits it once the outermost transaction has
 *   committed, before the caller's write returns: the profile is read then,
 *   and the post's byline set if it still has none.
 *
 * A failed lookup or credit never refuses or undoes the post: it is saved
 * uncredited, the failure logged, and an editor can still choose a byline.
 * Where the hook context has no Direct API (some CLI paths), nothing is
 * looked up.
 */
import type { HookHandler } from "nextly/config";

/** The shared-context key `beforeChange` leaves for `afterChange`. */
const DEFERRED = "blog:bylineFromCreator:deferred";

/** The Direct API, as a hook context offers it. */
type DirectApi = NonNullable<
  NonNullable<Parameters<HookHandler>[0]["req"]>["nextly"]
>;

/** Whether a byline value names a profile. */
const isNamed = (byline: unknown): boolean =>
  byline !== undefined && byline !== null && byline !== "";

/** The id of the profile whose `account` is `accountId`, if there is one. */
async function profileOf(
  nextly: DirectApi,
  authors: string,
  accountId: string
): Promise<string | undefined> {
  const found = await nextly.find({
    collection: authors,
    where: { account: { equals: accountId } },
    limit: 1,
    depth: 0,
  });
  const id = found.items[0]?.id;
  return typeof id === "string" ? id : undefined;
}

/** Logged, never thrown: a post is never refused for want of a credit. */
function reportFailure(error: unknown): void {
  console.error(
    "[blog] bylineFromCreator: could not credit the post to the writer's author profile.",
    error
  );
}

/**
 * The two hooks, for the authors collection `authors`: `beforeChange` and
 * `afterChange` on the posts collection.
 */
export function bylineFromCreator(options: { authors: string }): {
  beforeChange: HookHandler;
  afterChange: HookHandler;
} {
  const { authors } = options;

  const beforeChange: HookHandler = async ({
    operation,
    data,
    user,
    req,
    executor,
    context,
  }) => {
    if (operation !== "create" || !data || !user) return data;
    if (isNamed(data.byline)) return data;
    const nextly = req?.nextly;
    if (!nextly) return data;
    if (executor !== undefined) {
      context[DEFERRED] = true;
      return data;
    }
    try {
      const id = await profileOf(nextly, authors, user.id);
      return id === undefined ? data : { ...data, byline: id };
    } catch (error) {
      reportFailure(error);
      return data;
    }
  };

  const afterChange: HookHandler = async ({
    operation,
    collection,
    data,
    user,
    req,
    context,
    afterCommit,
  }) => {
    if (operation !== "create" || context[DEFERRED] !== true) return;
    const nextly = req?.nextly;
    const postId = data?.id;
    if (!nextly || !user || !afterCommit || typeof postId !== "string") return;
    await afterCommit(async () => {
      try {
        const profile = await profileOf(nextly, authors, user.id);
        if (profile === undefined) return;
        const post = await nextly.findByID({
          collection,
          id: postId,
          depth: 0,
        });
        if (!post || isNamed(post.byline)) return;
        await nextly.update({
          collection,
          id: postId,
          data: {
            byline: profile,
            // The version just read, so an edit made since refuses this
            // rather than being overwritten by it.
            ...(typeof post._rev === "string"
              ? { _rev: post._rev }
              : { _overwrite: true }),
          },
        });
      } catch (error) {
        reportFailure(error);
      }
    });
  };

  return { beforeChange, afterChange };
}
