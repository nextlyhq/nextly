/**
 * Which document a write hook may act on, and when it must decline.
 *
 * Every `after*` hook this plugin registers asks the same four questions before
 * it does anything, and each answer is a guard that was earned rather than
 * guessed. Kept in one place because two copies of a guard is two chances for
 * one of them to be relaxed: a hook that stops declining the transactional path
 * does not fail, it silently reads the database as it was BEFORE the write it
 * was called for, and reports success.
 *
 * Generic over the Direct API shape rather than owning one. Each hook names the
 * surface it actually uses, so the capabilities a hook can reach stay legible
 * at its own call site and a later edit reaching for more shows up there.
 *
 * @module write-target
 */
import type { HookContext } from "nextly";

/** How core namespaces a Single's hooks, so a wildcard can tell them apart. */
const SINGLE_HOOK_NAMESPACE = "single:";

/** The document a write hook may act on. */
export interface WriteTarget<TApi> {
  /** The collection slug the write was for. */
  slug: string;
  /** The pooled Direct API, for reads this hook makes on its own behalf. */
  nextly: TApi;
  /** The written document's id, read from the data as saved. */
  documentId: string;
}

/**
 * The document this write targets, or `null` when the hook must decline.
 *
 * Declines on four conditions, and none of them is an error:
 *
 * 1. **A caller-owned transaction.** The hook is handed that transaction's
 *    executor and runs BEFORE the caller commits, while anything reaching the
 *    database through the pooled Direct API cannot join it — so on a small pool
 *    it stalls on the connection the transaction holds, and on a large one it
 *    reads a database that does not yet contain this write. Acting on that read
 *    would describe the document's PREVIOUS state and report success.
 * 2. **No usable slug.**
 * 3. **A Single.** Core namespaces a Single's hooks as `single:<slug>`, and a
 *    wildcard registration receives those too. A plugin has no supported way to
 *    read a Single's document — the one available path CREATES the row when it
 *    is absent, so asking about a Single would materialise every Single in the
 *    app as a side effect.
 * 4. **A collection the caller excluded**, for a hook that writes to one of its
 *    own and would otherwise re-enter itself.
 */
export function writeTargetOf<TApi>(
  context: HookContext<unknown>,
  options: { excluded?: readonly string[] } = {}
): WriteTarget<TApi> | null {
  const ctx = context as unknown as Record<string, unknown>;
  if (ctx.executor !== undefined) return null;

  const slug = ctx.collection;
  if (typeof slug !== "string" || slug.length === 0) return null;
  if (slug.startsWith(SINGLE_HOOK_NAMESPACE)) return null;
  if (options.excluded?.includes(slug) === true) return null;

  const nextly = directApiOf<TApi>(ctx);
  const documentId = documentIdOf(ctx);
  if (nextly === null || documentId === null) return null;

  return { slug, nextly, documentId };
}

/**
 * The pooled Direct API this request carries, if it carries one.
 *
 * Absent rather than broken: a hook can run on a path that supplies no Direct
 * API, and there is nothing for a reader to do without one.
 */
function directApiOf<TApi>(ctx: Record<string, unknown>): TApi | null {
  const req = ctx.req;
  if (typeof req !== "object" || req === null) return null;
  const nextly = (req as { nextly?: unknown }).nextly;
  return typeof nextly === "object" && nextly !== null
    ? (nextly as TApi)
    : null;
}

/**
 * The written document's id.
 *
 * Read from the AFTER data, which is the record as saved. Without a usable id
 * there is no addressable subject, so the write is left alone rather than
 * attributed to a key nothing can resolve.
 */
function documentIdOf(ctx: Record<string, unknown>): string | null {
  const data = ctx.data;
  if (typeof data !== "object" || data === null) return null;
  const id = (data as { id?: unknown }).id;
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * The request context forwarded to a configuration read.
 *
 * Carries the acting user so the read is made as the request that triggered it
 * rather than anonymously. Reading a collection's own configuration is not the
 * privileged part.
 */
export function requestContextFor(context: HookContext<unknown>): unknown {
  return { user: (context as unknown as Record<string, unknown>).user };
}
