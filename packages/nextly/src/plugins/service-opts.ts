import type { AuthenticatedScope } from "../auth/authenticated-scope";
import { effectiveCallerScope, runWithCallerScope } from "../auth/caller-scope";
import { buildUserContext } from "../auth/user-context";
import { buildMutationMessage } from "../direct-api/namespaces/helpers";
import type { MutationResult } from "../direct-api/types/shared";
import { isLocaleSelector } from "../domains/i18n/locale-selector";
import { NextlyError } from "../errors/nextly-error";
import { collectingWarnings } from "../hooks/side-effect-warnings";
import type {
  CollectionEntry,
  CollectionService,
} from "../services/collections/collection-service";
import { listRoleSlugsForUserOrRefuse } from "../services/lib/permissions";
import type { RequestContext } from "../services/shared";
import type { AuthUser } from "../types/auth";

/**
 * @public Elevation options for the managed `ctx.services` path.
 * Default: `system` when no `user` is supplied (no-user → system). Validation/
 * hooks/events ALWAYS run, even under `system` — only the access check is bypassed.
 *
 * Under `as:'user'`, RBAC is enforced by `user.id` (DB lookup), and the caller's
 * roles are resolved so a code-defined `access` rule reading `ctx.user.role` or
 * `ctx.user.roles` sees the same caller a session request would. A caller that
 * arrived on an API key is judged on the KEY's roles, never its owner's.
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

  /**
   * The content locale this operation reads or writes in.
   *
   * DATA, like `context`: which translation a localized field answers with, or
   * which one a write stores into. Absent means the site's default locale,
   * which is what every plugin call has silently meant — the request context
   * always carried this pair, and the facade always accepted it, but nothing
   * on the plugin path could say it. So a plugin serving a French page read
   * English content, and a form redirecting to a picked page answered
   * `/thanks` for a visitor who was on `/merci`.
   *
   * The same spelling as `RequestContext` and the wire's `?locale=`, so a
   * route can hand through what it was given, and what it was given is judged
   * here and below rather than trusted. One language code, only. The
   * selectors the core understands elsewhere — `*`, which moves every
   * translation's lifecycle in one write, and `all`, which answers a read
   * with one value per language — are refused at this boundary, because a
   * value forwarded from a query string must never be able to publish every
   * translation of a document, and no plugin has a designed use for either;
   * a plugin that needs the sweep needs a surface that says so by name.
   *
   * The collection services decide what an unconfigured code means, and they
   * decide it differently by verb: a READ resolves it to the default, so a
   * wrong query string still shows a page; a WRITE is refused (`400`), so a
   * typo cannot overwrite the default language's content. `createMany`
   * refuses any locale at all, by name — its bulk pipeline cannot perform the
   * localized split, and accepting a value it could not honour would file the
   * rows under the default language silently.
   */
  locale?: string;

  /**
   * Which locale a missing translation falls back to, or `false` for none.
   *
   * Absent means the configured fallback chain, which is right for a read
   * that wants SOMETHING to show. `false` is for a read that must know
   * whether the translation exists — a sitemap deciding whether to list a
   * language, say — and would be misled by the default's value standing in.
   */
  fallbackLocale?: string | false;
}

/**
 * What resolving a caller needs from the outside: the roles a user holds, by
 * slug. Injectable so the translation is tested without a database; the facade
 * wrapper supplies the real lookup.
 */
export interface ServiceOptsDeps {
  listRoleSlugs: (userId: string) => Promise<string[]>;
}

/**
 * The resolver that refuses rather than answering with an empty set.
 *
 * A role set nobody could read is not a role set. The swallowing resolver
 * returns `[]` on a failed query, which is the safe direction for a rule that
 * GRANTS on a role and the wrong one for a rule that WITHHOLDS on one:
 * `user.role !== "suspended"` admits a caller whose roles the database
 * declined to answer for, and no caller downstream can tell that empty set
 * from a user who genuinely holds no roles.
 *
 * A throw here fails the plugin's call, which is the correct direction: an
 * access decision taken on roles nobody could read is not a decision.
 */
const REAL_DEPS: ServiceOptsDeps = {
  listRoleSlugs: listRoleSlugsForUserOrRefuse,
};

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
 *
 * The roles are the KEY's when the caller arrived on one. `user` names the
 * key's owner, and a stored role rule reads `user.roles` with no scope in
 * front of it, so the owner's roles here let a viewer key minted by an
 * administrator satisfy an administrators-only rule, and refused a key
 * holding the very role the rule names because its owner did not. The REST
 * path answers the same question with `resolveRoleSlugs`: a key's roles as
 * authentication resolved them, an account's from the database. A scope that
 * carries none falls back to the account, as `apiKeyWriteAllowed` does.
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
  locale?: string;
  fallbackLocale?: string | false;
}> {
  const { as, user } = opts;
  // `?locale=` with nothing after it reaches a route as the empty string, and
  // a route forwarding what it was given hands that on. It is not a language
  // and not a selector: the write path takes any falsy locale as "none named"
  // and would file the write under the default language, which is the one
  // wrong code the documented refusal would not catch. It names nothing, so it
  // travels as nothing — the same reading the wire gives an absent parameter.
  const locale = opts.locale === "" ? undefined : opts.locale;
  // A selector is not a language. `*` is the every-locale lifecycle sweep
  // and `all` the every-translation read; both are core vocabulary a plugin
  // has no designed use for, and a route forwarding `?locale=` must not be
  // able to reach the sweep by accident. Refused before any branch, so no
  // branch can carry one.
  if (locale !== undefined && isLocaleSelector(locale)) {
    throw NextlyError.invalidInput({
      message: "locale must name one language.",
      logContext: {
        reason: "service-opts-locale-selector",
        locale,
      },
    });
  }
  // What travels whatever the caller is, built once. Each branch below used to
  // write its own literal of these, and a literal drops whatever it does not
  // name: that is how the locale a plugin could not say stayed unsayable —
  // there was no field to forget, and adding one to three literals is adding
  // it to two. Spread this and a branch cannot lose a field the others carry.
  //
  // The pair is present only when the plugin named it. A key holding
  // `undefined` and no key read the same to every consumer today, but they are
  // different claims — "no locale" and "the locale is undefined" — and only
  // the absence says the facade is deciding the default, not being handed one.
  const carried = {
    context: opts.context,
    request: opts.request,
    ...(locale !== undefined ? { locale } : {}),
    ...(opts.fallbackLocale !== undefined
      ? { fallbackLocale: opts.fallbackLocale }
      : {}),
  };
  // The caller's own scope wins when named; otherwise the one the dispatcher
  // pinned for this request. A route that omits it is the common case, not the
  // exception, so the ambient value is what makes the key's grants reach the
  // access check at all.
  const authenticatedScope = effectiveCallerScope(opts.authenticatedScope);

  // No caller, rules still enforced. Named rather than inferred from an absent
  // `user`, because that shape already means "system" and quietly changing it
  // would elevate nothing and demote every existing plugin call at once.
  if (as === "public") {
    return { overrideAccess: false, ...carried };
  }

  const wantsUser = as === "user" || (as === undefined && user !== undefined);
  if (wantsUser) {
    if (!user) {
      throw NextlyError.invalidInput({
        message: "Permission configuration is invalid.",
        logContext: { reason: "service-opts-user-missing" },
      });
    }
    // 🔴 The verified CLAIMS travel with the identity, and dropping them is a
    // security defect rather than a tidiness one. `readCaller` spreads
    // `auth.claims` onto the user it builds, so a caller handed to a plugin
    // carries whatever the token proved -- a tenant, a plan, an entitlement --
    // and a collection's code-defined `access` rule may read exactly those.
    // Rebuilt from id/name/email/roles alone, the rule received a DIFFERENT
    // caller than the endpoint authenticated: a positive check on a claim
    // denies wrongly, and an absence-tolerant one like
    // `user.plan !== "suspended"` GRANTS wrongly.
    //
    // Taken as "whatever else the supplied identity carried", so a caller
    // passing a plain `AuthUser` contributes nothing and is unaffected.
    const {
      id: _id,
      name: _name,
      email: _email,
      roles: _roles,
      role: _role,
      ...claims
    } = user as typeof user & {
      roles?: string[];
      role?: string;
    };
    const identity = buildUserContext({
      claims,
      id: user.id,
      name: user.name ?? undefined,
      email: user.email,
      // Copied: the scope's arrays are frozen, and the caller object is the
      // mutable shape every consumer of it is typed against.
      roles: authenticatedScope?.roles
        ? [...authenticatedScope.roles]
        : await deps.listRoleSlugs(user.id),
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
      ...carried,
      ...(authenticatedScope ? { authenticatedScope } : {}),
    };
  }
  return { overrideAccess: true, ...carried };
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
  | "createMany"
  | "updateMany";

const CONTEXT_INDEX: Record<AccessMethod, number> = {
  createEntry: 2,
  listEntries: 2,
  findEntryById: 2,
  updateEntry: 3,
  deleteEntry: 2,
  // D56 additions — trailing context at arg index 2.
  count: 2,
  createMany: 2,
  // The entries carry their own ids, so the context stays at index 2 as on
  // `createMany` rather than moving out to make room for one.
  updateMany: 2,
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
