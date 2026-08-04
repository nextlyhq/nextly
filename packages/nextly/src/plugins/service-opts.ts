import { buildMutationMessage } from "../direct-api/namespaces/helpers";
import type {
  CollectionSlug,
  GeneratedTypes,
  MutationResult,
} from "../direct-api/types/shared";
import type { BatchOperationResult } from "../domains/collections/services/collection-types";
import { NextlyError } from "../errors/nextly-error";
import { collectingWarnings } from "../hooks/side-effect-warnings";
import type {
  CollectionEntry,
  CollectionService,
} from "../services/collections/collection-service";
import type {
  PaginatedResult,
  QueryOptions,
  RequestContext,
} from "../services/shared";
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

/**
 * A slug this surface accepts.
 *
 * The generated union when types exist, and any string besides. The canonical
 * remap-safe way to name your own collection is `ctx.self.collections[...]`,
 * which is `Record<string, string>` because the framework may rename an
 * entity -- so a bare `CollectionSlug` would reject the very expression the
 * docs tell plugin authors to use. `string & {}` keeps the union's
 * autocompletion while still admitting a computed name.
 */
type AcceptedSlug = CollectionSlug | (string & {});

/**
 * The row a slug resolves to.
 *
 * The generated type when one exists, and `CollectionEntry` otherwise -- NOT a
 * bare record. An app without generated types has always been promised `id`
 * and the timestamps here, and dropping to `Record<string, unknown>` would take
 * that away from exactly the projects that have the least type information to
 * spare.
 */
type RowFor<TSlug> = GeneratedTypes extends { collections: infer C }
  ? TSlug extends keyof C
    ? C[TSlug]
    : CollectionEntry
  : CollectionEntry;

/**
 * @public Plugin-facing collection service.
 *
 * Two differences from the facade underneath, both so a plugin writes what an
 * application writes:
 *
 * 1. Access methods take {@link ServiceOpts} in place of a `RequestContext`, so
 *    a plugin never touches `overrideAccess` directly.
 * 2. They are generic over the collection slug, so a row comes back as the type
 *    generated for that collection rather than an index-signature record. The
 *    Direct API has always done this; the plugin path did not, which is why
 *    plugin code asserts a row into its own document type -- and why those
 *    assertions cannot be checked, an index-signature record and a concrete
 *    document having no overlap for TypeScript to verify.
 *
 * Written out rather than mapped from `CollectionService`: a mapped type cannot
 * introduce a type parameter per method, and this IS the surface a plugin
 * author reads.
 */
export type PluginCollectionService = Omit<
  CollectionService,
  AccessMethod | WriteMethod
> & {
  /** Create one entry. Resolves to `{ message, item, warnings? }`. */
  createEntry<TSlug extends AcceptedSlug>(
    collectionName: TSlug,
    data: Record<string, unknown>,
    opts?: ServiceOpts
  ): Promise<MutationResult<RowFor<TSlug>>>;

  /** Update one entry. Resolves to `{ message, item, warnings? }`. */
  updateEntry<TSlug extends AcceptedSlug>(
    collectionName: TSlug,
    entryId: string,
    data: Record<string, unknown>,
    opts?: ServiceOpts
  ): Promise<MutationResult<RowFor<TSlug>>>;

  /**
   * Delete one entry. Resolves to `{ message, item: { id }, warnings? }`.
   *
   * The deleted row is reported as its id alone: the facade's delete resolves
   * to `void`, and there is no row left to return.
   */
  deleteEntry<TSlug extends AcceptedSlug>(
    collectionName: TSlug,
    entryId: string,
    opts?: ServiceOpts
  ): Promise<MutationResult<{ id: string }>>;

  /** Fetch one entry by id. */
  findEntryById<TSlug extends AcceptedSlug>(
    collectionName: TSlug,
    entryId: string,
    opts?: ServiceOpts
  ): Promise<RowFor<TSlug>>;

  /** List entries with filter, sort and pagination. */
  listEntries<TSlug extends AcceptedSlug>(
    collectionName: TSlug,
    options?: QueryOptions,
    opts?: ServiceOpts
  ): Promise<PaginatedResult<RowFor<TSlug>>>;

  /** Count entries matching a filter. */
  count<TSlug extends AcceptedSlug>(
    collectionName: TSlug,
    options?: { where?: Record<string, unknown>; search?: string },
    opts?: ServiceOpts
  ): Promise<number>;

  /**
   * Bulk insert.
   *
   * Keeps `BatchOperationResult`, which already models per-row outcomes -- an
   * envelope around it would describe the batch and hide the rows.
   */
  createMany<TSlug extends AcceptedSlug>(
    collectionName: TSlug,
    data: Record<string, unknown>[],
    opts?: ServiceOpts
  ): Promise<BatchOperationResult>;
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
