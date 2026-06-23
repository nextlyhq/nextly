import { NextlyError } from "../errors/nextly-error";
import type { CollectionService } from "../services/collections/collection-service";
import type { RequestContext } from "../services/shared";
import type { AuthUser } from "../types/auth";

/**
 * @public Elevation options for the managed `ctx.services` path (D35).
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

/** Translate {@link ServiceOpts} into the facade's `{ user, overrideAccess }` (D35). */
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
 * position into a `RequestContext` (D35).
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

/** Replace a method's trailing `RequestContext` arg with an optional `ServiceOpts`. */
type ReplaceTrailingContext<F> = F extends (
  ...args: [...infer Head, RequestContext]
) => infer R
  ? (...args: [...Head, ServiceOpts?]) => R
  : F;

/** @public Plugin-facing collection service: access methods take `ServiceOpts` (D35). */
export type PluginCollectionService = Omit<CollectionService, AccessMethod> & {
  [K in AccessMethod]: ReplaceTrailingContext<CollectionService[K]>;
};

/**
 * Wrap the collection facade so its access methods accept a trailing `ServiceOpts`
 * (translated to a `RequestContext` via {@link resolveServiceOpts}). Non-access
 * members pass through. The wrapped methods are async, so a `ServiceOpts` misuse
 * (e.g. `as:'user'` with no user) surfaces as a rejection. Plugins never touch
 * `overrideAccess` directly (D35).
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
      return async (...args: unknown[]) => {
        const resolved = resolveServiceOpts((args[idx] as ServiceOpts) ?? {});
        const next = [...args];
        next[idx] = {
          user: resolved.user,
          overrideAccess: resolved.overrideAccess,
        };
        return (fn as (...a: unknown[]) => Promise<unknown>).apply(
          target,
          next
        );
      };
    },
  }) as unknown as PluginCollectionService;
}
