import type { AuthenticatedScope } from "../auth/authenticated-scope";
import { effectiveCallerScope, runWithCallerScope } from "../auth/caller-scope";
import { buildUserContext } from "../auth/user-context";
import { buildMutationMessage } from "../direct-api/namespaces/helpers";
import type { MutationResult } from "../direct-api/types/shared";
import { NextlyError } from "../errors/nextly-error";
import { collectingWarnings } from "../hooks/side-effect-warnings";
import type {
  CollectionEntry,
  CollectionService,
} from "../services/collections/collection-service";
import { listRoleSlugsForUser } from "../services/lib/permissions";
import type { RequestContext } from "../services/shared";
import type { AuthUser } from "../types/auth";

/**
 * @public Elevation options for the managed `ctx.services` path.
 * Default: `system` when no `user` is supplied (no-user → system). Validation/
 * hooks/events ALWAYS run, even under `system` — only the access check is bypassed.
 *
 * Under `as:'user'`, RBAC is enforced by `user.id` (DB lookup), and the caller's
 * roles are resolved so a code-defined `access` rule reading `ctx.user.role` or
 * `ctx.user.roles` sees the same caller a session request would.
 */
export interface ServiceOpts {
  /**
   * Who this operation runs as.
   *
   * `user` is a signed-in caller and requires one. `system` is the plugin
   * acting on its own behalf, and bypasses the access check.
   *
   * `public` is a caller with no session AT ALL, with the collection's access
   * rules still enforced. A plugin serving a `public: true` route needs it and
   * had no way to say it: `user` throws without a user, and everything else
   * elevated to `system`, so a public route could only read by bypassing the
   * host's configured rules. Route auth and collection access are separate
   * questions, and `public: true` answers only the first.
   */
  as?: "user" | "system" | "public";
  user?: AuthUser;
  /**
   * Arbitrary data handed to this operation's hooks as `ctx.context`.
   *
   * How a plugin tells a hook something about the CALL that the row cannot say.
   * A hook doing expensive presentation work can be told a read is internal and
   * skip it, and a hook that writes can be told not to recurse. Core has
   * accepted this on every collection operation for some time and seeds the
   * shared hook context from it; this facade dropped it, so a plugin could
   * reach neither.
   *
   * It is data, not permission: nothing here bypasses access, validation or any
   * hook. A hook decides for itself what to do with what it is told.
   */
  context?: Record<string, unknown>;

  /**
   * The HTTP request this operation is serving, when the plugin is serving one.
   *
   * A plugin handling its own route passes the request it was given, and the
   * core resolves it into the facts hooks read as `ctx.req`: the headers, and a
   * client address judged against the deployment's proxy-trust settings. A
   * plugin doing background work leaves it out, and a hook scoped to a visitor
   * then knows to stand down.
   *
   * The request rather than an address, for the same reason core takes the
   * request: a caller does not get to name its own client.
   */
  request?: Request;

  /**
   * The caller's own authorization scope when they arrived on an API key --
   * `ctx.authenticatedScope`, passed straight through.
   *
   * `user` names the key's OWNER, so without this the access check resolves the
   * owner's roles and a viewer-scoped key minted by a super-admin is judged as
   * a super-admin. A route serving an API key must forward it; a session caller
   * has none and resolves the normal way.
   *
   * Unlike `context` above this IS permission: it narrows what the caller may
   * do, never widens it.
   */
  authenticatedScope?: AuthenticatedScope;
}

/**
 * What resolving a caller needs from the outside: the roles a user holds, by
 * slug. Injectable so the translation is tested without a database; the facade
 * wrapper supplies the real lookup.
 */
export interface ServiceOptsDeps {
  listRoleSlugs: (userId: string) => Promise<string[]>;
}

const REAL_DEPS: ServiceOptsDeps = { listRoleSlugs: listRoleSlugsForUser };

/**
 * Translate {@link ServiceOpts} into the facade's `{ user, overrideAccess }`.
 *
 * A caller is built by `buildUserContext`, the one constructor every
 * authenticated path uses, with the roles it holds resolved here. Built by hand
 * with `role: ""`, as it was, a code-defined rule such as
 * `req.user?.role === "editor"` refused every caller on the plugin path, while
 * the same caller's own request passed it; and a negative rule granted what it
 * was written to refuse. The permission list stays empty: the access services
 * resolve permissions from the id, and from the key's own scope when there is
 * one.
 */
export async function resolveServiceOpts(
  opts: ServiceOpts,
  deps: ServiceOptsDeps = REAL_DEPS
): Promise<{
  user?: RequestContext["user"];
  authenticatedScope?: AuthenticatedScope;
  overrideAccess: boolean;
  context?: Record<string, unknown>;
  request?: Request;
}> {
  const { as, user, context, request } = opts;
  // The caller's own scope wins when named; otherwise the one the dispatcher
  // pinned for this request. A route that omits it is the common case, not the
  // exception, so the ambient value is what makes the key's grants reach the
  // access check at all.
  const authenticatedScope = effectiveCallerScope(opts.authenticatedScope);

  // No caller, rules still enforced. Named rather than inferred from an absent
  // `user`, because that shape already means "system" and quietly changing it
  // would elevate nothing and demote every existing plugin call at once.
  if (as === "public") {
    return { overrideAccess: false, context, request };
  }

  const wantsUser = as === "user" || (as === undefined && user !== undefined);
  if (wantsUser) {
    if (!user) {
      throw new NextlyError({
        code: "INVALID_INPUT",
        statusCode: 400,
        publicMessage: "Permission configuration is invalid.",
        logMessage: "ServiceOpts as:'user' requires a `user`",
        logContext: { reason: "service-opts-user-missing" },
      });
    }
    const identity = buildUserContext({
      id: user.id,
      name: user.name ?? undefined,
      email: user.email,
      roles: await deps.listRoleSlugs(user.id),
    });
    return {
      overrideAccess: false,
      user: {
        ...identity,
        id: user.id,
        email: user.email,
        role: identity.role ?? "",
        permissions: [],
      },
      context,
      request,
      ...(authenticatedScope ? { authenticatedScope } : {}),
    };
  }
  return { overrideAccess: true, context, request };
}

/**
 * The collection-facade access methods, mapped to the position of their trailing
 * `RequestContext` argument. The wrapper translates a `ServiceOpts` passed at this
 * position into a `RequestContext`.
 */
type AccessMethod =
  | "createEntry"
  | "listEntries"
  | "findEntryById"
  | "updateEntry"
  | "deleteEntry"
  | "count"
  | "createMany";

const CONTEXT_INDEX: Record<AccessMethod, number> = {
  createEntry: 2,
  listEntries: 2,
  findEntryById: 2,
  updateEntry: 3,
  deleteEntry: 2,
  // D56 additions — trailing context at arg index 2.
  count: 2,
  createMany: 2,
};

/**
 * The write methods, and the verb each reports.
 *
 * A write is where a post-commit hook can fail after the row is already
 * durable, so these are the methods whose result has something to say beyond
 * the row itself. The reads are left exactly as they are: nothing runs after
 * them that could fail without failing the read.
 */
const WRITE_VERB = {
  createEntry: "created",
  updateEntry: "updated",
  deleteEntry: "deleted",
} as const satisfies Record<string, "created" | "updated" | "deleted">;

type WriteMethod = keyof typeof WRITE_VERB;

/** Replace a method's trailing `RequestContext` arg with an optional `ServiceOpts`. */
type ReplaceTrailingContext<F> = F extends (
  ...args: [...infer Head, RequestContext]
) => infer R
  ? (...args: [...Head, ServiceOpts?]) => R
  : F;

/**
 * The plugin-facing return type for a write.
 *
 * `deleteEntry` resolves to `void` on the facade, so the deleted row is
 * reported as the minimal `{ id }` the Direct API already uses for it -- a
 * caller that wants to log or re-key what it removed has the id, and there is
 * no row left to return.
 */
type WriteResult<K extends WriteMethod> = K extends "deleteEntry"
  ? MutationResult<{ id: string }>
  : MutationResult<CollectionEntry>;

/** Replace a write's trailing context AND widen its result to the envelope. */
type PluginWriteMethod<K extends WriteMethod> =
  ReplaceTrailingContext<CollectionService[K]> extends (
    ...args: infer A
  ) => unknown
    ? (...args: A) => Promise<WriteResult<K>>
    : never;

/**
 * @public Plugin-facing collection service.
 *
 * Access methods take `ServiceOpts` in place of a `RequestContext`, and the
 * writes resolve to the same `{ message, item, warnings? }` envelope the Direct
 * API and the wire API return. Returning the bare row left a plugin unable to
 * see a post-commit hook failure that every other caller of the same write is
 * told about.
 */
export type PluginCollectionService = Omit<
  CollectionService,
  AccessMethod | WriteMethod
> & {
  [K in Exclude<AccessMethod, WriteMethod>]: ReplaceTrailingContext<
    CollectionService[K]
  >;
} & {
  [K in WriteMethod]: PluginWriteMethod<K>;
};

/**
 * Wrap the collection facade so its access methods accept a trailing `ServiceOpts`
 * (translated to a `RequestContext` via {@link resolveServiceOpts}). Non-access
 * members pass through. The wrapped methods are async, so a `ServiceOpts` misuse
 * (e.g. `as:'user'` with no user) surfaces as a rejection. Plugins never touch
 * `overrideAccess` directly.
 */
export function wrapCollectionsForPlugin(
  collections: CollectionService,
  deps: ServiceOptsDeps = REAL_DEPS
): PluginCollectionService {
  return new Proxy(collections, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver) as unknown;
      if (typeof orig !== "function") return orig;
      const fn = orig as (...args: unknown[]) => unknown;
      const idx = (CONTEXT_INDEX as Record<string, number | undefined>)[
        prop as string
      ];
      if (idx === undefined) return fn.bind(target);
      const verb = (WRITE_VERB as Record<string, string | undefined>)[
        prop as string
      ];
      return async (...args: unknown[]) => {
        const resolved = await resolveServiceOpts(
          (args[idx] as ServiceOpts) ?? {},
          deps
        );
        const next = [...args];
        // Spread rather than named one by one. Rebuilding this literal is
        // what kept a plugin from reaching the hook context, and the same
        // shape then dropped an API key's scope on its way to the access
        // check -- twice, because a hand-written list is a second
        // implementation of what `resolveServiceOpts` already decided. A
        // spread cannot forget a field.
        next[idx] = { ...resolved } satisfies RequestContext;
        // The scope this call runs under becomes the ambient one for its whole
        // duration, so a route that NARROWED its scope is narrowed at every
        // gate underneath and not only at the one it passed the scope to.
        //
        // Field access is the gate that makes this necessary. It reads the
        // ambient scope rather than an argument — eighteen call sites reach it
        // and none could be relied on to forward one — so without re-pinning,
        // a handler that gave up a grant still got the field that grant opens,
        // which is the narrowing silently not happening.
        const call = () =>
          runWithCallerScope(resolved.authenticatedScope, () =>
            (fn as (...a: unknown[]) => Promise<unknown>).apply(target, next)
          );

        if (verb === undefined) return call();

        // A plugin write is its own operation boundary: it may run during boot,
        // with no request around it to open a collector. Opening one here is
        // what lets the failure reach the plugin that caused it. A scope
        // already open still receives the same failures, so an in-process write
        // cannot hide one from the request waiting on it.
        const { result, warnings } = await collectingWarnings(call);
        return {
          message: buildMutationMessage(args[0] as string, verb as "created"),
          // `deleteEntry` resolves to `void`; the id the caller passed is the
          // only thing left to identify what went, and it is the same minimal
          // shape the Direct API reports for a delete.
          item: result === undefined ? { id: args[1] as string } : result,
          ...(warnings ? { warnings } : {}),
        };
      };
    },
  }) as unknown as PluginCollectionService;
}
