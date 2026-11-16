import type { TransactionContext } from "@nextlyhq/adapter-drizzle/types";

import { runWithAccessMemo } from "../auth/access/request-memo";
import type { AuthenticatedScope } from "../auth/authenticated-scope";
import {
  currentRouteActor,
  effectiveCallerScope,
  runWithCallerScope,
} from "../auth/caller-scope";
import { runAsPrincipal } from "../auth/principal-scope";
import type { RequestActor } from "../auth/request-actor";
import { buildUserContext } from "../auth/user-context";
import type { FieldConfig } from "../collections/fields/types";
import {
  buildMutationMessage,
  createErrorFromSingleResult,
} from "../direct-api/namespaces/helpers";
import type { MutationResult } from "../direct-api/types/shared";
import { withCurrentLanguages } from "../domains/i18n/configured-locales";
import { isLocaleSelector } from "../domains/i18n/locale-selector";
import type { SingleEntryService } from "../domains/singles/services/single-entry-service";
import type { SingleDocument } from "../domains/singles/types";
import {
  parseFieldRewrite,
  rewriteCallerOf,
  rewritesSingle,
  type DocumentFieldRewriteRequest,
  type FieldRewriteResult,
} from "../domains/versions/field-rewrite";
import { holdsFieldOfType } from "../domains/versions/tag-component-types";
import { NextlyError } from "../errors/nextly-error";
import { collectingWarnings } from "../hooks/side-effect-warnings";
import type {
  Collection,
  CollectionEntry,
  CollectionService,
} from "../services/collections/collection-service";
import {
  type HookExemptRead,
  issueHookExemptRead,
  readHooksWaived,
} from "../services/collections/trust-grant";
import { listRoleSlugsForUserOrRefuse } from "../services/lib/permissions";
import type { RequestContext } from "../services/shared";
import { refuseSchemaChangeInProduction } from "../shared/builder-refusal";
import {
  type ReadLock,
  runReadsInTransaction,
} from "../shared/lib/read-transaction-scope";
import type { AuthUser } from "../types/auth";

import type { PluginSingleRecord } from "./plugin-singles";
import { assertRunnableAsPrincipal } from "./principals/run-as";
import type { Principal } from "./principals/types";
import { methodFacade } from "./service-facade";
import {
  type PluginTransactionMethod,
  type TransactionScope,
  transactionScope,
} from "./transaction-scope";

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
   * acting on its own behalf, and bypasses the access check; a `user` named
   * beside it is not judged, and is who the write is attributed to.
   *
   * `public` is a caller with no session AT ALL, with the collection's access
   * rules still enforced. A plugin serving a `public: true` route needs it and
   * had no way to say it: `user` throws without a user, and everything else
   * elevated to `system`, so a public route could only read by bypassing the
   * host's configured rules. Route auth and collection access are separate
   * questions, and `public: true` answers only the first. With no rule for
   * the operation, a read keeps the public default and a create, update or
   * delete is refused: a write needs a rule that answers `true`.
   */
  as?: "user" | "system" | "public";
  user?: AuthUser;
  /**
   * @experimental A plugin-defined signed-in person this operation is made as,
   * as `ctx.principals.fromRequest` or `byId` returned them.
   *
   * Access rules always apply: the collection's code-defined rule is the only
   * way in. The call is refused, and runs nothing, when it also sets `as`,
   * names a `user` or an `authenticatedScope`, or names a person core did
   * not make.
   */
  principal?: Principal;
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
 * wrapper supplies the real lookup. `executor` is the transaction a call runs
 * in, when it runs in one: its roles are read there, as its writes and its
 * access check are, so a role the transaction took away is gone from them.
 */
export interface ServiceOptsDeps {
  listRoleSlugs: (userId: string, executor?: unknown) => Promise<string[]>;
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
  deps: ServiceOptsDeps = REAL_DEPS,
  // The transaction-bound executor of a call made inside a transaction, which
  // the caller's roles are read on; see `ServiceOptsDeps`.
  executor?: unknown
): Promise<{
  user?: RequestContext["user"];
  authenticatedScope?: AuthenticatedScope;
  overrideAccess: boolean;
  context?: Record<string, unknown>;
  request?: Request;
  locale?: string;
  fallbackLocale?: string | false;
  actor?: RequestActor;
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
  // A call made as a plugin-defined person: under the rules, with no staff
  // user and no API key. Answered before the request's scope is read, since
  // that scope is the key the person's request may have arrived beside, not
  // the person. The person is pinned around the call by the facade.
  if (opts.principal !== undefined) {
    assertRunnableAsPrincipal(opts.principal, {
      user: opts.user,
      authenticatedScope: opts.authenticatedScope,
      as: opts.as,
    });
    return { overrideAccess: false, ...carried };
  }

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
    return {
      overrideAccess: false,
      user: callerFor(
        user,
        // Copied: the scope's arrays are frozen, and the caller object is the
        // mutable shape every consumer of it is typed against.
        authenticatedScope?.roles
          ? [...authenticatedScope.roles]
          : await deps.listRoleSlugs(user.id, executor)
      ),
      ...carried,
      ...(authenticatedScope ? { authenticatedScope } : {}),
      ...requestActorFor(user),
    };
  }
  // The plugin acting as itself, beside a person it names: still trusted, and
  // the person is the one the write is attributed to, so a folder records its
  // creator and a hook sees who the change was made for. Nothing is asked
  // about them, so no role lookup runs: a trusted call never needed one, and
  // a lookup that failed would refuse a call that does not depend on it. No
  // scope travels either: a scope narrows an access check, and a trusted call
  // runs none.
  if (user !== undefined) {
    return {
      overrideAccess: true,
      user: callerFor(user, []),
      ...carried,
    };
  }
  return { overrideAccess: true, ...carried };
}

/**
 * The actor a write made as `user` is recorded under, when it is the plugin
 * route request's own user: the API key itself when one authenticated, as a
 * REST write records it. A write as anybody else, or made outside a route's
 * request (a job, boot, the system), names none and is recorded as before,
 * by its user or as the system.
 */
function requestActorFor(user: AuthUser): { actor?: RequestActor } {
  const route = currentRouteActor();
  return route !== undefined && route.userId === user.id
    ? { actor: route.actor }
    : {};
}

/**
 * The caller a plugin's `ServiceOpts.user` is, as every service receives one:
 * built by `buildUserContext`, carrying `roles`.
 */
function callerFor(
  user: AuthUser,
  roles: string[]
): NonNullable<RequestContext["user"]> {
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
    roles,
  });
  return {
    ...identity,
    id: user.id,
    email: user.email,
    role: identity.role ?? "",
    permissions: [],
  };
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
  | "updateMany"
  | "rewriteField"
  | InTransactionMethod;

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
  // The request carries the entry, so the context follows it directly. The
  // plugin making the rewrite is appended after the context by core, from the
  // plugin's identity (see `translateServiceOpts`), never taken from a call.
  rewriteField: 1,
  // The transactional writes run the same access check as the writes above,
  // so their context is a `ServiceOpts` too. Taken raw, it let a plugin name
  // `overrideAccess` or hand in a caller carrying whatever roles it liked.
  // Each sits one place further out, behind the transaction token.
  createEntryInTransaction: 3,
  updateEntryInTransaction: 4,
  deleteEntryInTransaction: 3,
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
 * The collection-service methods a plugin receives. Everything else on the
 * service (its adapter, its Drizzle handle, its sub-services, the schema
 * registry's mutators) is not reachable through `ctx.services.collections`.
 */
const PLUGIN_COLLECTION_METHODS = [
  "createCollection",
  "listCollections",
  "getCollection",
  "updateCollection",
  "deleteCollection",
  "createEntry",
  "createMany",
  "updateMany",
  "listEntries",
  "count",
  "findEntryById",
  "updateEntry",
  "deleteEntry",
  "rewriteField",
  "warmLocalizedReadiness",
  "withTransaction",
  "createEntryInTransaction",
  "updateEntryInTransaction",
  "deleteEntryInTransaction",
] as const satisfies readonly (keyof CollectionService)[];

/**
 * The methods that take the transaction `withTransaction` opened, as their
 * first argument. Listed once, for the type and for the runtime check alike.
 */
const IN_TRANSACTION_METHODS = [
  "createEntryInTransaction",
  "updateEntryInTransaction",
  "deleteEntryInTransaction",
] as const;
type InTransactionMethod = (typeof IN_TRANSACTION_METHODS)[number];
const IN_TRANSACTION: ReadonlySet<string> = new Set(IN_TRANSACTION_METHODS);

declare const pluginTransactionBrand: unique symbol;

/**
 * @experimental The transaction `ctx.services.collections.withTransaction`
 * hands its work: a token to pass to the `*InTransaction` methods, and
 * nothing else. The adapter's transaction it stands for carries `execute`,
 * raw SQL on the transaction's connection, which a plugin holds only through
 * `ctx.db.raw`, and only when it declares `capabilities.db.rawSql` and the
 * app lists it in `db.rawSqlPlugins`.
 */
export interface PluginCollectionTransaction {
  readonly [pluginTransactionBrand]: "PluginCollectionTransaction";
}

/** Replace a method's leading `TransactionContext` with the plugin's token. */
type ReplaceLeadingTransaction<F> = F extends (
  tx: TransactionContext,
  ...rest: infer A
) => infer R
  ? (tx: PluginCollectionTransaction, ...rest: A) => R
  : never;

/**
 * Drop the service's trailing `actor` from `deleteEntryInTransaction`.
 *
 * The actor is who the recorded event names, and a plugin naming it would be
 * the plugin choosing whom its own delete is attributed to. `deleteEntry`
 * takes none either, so both deletes attribute the same way: from the caller
 * `ServiceOpts` resolves.
 */
type WithoutTrailingActor<F> = F extends (
  tx: TransactionContext,
  collectionName: string,
  entryId: string,
  context: RequestContext,
  actor?: infer _Actor
) => infer R
  ? (
      tx: TransactionContext,
      collectionName: string,
      entryId: string,
      context: RequestContext
    ) => R
  : F;

/** A transactional write as a plugin calls it: a token first, `ServiceOpts` last. */
type PluginInTransactionMethod<K extends InTransactionMethod> =
  ReplaceLeadingTransaction<
    ReplaceTrailingContext<WithoutTrailingActor<CollectionService[K]>>
  >;

/**
 * @public Plugin-facing collection service.
 *
 * Access methods, the `*InTransaction` writes among them, take `ServiceOpts`
 * in place of a `RequestContext`, and the non-transactional writes resolve to the same `{ message, item, warnings? }` envelope the Direct
 * API and the wire API return. Returning the bare row left a plugin unable to
 * see a post-commit hook failure that every other caller of the same write is
 * told about. Only the methods meant for plugins are present; a transaction
 * reaches the plugin as a `PluginCollectionTransaction` token.
 */
export type PluginCollectionService = Pick<
  CollectionService,
  Exclude<
    (typeof PLUGIN_COLLECTION_METHODS)[number],
    AccessMethod | WriteMethod | InTransactionMethod | "withTransaction"
  >
> & {
  [K in Exclude<
    AccessMethod,
    WriteMethod | InTransactionMethod | "rewriteField"
  >]: ReplaceTrailingContext<CollectionService[K]>;
} & {
  /**
   * @experimental Rewrite one field of an entry (`{ collection, id, ... }`)
   * or of a Single (`{ single, ... }`) on its live copy and on every pending
   * draft that holds it, in one transaction, without publishing: each draft
   * stays a draft and the status is unchanged. Applied only if the document
   * is still at `expectedVersion`, the version the plugin read; otherwise
   * refused with `STALE_VERSION` and nothing changes. There is no overwrite:
   * read again and decide again.
   *
   * Runs no save hooks and no in-transaction handlers. The document's history
   * records one "rewritten" event naming this plugin (or, with `as: "user"`,
   * the person, with this plugin named beside them) and the `reason`. The
   * live change records the `entry.updated` (or `single.updated`) event and
   * revalidates the document's pages once it commits.
   *
   * Made as a person (`as: "user"`), it needs their permission to update the
   * document and, where it has a publish lifecycle, to publish it, and every
   * field rule that applies to their own update.
   */
  rewriteField(
    request: DocumentFieldRewriteRequest,
    opts?: ServiceOpts
  ): Promise<FieldRewriteResult>;
} & {
  [K in WriteMethod]: PluginWriteMethod<K>;
} & {
  [K in InTransactionMethod]: PluginInTransactionMethod<K>;
} & {
  withTransaction<T>(
    work: (tx: PluginCollectionTransaction) => Promise<T>
  ): Promise<T>;
  /**
   * @experimental Hold a collection for the rest of the transaction `tx`
   * stands for, and answer whether it exists: its registry row, locked for
   * share. A delete of the collection locks the row for update before it
   * removes anything, so a write that must not outlive the collection it
   * names either commits before the delete's collection-delete handlers
   * (`ctx.hooks.onCollectionDelete`) read what to remove with it, or waits
   * for the delete and is told the collection is gone. Asks nothing of the
   * caller's access, and reads nothing but whether the row is there. On
   * MySQL, where a table drop commits a transaction's row locks, both sides
   * also take the collection's named lock, which the delete holds until it
   * has removed the row. A settled token is refused.
   */
  holdCollectionInTransaction(
    tx: PluginCollectionTransaction,
    collectionName: string
  ): Promise<boolean>;
  /**
   * @experimental Hold an entry for the rest of the transaction `tx` stands
   * for, and answer whether it exists: its row, locked for share. A delete of
   * the entry locks the row for update before it removes it, and runs its
   * in-transaction handlers (`ctx.hooks.onInTransaction`) after, so a write
   * that must not outlive the entry it names either commits before the
   * delete goes on, and those handlers see it, or waits for the delete and is
   * told the entry is gone. It holds the entry's collection first, as
   * `holdCollectionInTransaction` does, so a delete of the whole collection,
   * which locks its registry row rather than the entries' rows before its
   * `ctx.hooks.onCollectionDelete` handlers run, takes turns with the write
   * too: the write commits first and those handlers see it, or waits and is
   * told the entry is gone. Asks nothing of the caller's access, and reads
   * nothing but whether the collection and the row are there. On SQLite, with
   * one writer at a time, the rows are only read. A collection that does not
   * exist holds no entry. A settled token is refused.
   */
  holdEntryInTransaction(
    tx: PluginCollectionTransaction,
    collectionName: string,
    entryId: string
  ): Promise<boolean>;
  /**
   * @experimental Collection `collectionName`'s record, as `getCollection`
   * answers it, read on the transaction `tx` stands for: what the
   * transaction sees, its own uncommitted changes included. `getCollection`
   * takes a pooled connection, which inside a transaction on a pool of one
   * waits for the connection the transaction holds; this reads on that
   * connection. Like `getCollection`, it asks nothing of the caller's access
   * and is refused with `NOT_FOUND` for a collection there is no record of.
   * It reads the registry only, never an entry, and takes no row lock: hold
   * the row with `holdCollectionInTransaction` where a write must not
   * outlive the collection. A settled token is refused before anything is
   * read.
   */
  getCollectionInTransaction(
    tx: PluginCollectionTransaction,
    collectionName: string
  ): Promise<Collection>;
  /**
   * @experimental `listEntries`, read on the transaction `tx` stands for:
   * the same options and `ServiceOpts`, the same access check, the same
   * read hooks and the same answer, with every read it makes on the
   * transaction's connection, the caller's roles under `as: "user"`
   * included. `listEntries` takes a pooled connection, which inside a
   * transaction on a pool of one waits for the connection the transaction
   * holds; this reads on that connection, and so sees what the transaction
   * wrote. Like any read the services route to a transaction, the page's
   * rows are read with a shared lock on PostgreSQL and MySQL, held until
   * the transaction ends. It grants nothing `listEntries` does not: it is
   * that read, on the caller's transaction. A settled token is refused
   * before anything is read.
   */
  listEntriesInTransaction(
    tx: PluginCollectionTransaction,
    // Exactly what the facade's `listEntries` takes, derived from it, so
    // the two cannot drift.
    ...read: Parameters<
      ReplaceTrailingContext<CollectionService["listEntries"]>
    >
  ): ReturnType<CollectionService["listEntries"]>;
};

/**
 * What a token `withTransaction` handed out stands for: the adapter's
 * transaction, and the scope that decides how long the token may reach it
 * (`transactionScope`, the same rule `ctx.db.transaction` follows).
 */
export interface PluginTransactionRecord {
  readonly tx: TransactionContext;
  readonly scope: TransactionScope;
}

/**
 * The record behind each token `withTransaction` handed out. Weak, so a token
 * outliving its transaction holds nothing.
 */
const pluginTransactions = new WeakMap<object, PluginTransactionRecord>();

/**
 * The key each write's transaction hands its in-transaction handlers, by the
 * adapter's transaction: one per transaction, so every handler call in it
 * (each entry of a batch included) holds the same key, and work a plugin
 * keys by it sees what its earlier calls on that transaction did. A key
 * carries no capability: the token beside it is what reaches the database.
 */
const writeTransactionKeys = new WeakMap<object, object>();

/**
 * Run `work` with a token for the write transaction `tx`, as the collection
 * service's in-transaction methods take it, open while `work` runs and
 * refusing once it has settled, as every token a plugin holds does; and with
 * the key that transaction's every handler call shares. `method` is what a
 * refusal of the settled token names as the callback the work belongs in.
 *
 * @internal The in-transaction phase's, for `InTransactionContext`, and a
 * collection delete's, for `ctx.hooks.onCollectionDelete`.
 */
export function withWriteTransactionToken<R>(
  tx: TransactionContext,
  work: (token: PluginCollectionTransaction, key: object) => Promise<R>,
  method: PluginTransactionMethod = "ctx.hooks.onInTransaction"
): Promise<R> {
  const adapterTx = tx as unknown as object;
  let key = writeTransactionKeys.get(adapterTx);
  if (key === undefined) {
    key = Object.freeze({});
    writeTransactionKeys.set(adapterTx, key);
  }
  const token = Object.freeze({}) as PluginCollectionTransaction;
  const scope = transactionScope(method);
  pluginTransactions.set(token, { tx, scope });
  const shared = key;
  return scope.run(() => work(token, shared));
}

/**
 * The record a plugin's token stands for, or a refusal when the value is not
 * one `withTransaction` handed out.
 */
export function transactionOf(token: unknown): PluginTransactionRecord {
  const record =
    typeof token === "object" && token !== null
      ? pluginTransactions.get(token)
      : undefined;
  if (record === undefined) {
    throw NextlyError.validation({
      logContext: { reason: "plugin-transaction-token-unknown" },
      errors: [
        {
          path: "tx",
          code: "INVALID",
          message:
            "Pass the transaction ctx.services.collections.withTransaction handed your work.",
        },
      ],
    });
  }
  return record;
}

/**
 * Wrap the collection facade so its access methods accept a trailing `ServiceOpts`
 * (translated to a `RequestContext` via {@link resolveServiceOpts}). Non-access
 * members pass through. The wrapped methods are async, so a `ServiceOpts` misuse
 * (e.g. `as:'user'` with no user) surfaces as a rejection. Plugins never touch
 * `overrideAccess` directly.
 */
export function wrapCollectionsForPlugin(
  collections: CollectionService,
  deps: ServiceOptsDeps = REAL_DEPS,
  /**
   * The plugin these services belong to, by the name it booted under: a
   * rewrite it makes names it in history. Absent for services no plugin owns.
   */
  pluginName?: string,
  /**
   * The Singles service a rewrite of a Single goes to, resolved on its first
   * use. Absent where no Single can be rewritten through these services.
   */
  singles?: () => SingleEntryService
): PluginCollectionService {
  const trusted = {
    rewriteField: pluginName === undefined ? [] : [pluginName],
  };
  const translated = translateServiceOpts(
    collections,
    deps,
    undefined,
    trusted
  );
  const facade = methodFacade(translated, PLUGIN_COLLECTION_METHODS);
  // One `rewriteField` for an entry and a Single, its caller resolved by the
  // same translation as every other method's.
  const rewrites = translateServiceOpts(
    rewriteRouter(collections, singles) as unknown as CollectionService,
    deps,
    undefined,
    trusted
  );
  // The transaction a plugin's work receives is a token, mapped back to the
  // adapter's transaction where a method needs it. Async, so an unknown or
  // finished token is a rejection like every other failure of these methods,
  // and both checks run before the service is reached: a refused write never
  // gets as far as resolving its `ServiceOpts`.
  //
  // A write is tracked on its token's scope for as long as it runs, because
  // the check alone happens too early to be the whole guard. The service sees
  // the transaction only after the caller is resolved, which awaits a role
  // lookup, so a write started inside the callback but not awaited by it
  // could pass the check while the transaction is live and reach the service
  // after it ended. The scope holds the transaction open until it settles.
  const inTransaction =
    (method: InTransactionMethod) =>
    async (token: unknown, ...rest: unknown[]): Promise<unknown> => {
      const { tx, scope } = transactionOf(token);
      scope.assertOpen();
      return scope.track(
        (facade[method] as (...args: unknown[]) => Promise<unknown>)(
          tx,
          ...rest
        )
      );
    };
  // A collection's definition is schema, which reaches production only
  // through migrations: a plugin's create, update or delete of one is refused
  // there with the builder's own refusal, before its `ServiceOpts` is resolved
  // or the service is reached. Async, so the refusal is a rejection like every
  // other failure of these methods.
  const schemaChange =
    (method: "createCollection" | "updateCollection" | "deleteCollection") =>
    async (...args: unknown[]): Promise<unknown> => {
      refuseSchemaChangeInProduction(`ctx.services.collections.${method}`);
      return (
        facade[method] as unknown as (...args: unknown[]) => Promise<unknown>
      )(...args);
    };
  return Object.freeze({
    ...facade,
    createCollection: schemaChange("createCollection"),
    updateCollection: schemaChange("updateCollection"),
    deleteCollection: schemaChange("deleteCollection"),
    rewriteField: rewrites.rewriteField.bind(rewrites),
    withTransaction: <T>(
      work: (tx: PluginCollectionTransaction) => Promise<T>
    ): Promise<T> =>
      facade.withTransaction(async tx => {
        const token = Object.freeze({}) as PluginCollectionTransaction;
        const scope = transactionScope(
          "ctx.services.collections.withTransaction"
        );
        pluginTransactions.set(token, { tx, scope });
        // Settled either way: writes the work started and did not await
        // finish inside the transaction, one of those failing rolls it back
        // even when the work resolved, and the token refuses from then on,
        // whether the transaction is about to commit or to roll back. A
        // write that failed before the work settled — a validation refusal
        // the work caught, say — is the work's to handle and does not.
        return scope.run(() => work(token));
      }),
    createEntryInTransaction: inTransaction("createEntryInTransaction"),
    updateEntryInTransaction: inTransaction("updateEntryInTransaction"),
    deleteEntryInTransaction: inTransaction("deleteEntryInTransaction"),
    // Checked and tracked as the writes are, with no `ServiceOpts`: it reads
    // only whether the collection's registry row is there.
    holdCollectionInTransaction: async (
      token: unknown,
      collectionName: string
    ): Promise<boolean> => {
      const { tx, scope } = transactionOf(token);
      scope.assertOpen();
      return scope.track(
        collections.holdCollectionInTransaction(tx, collectionName),
        "read"
      );
    },
    // The same, for one entry's row.
    holdEntryInTransaction: async (
      token: unknown,
      collectionName: string,
      entryId: string
    ): Promise<boolean> => {
      const { tx, scope } = transactionOf(token);
      scope.assertOpen();
      return scope.track(
        collections.holdEntryInTransaction(tx, collectionName, entryId),
        "read"
      );
    },
    // The facade's own `getCollection`, so both answer alike, with every
    // read the services make inside it routed to the transaction's
    // connection (`runReadsInTransaction`). Its context is unused there, as
    // it is when a plugin calls `getCollection`.
    getCollectionInTransaction: async (
      token: unknown,
      collectionName: string
    ): Promise<Collection> => {
      const { tx, scope } = transactionOf(token);
      scope.assertOpen();
      return scope.track(
        runReadsInTransaction(tx, () =>
          facade.getCollection(collectionName, {})
        ),
        "read"
      );
    },
    // The facade's own `listEntries`, translated by the same code, so both
    // answer alike, with every read the services make inside it routed to
    // the transaction's connection, and the caller's roles read there too,
    // as a transactional write's are.
    listEntriesInTransaction: async (
      token: unknown,
      ...read: unknown[]
    ): Promise<unknown> => {
      const { tx, scope } = transactionOf(token);
      scope.assertOpen();
      const onTransaction = translateServiceOpts(collections, deps, tx);
      return scope.track(
        runReadsInTransaction(tx, () =>
          (
            onTransaction.listEntries as unknown as (
              ...args: unknown[]
            ) => Promise<unknown>
          )(...read)
        ),
        "read"
      );
    },
  }) as unknown as PluginCollectionService;
}

/**
 * Where a plugin's field rewrite goes: a Single's to the Singles service, an
 * entry's to the collection service. Takes the arguments the collection
 * service's `rewriteField` takes, so the caller is translated alike for both.
 */
function rewriteRouter(
  collections: CollectionService,
  singles: (() => SingleEntryService) | undefined
): Pick<CollectionService, "rewriteField"> {
  return {
    rewriteField: async (
      input: unknown,
      context: RequestContext,
      plugin?: string
    ): Promise<FieldRewriteResult> => {
      const request = parseFieldRewrite(input);
      if (!rewritesSingle(request) || singles === undefined) {
        return collections.rewriteField(request, context, plugin);
      }
      const result = await singles().rewriteField({
        request,
        ...rewriteCallerOf(context, plugin),
      });
      if (!result.success) throw createErrorFromSingleResult(result);
      return result.data as FieldRewriteResult;
    },
  };
}

/**
 * The collection service with its access methods accepting a trailing
 * `ServiceOpts`, and its writes resolving to the mutation envelope.
 * `readsOn` is the transaction a read made through it runs on, when it runs
 * on one: the caller's roles are read there, as a transactional write's are.
 */
function translateServiceOpts(
  collections: CollectionService,
  deps: ServiceOptsDeps,
  readsOn?: TransactionContext,
  /**
   * Arguments core passes after a method's context, by method: what only core
   * may say, such as which plugin is calling. Appended after the arguments a
   * plugin named are cut at the context, so a plugin can't supply them.
   */
  trusted: Partial<Record<string, readonly unknown[]>> = {}
): CollectionService {
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
      const accessCall = async (args: unknown[]) => {
        const opts = (args[idx] as ServiceOpts | undefined) ?? {};
        // A transactional write's caller is resolved on its transaction: read
        // on the pool, its roles would be another connection's, blind to a
        // role the transaction changed, and a field rule reading
        // `req.user.roles` would judge the write by them.
        const resolved = await resolveServiceOpts(
          opts,
          deps,
          IN_TRANSACTION.has(prop as string)
            ? (args[0] as TransactionContext).getDrizzle()
            : readsOn?.getDrizzle()
        );
        // Nothing past the context travels. The context is the last argument
        // a plugin may name; a parameter the service accepts after it (the
        // delete's `actor`) is the service's own, and an extra argument
        // passed at runtime past the published type must not reach it.
        const next = args.slice(0, idx);
        // Spread rather than named one by one. Rebuilding this literal is
        // what kept a plugin from reaching the hook context, and the same
        // shape then dropped an API key's scope on its way to the access
        // check -- twice, because a hand-written list is a second
        // implementation of what `resolveServiceOpts` already decided. A
        // spread cannot forget a field.
        next[idx] = { ...resolved } satisfies RequestContext;
        next.push(...(trusted[prop as string] ?? []));
        // The scope this call runs under becomes the ambient one for its whole
        // duration, so a route that NARROWED its scope is narrowed at every
        // gate underneath and not only at the one it passed the scope to.
        //
        // Field access is the gate that makes this necessary. It reads the
        // ambient scope rather than an argument — eighteen call sites reach it
        // and none could be relied on to forward one — so without re-pinning,
        // a handler that gave up a grant still got the field that grant opens,
        // which is the narrowing silently not happening.
        //
        // The person, too, for the same reason and more: a gate that missed
        // the person would judge the call as anonymous, and an anonymous
        // caller reaches a collection's public default where a person must be
        // refused. A call naming no person runs as none, so it never inherits
        // the person of an operation that set it going.
        //
        // And one language list for the whole call, as a Direct API call has: a
        // plugin's write may run at boot, in a job or on a timer, with no request
        // to have chosen one.
        const call = () =>
          withCurrentLanguages(() =>
            runAsPrincipal(opts.principal ?? null, () =>
              runWithCallerScope(resolved.authenticatedScope, () =>
                (fn as (...a: unknown[]) => Promise<unknown>).apply(
                  target,
                  next
                )
              )
            )
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
      // Each call with one memo of access lookups, so the caller named by
      // `as: "user"` is looked up once for the call and its rows; a call made
      // inside a request shares that request's memo.
      return (...args: unknown[]) => runWithAccessMemo(() => accessCall(args));
    },
  });
}

/*
 * Reads of the collections a plugin declared, shaped by no configured hook
 * (`ctx.services.ownCollections`).
 *
 * A plugin's bookkeeping is read to DECIDE something: whether a component is
 * still used, where a backfill stopped. A site hook that narrows every read to
 * one tenant, retargets a read by id or rewrites the document makes that answer
 * wrong while it looks exact. `overrideAccess` does not help: it skips the
 * access check and nothing else.
 *
 * What the read skips: every configured read hook. That is a collection's
 * `beforeOperation`, `beforeRead` and `afterRead` (the `*` globals and every
 * plugin's own, this plugin's included), the stored hooks, the field hooks set
 * in config, and the list-query filter. What it keeps: what a field's type does
 * to make a stored value readable, because none of it is a hook. That means
 * JSON decoding, timestamp casing, the redaction of server-only values
 * (password hashes, the owner column), the rich-text format and `select`. A
 * field type that decrypted its value would keep that too; no core type does
 * today.
 *
 * The grant is structural rather than a flag. Each context is issued one grant
 * covering exactly the collections its plugin declared, and the grant never
 * appears on `ServiceOpts`, so no call can ask for more than the plugin owns. A
 * plugin that depends on the owner declares none of the owner's collections, so
 * it is refused like any other. Related rows belong to their own collection and
 * keep that collection's hooks: the relationship walk never sees the grant.
 *
 * Runs as the system only, and as no person, even inside a person's request:
 * a hook-free result handed to a person could cross the tenant boundary a site
 * draws with its read hooks. The result is for the plugin's own code.
 *
 */

/**
 * What a read of the plugin's own collection may say about the call.
 *
 * Only data. There is no `as`, `user`, principal or scope, because the read is
 * the plugin acting on its own bookkeeping, and nothing here can widen the
 * grant or name a person.
 */
export type OwnCollectionReadOpts = Pick<
  ServiceOpts,
  "context" | "locale" | "fallbackLocale"
>;

/**
 * @experimental What a read of the plugin's own collection on a transaction
 * may also say: the lock its rows are read with on PostgreSQL and MySQL.
 * `share` (the default) holds them against writes from elsewhere; `update`
 * also holds them against other transactions' locking reads, for a read
 * that goes on to write the rows it read, so two such transactions take
 * turns rather than each holding a shared lock the other's write waits on.
 *
 * `none` (`@experimental`) is a plain read on the transaction's own
 * connection: no `FOR SHARE` or `FOR UPDATE`, so it waits for no other
 * writer and holds nothing it read. It is for a caller holding a lock of its
 * own (a lock row each of its writes takes first, say) that reads rows
 * another writer may be updating: a locking read waits for that writer, and
 * when the writer is itself waiting for the caller's lock the two wait on
 * each other until the database refuses one of them. Under READ COMMITTED
 * (PostgreSQL's default) the plain read sees the latest committed rows;
 * under REPEATABLE READ (MySQL's default) it answers from the transaction's
 * snapshot, which may predate a commit the caller's lock was meant to order
 * it after, and the caller must guard against that itself. SQLite has one
 * connection and takes no row locks, so there the three read alike.
 */
export type OwnTransactionReadOpts = OwnCollectionReadOpts & {
  readonly lock?: "share" | "update" | "none";
};

/**
 * @experimental What a read of a Single on a transaction may also say: its
 * row's lock on PostgreSQL and MySQL, `share` (the default) or `none`, as
 * {@link OwnTransactionReadOpts} describes them. A Single's read has no
 * `update`: it is one row, read to answer a document rather than to write it.
 */
export type OwnSingleTransactionReadOpts = OwnCollectionReadOpts & {
  readonly lock?: Exclude<OwnTransactionReadOpts["lock"], "update">;
};

/**
 * @experimental Reads of the collections this plugin declared, shaped by no
 * configured hook. Never return the result to a person: a site's read hooks
 * may be what keeps one tenant's rows from another.
 */
export interface PluginOwnCollectionReads {
  listEntries(
    slug: string,
    options?: Parameters<CollectionService["listEntries"]>[1],
    opts?: OwnCollectionReadOpts
  ): ReturnType<CollectionService["listEntries"]>;
  findEntryById(
    slug: string,
    id: string,
    opts?: OwnCollectionReadOpts
  ): ReturnType<CollectionService["findEntryById"]>;
  count(
    slug: string,
    options?: Parameters<CollectionService["count"]>[1],
    opts?: OwnCollectionReadOpts
  ): ReturnType<CollectionService["count"]>;
  group(
    slug: string,
    options: Parameters<CollectionService["group"]>[1],
    opts?: OwnCollectionReadOpts
  ): ReturnType<CollectionService["group"]>;
  /**
   * @experimental {@link listEntries}, read on the transaction `tx` stands
   * for: the token `ctx.services.collections.withTransaction` hands its work,
   * or an in-transaction handler's `transaction`. Same options, same answer.
   *
   * The read runs on the transaction's own connection, so it sees what the
   * transaction wrote and takes no second connection from the pool, which on
   * a pool of one would wait for the connection the transaction holds. On
   * PostgreSQL and MySQL the page's rows are read with a shared lock
   * (`FOR SHARE`): the latest committed rows, whatever the transaction's
   * isolation, held until it ends, so a write to them from elsewhere waits.
   * The total in `pagination` is a count, which takes no lock: rows can be
   * added beside the page before the transaction ends. Page with `limit` and
   * stop on a short page rather than on the total. A settled token, or a
   * collection this plugin did not declare, is refused before anything is
   * read. `opts.lock: "update"` reads the rows for update instead, for a
   * read that goes on to write them, and `opts.lock: "none"`
   * (`@experimental`) reads them with no lock, for a caller holding a lock of
   * its own (see {@link OwnTransactionReadOpts}).
   */
  listEntriesInTransaction(
    tx: PluginCollectionTransaction,
    slug: string,
    options?: Parameters<CollectionService["listEntries"]>[1],
    opts?: OwnTransactionReadOpts
  ): ReturnType<CollectionService["listEntries"]>;
  /**
   * @experimental {@link findEntryById}, read on the transaction `tx` stands
   * for, as {@link listEntriesInTransaction} reads: on its connection, and on
   * PostgreSQL and MySQL with a shared lock on the row, held until the
   * transaction ends, unless `opts.lock` names another
   * ({@link OwnTransactionReadOpts}). Same answer.
   */
  findEntryByIdInTransaction(
    tx: PluginCollectionTransaction,
    slug: string,
    id: string,
    opts?: OwnTransactionReadOpts
  ): ReturnType<CollectionService["findEntryById"]>;
  /**
   * @experimental A Single this plugin declared, as stored, read on the
   * transaction `tx` stands for, as {@link listEntriesInTransaction} reads:
   * on its connection, and on PostgreSQL and MySQL with a shared lock on the
   * Single's row, held until the transaction ends. `opts.lock: "none"`
   * (`@experimental`) reads the row with no lock
   * ({@link OwnSingleTransactionReadOpts}).
   *
   * Answers the document the Singles read answers, shaped by none of the
   * Single's read hooks (`beforeOperation`, `beforeRead`, `afterRead`) or its
   * fields' `afterRead` hooks, as the system. A Single with no stored
   * document answers the default document a first read would create, and
   * nothing is written: no row, version or event. A settled token, or a
   * Single this plugin did not declare, is refused before anything is read.
   */
  getSingleInTransaction(
    tx: PluginCollectionTransaction,
    slug: string,
    opts?: OwnSingleTransactionReadOpts
  ): Promise<SingleDocument>;
  /**
   * @experimental {@link listEntriesInTransaction}, of a HOST collection: one
   * this plugin did not declare, that holds a field of a type this plugin
   * registered (`contributes.fieldTypes`) at any depth, inside groups,
   * repeaters and the components it names included. Same options, same
   * answer, same lock (`opts.lock`), as the system and past the collection's
   * read hooks.
   *
   * Whether the collection holds such a field is decided at the call, from
   * its schema as it stands on the transaction, so a collection created or
   * changed at runtime is judged as it is now. One that holds none, or does
   * not exist, is refused before anything is read, as a settled token is.
   */
  listHostEntriesInTransaction(
    tx: PluginCollectionTransaction,
    slug: string,
    options?: Parameters<CollectionService["listEntries"]>[1],
    opts?: OwnTransactionReadOpts
  ): ReturnType<CollectionService["listEntries"]>;
  /**
   * @experimental {@link findEntryByIdInTransaction}, of a HOST collection,
   * judged as {@link listHostEntriesInTransaction} judges one.
   */
  findHostEntryByIdInTransaction(
    tx: PluginCollectionTransaction,
    slug: string,
    id: string,
    opts?: OwnTransactionReadOpts
  ): ReturnType<CollectionService["findEntryById"]>;
  /**
   * @experimental {@link getSingleInTransaction}, of a HOST Single: one that
   * holds a field of a type this plugin registered, at any depth, judged at
   * the call as {@link listHostEntriesInTransaction} judges a collection.
   * Same lock (`opts.lock`).
   */
  getHostSingleInTransaction(
    tx: PluginCollectionTransaction,
    slug: string,
    opts?: OwnSingleTransactionReadOpts
  ): Promise<SingleDocument>;
  /**
   * @experimental Which collections and Singles hold a field of a type this
   * plugin registered, at any depth, read on the transaction `tx` stands
   * for: the content the host reads above would accept, found without
   * naming it first.
   *
   * Each kind is listed whole, each entry as
   * `services.collections.listCollections` or `services.singles.list`
   * describes it, and judged by the rule the host reads judge a slug by,
   * from the fields read in the same statement as the entry itself, so a
   * collection or Single renamed or changed while the walk runs is listed
   * under the one name and judged by the one schema. A host read of a slug
   * listed here is therefore not refused on the same transaction unless the
   * schema changes after the walk. Those listings take a pooled connection,
   * which on a pool of one waits for the connection the transaction holds;
   * this reads on that connection, so it sees the schemas as the
   * transaction does.
   *
   * Its reads are a fixed handful whatever the number of entries: the
   * collections, the Singles, and every component's fields once some schema
   * names a component, each one statement, made one after another. The
   * components are the one read apart from the entries naming them: a
   * component renamed between the two reads, with the schemas naming it,
   * is not found under either name, and an entry holding the type only
   * through it is left out of that walk. It reads schemas only, never
   * content rows, so it takes none of the row locks the reads above take.
   *
   * The plugin's own collections and Singles are judged like any other, as
   * the host reads judge them: one is listed only when it holds such a
   * field itself. A plugin that registered no field type is answered empty
   * without reading anything. A settled token is refused before anything
   * is read.
   */
  listHostTypesInTransaction(
    tx: PluginCollectionTransaction
  ): Promise<PluginHostTypes>;
}

/**
 * @experimental What {@link PluginOwnCollectionReads.listHostTypesInTransaction}
 * answers: the content holding a field of a type the plugin registered.
 */
export interface PluginHostTypes {
  /**
   * Each collection holding one, as `services.collections.listCollections`
   * lists it, in slug order.
   */
  readonly collections: readonly Collection[];
  /**
   * Each Single holding one, as `services.singles.list` lists it, in the
   * order it lists them. A code-first Single's row that outlived its config
   * is included, as it is there, and says so with `source: "code"`.
   */
  readonly singles: readonly PluginSingleRecord[];
}

/**
 * The Singles a plugin declared, for its own reads of them: their RESOLVED
 * slugs, and the Singles service, resolved on first use.
 */
export interface OwnSinglesSource {
  owned: readonly string[];
  service: () => Pick<SingleEntryService, "get">;
}

/**
 * What a host read asks to decide whether a collection or Single holds a
 * field of a type the plugin registered: those types, and the schema as it
 * stands when it is asked.
 */
export interface HostSchemaSource {
  /** The field types the plugin registered (`contributes.fieldTypes`). */
  readonly fieldTypes: readonly string[];
  /** A collection's or a Single's declared fields, or null where there is none. */
  fieldsOf(
    kind: "collection" | "Single",
    slug: string
  ): Promise<readonly unknown[] | null>;
  /** A component's own fields, or null where there is none. */
  componentFields(slug: string): Promise<FieldConfig[] | null>;
  /**
   * The first `limit` collections, as `services.collections.listCollections`
   * lists them sorted by slug, each beside the fields it is judged by,
   * taken from the listed record itself as {@link fieldsOf} takes them from
   * a registry row. Its rows come from one statement, so a collection added,
   * removed or renamed while the walk runs cannot shift one past another or
   * be judged by a schema it did not have when listed.
   */
  listCollections(
    limit: number
  ): Promise<readonly HostListedEntry<Collection>[]>;
  /**
   * Every Single, as `services.singles.list` describes it, each beside its
   * declared fields as {@link fieldsOf} answers them, both from the one
   * statement that read its row. The description reduces each field and
   * drops the component it names, which the rule follows, so the declared
   * fields come beside it rather than from it.
   */
  listSingles(): Promise<readonly HostListedEntry<PluginSingleRecord>[]>;
  /**
   * Every component's own fields by slug, from one statement: for each, what
   * {@link componentFields} answers.
   */
  allComponentFields(): Promise<ReadonlyMap<string, FieldConfig[]>>;
}

/**
 * A collection or Single a host-types walk listed, beside the declared
 * fields it is judged by, both from the statement that read it.
 */
interface HostListedEntry<R> {
  readonly record: R;
  readonly fields: readonly unknown[];
}

/**
 * How many collections the host-types walk first asks the listing for. A
 * listing that comes back full is asked again from the start for twice as
 * many, until one comes back short and so holds every collection.
 */
export const HOST_TYPES_PAGE_SIZE = 100;

/**
 * Whether declared `fields` hold a field of one of `fieldTypes` at any
 * depth, `componentFields` answering each component they name; false for
 * content with no schema (`null`). The one rule a host read and the
 * host-types walk both judge by, whichever way each came by the fields.
 */
async function holdsOwnFieldType(
  fields: readonly unknown[] | null,
  fieldTypes: readonly string[],
  componentFields: (slug: string) => Promise<FieldConfig[] | null>
): Promise<boolean> {
  return (
    fields !== null &&
    (await holdsFieldOfType(fields, fieldTypes, componentFields))
  );
}

/**
 * Build the reads for one plugin's context.
 *
 * `owned` is the RESOLVED slug of each collection the plugin declared, so a
 * collection a host renamed is reached under the name it is stored as.
 */
export function ownCollectionReads(
  collections: CollectionService,
  owned: readonly string[],
  singles?: OwnSinglesSource,
  host?: HostSchemaSource
): PluginOwnCollectionReads {
  /**
   * Which slugs a read may skip the read hooks of, and how one outside them
   * is refused.
   */
  interface ReadGrant {
    grant: HookExemptRead;
    refuse: (slug: string) => NextlyError;
  }
  type Kind = "collection" | "Single";
  const notDeclared =
    (kind: Kind) =>
    (slug: string): NextlyError =>
      NextlyError.invalidInput({
        message: `"${slug}" is not a ${kind} this plugin declared, so it cannot be read without its hooks.`,
        logContext:
          kind === "collection"
            ? { reason: "own-collection-read-not-owned", collection: slug }
            : { reason: "own-single-read-not-owned", single: slug },
      });
  const holdsNoOwnField =
    (kind: Kind) =>
    (slug: string): NextlyError =>
      NextlyError.invalidInput({
        message: `"${slug}" holds no field of a type this plugin registered, so it cannot be read without its hooks.`,
        logContext:
          kind === "collection"
            ? { reason: "host-collection-read-not-eligible", collection: slug }
            : { reason: "host-single-read-not-eligible", single: slug },
      });

  // One grant per kind: a collection and a Single may share a slug, and a
  // grant for the one must not waive the other's hooks.
  const collection: ReadGrant = {
    grant: issueHookExemptRead(owned),
    refuse: notDeclared("collection"),
  };
  const single: ReadGrant = {
    grant: issueHookExemptRead(singles?.owned ?? []),
    refuse: notDeclared("Single"),
  };

  /**
   * The grant one host read runs under: the slug alone when it holds a field
   * of a type this plugin registered, nothing otherwise. Issued for the one
   * call, so it never widens the grants above and a slug found ineligible is
   * never waived. Asked inside the read's transaction scope, so the schema is
   * read as the transaction sees it, on its connection.
   */
  const hostGrant = async (kind: Kind, slug: string): Promise<ReadGrant> => {
    const source = host;
    const eligible =
      source !== undefined &&
      source.fieldTypes.length > 0 &&
      (await holdsOwnFieldType(
        await source.fieldsOf(kind, slug),
        source.fieldTypes,
        componentSlug => source.componentFields(componentSlug)
      ));
    return {
      grant: issueHookExemptRead(eligible ? [slug] : []),
      refuse: holdsNoOwnField(kind),
    };
  };

  /**
   * The content a host read would accept, kind by kind: each collection and
   * each Single the listings name, kept when {@link holdsOwnFieldType} says
   * its fields hold a field of a type this plugin registered, the question
   * `hostGrant` asks, so the two cannot disagree about a schema.
   *
   * Each entry is judged from the fields its own listing statement read,
   * never from a later read: on READ COMMITTED isolation each statement sees
   * the latest commit, so a schema read apart from its listing could name a
   * collection renamed in between under its new slug only, and the listed
   * one would find no schema. The reads run one after another on the
   * transaction's connection, a fixed handful whatever the number of entries,
   * since every read here holds the transaction, and on a pool of one every
   * other request too.
   */
  const listHostTypes = async (): Promise<PluginHostTypes> => {
    const source = host;
    if (source === undefined || source.fieldTypes.length === 0) {
      return { collections: [], singles: [] };
    }
    // A full listing may have stopped short of the last collection, so it is
    // asked again for more until one is short: each answer is a single
    // statement, consistent in itself, where pages taken by offset in
    // separate statements would shift past a collection added or removed
    // between them.
    let limit = HOST_TYPES_PAGE_SIZE;
    let listedCollections = await source.listCollections(limit);
    while (listedCollections.length >= limit) {
      limit *= 2;
      listedCollections = await source.listCollections(limit);
    }
    const listedSingles = await source.listSingles();
    // Read once, when a schema first names a component: the walk asks for
    // several at a time, and all of them wait on the one statement, so a
    // failed read fails them together and starts nothing after it.
    let components: Promise<ReadonlyMap<string, FieldConfig[]>> | undefined;
    const componentFields = async (
      slug: string
    ): Promise<FieldConfig[] | null> =>
      (await (components ??= source.allComponentFields())).get(slug) ?? null;
    const kept = async <R>(
      listed: readonly HostListedEntry<R>[]
    ): Promise<R[]> => {
      const holding: R[] = [];
      for (const { record, fields } of listed) {
        if (
          await holdsOwnFieldType(fields, source.fieldTypes, componentFields)
        ) {
          holding.push(record);
        }
      }
      return holding;
    };

    return {
      collections: await kept(listedCollections),
      singles: await kept(listedSingles),
    };
  };

  const read = async <T>(
    owner: ReadGrant,
    slug: string,
    opts: OwnCollectionReadOpts | undefined,
    run: (context: RequestContext) => Promise<T>
  ): Promise<T> => {
    // The grant is the precondition for the waiver, so a slug outside it is
    // refused before anything is resolved or read, and asked with the same
    // function the query services ask before skipping a hook.
    if (!readHooksWaived(owner.grant, slug)) throw owner.refuse(slug);
    // Named field by field, because what is left out is the point: a caller
    // passing `as`, `user` or a principal at runtime gets none of them.
    const resolved = await resolveServiceOpts({
      as: "system",
      context: opts?.context,
      locale: opts?.locale,
      fallbackLocale: opts?.fallbackLocale,
    });
    const context: RequestContext = {
      ...resolved,
      hookExemptRead: owner.grant,
    };
    // The same pins the ordinary facade puts around a system call. No person
    // from an enclosing request reaches this read, or a related row's hooks
    // inside it. A system call carries no scope of its own, so an API key's
    // scope from an enclosing request stays ambient, as it does on the
    // ordinary facade, and can only narrow what a related row shows, never
    // widen it.
    return runWithAccessMemo(() =>
      withCurrentLanguages(() =>
        runAsPrincipal(null, () =>
          runWithCallerScope(resolved.authenticatedScope, () => run(context))
        )
      )
    );
  };

  /**
   * Run `readOwned` on the transaction `token` stands for. The token is
   * checked as a write on it is (`wrapCollectionsForPlugin`): an unknown or
   * settled one is refused before anything runs, and the read is tracked on
   * its scope, so a read started and not awaited still finishes before the
   * transaction ends. Every read the services make inside it runs on the
   * transaction's connection (`runReadsInTransaction`).
   */
  const onTransaction = async <T>(
    token: PluginCollectionTransaction,
    readOwned: () => Promise<T>,
    lock: ReadLock = "share"
  ): Promise<T> => {
    const { tx, scope } = transactionOf(token);
    scope.assertOpen();
    return scope.track(runReadsInTransaction(tx, readOwned, lock), "read");
  };

  /** The Single's stored document, as the Singles read answers it. */
  const readSingle = async (
    slug: string,
    context: RequestContext
  ): Promise<SingleDocument> => {
    if (!singles) {
      // A context built with no Singles source owns no Single, and a plugin
      // context always has one; only a context built for a test with a host
      // schema source and no Singles service reaches this. Kept as a guard
      // over values in hand.
      throw NextlyError.internal({
        logContext: { reason: "own-single-read-without-service", single: slug },
      });
    }
    const result = await singles.service().get(slug, {
      overrideAccess: context.overrideAccess,
      // The grant the read was judged under: the plugin's own Singles, or
      // the one host Single this call found eligible.
      hookExemptRead: context.hookExemptRead,
      // A read writes nothing: a Single with no stored document answers the
      // default one a first read would create, built and not stored.
      createIfMissing: false,
      whenAbsent: "default",
      context: context.context,
      locale: context.locale,
      fallbackLocale: context.fallbackLocale,
    });
    if (!result.success) throw createErrorFromSingleResult(result);
    if (result.data === undefined) {
      // A read asked for the default document answers one when none is
      // stored, so a success with no document is a broken promise from the
      // read below, not a Single that is missing. Kept as a guard over values
      // in hand, and internal for that reason.
      throw NextlyError.internal({
        logContext: { reason: "own-single-read-no-document", single: slug },
      });
    }
    return result.data;
  };

  // Each read once, under whichever grant the caller holds: the plugin's own
  // collections, or the one host collection a host read found eligible.
  const listUnder =
    (owner: ReadGrant): PluginOwnCollectionReads["listEntries"] =>
    (slug, options, opts) =>
      read(owner, slug, opts, context =>
        collections.listEntries(slug, options, context)
      );
  const findUnder =
    (owner: ReadGrant): PluginOwnCollectionReads["findEntryById"] =>
    (slug, id, opts) =>
      read(owner, slug, opts, context =>
        collections.findEntryById(slug, id, context)
      );
  const getSingleUnder = (
    owner: ReadGrant,
    slug: string,
    opts: OwnCollectionReadOpts | undefined
  ): Promise<SingleDocument> =>
    read(owner, slug, opts, context => readSingle(slug, context));
  const listEntries = listUnder(collection);
  const findEntryById = findUnder(collection);

  return Object.freeze({
    listEntries,
    findEntryById,
    count: (slug, options, opts) =>
      read(collection, slug, opts, context =>
        collections.count(slug, options, context)
      ),
    group: (slug, options, opts) =>
      read(collection, slug, opts, context =>
        collections.group(slug, options, context)
      ),
    // The reads above, on the transaction: the same read, so the same answer.
    listEntriesInTransaction: (tx, slug, options, opts) =>
      onTransaction(tx, () => listEntries(slug, options, opts), opts?.lock),
    findEntryByIdInTransaction: (tx, slug, id, opts) =>
      onTransaction(tx, () => findEntryById(slug, id, opts), opts?.lock),
    getSingleInTransaction: (tx, slug, opts) =>
      onTransaction(tx, () => getSingleUnder(single, slug, opts), opts?.lock),
    // The same reads under a grant decided at the call, inside the
    // transaction's scope, before the service is reached.
    listHostEntriesInTransaction: (tx, slug, options, opts) =>
      onTransaction(
        tx,
        async () =>
          listUnder(await hostGrant("collection", slug))(slug, options, opts),
        opts?.lock
      ),
    findHostEntryByIdInTransaction: (tx, slug, id, opts) =>
      onTransaction(
        tx,
        async () =>
          findUnder(await hostGrant("collection", slug))(slug, id, opts),
        opts?.lock
      ),
    getHostSingleInTransaction: (tx, slug, opts) =>
      onTransaction(
        tx,
        async () => getSingleUnder(await hostGrant("Single", slug), slug, opts),
        opts?.lock
      ),
    // Listings and schemas only: no content row is read, so no grant is
    // issued, and the token is checked and the work tracked as above.
    listHostTypesInTransaction: tx => onTransaction(tx, listHostTypes),
  } satisfies PluginOwnCollectionReads);
}
