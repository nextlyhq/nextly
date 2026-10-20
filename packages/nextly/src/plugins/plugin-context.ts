/**
 * Plugin Context System
 *
 * Provides a type-safe context for plugins to access Nextly services.
 * Plugins receive this context during initialization, enabling them
 * to interact with core services and register hooks.
 *
 * @module plugins/plugin-context
 * @since 1.0.0
 */

import type {
  SupportedDialect,
  TransactionContext,
} from "@nextlyhq/adapter-drizzle/types";
import { getTableName, type AnyRelations, type Table } from "drizzle-orm";

import {
  readSubjectEvents,
  type SubjectEventsQuery,
} from "../api/subject-events";
import { runWithCallerScope } from "../auth/caller-scope";
import type { PluginAuthApi } from "../auth/plugin-auth-api";
import { runAsPrincipal } from "../auth/principal-scope";
import type { CollectionConfig } from "../collections/config/define-collection";
import type { NextlyServiceConfig } from "../di/register";
import {
  createJobsNamespace,
  type JobsNamespace,
} from "../direct-api/namespaces/jobs";
import type { ContentEventSubject } from "../domains/content-events/record";
import {
  pluginKeyScope,
  scopedSender,
  SITE_KEY_SCOPE,
} from "../domains/email/send-claims";
import type { PluginLimiter } from "../domains/limits/plugin-limiter";
import { getActiveExtensionSchema } from "../domains/schema/extension/build-extension-schema";
import type {
  ExtensionColumn,
  SchemaOwner,
} from "../domains/schema/extension/types";
import type { SingleRegistryService } from "../domains/singles/services/single-registry-service";
import type { VersionsService } from "../domains/versions/versions-service";
import { NextlyError } from "../errors/nextly-error";
import type { EventBus, EventHandler, EventName } from "../events/event-bus";
import { getEventBus, isReservedEventName } from "../events/event-bus";
import type { Action, Decision, Filter } from "../filters";
import { getFilterRegistry } from "../filters";
import type {
  BeforeOperationHandler,
  HookContextPhase,
  HookHandler,
  HookOwner,
} from "../hooks/types";
import { env } from "../lib/env";
import type { CollectionService } from "../services/collections/collection-service";
import type { EmailService } from "../services/email/email-service";
import type { MediaService } from "../services/media/media-service";
import type { Logger } from "../services/shared";
import type { UserService } from "../services/users/user-service";
import { runInPluginTransaction } from "../shared/lib/plugin-transaction-scope";
import {
  type AfterCommitAdapter,
  runAdapterTransaction,
} from "../shared/lib/run-adapter-transaction";
import { secretGenerations } from "../shared/lib/secret-generations";
import type { DatabaseInstance } from "../types/database-operations";

import type { AdminPlacement } from "./admin-placement";
import type { PluginContributions } from "./contributions";
import { getCoreVersion } from "./core-version";
import type { ContributedColumn } from "./database/access";
import {
  createPluginDatabase,
  type PluginDatabase,
} from "./database/plugin-database";
import type {
  HookPointContext,
  HookPointNameOf,
  HookPointPayload,
  HookPointValue,
} from "./hook-point-payloads";
import { createPayloadChecker, getDeclaredHookPoints } from "./hook-points";
import { createPluginLimits } from "./limits/plugin-limits";
import { createPluginAudit } from "./plugin-audit-provider";
import { getPluginAuthApi, getPluginAuthApiFor } from "./plugin-auth-provider";
import type { PluginCategory } from "./plugin-categories";
import { type PluginConfig, pluginConfigView } from "./plugin-config-view";
import { NO_PLUGIN_GRANTS, type PluginGrants } from "./plugin-consent";
import { currentDependencies } from "./plugin-dependencies";
import { createPluginFetchFor } from "./plugin-fetch-provider";
import { createPluginSettings } from "./plugin-settings-provider";
import { wrapSinglesForPlugin } from "./plugin-singles";
import type { PluginSinglesService } from "./plugin-singles";
import { isInPluginNamespace } from "./plugin-slug";
import { createPluginPrincipals } from "./principals/api";
import type { PluginPrincipalsApi, PrincipalRef } from "./principals/types";
import {
  createOneTimeSecrets,
  type OneTimeSecrets,
  type SecretsAdapter,
} from "./security/one-time-secrets";
import {
  createOpaqueSecrets,
  type OpaqueSecrets,
} from "./security/opaque-secrets";
import {
  createPasswordHelper,
  type PasswordHelper,
} from "./security/password-helper";
import type { PluginSelf } from "./self";
import { resolvePluginSelf } from "./self";
import { methodFacade } from "./service-facade";
import {
  resolveServiceOpts,
  wrapCollectionsForPlugin,
  type PluginCollectionService,
  type ServiceOpts,
} from "./service-opts";
import { buildPluginServicesNamespace } from "./services/plugin-services-registry";
import { recordPluginSubscription } from "./subscription-tracker";
import { type TransactionScope, transactionScope } from "./transaction-scope";

// The typed surface `ctx.db` is, under the names the package exports.
export type {
  PluginDatabase,
  PluginInsert,
  PluginTransaction,
} from "./database/plugin-database";

// ============================================================
// Plugin Hook Registry Interface
// ============================================================

/**
 * Simplified hook registry interface for plugins.
 *
 * Provides only the methods plugins should use (register/unregister hooks).
 * Internal methods like `execute()` and `clear()` are not exposed.
 *
 * @example
 * ```typescript
 * export const myPlugin = definePlugin({
 *   name: 'my-plugin',
 *
 *   async init(nextly) {
 *     // Register a beforeCreate hook
 *     nextly.hooks.on('beforeCreate', 'posts', async (context) => {
 *       context.data.slug = slugify(context.data.title);
 *       return context.data;
 *     });
 *
 *     // Register a global hook (all collections)
 *     nextly.hooks.on('afterCreate', '*', async (context) => {
 *       nextly.logger.info(`Created ${context.collection}:${context.data?.id}`);
 *     });
 *   }
 * });
 * ```
 */
export interface PluginHookRegistry {
  /**
   * Register a hook for a specific collection and hook type.
   *
   * @param hookType - Type of hook (beforeCreate, afterCreate, etc.)
   * @param collection - Collection name or '*' for global hooks
   * @param handler - Hook function to execute
   *
   * @example
   * ```typescript
   * // Collection-specific hook
   * nextly.hooks.on('beforeCreate', 'users', async (context) => {
   *   context.data.password = await bcrypt.hash(context.data.password, 10);
   *   return context.data;
   * });
   *
   * // Global hook (runs for all collections)
   * nextly.hooks.on('afterDelete', '*', async (context) => {
   *   console.log(`Deleted from ${context.collection}`);
   * });
   * ```
   *
   * @typeParam T - The document shape. Pass it to get a typed `context.data`
   *   instead of casting — prefer this over `as unknown as`:
   * ```typescript
   * interface Post { id: string; title: string; status: string }
   * nextly.hooks.on<Post>('beforeCreate', 'posts', (context) => {
   *   // context.data is typed Post — no cast needed
   *   if (context.data?.status === 'published') { ... }
   *   return context.data;
   * });
   * ```
   */
  on<T = unknown>(
    hookType: HookContextPhase,
    collection: string,
    handler: HookHandler<T>
  ): void;

  /**
   * Unregister a previously registered hook.
   *
   * @param hookType - Type of hook
   * @param collection - Collection name or '*'
   * @param handler - The exact handler function to remove
   *
   * @example
   * ```typescript
   * const myHook = async (context) => { ... };
   *
   * // Register
   * nextly.hooks.on('beforeCreate', 'posts', myHook);
   *
   * // Later, unregister
   * nextly.hooks.off('beforeCreate', 'posts', myHook);
   * ```
   */
  off<T = unknown>(
    hookType: HookContextPhase,
    collection: string,
    handler: HookHandler<T>
  ): void;

  /**
   * Register a `beforeOperation` hook.
   *
   * Separate from {@link on} because the handler is shaped differently: it
   * receives the operation's `args` -- the data, id or where clause about to be
   * used -- rather than a document, and returning a modified set replaces them.
   *
   * @param collection - Collection name or '*' for all collections
   * @param handler - Hook function to execute
   *
   * @example
   * ```typescript
   * nextly.hooks.onBeforeOperation('posts', (context) => {
   *   if (context.operation === 'read') {
   *     return { ...context.args, where: { ...context.args.where, archived: false } };
   *   }
   * });
   * ```
   */
  onBeforeOperation<T = unknown>(
    collection: string,
    handler: BeforeOperationHandler<T>
  ): void;

  /**
   * Unregister a `beforeOperation` hook, the counterpart to
   * {@link onBeforeOperation}.
   *
   * @param collection - Collection name or '*'
   * @param handler - The exact handler function to remove
   */
  offBeforeOperation<T = unknown>(
    collection: string,
    handler: BeforeOperationHandler<T>
  ): void;
}

/**
 * @experimental Typed filter registry exposed to plugins.
 * Register transforms on named seams, or define + apply your own seams.
 *
 * A point listed in `HookPointPayloads` is typed by its entry; any other
 * name by the type arguments, or by inference from the call. `N` comes last
 * so explicit `<V, C>` arguments mean what they did before it existed.
 */
export interface PluginFilterRegistry {
  /** Add a handler to a filter point, or to a decision point's chain. */
  add<V = unknown, C = unknown, N extends string = string>(
    name: HookPointNameOf<N, "filter" | "decision">,
    fn: Filter<HookPointValue<N, V>, HookPointContext<N, C>>
  ): void;
  remove<V = unknown, C = unknown, N extends string = string>(
    name: HookPointNameOf<N, "filter" | "decision">,
    fn: Filter<HookPointValue<N, V>, HookPointContext<N, C>>
  ): void;
  apply<V = unknown, C = unknown, N extends string = string>(
    name: HookPointNameOf<N, "filter">,
    value: HookPointValue<N, V>,
    context: HookPointContext<N, C>
  ): Promise<HookPointValue<N, V>>;
  /**
   * Run a VETO point, which fails closed.
   *
   * Filters are error-isolated, so a handler that vetoed by throwing would be
   * skipped and the chain would answer allow. A decision is a value instead: a
   * throwing handler denies, and a handler may only keep or downgrade the
   * verdict, so load order cannot decide access.
   */
  decide<C = unknown, N extends string = string>(
    name: HookPointNameOf<N, "decision">,
    initial: Decision,
    context?: HookPointContext<N, C>
  ): Promise<Decision>;
}

/**
 * @experimental Typed action registry exposed to plugins.
 * Register ordered, error-isolated side-effects on named seams, or run your own.
 *
 * Typed by `HookPointPayloads` as {@link PluginFilterRegistry} is.
 */
export interface PluginActionRegistry {
  add<P = unknown, C = unknown, N extends string = string>(
    name: HookPointNameOf<N, "action">,
    fn: Action<HookPointPayload<N, P>, HookPointContext<N, C>>
  ): void;
  remove<P = unknown, C = unknown, N extends string = string>(
    name: HookPointNameOf<N, "action">,
    fn: Action<HookPointPayload<N, P>, HookPointContext<N, C>>
  ): void;
  run<P = unknown, C = unknown, N extends string = string>(
    name: HookPointNameOf<N, "action">,
    payload: HookPointPayload<N, P>,
    context: HookPointContext<N, C>
  ): Promise<void>;
}

// ============================================================
// Plugin Context Interface
// ============================================================

/**
 * PluginContext - Type-safe context for plugin service access.
 *
 * Plugins receive this context during initialization, providing
 * access to all Nextly services and infrastructure.
 *
 * The context provides:
 * - `services`: Core business logic services (collections, users, media, email)
 * - `db`: Typed, owner-checked access to the plugin's tables, with Drizzle's
 *   fluent builder as the `db.raw` escape hatch
 * - `logger`: Diagnostics logger
 * - `events`: Post-commit, observe-only event bus
 * - `self` / `nextlyVersion`: Resolved own-entity names + core version
 * - `config`: Read-only configuration
 * - `hooks`: Hook registration for lifecycle events
 *
 * @example
 * ```typescript
 * import { definePlugin, NextlyError } from '@nextlyhq/plugin-sdk';
 *
 * export const myPlugin = definePlugin({
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *
 *   async init(nextly) {
 *     // Access services with full TypeScript autocomplete
 *     const { collections, users, media } = nextly.services;
 *
 *     // Register hooks
 *     nextly.hooks.on('beforeCreate', 'posts', async (context) => {
 *       // Validate that author exists
 *       const author = await users.findById(context.data.authorId, {});
 *       if (!author) {
 *         // A NextlyError, not a plain one: a plain Error reads as a crash and
 *         // its message is replaced before the caller sees it.
 *         throw NextlyError.validation({
 *           errors: [
 *             { path: 'authorId', code: 'NOT_FOUND', message: 'Author not found.' },
 *           ],
 *         });
 *       }
 *       return context.data;
 *     });
 *
 *     // Use infrastructure
 *     nextly.logger.info('MyPlugin initialized');
 *   }
 * });
 * ```
 */
/**
 * The methods of each core service a plugin receives at `ctx.services`. A
 * service instance carries the adapter and Drizzle handle its methods run on,
 * so a plugin is handed a facade of these methods (`methodFacade`) and
 * nothing else.
 */
const PLUGIN_USER_METHODS = [
  "create",
  "findById",
  "listUsersByIds",
  "findByEmail",
  "listUsers",
  "update",
  "delete",
  "authenticate",
  "changePassword",
  "hasPassword",
  "updateProfile",
] as const satisfies readonly (keyof UserService)[];

const PLUGIN_MEDIA_METHODS = [
  "upload",
  "findById",
  "listMedia",
  "update",
  "delete",
  "bulkUpload",
  "bulkDelete",
  "moveToFolder",
  "getStorageType",
  "hasStorage",
  "createFolder",
  "findFolderById",
  "listRootFolders",
  "listSubfolders",
  "getFolderContents",
  "updateFolder",
  "deleteFolder",
  "isImage",
  "validateImage",
  "getImageDimensions",
] as const satisfies readonly (keyof MediaService)[];

const PLUGIN_EMAIL_METHODS = [
  "send",
  "sendWithTemplate",
  "sendPasswordResetEmail",
  "sendEmailVerificationEmail",
  "sendWelcomeEmail",
  "isConfigured",
  "canSendTemplate",
] as const satisfies readonly (keyof EmailService)[];

const PLUGIN_VERSIONS_METHODS = [
  "list",
  "get",
  "setLabel",
  "deleteWorkingDraft",
  "autosave",
  "getAutosave",
  "pendingEditRows",
] as const satisfies readonly (keyof VersionsService)[];

/** @experimental `ctx.services.users`: the plugin view of the user service. */
export type PluginUserService = Pick<
  UserService,
  (typeof PLUGIN_USER_METHODS)[number]
>;
/** @experimental `ctx.services.media`. */
export type PluginMediaService = Pick<
  MediaService,
  (typeof PLUGIN_MEDIA_METHODS)[number]
>;
/** @experimental `ctx.services.email`. */
export type PluginEmailService = Pick<
  EmailService,
  (typeof PLUGIN_EMAIL_METHODS)[number]
>;
/** @experimental `ctx.services.versions`. */
export type PluginVersionsService = Pick<
  VersionsService,
  (typeof PLUGIN_VERSIONS_METHODS)[number]
> & {
  /**
   * @experimental A subject's content events (a document's or a release's),
   * filtered by kind and part, newest first, as `{ items, meta }`; the next
   * page passes the last item's id as `before`. Runs as the system unless
   * `opts` names a user (`as: "user"`), who is then judged as REST judges them.
   */
  listEvents(
    subject: ContentEventSubject,
    query?: SubjectEventsQuery,
    opts?: ServiceOpts
  ): ReturnType<typeof readSubjectEvents>;
};

/**
 * The plugin path to a subject's events: the one read REST and the Direct API
 * use, with the caller translated from {@link ServiceOpts} by the rule every
 * plugin service uses. A plugin-defined person resolves to no user here, so
 * reads nothing: events have no rule a principal can be judged by yet.
 */
async function readEventsForPlugin(
  subject: ContentEventSubject,
  query: SubjectEventsQuery = {},
  opts: ServiceOpts = {}
): ReturnType<typeof readSubjectEvents> {
  const caller = await resolveServiceOpts(opts);
  // Pinned as `services.collections` pins its calls: the person the call names,
  // or none, and the scope it resolved, so the document's hooks judge this
  // caller rather than whichever frame the plugin was running in.
  return runAsPrincipal(opts.principal ?? null, () =>
    runWithCallerScope(caller.authenticatedScope, () =>
      readEventsAs(subject, query, caller)
    )
  );
}

/** The read itself, as the caller resolved from the plugin's options. */
function readEventsAs(
  subject: ContentEventSubject,
  query: SubjectEventsQuery,
  caller: Awaited<ReturnType<typeof resolveServiceOpts>>
): ReturnType<typeof readSubjectEvents> {
  return readSubjectEvents(subject, query, {
    overrideAccess: caller.overrideAccess,
    ...(caller.user === undefined ? {} : { user: caller.user }),
    ...(caller.authenticatedScope === undefined
      ? {}
      : { authenticatedScope: caller.authenticatedScope }),
    // What the plugin handed its hooks, so a hook that narrows reads by them
    // answers here as it would through `services.collections`.
    ...(caller.request === undefined ? {} : { request: caller.request }),
    ...(caller.context === undefined ? {} : { context: caller.context }),
  });
}

export interface PluginContext {
  /**
   * @public Core services with full TypeScript autocomplete — the managed,
   * secure-by-default data path. Prefer this over `ctx.db`.
   *
   * Provides access to the unified service layer for:
   * - Collections: CRUD operations on dynamic collections
   * - Users: User management and authentication
   * - Media: File upload and management
   */
  services: {
    /**
     * Collection service for CRUD on dynamic collections. Access methods accept
     * `ServiceOpts` (`as`/`user`) — secure-by-default; no-user runs as system.
     */
    collections: PluginCollectionService;
    /**
     * User service for user management.
     *
     * A plugin may create and update accounts, but not decide who administers
     * the site: a create on an install with no account yet, and a create or
     * update giving a role that reaches `super-admin` (directly or by
     * inheritance), and an update to the password, email, activation,
     * verification or roles of an account that reaches it, or its deletion,
     * are refused with `NextlyError` code `FORBIDDEN`. So is an update that
     * would leave an account active, verified and without a password, or move
     * such an account to another address: core makes that account for an
     * externally verified identity, only when an app's login plugin hands it
     * a sign-in. A create cannot make one, since it requires a password and,
     * once an account exists, refuses its absence with `VALIDATION_ERROR`. An
     * address a plugin vouches for is recorded as verified by `"plugin"`.
     */
    users: PluginUserService;
    /** Media service for file operations */
    media: PluginMediaService;
    /** Email service for sending emails via templates and providers */
    email: PluginEmailService;
    /**
     * @experimental Read-only content version history (list/get), and a
     * subject's content events (`listEvents`). Restore and diff arrive in
     * later stages.
     */
    versions: PluginVersionsService;
    /**
     * @experimental Read-only registry access to the app's Singles: which are
     * declared, and what fields they have.
     *
     * The counterpart to `collections` for the other kind of content. Without
     * it a plugin can enumerate collections and is simply blind to Singles, so
     * anything that sweeps the app's documents silently covers half of it —
     * which is how a usage index reports a class as unreferenced while a
     * homepage still renders it.
     *
     * Addressed by SLUG, because a Single's row may not exist until something
     * writes to it. Listing creates nothing; see `plugin-singles`.
     */
    singles: PluginSinglesService;
    /**
     * @experimental Queue background work — `ctx.services.jobs.queue({...})`.
     *
     * Declaring a job type is `defineJob` in `contributes.jobs`; this is how a
     * plugin asks for one of them to happen.
     */
    jobs: JobsNamespace;
    /**
     * @experimental Services contributed by plugins, keyed by plugin name
     * then service name. Lazily resolved (instantiated on first access). Runtime
     * type is `unknown` — cast to your service's type, or export it from the
     * providing plugin.
     */
    plugins: Record<string, Record<string, unknown>>;
  };

  /**
   * @experimental Typed, owner-checked access to the tables this plugin
   * declared (`contributes.schema`), its dependencies' tables, and the columns
   * it contributed to other tables (`db.contributed`). The same on every
   * dialect; `db.transaction` makes several writes atomic.
   *
   * `db.raw` is the handle this property used to be: Drizzle's fluent builder
   * (`select`, `insert`, `update`, `delete`) and a `transaction`, with no
   * ownership check and no portability guarantee. Unmanaged either way: both
   * bypass validation, hooks, access control and events, so prefer
   * `services` for content. `db.raw` has no `execute` or `run` unless the
   * plugin declares `capabilities.db.rawSql` AND the app lists it in
   * `db.rawSqlPlugins`; then it is the live Drizzle instance. That is a
   * reviewed grant, not a sandbox: plugins run as trusted code.
   */
  db: PluginDatabase & { raw: PluginRawDatabase };

  /**
   * @experimental Which database this installation runs on.
   *
   * Exposed because a plugin cannot always be dialect-blind and had no way to
   * ask. `isUniqueViolation(dialect, error)` is the case that forced it: the
   * classification falls back to matching driver MESSAGES for MySQL and
   * SQLite, so it needs to be told which dialect produced the error, and a
   * helper guessing across all three would read a MySQL phrase in a
   * PostgreSQL message as a duplicate key.
   */
  dialect: SupportedDialect;

  /** @experimental Logger for plugin diagnostics. */
  logger: Logger;

  /**
   * @public Post-commit, observe-only, best-effort event bus.
   * Use a hook to modify/abort; use an event to react/notify.
   */
  events: EventBus;

  /**
   * @experimental Running Nextly core version, for feature-detection.
   * e.g. "0.0.2-alpha.21".
   */
  nextlyVersion: string;

  /**
   * @experimental Resolved names for this plugin's own entities. Read
   * `ctx.self.collections[...]` instead of hardcoding slugs so the P2 remap can
   * rename them transparently. Identity-resolved.
   */
  self: PluginSelf;

  /**
   * @experimental Read-only application configuration: the plain values in
   * the service configuration, and none of its live handles. See
   * `PluginConfig` for what is included. Frozen.
   */
  config: PluginConfig;

  /**
   * @experimental Hook registration for lifecycle events. Allows plugins to
   * register hooks that run before/after database operations on collections.
   * No first-party plugin registers via `ctx.hooks` yet (see STABILITY.md).
   */
  hooks: PluginHookRegistry;

  /** @experimental Typed filter registry. Transform values at named seams. */
  filters: PluginFilterRegistry;

  /** @experimental Typed action registry. Ordered side-effects at named seams. */
  actions: PluginActionRegistry;

  /**
   * @experimental Finishing a login the plugin authenticated elsewhere, and
   * reading who is signed in.
   *
   * The only supported way for a plugin to turn a verified external identity
   * into a session: it applies the same account-state rules, hooks and audit
   * trail as the password path, so a plugin cannot accidentally grant a
   * session core would have refused.
   */
  auth: PluginAuthApi;

  /**
   * @experimental Core's security helpers, lent to the plugin for the people
   * it signs in itself: `passwords` hashes, verifies and checks passwords.
   *
   * Independent of the staff path's hashing and of an app's
   * `passwordHasher`: a plugin's people never share a format with staff.
   */
  security: PluginSecurityApi;

  /**
   * @experimental This plugin's stored configuration.
   *
   * Present only when the plugin declares `contributes.settings`. Values are
   * parsed with that schema, and the keys named in `capabilities.secrets` are
   * encrypted at rest and never returned to the admin.
   */
  settings?: PluginSettingsApi;

  /**
   * @experimental Outbound HTTP, limited to the hosts this plugin declared in
   * `capabilities.net.outbound`.
   *
   * Undefined for a plugin that declared none, so reaching the network is
   * something a plugin has to have asked for where a reviewer sees it. Names
   * are resolved here and every answer vetted, and the request is sent to the
   * address that was vetted — so a name that resolves differently the second
   * time cannot redirect it inward.
   */
  fetch?: (
    input: string | URL | Request,
    init?: RequestInit
  ) => Promise<Response>;

  /**
   * @experimental Writing to the audit trail.
   *
   * Present only when the plugin declares `contributes.audit`. Never throws,
   * like the core writer: an audit write is a side effect of whatever the
   * plugin was really doing, and failing that because a row could not be
   * stored would be the worse outcome.
   */
  audit?: PluginAuditApi;

  /**
   * @experimental Recognising a person of this plugin's own kinds of
   * signed-in person on a request.
   *
   * Present only when the plugin registers a kind in
   * `contributes.principals`. Shares the request's answer with every other
   * entry point asking for the same kind, so the kind's resolver runs at most
   * once per request. A write from another site gets nobody, as
   * `auth.currentUser` gives it no user.
   */
  principals?: PluginPrincipalsApi;

  /**
   * @experimental This plugin's limiter: reserve an attempt on keys the
   * plugin chooses, before the work it guards runs, under the rules it
   * declared in `contributes.limits`.
   *
   * Present only when the plugin declares a rule. Reserve before opening a
   * transaction: `reserve`, `release` and `reset` throw inside one, since a
   * count must never roll back with the work it guarded.
   */
  limits?: PluginLimiter;
}

/** @experimental Core's security helpers on `ctx.security`. */
export interface PluginSecurityApi {
  /** Hashing, verifying and checking passwords. */
  readonly passwords: PasswordHelper;
  /** Random secrets for the plugin's own records, with a stable hash. */
  readonly opaque: OpaqueSecrets;
  /** One-purpose links and codes, spent once. */
  readonly secrets: OneTimeSecrets;
}

/** @experimental Writing one plugin's declared audit events. */
export interface PluginAuditApi {
  write(event: {
    kind: string;
    actorUserId?: string | null;
    /**
     * The account the event is about. Must be an existing user's id, or the
     * row is stored without its `metadata` and a warning is logged naming the
     * kind, with only this value's length and whether it has a user id's
     * shape, never the value: a deleted target and one that never existed
     * look the same, and neither may keep data about them.
     */
    targetUserId?: string | null;
    /**
     * @experimental A plugin-defined signed-in person who acted, by kind and
     * id (a `Principal` will do). Never pass a person's id as `actorUserId`:
     * that column names staff users, and an id naming none is stored as an
     * erased account's. A row naming a person keeps its address, client and
     * metadata until their plugin reports them deleted; one written after
     * that is stored already erased. Not with `actorUserId`.
     */
    actorPrincipal?: PrincipalRef | null;
    /**
     * @experimental A plugin-defined signed-in person the event is about, as
     * `actorPrincipal` names one. Never pass a person's id as
     * `targetUserId`. Not with `targetUserId`.
     */
    targetPrincipal?: PrincipalRef | null;
    request?: Request;
    metadata?: Record<string, string | number | boolean>;
  }): Promise<void>;
}

/**
 * @experimental A JSON merge patch (RFC 7396) of a plugin's settings: any key
 * may be left out at any depth, and `null` removes it. An array is replaced
 * whole.
 */
export type SettingsPatch<T> = {
  [K in keyof T]?: SettingsPatchValue<T[K]> | null;
};

/**
 * What a patch may hold for one member. `V` is a naked type parameter, so the
 * conditional distributes over a union: an optional or nullable group is a
 * partial in its object branch while `undefined` and `null` stay as they are.
 * `object` rather than `Record<string, unknown>`, which a group declared as an
 * interface does not satisfy.
 */
type SettingsPatchValue<V> = V extends readonly unknown[]
  ? V
  : V extends object
    ? SettingsPatch<V>
    : V;

/** @experimental Reading and writing one plugin's settings. */
export interface PluginSettingsApi<
  T extends Record<string, unknown> = Record<string, unknown>,
> {
  /**
   * Parsed with the declared schema; missing keys take its defaults. Throws
   * an internal error, with the detail in the log, when the stored settings
   * no longer fit the schema or hold a secret nothing can decrypt.
   */
  get(): Promise<T>;
  /**
   * Apply a merge patch: keys left out keep their stored value at every
   * depth, and `null` removes a key. The result is validated against the
   * whole schema, its secrets encrypted, and stored.
   */
  set(patch: SettingsPatch<T>, opts?: { actorUserId?: string }): Promise<void>;
}

// ============================================================
// Plugin Admin Appearance Interface
// ============================================================

/**
 * Sidebar appearance customization for plugins.
 *
 * Allows plugin authors to customize how their plugin appears
 * in the admin sidebar. All fields are optional — unset fields
 * use sensible defaults (Package icon, plugin name as label).
 *
 * @example
 * ```typescript
 * admin: {
 *   appearance: {
 *     icon: "BarChart",       // Lucide icon name
 *     label: "Analytics",     // Custom sidebar label
 *     badge: "Beta",          // Badge text
 *     badgeVariant: "secondary",
 *   },
 * }
 * ```
 */
export interface PluginAdminAppearance {
  /** Lucide icon name for the plugin's sidebar entry */
  icon?: string;
  /**
   * URL of an image the plugin ships, for a plugin that wants its own branding
   * rather than a built-in glyph. Takes precedence over `icon` where both are
   * declared, and the admin scales it rather than cropping, so a rectangular
   * logo keeps its proportions.
   *
   * `icon` remains the common case: a lucide name is theme-aware by
   * construction, while an image has to work on both the light and the dark
   * surface on its own.
   */
  iconAsset?: string;
  /** Custom label override (defaults to plugin name) */
  label?: string;
  /** Badge text shown next to the plugin name (e.g., "Beta", "New") */
  badge?: string;
  /** Badge variant for styling */
  badgeVariant?: "default" | "secondary" | "destructive" | "outline";
}

/**
 * Controlled vocabulary for the admin plugins list's category filter.
 *
 * Defined in `./plugin-categories`, which has no imports so the admin can take
 * it from `nextly/config` without the plugin runtime. Re-exported here because
 * this is the module a plugin author already imports to declare one.
 */
export {
  PLUGIN_CATEGORIES,
  isPluginCategory,
  type PluginCategory,
} from "./plugin-categories";

// ============================================================
// Plugin Admin Config Interface
// ============================================================

/**
 * Plugin admin configuration for sidebar placement and appearance.
 *
 * Allows plugins to declare their sidebar placement, sort order,
 * appearance customization, and description for the plugin settings page.
 *
 * @example
 * ```typescript
 * import { definePlugin, AdminPlacement } from 'nextly';
 *
 * export const analyticsPlugin = definePlugin({
 *   name: 'Analytics Dashboard',
 *   admin: {
 *     placement: AdminPlacement.USERS,
 *     order: 60,
 *     description: 'User analytics and insights',
 *     appearance: {
 *       icon: 'BarChart',
 *       label: 'Analytics',
 *       badge: 'Beta',
 *       badgeVariant: 'secondary',
 *     },
 *   },
 * });
 * ```
 */
export interface PluginAdminConfig {
  /**
   * Immutable sidebar placement for this plugin's items.
   *
   * Use `AdminPlacement` constants for TypeScript autocomplete:
   * - `AdminPlacement.COLLECTIONS` (Collections section)
   * - `AdminPlacement.SINGLES` (Singles section)
   * - `AdminPlacement.USERS` (Users inner sidebar)
   * - `AdminPlacement.SETTINGS` (Settings inner sidebar)
   * - `AdminPlacement.PLUGINS` (Plugins section, default)
   *
   * If not set, falls back to `"plugins"`.
   */
  placement?: AdminPlacement;

  /** Sort order when placed in a group (lower = higher position, default: 100) */
  order?: number;

  /**
   * Position anchor for standalone plugins.
   * Specifies which built-in sidebar section this plugin's icon appears after.
   *
   * Valid values: `"dashboard"` | `"collections"` | `"singles"` | `"media"` | `"plugins"` | `"users"`
   *
   * Only applies when `placement` is `AdminPlacement.STANDALONE`.
   * If multiple standalone plugins share the same `after`, they are sorted by `order`.
   * Defaults to `"plugins"` (after the Plugins icon).
   *
   * @example
   * ```ts
   * admin: {
   *   placement: AdminPlacement.STANDALONE,
   *   after: "collections", // icon appears right after Collections
   *   order: 10,
   * }
   * ```
   */
  after?:
    | "dashboard"
    | "collections"
    | "singles"
    | "media"
    | "plugins"
    | "users"
    | "settings";

  /** Plugin description shown on the plugin settings page */
  description?: string;

  /** Sidebar appearance customization (icon, label, badge) */
  appearance?: PluginAdminAppearance;
}

// ============================================================
// Plugin Definition Interface
// ============================================================

/**
 * Plugin definition interface.
 *
 * Defines the structure of a Nextly plugin. Plugins can:
 * - Initialize with access to PluginContext
 * - Transform configuration before services are registered
 *
 * @example
 * ```typescript
 * import { definePlugin } from 'nextly';
 *
 * export const auditLogPlugin = definePlugin({
 *   name: 'audit-log',
 *   version: '1.0.0',
 *
 *   async init(nextly) {
 *     // Log all create/update/delete operations
 *     const logOperation = async (context) => {
 *       nextly.logger.info('Audit', {
 *         collection: context.collection,
 *         operation: context.operation,
 *         user: context.user?.id,
 *         timestamp: new Date().toISOString(),
 *       });
 *     };
 *
 *     nextly.hooks.on('afterCreate', '*', logOperation);
 *     nextly.hooks.on('afterUpdate', '*', logOperation);
 *     nextly.hooks.on('afterDelete', '*', logOperation);
 *   }
 * });
 * ```
 */
export interface PluginDefinition {
  /**
   * Unique plugin name.
   * Used for identification and error messages.
   */
  name: string;

  /**
   * Plugin semver version.
   * Required so that other plugins' `dependsOn` ranges can be checked.
   */
  version: string;

  /**
   * @public Author shown in the admin plugins list (a person or an
   * organization). Convention: mirror the package.json `author` value.
   */
  author?: string;

  /**
   * @public Homepage URL, linked from the admin plugin detail page.
   * Convention: mirror the package.json `homepage` value.
   */
  homepage?: string;

  /**
   * @public Source repository URL, linked from the admin plugin detail page.
   * Convention: mirror the package.json `repository` URL.
   */
  repository?: string;

  /**
   * @public Documentation URL, when the docs live somewhere other than the
   * homepage. Omit if `homepage` already points at the docs.
   */
  docsUrl?: string;

  /**
   * @public SPDX license identifier (e.g. `"MIT"`), shown on the admin plugin
   * detail page. Convention: mirror the package.json `license` value.
   */
  license?: string;

  /**
   * @public Category the admin plugins list groups and filters by.
   * A controlled vocabulary rather than free text so filtering stays useful.
   */
  category?: PluginCategory;

  /**
   * @public Free-form descriptive tags, shown on the admin plugin detail
   * page. Unlike `category` these are not used for filtering.
   */
  tags?: string[];

  /**
   * @public Core-compatibility range, boot-checked. May span majors,
   * e.g. `'^1 || ^2'`. Prereleases (alpha/beta) count as in-range.
   */
  nextly: string;

  /**
   * @experimental Required plugin dependencies → version range.
   * Plugins are topologically sorted so dependencies initialize first.
   */
  dependsOn?: Record<string, string>;

  /**
   * @experimental Enhance-if-present dependencies → version range.
   * Absent optional deps are fine; present-but-incompatible fails fast.
   */
  optionalDependsOn?: Record<string, string>;

  /**
   * @experimental Default `true`. `false` skips behavior (init/hooks/events/
   * routes/admin) but STILL applies declarative schema. Behavior-skip is
   * wired.
   */
  enabled?: boolean;

  /**
   * @experimental What this plugin may do beyond its own tables and routes.
   *
   * A reviewable contract rather than a sandbox: Nextly runs plugins as
   * trusted code, and this makes their reach legible before installation. The
   * runtime surfaces read it — `ctx.fetch` exists only for a plugin that
   * declared the hosts it calls.
   */
  capabilities?: PluginCapabilities;

  /** @experimental Capability names this plugin implements, e.g. "auth-provider". */
  provides?: string[];

  /**
   * @experimental Capability → the semver range a providing plugin must
   * satisfy, matched against THAT PLUGIN's version.
   *
   * Checked at boot; it does not order initialisation. A plugin that needs
   * another to have run its `init` first says so with `dependsOn`.
   */
  requires?: Record<string, string>;

  /**
   * @experimental The version of this plugin's own schema, as a positive
   * integer.
   *
   * Validated as a positive integer at resolve time, and recorded — it is NOT
   * yet compared against what a database has applied, because no plugin
   * migration state exists to compare it with. A plugin can therefore boot at
   * a newer code version than its tables, which is exactly the case this field
   * will stop once that state does exist. Described here as what it does
   * rather than what it is for, because a contract nothing enforces reads to a
   * plugin author as a guarantee.
   */
  schemaVersion?: number;

  /**
   * @public Declarative contributions — introspectable without running
   * the plugin. Consumed incrementally by later phases. See {@link PluginContributions}.
   */
  contributes?: PluginContributions;

  /**
   * Collections provided by this plugin.
   *
   * @deprecated Prefer `contributes.collections` (wired by the schema pipeline in
   * P2). Still read by the admin sidebar (routeHandler) — kept for backward
   * compatibility and merged today via the plugin's own `setup` transformer.
   */
  collections?: CollectionConfig[];

  /**
   * Admin configuration for sidebar placement and plugin metadata.
   *
   * Controls where the plugin's items appear in the sidebar (placement/order)
   * and its appearance + settings-page blurb. This is **complementary** to
   * `contributes.admin`: `admin` = placement & appearance; `contributes.admin`
   * = the declarative menu/pages/settings/views surface. Both are retained.
   */
  admin?: PluginAdminConfig;

  /**
   * @public Escape-hatch config transformer; all `setup`s run before any
   * `init`. Don't mutate the config — spread and return a new object.
   *
   * @param config - Current configuration
   * @returns Modified configuration
   */
  setup?: (config: NextlyServiceConfig) => NextlyServiceConfig;

  /**
   * @public Plugin initialization function.
   *
   * Called after all services are registered.
   * Receives PluginContext for service access and hook registration.
   *
   * @param context - PluginContext with services, db, logger, events, config, hooks
   */
  init?: (context: PluginContext) => Promise<void> | void;

  /**
   * @experimental Runs once per boot, after EVERY plugin's `init` and after
   * routes are registered.
   *
   * `init` cannot see the finished system: plugins initialise in dependency
   * order, so anything a plugin does there observes only the part of the boot
   * that has already happened. A plugin that wants to read the assembled
   * picture — every route, every contributed service — does it here.
   *
   * A throw fails boot, exactly as one from `init` does: a plugin that cannot
   * finish starting has not started.
   */
  onReady?: (context: PluginContext) => Promise<void> | void;

  /**
   * @experimental Runs when the plugin is INSTALLED, after its migrations.
   *
   * Never called during an ordinary boot, so it is the right place for
   * one-time setup — seeding a row, registering with an external service —
   * that would otherwise run on every start. Must be idempotent regardless: an
   * install can be retried after a failure part-way through.
   */
  onInstall?: (context: PluginContext) => Promise<void> | void;

  /**
   * @experimental Runs when the plugin is UNINSTALLED, before its down
   * migrations, so its tables are still readable.
   *
   * `keepData` tells it which kind of uninstall this is: with data kept, the
   * tables survive and an external deregistration may still be wanted; without
   * it, this is the last moment anything can read them.
   */
  onUninstall?: (
    context: PluginContext,
    opts: { keepData: boolean }
  ) => Promise<void> | void;

  /**
   * @public Teardown on shutdown / HMR / test teardown.
   * Invocation is wired.
   */
  destroy?: (context: PluginContext) => Promise<void> | void;

  /**
   * @experimental Framework-owned entity remap. Rename this plugin's
   * contributed entity slugs at registration — declared slug → new slug — to
   * avoid collisions or match house naming. Returns a NEW definition; the
   * plugin keeps working because it references its own entities via `ctx.self`.
   *
   * @example
   * ```ts
   * defineConfig({ plugins: [formBuilder().plugin.rename({ forms: "contact-forms" })] })
   * ```
   */
  rename?: (map: Record<string, string>) => PluginDefinition;

  /**
   * @internal Accumulated declared-slug → new-slug map from `rename()`.
   * Consumed by the schema fold (renames merged slugs + the plugin's own
   * `relationTo`) and by `resolvePluginSelf` (builds `ctx.self`). Not for
   * plugin authors to set directly.
   */
  renameMap?: Record<string, string>;
}

// ============================================================
// Helper Functions
// ============================================================

/**
 * Define a plugin with type safety.
 *
 * This is a helper function that provides TypeScript autocomplete
 * when defining plugins. It simply returns the definition as-is.
 *
 * @param definition - Plugin definition
 * @returns The same definition (for type inference)
 *
 * @example
 * ```typescript
 * import { definePlugin } from 'nextly';
 *
 * export const myPlugin = definePlugin({
 *   name: 'my-plugin',
 *   version: '1.0.0',
 *
 *   async init(nextly) {
 *     // Full TypeScript autocomplete available
 *     nextly.services.collections.listCollections();
 *   }
 * });
 * ```
 */
export type {
  PluginConfig,
  PluginEmailSettings,
  PluginSummary,
} from "./plugin-config-view";

export function definePlugin(definition: PluginDefinition): PluginDefinition {
  const withRename: PluginDefinition = {
    ...definition,
    // Framework remap: returns a NEW definition with the rename map
    // merged. The original is left untouched (pure); chainable.
    rename(map: Record<string, string>): PluginDefinition {
      return definePlugin({
        ...withRename,
        renameMap: { ...(withRename.renameMap ?? {}), ...map },
      });
    },
  };
  return withRename;
}

/**
 * Create a PluginContext from the DI container.
 *
 * This factory function creates a PluginContext by retrieving
 * services from the container. It should be called after
 * `registerServices()` has been invoked.
 *
 * The config is frozen to prevent accidental modification.
 *
 * @param getServiceFn - Function to get services from container
 * @param hookRegistry - Hook registry for plugin hook registration
 * @returns Fully initialized PluginContext
 *
 * @example
 * ```typescript
 * import { getService, getHookRegistry } from 'nextly';
 *
 * // Create context for plugin initialization
 * const context = createPluginContext(getService, getHookRegistry());
 *
 * // Initialize plugins
 * for (const plugin of plugins) {
 *   await plugin.init?.(context);
 * }
 * ```
 *
 * @internal Core wiring, not an entry point for plugin authors. The DI
 * container and the auth deps bridge build a context; a plugin receives one.
 * It is absent from `@nextlyhq/plugin-sdk` and from that package's
 * STABILITY.md for that reason.
 *
 * `getServiceFn` is typed from {@link PLUGIN_SERVICE_NAMES}, so a resolver must
 * answer every name in that list.
 */
/**
 * Every service name `createPluginContext` may ask its resolver for.
 *
 * Declared once and consumed by both the context and its resolver, so the two
 * cannot disagree about what may be asked for. A resolver missing a name here
 * fails to compile; without the shared list it would instead throw
 * `Unknown service` at runtime, and nothing earlier would catch it — the
 * resolver reaches `createPluginContext` through a cast, so the compiler cannot
 * check it, and `ctx.services` members are getters, so enumerating the object
 * reports a name without ever invoking it.
 */
export const PLUGIN_SERVICE_NAMES = [
  "collectionService",
  "userService",
  "mediaService",
  "emailService",
  "versionsService",
  "singleRegistryService",
  "db",
  "relations",
  "dialect",
  "logger",
  "config",
  "adapter",
] as const;

/** The app's own surface depends on no plugin: it owns what the app owns. */
const NO_DEPENDENCIES: ReadonlySet<string> = new Set();

/**
 * Every column contributed to a table its contributor does not own, by
 * table SQL name, with the contributor each carries: the hidden columns on
 * entity and extendable core tables, and those on extension tables.
 */
function contributedColumnsByTable(
  schema: ReturnType<typeof getActiveExtensionSchema>
): Map<string, ContributedColumn[]> {
  const byTable = new Map<string, ContributedColumn[]>();
  const add = (table: string, column: ExtensionColumn): void => {
    const list = byTable.get(table) ?? [];
    list.push({
      name: column.name,
      key: column.key,
      contributedBy: column.contributedBy,
      spec: column,
    });
    byTable.set(table, list);
  };
  for (const [table, columns] of schema?.entityColumns ?? []) {
    for (const column of columns) add(table, column);
  }
  const extensionColumns = (schema?.tables ?? []).flatMap(table =>
    table.columns
      .filter(column => column.contributedBy !== undefined)
      .map(column => ({ table: table.name, column }))
  );
  for (const { table, column } of extensionColumns) add(table, column);
  return byTable;
}

/**
 * Compose the plugin database surface for one plugin.
 *
 * Everything the surface needs about the schema is read through a closure
 * rather than captured, for the reason on the call site: a reload replaces the
 * active schema and a captured one describes tables that may no longer exist.
 */
function buildPluginDatabase(
  rawDb: PluginRawDatabase,
  relations: () => AnyRelations,
  adapter: () => AdapterTransactions,
  dialect: () => SupportedDialect,
  plugin: PluginDefinition | undefined
): PluginDatabase & { raw: PluginRawDatabase } {
  const owner: SchemaOwner = plugin
    ? { kind: "plugin", id: plugin.name }
    : { kind: "app" };

  // The schema compiled for the dialect this process runs, asked for by name.
  // Taking the first dialect that had one returned whichever was compiled
  // first — a process that had held another dialect's schema served its
  // tables and its owner rules, refusing this plugin's own tables.
  const active = () => getActiveExtensionSchema(dialect());

  const surface = createPluginDatabase({
    // Read when an operation runs, not now: the context can be built before
    // the database is connected.
    get dialect() {
      return dialect();
    },
    owner,
    // Read when an operation runs, like the schema below: the context
    // outlives a config reload, and the dependencies a plugin may reach
    // through are the ones the config in force declares.
    get dependsOn() {
      return plugin ? currentDependencies(plugin) : NO_DEPENDENCIES;
    },
    owners: () => active()?.owners ?? new Map(),
    tables: () => ({
      ...(active()?.drizzle ?? {}),
      // Adopted tables are readable through the same owner check as any
      // other: app-owned, so the app's own `ctx.db` surface reaches them and a
      // plugin's check does not.
      ...(active()?.adopted ?? {}),
    }),
    // What `ctx.db.contributed` may reach: every column contributed to a
    // table its contributor does not own, with the contributor each carries —
    // the hidden columns on entity and extendable core tables, and those on
    // extension tables (an app's on a plugin's table, a plugin's on a
    // dependency's). The access rule decides which of them a caller may use.
    contributions: () => contributedColumnsByTable(active()),
    // The runtime table an entity or core table queries through, found in
    // the relations config the registry assembles from every registered
    // table — keyed differently for core and dynamic tables, so matched by
    // the table's SQL name rather than by key.
    entityTable: tableName =>
      Object.values(relations()).find(
        entry => getTableName(entry.table as Table) === tableName
      )?.table,
    tableList: () => [
      ...(active()?.tables ?? []).map(table => ({
        name: table.name,
        authored: table.authored,
        owner: table.owner,
      })),
      ...Object.keys(active()?.adopted ?? {}).map(name => ({
        name,
        authored: name,
        owner: { kind: "app" as const },
      })),
    ],
    db: () => rawDb,
    // The relations-enabled handle behind `ctx.db.query`, rebuilt from the
    // CURRENT relations on every access. The registry replaces its relations
    // object when a table is re-registered, and a handle resolved once at
    // context construction would keep querying through edges that close over
    // dropped table objects. The adapter memoizes per relations object, so an
    // unchanged schema resolves to the same instance each time.
    relationalDb: () => adapter().getDrizzle(relations()),
    // The ADAPTER's transaction, not a bare call of the callback.
    //
    // `fn(rawDb)` opened no transaction at all: a plugin that wrote twice and
    // then threw kept the first write, which is the opposite of what
    // `ctx.db.transaction` promises. Core-owned stores already route through
    // the adapter for the reason that decides it here too — Drizzle's
    // better-sqlite3 transaction refuses an async callback, so SQLite needs
    // the adapter's manual `BEGIN IMMEDIATE` path, and a plugin surface that
    // works on two dialects out of three is not portable.
    //
    // Both handles come from the TRANSACTION's context, not the pool.
    // `adapter.transaction` leases a client, and `tx.getDrizzle()` is bound
    // to it; the adapter's own `getDrizzle()` wraps the pool and would use a
    // different connection,
    // so the plugin's writes would commit on their own and a later throw
    // would roll back an empty transaction while leaving them in place.
    //
    // The relational handle is `tx.drizzleWithRelations(relations)`: the same leased
    // client, with the relations config that populates `query` — the bare
    // instance's `query` namespace is empty. A getter, so the relations are
    // resolved per access as they are outside the transaction, and a
    // transaction that never touches `query` never builds the instance.
    //
    // The work runs through `runAdapterTransaction`, so what it throws reaches
    // the plugin as thrown rather than as the adapter's classification of it.
    // On SQLite it also runs marked as a plugin transaction, as `raw`'s does:
    // a service called inside nests as a savepoint, defers what follows its
    // write until the commit, and refuses what a rollback could not undo.
    transaction: fn => {
      const run = (tx: AdapterTransactionHandles) =>
        fn({
          db: tx.getDrizzle(),
          get relationalDb() {
            return tx.drizzleWithRelations(relations());
          },
          adapterTx: asTransactionContext(tx),
        });
      const transactions = adapter();
      return runAdapterTransaction(
        transactions.transaction.bind(transactions),
        (tx: AdapterTransactionHandles) =>
          dialect() === "sqlite"
            ? runInPluginTransaction(() => run(tx))
            : run(tx)
      );
    },
  });

  return Object.assign(surface, { raw: rawDb });
}

/** One of the names a plugin-context resolver must answer. */
export type PluginServiceName = (typeof PLUGIN_SERVICE_NAMES)[number];

/**
 * The slice of the database adapter core's own stores need: a transaction
 * that can carry awaited work on EVERY dialect. Drizzle's better-sqlite3
 * transaction cannot (the driver refuses an async callback), so SQLite
 * writes ride the adapter's manual `BEGIN IMMEDIATE` implementation — this
 * type names the one method that makes dialect-correct transactions
 * reachable without binding plugin-context to an adapter class, and the
 * `afterCommit` a store announces its committed change through.
 */
export interface AdapterTransactions extends AfterCommitAdapter {
  /**
   * The callback receives the transaction's own context, whose `getDrizzle()`
   * is bound to the transaction's connection. Ignoring it and using the pooled
   * handle runs the work on a DIFFERENT connection on PostgreSQL and MySQL,
   * outside the transaction. Passing a relations config returns an instance
   * on that same connection with the relational query API enabled. On SQLite
   * a call made inside an open transaction nests as a savepoint.
   */
  transaction: <T>(
    work: (tx: AdapterTransactionHandles) => Promise<T>
  ) => Promise<T>;
  /**
   * The pooled Drizzle handle, relations-enabled when given a config. Used
   * for `ctx.db.query` OUTSIDE a transaction; inside one, the transaction
   * context's `drizzleWithRelations(relations)` is the handle to use.
   */
  getDrizzle: <D = unknown>(relations?: AnyRelations) => D;
}

/** The Drizzle handles bound to one transaction's connection. */
export interface AdapterTransactionHandles {
  getDrizzle: <D = unknown>() => D;
  drizzleWithRelations: <D = unknown>(relations: AnyRelations) => D;
}

/**
 * The transaction's full adapter context when the adapter handed one, which
 * every adapter core ships does; undefined for one that supplies only the two
 * Drizzle handles this resolver's contract asks for. Core code a plugin passes
 * its transaction to writes through it (`plugin-transaction-link`), and with
 * none it refuses rather than writes outside the transaction.
 */
function asTransactionContext(
  tx: AdapterTransactionHandles
): TransactionContext | undefined {
  const candidate = tx as Partial<TransactionContext>;
  return typeof candidate.insert === "function" &&
    typeof candidate.select === "function" &&
    typeof candidate.updateCount === "function" &&
    typeof candidate.delete === "function"
    ? (tx as TransactionContext)
    : undefined;
}

/** Whether `value` has every method the one-purpose secrets helper calls. */
function isSecretsAdapter(value: unknown): value is SecretsAdapter {
  if (typeof value !== "object" || value === null) return false;
  const methods: readonly (keyof SecretsAdapter)[] = [
    "transaction",
    "select",
    "transactionOpenInFlow",
  ];
  return methods.every(
    name => typeof (value as Record<string, unknown>)[name] === "function"
  );
}

/**
 * The adapter as the one-purpose secrets helper uses it. The resolver's
 * contract names only the transaction methods, and every adapter core ships
 * has the rest; one that does not is refused with a clear error, rather than
 * failing on a missing method partway through a secret's write.
 */
function asSecretsAdapter(adapter: AdapterTransactions): SecretsAdapter {
  if (isSecretsAdapter(adapter)) return adapter;
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "An unexpected error occurred.",
    logMessage:
      "The adapter this plugin context resolves has no select or transactionOpenInFlow, which one-purpose secrets need.",
    logContext: { reason: "secrets-adapter-incomplete" },
  });
}

/**
 * @experimental The handle a plugin receives as `ctx.db.raw`: Drizzle's fluent
 * builder and a transaction whose handle is the same restricted builder. For
 * a plugin that declares `capabilities.db.rawSql` and that the app lists in
 * `db.rawSqlPlugins`, it is the live Drizzle instance instead, `execute` and
 * `run` included. No ownership check: it reaches every table.
 */
export interface PluginRawDatabase extends DatabaseInstance {
  /**
   * Run `work` in one transaction: it commits when `work` resolves and rolls
   * back when it throws. The handle `work` receives is the restricted builder,
   * without a nested `transaction`; with `rawSql` it is the live handle, whose
   * `transaction` nests as a savepoint. Write through it: another service or
   * `ctx.settings` called inside runs on its own connection on PostgreSQL and
   * MySQL, outside this transaction.
   *
   * On SQLite the transaction holds the database's only connection until it
   * ends. A service or `ctx.settings` called inside joins it as a savepoint,
   * and its rows roll back with it; what it does after its write (after
   * hooks, events, cache revalidation, webhook delivery) waits until this
   * transaction commits, runs before `transaction` resolves, and never runs if
   * it rolls back. Deleting media is refused inside it,
   * including from a collection hook a service runs inside it, since a
   * rollback could not bring the stored files back with the row, and a
   * focal-point change keeps the superseded image variants rather than
   * deleting them. Core's own transactions are unaffected: a collection hook
   * that deletes media outside a plugin's transaction still deletes it.
   * Other requests' statements wait for it or run inside it.
   * On SQLite, nested transactions (a nested `ctx.db.transaction`, or a
   * service called inside) run one at a time, in the order they are started.
   * A nested transaction must never wait for one started after it in the same
   * transaction, such as a memoised promise a later sibling started: neither
   * settles, the database's only connection stays in the open transaction,
   * every later transaction waits, and other requests' writes land in it
   * uncommitted and are lost on restart.
   * Keep it short, and never await network I/O (`ctx.fetch`) inside it.
   *
   * `tx` lives only as long as `work`: once `work` has settled, every method
   * of `tx` refuses. A builder made from `tx` inside `work` and run after it
   * is not refused, so finish every statement before `work` returns.
   */
  transaction<T>(work: (tx: DatabaseInstance) => Promise<T>): Promise<T>;
}

/**
 * @experimental What a plugin declares it may do beyond its own tables and
 * routes: `PluginDefinition.capabilities`.
 */
export interface PluginCapabilities {
  /**
   * Hosts `ctx.fetch` may reach: an exact hostname or one leading `*.`
   * wildcard. Absent means `ctx.fetch` is not available at all.
   */
  net?: { outbound: string[] };
  /**
   * Declares that the plugin runs raw SQL. Default false. Without it,
   * `ctx.db.raw` has no `execute` or `run`; with it, `ctx.db.raw` is the live
   * Drizzle instance. The app must also list the plugin in
   * `db.rawSqlPlugins`, or the boot refuses, naming the line to add. A
   * reviewed grant, not an enforced boundary.
   */
  db?: { rawSql?: boolean };
  /**
   * Settings key paths stored encrypted and redacted on read, dot-separated
   * for nested values (`providers.google.clientSecret`).
   */
  secrets?: string[];
  /**
   * `login: true` lets the plugin finish logins with
   * `ctx.auth.completeLogin`, which signs in whichever account it names.
   * Its strategy names must begin with `<plugin-slug>:`.
   */
  auth?: { login?: boolean };
}

/** The four fluent methods of a Drizzle handle, and nothing else. */
function fluentOnly(handle: DatabaseInstance): DatabaseInstance {
  return {
    update: table => handle.update(table),
    delete: table => handle.delete(table),
    insert: table => handle.insert(table),
    select: columns => handle.select(columns),
  };
}

/**
 * `handle` for as long as `scope` is open, refusing every property read
 * after, and every call of a method read from it while it was open.
 *
 * The handle `ctx.db.raw.transaction` passes its work is bound to the
 * transaction's connection: on PostgreSQL and MySQL a client the pool leased
 * to it, on SQLite the database's only connection, where the transaction is
 * the adapter's `BEGIN IMMEDIATE`. A plugin that keeps it past the callback
 * and starts a statement through it would write on a client already back in
 * the pool, or on SQLite outside any transaction. Every statement starts with
 * a property read on the handle (`insert`, `select`, `execute`, `query`, ...),
 * so refusing the read refuses the statement before Drizzle builds anything.
 * A method read while the transaction was open and kept (`const insert =
 * tx.insert`) needs no read to start a statement later, so each method is
 * handed out wrapped: it checks again when it is called.
 *
 * `then` stays readable: resolving a promise with a value reads its `then`,
 * and a callback that returns its handle must not have its transaction fail
 * on that read. Symbols stay readable too: they are how a value is inspected
 * or converted, and no statement starts with one.
 *
 * What it cannot refuse is a builder made inside the callback and run after
 * it. Drizzle's builders hold the session they were made from, not this
 * handle, and run when first awaited, so a kept
 * `tx.insert(t).values(v)` awaited after the transaction still runs. An
 * object read off a full Drizzle handle (`tx.query`, for a plugin the app
 * granted raw SQL) is the same case: it is Drizzle's, and handing it out wrapped would
 * break the identity Drizzle looks its tables up by. The typed
 * `ctx.db.transaction` covers those cases; this escape hatch does not.
 */
function scopedHandle<H extends object>(handle: H, scope: TransactionScope): H {
  return new Proxy(handle, {
    get(target, property, receiver) {
      if (typeof property !== "string" || property === "then") {
        return Reflect.get(target, property, receiver) as unknown;
      }
      scope.assertOpen();
      const value: unknown = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      const method = value as (...args: unknown[]) => unknown;
      // Called as the method was called before it was wrapped, with the same
      // receiver, so a Drizzle method reads its own instance as it always has.
      return function scopedMethod(this: unknown, ...args: unknown[]) {
        scope.assertOpen();
        return Reflect.apply(method, this, args);
      };
    },
  });
}

/**
 * Runs `work` with `handle` behind a fresh scope, so the handle refuses once
 * the work has settled (see `scopedHandle`), whichever way it settles.
 */
function inRawTransactionScope<T>(
  handle: DatabaseInstance,
  work: (tx: DatabaseInstance) => Promise<T>
): Promise<T> {
  const scope = transactionScope("ctx.db.raw.transaction");
  return scope.run(() => work(scopedHandle(handle, scope)));
}

/**
 * The database surface a plugin actually receives.
 *
 * A NEW object exposing the fluent methods and a transaction, rather than the
 * live instance with its extras hidden by a type, so `execute` and `run` are
 * absent at runtime as well as in the type. This makes what a plugin declared
 * legible; it is not a sandbox, because plugins are trusted code and one can
 * still build raw SQL with its own `sql`. `rawSql` hands back the instance
 * itself, which is what declaring the capability means.
 *
 * The transaction is kept because without it a plugin has no way to make
 * several writes atomic. Its handle is restricted the same way. On SQLite it
 * runs through the adapter's `BEGIN IMMEDIATE` runner, since Drizzle's
 * better-sqlite3 transaction refuses an async callback, and the builder shares
 * the connection that runner opened. What the work throws reaches the plugin
 * as thrown, as Drizzle's transaction hands it back on PostgreSQL and MySQL,
 * rather than as the adapter's classification of it. The work runs marked as
 * a plugin transaction (`runInPluginTransaction`), so a service it calls can
 * refuse what a rollback of the plugin's transaction could not undo.
 */
function restrictDatabase(
  raw: DatabaseInstance,
  rawSqlAllowed: boolean,
  dialect: () => SupportedDialect,
  adapterTransaction: () => AdapterTransactions["transaction"]
): PluginRawDatabase {
  if (rawSqlAllowed) {
    // The live instance, with one exception: on SQLite its own `transaction`
    // is better-sqlite3's synchronous one, which refuses the async callback
    // `PluginRawDatabase` documents — so declaring raw SQL took away the
    // transaction every other plugin has. Everything else reaches the
    // instance unchanged. The work's handle is this same proxy, so its
    // `transaction` nests as a savepoint, as a Drizzle transaction's does on
    // PostgreSQL and MySQL, instead of reaching the synchronous one.
    //
    // On every dialect the handle the work receives refuses once the work
    // has settled (`inRawTransactionScope`), as the restricted handle below
    // does: holding raw SQL makes a kept handle more dangerous, not less. On
    // SQLite that handle is this proxy behind the scope, so a kept `tx`
    // refuses while `ctx.db.raw` itself stays usable.
    const live: PluginRawDatabase = new Proxy(raw as PluginRawDatabase, {
      get(target, property, receiver) {
        if (property !== "transaction") {
          return Reflect.get(target, property, receiver) as unknown;
        }
        if (dialect() === "sqlite") {
          return <T>(work: (tx: DatabaseInstance) => Promise<T>) =>
            runAdapterTransaction(adapterTransaction(), () =>
              runInPluginTransaction(() => inRawTransactionScope(live, work))
            );
        }
        const native = Reflect.get(target, property, target) as (
          work: (tx: DatabaseInstance) => Promise<unknown>,
          ...rest: unknown[]
        ) => Promise<unknown>;
        // Drizzle's own transaction, with any config it was given passed
        // through; only the handle its callback receives is scoped.
        return <T>(
          work: (tx: DatabaseInstance) => Promise<T>,
          ...rest: unknown[]
        ) =>
          native.call(
            target,
            tx => inRawTransactionScope(tx, work),
            ...rest
          ) as Promise<T>;
      },
    });
    return live;
  }
  const native = raw as DatabaseInstance & {
    transaction: <T>(work: (tx: DatabaseInstance) => Promise<T>) => Promise<T>;
  };
  // The work's handle refuses once the work has settled
  // (`inRawTransactionScope`): kept past the callback it would otherwise
  // write on a client already back in the pool, or on SQLite on the shared
  // connection outside any transaction.
  return {
    ...fluentOnly(raw),
    transaction: work =>
      dialect() === "sqlite"
        ? runAdapterTransaction(adapterTransaction(), () =>
            runInPluginTransaction(() =>
              inRawTransactionScope(fluentOnly(raw), work)
            )
          )
        : native.transaction(tx => inRawTransactionScope(fluentOnly(tx), work)),
  };
}

export function createPluginContext(
  getServiceFn: <T extends PluginServiceName>(
    name: T
  ) => T extends "collectionService"
    ? CollectionService
    : T extends "userService"
      ? UserService
      : T extends "mediaService"
        ? MediaService
        : T extends "emailService"
          ? EmailService
          : T extends "versionsService"
            ? VersionsService
            : T extends "singleRegistryService"
              ? SingleRegistryService
              : T extends "db"
                ? DatabaseInstance
                : T extends "relations"
                  ? AnyRelations
                  : T extends "dialect"
                    ? SupportedDialect
                    : T extends "logger"
                      ? Logger
                      : T extends "config"
                        ? NextlyServiceConfig
                        : T extends "adapter"
                          ? AdapterTransactions
                          : never,
  hookRegistry: {
    register: (
      hookType: HookContextPhase,
      collection: string,
      handler: HookHandler,
      owner?: HookOwner
    ) => void;
    unregister: (
      hookType: HookContextPhase,
      collection: string,
      handler: HookHandler,
      owner?: HookOwner
    ) => void;
    registerBeforeOperation: (
      collection: string,
      handler: BeforeOperationHandler,
      owner?: HookOwner
    ) => void;
    unregisterBeforeOperation: (
      collection: string,
      handler: BeforeOperationHandler,
      owner?: HookOwner
    ) => void;
  },
  /**
   * The plugin this context is built for — used to resolve `ctx.self`.
   * Optional so the factory stays usable without a plugin (empty `self`).
   */
  plugin?: PluginDefinition,
  /**
   * What the boot granted, decided once when it resolved the plugin list
   * (`decidePluginGrants`). The context reads this and never the plugin's
   * manifest, so a manifest changed after resolution, or one whose accessor
   * answers differently when read here, grants nothing. Absent, nothing is
   * granted.
   */
  grants: PluginGrants = NO_PLUGIN_GRANTS
): PluginContext {
  // Subscriptions made through this context are tracked under the plugin's name
  // so the runtime can clear them before the plugin re-initializes on HMR (B2).
  const pluginName = plugin?.name;

  // Everything registered through this context is attributed to the plugin, so
  // a config reload can rebuild the config's own handlers without deleting a
  // plugin's -- the form builder registers its `afterRead` straight into the
  // `forms` namespace, and nothing would put that back. A context built without
  // a plugin has no identity to attribute to and keeps the registry's default.
  const hookOwner: HookOwner | undefined = pluginName
    ? `plugin:${pluginName}`
    : undefined;

  // Create simplified hook registry for plugins
  const pluginHooks: PluginHookRegistry = {
    on: (hookType, collection, handler) => {
      hookRegistry.register(
        hookType,
        collection,
        handler as HookHandler,
        hookOwner
      );
      if (pluginName) {
        recordPluginSubscription(pluginName, () =>
          hookRegistry.unregister(
            hookType,
            collection,
            handler as HookHandler,
            hookOwner
          )
        );
      }
    },
    off: (hookType, collection, handler) => {
      hookRegistry.unregister(
        hookType,
        collection,
        handler as HookHandler,
        hookOwner
      );
    },
    onBeforeOperation: (collection, handler) => {
      hookRegistry.registerBeforeOperation(collection, handler, hookOwner);
      if (pluginName) {
        recordPluginSubscription(pluginName, () =>
          hookRegistry.unregisterBeforeOperation(collection, handler, hookOwner)
        );
      }
    },
    offBeforeOperation: (collection, handler) => {
      hookRegistry.unregisterBeforeOperation(collection, handler, hookOwner);
    },
  };

  // Retrieve services from container
  const collectionService = getServiceFn("collectionService");
  const userService = getServiceFn("userService");
  const mediaService = getServiceFn("mediaService");
  const emailService = getServiceFn("emailService");
  // The raw handle is restricted unless the boot GRANTED this plugin raw SQL:
  // it declared the capability before setup and the app lists it.
  // `DatabaseInstance` already describes only the fluent surface, but the
  // object handed over was the live Drizzle instance, which carries `execute`,
  // `run` and its own client, so the ordinary way to run raw SQL needed no
  // declaration at all. Removing them makes the manifest the place raw SQL is
  // declared; it does not sandbox a plugin, which is trusted code. The typed
  // surface below exposes this handle as `raw`.
  const rawDb = restrictDatabase(
    getServiceFn("db"),
    plugin !== undefined && grants.rawSql.includes(plugin.name),
    // Both resolved when a transaction starts, not now: the context can be
    // built before the database is connected. A closure, so the adapter
    // keeps its receiver.
    () => getServiceFn("dialect"),
    () => {
      const adapter = getServiceFn("adapter");
      return work => adapter.transaction(work);
    }
  );

  /**
   * `ctx.db` — the typed, owner-checked surface over the restricted raw
   * handle.
   *
   * Built lazily so it reads the ACTIVE extension schema at call time rather
   * than at context construction. A context outlives a reload; capturing the
   * schema here would hand a plugin a view of tables the config no longer
   * declares, and the failure would be a query against a dropped table.
   *
   * `raw` preserves the documented escape hatch this used to BE. Removing a
   * surface plugins already depend on, in the same change that adds its
   * replacement, would break every one of them at once.
   */
  // The relations config is asked for on every relational access rather than
  // once here: the registry replaces it when a table is re-registered, and a
  // context outlives that.
  const db = buildPluginDatabase(
    rawDb,
    () => getServiceFn("relations"),
    // Resolved on use, like `raw`'s transaction: the context can be built
    // before the database is connected.
    () => getServiceFn("adapter"),
    () => getServiceFn("dialect"),
    plugin
  );
  const logger = getServiceFn("logger");
  const config = getServiceFn("config");

  // Route isolated event-handler diagnostics through the resolved logger.
  const rawBus = getEventBus();
  rawBus.setLogger(logger);
  // Per-plugin event bus: `on()` also records an unsubscribe thunk so the
  // runtime can clear this plugin's subscriptions before it re-initializes on
  // HMR (B2), and `emit()` refuses every name outside the plugin's own
  // namespace, core's included. Every other method
  // delegates to the shared bus unchanged.
  const events: EventBus = pluginName
    ? new Proxy(rawBus, {
        get(target, prop) {
          if (prop === "on") {
            return (name: EventName, handler: EventHandler) => {
              target.on(name, handler);
              recordPluginSubscription(pluginName, () =>
                target.off(name, handler)
              );
            };
          }
          if (prop === "emit") {
            return (name: EventName, payload: unknown) => {
              // Thrown at the plugin author rather than dropped: emitting a
              // core event is a programming error, and a silent no-op would
              // leave them debugging a listener that never fires.
              if (isReservedEventName(name)) {
                throw NextlyError.forbidden({
                  logContext: {
                    reason: "plugin-emit-reserved-event",
                    plugin: pluginName,
                    event: name,
                  },
                });
              }
              // Nor for another plugin: a listener on that plugin's event
              // would act on something its owner never did.
              if (!isInPluginNamespace(pluginName, name)) {
                throw NextlyError.forbidden({
                  logContext: {
                    reason: "plugin-emit-outside-namespace",
                    plugin: pluginName,
                    event: name,
                  },
                });
              }
              target.emit(name, payload);
            };
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    : rawBus;

  // Built once per context rather than per call: it closes over the
  // allowlist, and nothing about it changes between requests.
  const pluginFetch = plugin ? createPluginFetchFor(plugin) : undefined;
  const pluginPrincipals = plugin ? createPluginPrincipals(plugin) : undefined;
  const pluginLimits = plugin ? createPluginLimits(plugin) : undefined;

  const filterRegistry = getFilterRegistry();
  filterRegistry.setLogger(logger);
  // Consults what the plugins DECLARED, which was collected and thrown away —
  // so a declared payload schema checked nothing. The payload half runs in
  // development only, and warns once per point; the kind half runs always.
  // See the checker.
  const checkPayload = createPayloadChecker(
    getDeclaredHookPoints(),
    message => logger.warn(message),
    { payloads: env.NODE_ENV !== "production" }
  );
  const pluginFilters: PluginFilterRegistry = {
    add: (name, fn) => filterRegistry.addFilter(name, fn),
    remove: (name, fn) => filterRegistry.removeFilter(name, fn),
    apply: (name, value, context) => {
      // The value handed to a filter IS the payload at this seam. The kind
      // names THIS registry API, so a point declared otherwise is reported —
      // a decision run through here loses its fail-closed veto.
      checkPayload(name, value, "filter");
      return filterRegistry.applyFilters(name, value, context);
    },
    decide: (name, initial, context) => {
      // The CONTEXT is the payload of a decision point — the subject being
      // decided — not the verdict, which has one shape for every point.
      checkPayload(name, context, "decision");
      return filterRegistry.applyDecision(name, initial, context);
    },
  };
  const pluginActions: PluginActionRegistry = {
    add: (name, fn) => filterRegistry.addAction(name, fn),
    remove: (name, fn) => filterRegistry.removeAction(name, fn),
    run: (name, payload, context) => {
      checkPayload(name, payload, "action");
      return filterRegistry.runActions(name, payload, context);
    },
  };

  return {
    services: {
      collections: wrapCollectionsForPlugin(collectionService),
      // The plugin view, refusing the writes that decide who administers the
      // site; core's own callers keep the unrestricted instance. Resolved on
      // access like `versions` below, so a context built by a caller that
      // never manages users asks nothing of the service it was handed.
      get users() {
        return methodFacade(userService.forPlugins(), PLUGIN_USER_METHODS);
      },
      media: methodFacade(mediaService, PLUGIN_MEDIA_METHODS),
      // A plugin's keys are its own: scoped to its name, so two plugins, or a
      // plugin and the site, never name one send with the same key.
      email: methodFacade(
        scopedSender(
          emailService,
          pluginName ? pluginKeyScope(pluginName) : SITE_KEY_SCOPE
        ),
        PLUGIN_EMAIL_METHODS
      ),
      // Resolved on access, not at construction: `createPluginContext` is
      // exported, and a resolver written before this service existed would
      // otherwise throw while building the context for callers that never
      // touch version history.
      get versions() {
        return Object.freeze({
          ...methodFacade(
            getServiceFn("versionsService"),
            PLUGIN_VERSIONS_METHODS
          ),
          listEvents: readEventsForPlugin,
        });
      },
      // Lazy for the same reason as `versions` directly above: this module is
      // exported, so a context built by a caller that never asks about Singles
      // must not require the registry to have been resolved first.
      get singles() {
        return wrapSinglesForPlugin(getServiceFn("singleRegistryService"));
      },
      // Queueing work for later. Lazy like its neighbours above and for the same
      // reason: this module is exported, so a context built by a caller that
      // never queues a job must not require the runner to be resolved first.
      //
      // Reached through `ctx.services` rather than by re-exporting the Direct
      // API from the SDK. A plugin that declares a job type with `defineJob`
      // needs somewhere to ASK for one; without this the only route was
      // importing the core `nextly` entry directly, crossing the boundary the
      // SDK exists to draw.
      get jobs() {
        return createJobsNamespace();
      },
      plugins: buildPluginServicesNamespace(),
    },
    db,
    // Resolved on access: the context can be built before the database is
    // connected.
    get dialect() {
      return getServiceFn("dialect");
    },
    logger,
    events,
    nextlyVersion: getCoreVersion(),
    self: plugin
      ? resolvePluginSelf(plugin)
      : { name: "", collections: {}, singles: {} },
    config: pluginConfigView(config),
    hooks: pluginHooks,
    filters: pluginFilters,
    actions: pluginActions,
    // A plain property rather than a getter: `runPluginRoute` spreads the base
    // context on every request, which would evaluate a top-level getter each
    // time. The instance itself resolves its dependencies lazily instead.
    // Bound to the plugin, so `completeLogin` answers to its manifest; a
    // context built for no plugin is core's own and gets the shared one.
    auth: plugin ? getPluginAuthApiFor(plugin) : getPluginAuthApi(),
    // Built once here and kept as a plain property, like `auth`: it holds no
    // per-request state, so the copy every route spreads is the same helper.
    security: {
      passwords: createPasswordHelper({
        breachedPasswords: config.security?.breachedPasswords,
        logger,
      }),
      opaque: createOpaqueSecrets(),
      // Kept within this plugin's name. The adapter is read per call, as the
      // context can be built before the database connects, and through this
      // context's own resolver rather than the global container: a context
      // outlives a container being cleared, as on a reload while old plugins
      // finish tearing down. The install's secrets are read per call so a
      // rotation applies at once.
      secrets: createOneTimeSecrets({
        owner: plugin?.name ?? "nextly",
        adapter: () => asSecretsAdapter(getServiceFn("adapter")),
        // Every generation, the unkeyed one included: a secret minted before
        // NEXTLY_SECRET was set stays readable while '[null]' keeps it.
        secrets: () =>
          secretGenerations(env.NEXTLY_SECRET, env.NEXTLY_SECRET_PREVIOUS),
      }),
    },
    // Present only when the plugin declared a settings schema: without one
    // there is nothing to validate a write against, and an untyped bag is
    // exactly what this store exists to replace.
    // The UNRESTRICTED handle, deliberately. `restrictDatabase` bounds what the
    // PLUGIN may issue; this store is core code writing core-owned rows into a
    // core-owned table, and it needs a transaction to apply a multi-key patch
    // as one thing. The plugin never receives this handle — only `get` and
    // `set`, which take a validated patch.
    ...(plugin?.contributes?.settings
      ? {
          settings: createPluginSettings(
            plugin,
            getServiceFn("db"),
            getServiceFn("dialect"),
            // The adapter, reachable LAZILY like the handle: SQLite writes
            // need its manual BEGIN IMMEDIATE runner, the change is announced
            // through its `afterCommit`, and the context can be built before
            // the database is connected.
            () => getServiceFn("adapter")
          ),
        }
      : {}),
    ...(pluginFetch ? { fetch: pluginFetch } : {}),
    ...(plugin?.contributes?.audit ? { audit: createPluginAudit(plugin) } : {}),
    // Only for a plugin that registers kinds: a context with nothing of its
    // own to recognise has no use for it, as one with no settings has none
    // for `settings`.
    ...(pluginPrincipals ? { principals: pluginPrincipals } : {}),
    ...(pluginLimits ? { limits: pluginLimits } : {}),
  };
}
