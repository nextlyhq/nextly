import type { AuthenticatedScope } from "../auth/authenticated-scope";
import { apiKeyWriteAllowed } from "../auth/authenticated-scope";
import { getRBACService } from "../auth/entity-read-access";
import { buildMutationMessage } from "../direct-api/namespaces/helpers";
import type { MutationResult } from "../direct-api/types/shared";
import { NextlyError } from "../errors/nextly-error";
import { collectingWarnings } from "../hooks/side-effect-warnings";
import type {
  CollectionEntry,
  CollectionService,
} from "../services/collections/collection-service";
import type { RequestContext } from "../services/shared";
import type { AuthUser } from "../types/auth";

/**
 * @public Elevation options for the managed `ctx.services` path.
 * Default: `system` when no `user` is supplied (no-user → system). Validation/
 * hooks/events ALWAYS run, even under `system` — only the access check is bypassed.
 *
 * Under `as:'user'`, RBAC is enforced by `user.id` (DB lookup). Code-defined
 * `access` rules that read `ctx.user.role` see it empty — pass `system`, or rely on
 * DB RBAC, for now (documented v1 limitation).
 */
export interface ServiceOpts {
  as?: "user" | "system";
  user?: AuthUser;
}

/** Translate {@link ServiceOpts} into the facade's `{ user, overrideAccess }`. */
export function resolveServiceOpts(opts: ServiceOpts): {
  user?: RequestContext["user"];
  overrideAccess: boolean;
} {
  const { as, user } = opts;
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
    return {
      overrideAccess: false,
      user: { id: user.id, email: user.email, role: "", permissions: [] },
    };
  }
  return { overrideAccess: true };
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

/**
 * The access operation each method performs, in permission-slug vocabulary.
 *
 * Beside {@link CONTEXT_INDEX} because the two tables are read together and a
 * method present in one and missing from the other is the failure worth making
 * visible: an access method with no operation here is an ungated call that
 * still looks wrapped. `satisfies Record<AccessMethod, ...>` is what makes
 * adding a method to `AccessMethod` fail here rather than silently skip it.
 */
const ACCESS_OPERATION = {
  createEntry: "create",
  listEntries: "read",
  findEntryById: "read",
  updateEntry: "update",
  deleteEntry: "delete",
  count: "read",
  createMany: "create",
} as const satisfies Record<
  AccessMethod,
  "create" | "read" | "update" | "delete"
>;

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
  collections: CollectionService
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
        const resolved = resolveServiceOpts((args[idx] as ServiceOpts) ?? {});
        const next = [...args];
        next[idx] = {
          user: resolved.user,
          overrideAccess: resolved.overrideAccess,
        };
        const call = () =>
          (fn as (...a: unknown[]) => Promise<unknown>).apply(target, next);

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

/**
 * The caller a request-scoped collection service judges an API key against.
 *
 * `roles` are the KEY's own resolved role slugs, not its owner's — they reach a
 * code-defined `access` rule, which would otherwise decide on roles the key was
 * never granted.
 */
export interface ScopedCaller {
  scope: AuthenticatedScope | undefined;
  user: { id: string; roles?: string[] };
}

/**
 * Bind a request's caller to the plugin collection service, so a scoped API key
 * is judged on its OWN grants.
 *
 * ## Why this exists at all
 *
 * `resolveServiceOpts` turns `{ as: 'user', user }` into a `RequestContext`
 * carrying only an id and an email, and the access check downstream then
 * resolves that id's DATABASE grants. For a session caller that is exactly
 * right. For an API key it is the key's OWNER — so a deliberately read-only key
 * could drive any write its owner was allowed to make, through any plugin route
 * that offered one. Bounded (a key never exceeds its owner) and therefore not a
 * privilege escalation, but it is precisely the guarantee a scoped key exists to
 * provide.
 *
 * ## Why only the api-key half
 *
 * The result is an INTERSECTION, and each half is enforced once. The owner's
 * grants are already enforced downstream by `checkCollectionAccess`, which runs
 * the RBAC gate, the super-admin bypass and the stored rules for the resolved
 * user. What that path cannot see is the key's own scope, because nothing
 * carries it there. This adds only the missing half: `apiKeyWriteAllowed`
 * returns `null` for a session caller, so a session request passes through
 * completely unchanged and pays for no extra permission read. Answering the
 * session half here as well would be a second implementation of a check that
 * runs anyway, and a database read per plugin service call to reach the same
 * verdict.
 *
 * ## Why it is a precondition
 *
 * It runs BEFORE the call it guards, not behind it: this is authorization, and
 * a check that rejects after the write has happened is not one.
 *
 * `as: 'system'` is untouched, deliberately. System elevation is the plugin
 * author's own explicit choice to act without a caller, and it bypasses the
 * access check by design; this changes what `as: 'user'` MEANS, not what
 * elevation is for.
 *
 * ## One function for reads as well as writes
 *
 * `apiKeyWriteAllowed` decides the READS here too, and that is not a misuse of
 * a write helper. Its body is the generic pair — does the key hold
 * `{operation}-{resource}`, and does the code-defined rule allow it against the
 * KEY's scope — which for `read` is `canReadEntity`'s api-key branch step for
 * step. Branching to `canReadEntity` for the three reads would be a second
 * spelling of an answer that is already the same, and the two would then be
 * free to drift.
 */
export function bindCallerToCollections(
  collections: PluginCollectionService,
  caller: ScopedCaller
): PluginCollectionService {
  // A session caller has no scope to add, so the whole wrapper is skipped
  // rather than installed as a proxy that decides nothing on every call.
  if (caller.scope?.actorType !== "apiKey") return collections;

  return new Proxy(collections, {
    get(target, prop, receiver) {
      const orig = Reflect.get(target, prop, receiver) as unknown;
      if (typeof orig !== "function") return orig;
      const fn = orig as (...args: unknown[]) => unknown;
      const operation = (
        ACCESS_OPERATION as Record<
          string,
          "create" | "read" | "update" | "delete" | undefined
        >
      )[prop as string];
      if (operation === undefined) return fn.bind(target);
      const idx = CONTEXT_INDEX[prop as AccessMethod];

      return async (...args: unknown[]) => {
        // The SAME rule the wrapper below applies, asked of the same argument,
        // rather than a second reading of what `as`/`user` mean: a copy that
        // said "user" where `resolveServiceOpts` says "system" would gate an
        // elevated call, and one that said the reverse would gate nothing.
        const opts = (args[idx] as ServiceOpts | undefined) ?? {};
        const wantsUser = !resolveServiceOpts(opts).overrideAccess;
        if (wantsUser) {
          const collection = args[0];
          const allowed = await apiKeyWriteAllowed(
            caller.scope,
            operation,
            typeof collection === "string" ? collection : "",
            caller.user,
            getRBACService()
          );
          // `null` cannot occur here — the guard above established an api-key
          // scope — but it is read as a refusal rather than assumed away: this
          // is the branch that decides whether a write happens.
          if (allowed !== true) {
            throw NextlyError.forbidden({
              logContext: {
                reason: "plugin-route-api-key-scope",
                operation,
                collection,
              },
            });
          }
        }
        return (fn as (...a: unknown[]) => Promise<unknown>).apply(
          target,
          args
        );
      };
    },
  });
}
