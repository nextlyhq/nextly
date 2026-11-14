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

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type {
  SupportedDialect,
  TransactionContext,
  TransactionOptions,
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
import type { CollectionRegistryService } from "../domains/collections/services/collection-registry-service";
import { collectionFields } from "../domains/collections/services/collection-utils";
import type { StoredReads } from "../domains/collections/services/stored-field-read";
import type { ContentEventSubject } from "../domains/content-events/record";
import {
  type ForgetSendsInput,
  forgetPluginSends,
} from "../domains/email/plugin-send-forgetting";
import {
  onQueuedEmailChange,
  type QueuedEmailChange,
  RECIPIENT_DIGEST_PURPOSE,
  useRecipientDigester,
} from "../domains/email/queued-send-changes";
import { pluginKeyScope, scopedSender } from "../domains/email/send-claims";
import type { FieldGroupRegistryService } from "../domains/field-groups/services/field-group-registry-service";
import type { JobRegistry } from "../domains/jobs/job-registry";
import type { JobsPassDatabase } from "../domains/jobs/jobs-runner";
import type { PluginLimiter } from "../domains/limits/plugin-limiter";
import {
  createDurableEventRecorder,
  durableEventNames,
  type DurableEventsAdapter,
} from "../domains/plugin-events/durable-events";
import { getDurableEventsKick } from "../domains/plugin-events/kick";
import {
  getDurableSubscribers,
  type DurableHandler,
} from "../domains/plugin-events/subscribers";
import { pluginSettingsSecrets } from "../domains/plugins/settings-service";
import { getActiveExtensionSchema } from "../domains/schema/extension/build-extension-schema";
import type {
  ExtensionColumn,
  SchemaOwner,
} from "../domains/schema/extension/types";
import type { SingleEntryService } from "../domains/singles/services/single-entry-service";
import type { SingleRegistryService } from "../domains/singles/services/single-registry-service";
import type { VersionsService } from "../domains/versions/versions-service";
import type { WebhookFastDrainScheduler } from "../domains/webhooks/after-drain";
import {
  createPluginWebhooks,
  type PluginWebhooksApi,
} from "../domains/webhooks/plugin-record";
import type { AnyWidget } from "../domains/widgets/declaration/define-widget";
import { NextlyError } from "../errors/nextly-error";
import type { EventBus, EventHandler, EventName } from "../events/event-bus";
import { getEventBus, isReservedEventName } from "../events/event-bus";
import type { Action, Decision, Filter } from "../filters";
import { getFilterRegistry } from "../filters";
import { singleHookNamespace } from "../hooks/register-single-hooks";
import type {
  BeforeOperationHandler,
  CollectionDeleteImpactItem,
  CollectionDeleteRunner,
  HookContextPhase,
  HookHandler,
  HookOwner,
  InTransactionRunner,
  InTransactionWrite,
} from "../hooks/types";
import { env } from "../lib/env";
import type { CollectionService } from "../services/collections/collection-service";
import type { EmailService } from "../services/email/email-service";
import type { MediaService } from "../services/media/media-service";
import type { Logger } from "../services/shared";
import type { UserService } from "../services/users/user-service";
import type { OpenTransactionProbe } from "../shared/lib/open-transaction";
import { runInPluginTransaction } from "../shared/lib/plugin-transaction-scope";
import {
  type AfterCommitAdapter,
  afterCommit as holdUntilCommit,
  runAdapterTransaction,
} from "../shared/lib/run-adapter-transaction";
import {
  generationsCurrentFirst,
  secretGenerations,
} from "../shared/lib/secret-generations";
import type { DatabaseInstance } from "../types/database-operations";

import type { AdminPlacement } from "./admin-placement";
import type {
  PluginContributions,
  PluginStoredValue,
  PluginStoredValueTarget,
} from "./contributions";
import { getCoreVersion } from "./core-version";
import type { ContributedColumn } from "./database/access";
import {
  bindPluginDatabase,
  createPluginDatabase,
  type PluginDatabase,
  type PluginDatabaseDeps,
  type PluginTransaction,
  type PluginTransactionBounds,
  type PluginTransactionHandles,
} from "./database/plugin-database";
import { linkedTransaction } from "./database/plugin-transaction-link";
import type {
  HookPointContext,
  HookPointNameOf,
  HookPointPayload,
  HookPointValue,
} from "./hook-point-payloads";
import { createPayloadChecker, getDeclaredHookPoints } from "./hook-points";
import {
  contextSweepHost,
  pluginJobsNamespace,
  type PluginJobsNamespace,
} from "./jobs/plugin-jobs";
import { createPluginLimits } from "./limits/plugin-limits";
import { createPluginAudit } from "./plugin-audit-provider";
import { getPluginAuthApi, getPluginAuthApiFor } from "./plugin-auth-provider";
import { createPluginCache, type PluginCacheApi } from "./plugin-cache";
import type { PluginCategory } from "./plugin-categories";
import { type PluginConfig, pluginConfigView } from "./plugin-config-view";
import {
  bootNameOf,
  NO_PLUGIN_GRANTS,
  type PluginGrants,
} from "./plugin-consent";
import { currentDependencies } from "./plugin-dependencies";
import { createPluginFetchFor } from "./plugin-fetch-provider";
import { mediaForPlugin, type PluginMediaService } from "./plugin-media";
import {
  pluginPublicAddresses,
  type PluginPublicAddresses,
} from "./plugin-public-addresses";
import { createPluginSettings } from "./plugin-settings-provider";
import { toPluginSingleRecord, wrapSinglesForPlugin } from "./plugin-singles";
import type { PluginSinglesService } from "./plugin-singles";
import { isInPluginNamespace } from "./plugin-slug";
import {
  PLUGIN_VERSIONS_READS,
  pluginVersionWrites,
  type PluginVersionWrites,
} from "./plugin-versions";
import { createPluginPrincipals } from "./principals/api";
import type { PluginPrincipalsApi, PrincipalRef } from "./principals/types";
import type { PluginReceivedWebhooks } from "./security/inbound-webhooks";
import {
  createKeyedDigests,
  type DigestKeyAdapter,
  type DigestKeyStore,
  type KeyedDigests,
} from "./security/keyed-digest";
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
import {
  createPluginReceivedWebhooks,
  type ReceivedWebhooksAdapter,
} from "./security/received-webhooks";
import { isWellFormed } from "./security/well-formed";
import type { PluginSelf } from "./self";
import { resolvePluginSelf } from "./self";
import { methodFacade } from "./service-facade";
import {
  resolveServiceOpts,
  ownCollectionReads,
  withWriteTransactionToken,
  wrapCollectionsForPlugin,
  type PluginCollectionService,
  type PluginCollectionTransaction,
  type PluginOwnCollectionReads,
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
  PluginTransactionBounds,
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

  /**
   * @experimental Register a handler that runs inside a write's own
   * transaction: last, after the entry, its version and its outbox event are
   * written, and before the commit.
   *
   * What the handler writes through `context.db` commits or rolls back with
   * the entry, so a plugin can keep a row of its own exactly in step with the
   * entry it describes. Throwing aborts the write, with the error's own status
   * (a `NextlyError`'s; anything else answers 500), and nothing of it is kept.
   *
   * The transaction may be retried after a version conflict, and the handler
   * then runs again on the new attempt: only the attempt that commits keeps its
   * writes. So do nothing here a rollback cannot undo — no network call, no
   * email, no write through the pooled `ctx.db` — and keep it short, since the
   * entry's row stays locked while it runs. Work that should happen once,
   * after the commit, belongs in an `after*` hook.
   *
   * Runs for create, update and delete on collections, the bulk operations
   * included (once per entry), for publishing or withdrawing every language,
   * and for a Single's update and publish (as an `update`, registered under
   * `single:<slug>`); whether or not a write skips its hooks. In a batch
   * sharing one transaction, a handler that throws aborts the whole batch,
   * whatever `stopOnError` says.
   *
   * A write takes its set of handlers once, so one registered while a write is
   * under way first runs on the next write. The shared hook `context` it is
   * handed is a deeply frozen copy of plain data only (see
   * `InTransactionWrite.context`).
   *
   * In development, a handler that makes an outbound HTTP call is warned
   * about once: the call is not undone with a discarded attempt.
   *
   * @param collection - Collection slug, `single:<slug>`, or '*' for every one
   * @param handler - Called with the write and a database bound to its
   *   transaction
   *
   * @example
   * ```typescript
   * ctx.hooks.onInTransaction('orders', async ({ operation, id, db }) => {
   *   if (operation === 'create') await db.insert(orderLedger, { orderId: id });
   * });
   * ```
   */
  onInTransaction<T = Record<string, unknown>>(
    collection: string,
    handler: InTransactionHandler<T>
  ): void;

  /**
   * @experimental Unregister an in-transaction handler, the counterpart to
   * {@link onInTransaction}.
   *
   * @param collection - Collection slug or '*'
   * @param handler - The exact handler function to remove
   */
  offInTransaction<T = Record<string, unknown>>(
    collection: string,
    handler: InTransactionHandler<T>
  ): void;

  /**
   * @experimental Take part in deleting a collection: say what the delete
   * takes with it, and remove that in the delete's own transaction, so
   * nothing the plugin keeps is left naming a collection that no longer
   * exists.
   *
   * `impact` is asked for each collection the admin's delete dialog is about
   * to delete, before the confirm, and what it answers is listed under the
   * plugin's name. It must only read. `inTransaction` runs for each
   * collection deleted, inside the delete's transaction, before the
   * collection's field-group values, translations, table and registry row
   * are removed. Its `transaction` is a token for the `*InTransaction`
   * methods of `ctx.services.collections` and `ctx.services.ownCollections`,
   * refused once the handler settles. A handler that throws rolls the delete
   * back on every dialect: it runs before the delete's first table drop,
   * which on MySQL commits what ran before it.
   *
   * Asked of every collection deleted, the plugin's own among them: a handler
   * decides for itself which it holds anything for.
   *
   * @example
   * ```typescript
   * ctx.hooks.onCollectionDelete({
   *   impact: async slug => (await designsOf(slug)).map(design => ({
   *     label: design.title, kind: 'design',
   *   })),
   *   inTransaction: async ({ slug, transaction }) => {
   *     for (const design of await designsOf(slug, transaction)) {
   *       await ctx.services.collections.deleteEntryInTransaction(
   *         transaction, 'designs', design.id, {}
   *       );
   *     }
   *   },
   * });
   * ```
   */
  onCollectionDelete(handlers: CollectionDeleteHandlers): void;
}

/**
 * @experimental What `ctx.hooks.onCollectionDelete` takes: either part may be
 * left out.
 */
export interface CollectionDeleteHandlers {
  /** What deleting `slug` takes with it, for the delete dialog. Reads only. */
  impact?: (slug: string) => Promise<readonly CollectionDeleteImpactItem[]>;
  /** Remove it, in the delete's transaction, before the collection goes. */
  inTransaction?: (context: {
    slug: string;
    transaction: PluginCollectionTransaction;
  }) => Promise<void>;
}

/**
 * @experimental What an in-transaction handler is handed: the write, and the
 * plugin's own database bound to the write's transaction.
 */
export interface InTransactionContext<T = Record<string, unknown>>
  extends InTransactionWrite<T> {
  /**
   * The plugin's `ctx.db`, every statement of which runs inside the write's
   * transaction and sees its uncommitted writes. It refuses once the handler
   * has settled, and has no `transaction` of its own: it is one already.
   */
  db: PluginTransaction;
  /**
   * The write's transaction as `ctx.services.collections`' in-transaction
   * methods take it (`createEntryInTransaction` and the rest): their writes
   * join the write's own. It refuses once the handler has settled.
   *
   * @experimental
   */
  transaction: PluginCollectionTransaction;
  /**
   * The same object for every handler call on one transaction, each entry of
   * a batch included, so state a plugin keeps by it (what it wrote, not yet
   * committed) carries from one call to the next. It reaches nothing itself.
   *
   * @experimental
   */
  transactionKey: object;
  /**
   * Read one stored value of a field type this plugin contributes, on the
   * write's transaction: what the write stored is seen, and every other
   * document as last committed.
   *
   * The read a field type's validator is handed (`PluginFieldWrite.readStored`),
   * with the same scope, for the same reason: a field type judging a value
   * against other stored values can judge it again here, on the value finally
   * stored. A type this plugin does not contribute is refused. Like `db`, it
   * refuses once the handler has settled.
   *
   * Collection writes that run in-transaction handlers read committed on every
   * dialect, so a handler that serializes its writes with a row lock reads what
   * committed before it took the lock. A Single's write, and a write inside a
   * transaction its caller opened, read at that transaction's isolation.
   */
  readStored(
    fieldType: string,
    target: PluginStoredValueTarget
  ): Promise<PluginStoredValue>;
  /**
   * The paths of the written document's fields of a type this plugin
   * contributes, as its schema stands in this transaction: at the top level
   * and through named groups, as `readStored` names them (`hero.body`). A
   * repeater's rows and a field-group instance are not walked. A target that
   * names no language reads the app's default language: the write's own
   * language is not part of what this phase is handed.
   */
  fieldPaths(fieldType: string): Promise<readonly string[]>;
}

/**
 * @experimental A handler for `ctx.hooks.onInTransaction`. What it returns is
 * ignored; throwing aborts the write.
 */
export type InTransactionHandler<T = Record<string, unknown>> = (
  context: InTransactionContext<T>
) => void | Promise<void>;

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

const PLUGIN_EMAIL_METHODS = [
  "send",
  "sendWithTemplate",
  "queue",
  "queueWithTemplate",
  "sendPasswordResetEmail",
  "sendEmailVerificationEmail",
  "sendWelcomeEmail",
  "isConfigured",
  "canSendTemplate",
] as const satisfies readonly (keyof EmailService)[];

/** @experimental `ctx.services.users`: the plugin view of the user service. */
export type PluginUserService = Pick<
  UserService,
  (typeof PLUGIN_USER_METHODS)[number]
>;
/** @experimental `ctx.services.media`. */
export type { PluginMediaService } from "./plugin-media";
/** @experimental `ctx.services.email`. */
export type PluginEmailService = Pick<
  EmailService,
  (typeof PLUGIN_EMAIL_METHODS)[number] | "readQueued" | "recipientDigest"
> & {
  /**
   * @experimental Forget email this plugin sent about something it has
   * deleted: cancel the queued emails among `queuedIds` that are still
   * waiting or could be retried, clear the message and recipients of every
   * one of them, and erase the delivery records of the sends that carried
   * `idempotencyKeys`. Only this plugin's own: another caller's ids and keys
   * name nothing. Pass `tx`, the handle a `ctx.db.transaction` callback or an
   * in-transaction handler received, to commit with your own deletion;
   * without one it runs in a transaction of its own, and is refused inside
   * an open one.
   */
  forgetSends(
    input: ForgetSendsInput,
    options?: { tx?: PluginTransaction }
  ): Promise<void>;
  /**
   * @experimental Be told of each change of this plugin's own queued emails,
   * inside the transaction that makes it: an attempt starting (`sending`), a
   * failure a retry can help (`retrying`), `sent`, `failed`, or `cancelled`
   * with why. Each lists every final recipient after `email.beforeSend`
   * filters, with its line, what became of it, a masked hint and this
   * plugin's `recipientDigest` of it; no address. What the handler writes
   * through `db` or the collection services' in-transaction methods with
   * `transaction` commits or rolls back with the change, and a handler that
   * throws undoes it, so the attempt is tried again: write as an upsert.
   * Not told of an erasure, which a plugin reads with `readQueued`.
   * Returns the undo; teardown also withdraws it.
   */
  onQueuedEmailChange(handler: QueuedEmailChangeHandler): () => void;
};

/**
 * @experimental What `ctx.services.email.onQueuedEmailChange` hands its
 * handler: the change, and this plugin's database and collection token
 * bound to the change's transaction.
 */
export type QueuedEmailChangeHandler = (
  change: QueuedEmailChange,
  context: { db: PluginTransaction; transaction: PluginCollectionTransaction }
) => void | Promise<void>;
/** @experimental `ctx.services.versions`. */
export type PluginVersionsService = Pick<
  VersionsService,
  (typeof PLUGIN_VERSIONS_READS)[number]
> &
  PluginVersionWrites & {
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

/** @experimental Where a plugin's event is delivered from. */
export interface PluginEmitOptions {
  /**
   * The handle `ctx.db.transaction` passes its callback: the event is
   * delivered once that transaction commits, and never if it rolls back,
   * from whichever code emits it. A handle whose transaction has ended is
   * refused; emit without `tx` after the transaction returns.
   */
  tx?: PluginTransaction;
}

/**
 * @public A plugin's events: the event bus's methods, with an `emit` that
 * waits for the work that emitted it to commit (see `PluginContext.events`).
 */
export type PluginEvents = Omit<EventBus, "emit"> & {
  emit<P = unknown>(
    name: EventName,
    payload: P,
    options?: PluginEmitOptions
  ): void;
};

/**
 * @experimental A plugin's durable events, beside its bus on `ctx.events`.
 * A type of its own, so `PluginEvents` stays what it was.
 */
export interface PluginDurableEvents {
  /**
   * @experimental Record one of this plugin's durable events (declared
   * `durable: true` in `contributes.events`) with the work that emits it, by
   * the rule `emit` follows: with `{ tx }`, in that plugin transaction; else
   * in the transaction the calling code is in; else in one of its own. Every
   * `onDurable` subscriber registered when it is dispatched then receives it,
   * at least once, retried with backoff, across restarts. Resolves with the
   * event's id, which a subscriber de-duplicates on.
   */
  emitDurable(
    name: EventName,
    payload: Record<string, unknown>,
    options?: PluginEmitOptions
  ): Promise<{ id: string }>;
  /**
   * @experimental Subscribe to a durable event as `subscriber`, a name
   * unique within this plugin: what a waiting delivery is owed to, so it
   * reaches this handler after a restart however subscribers were added or
   * reordered. The handler may run again for one event; de-duplicate on
   * `event.id`.
   */
  onDurable(name: EventName, subscriber: string, handler: DurableHandler): void;
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
     * @experimental Reads of the collections THIS plugin declared, shaped by no
     * configured read hook or list-query filter, as the system. Never return
     * the result to a person: a site's read hooks may be what keeps one
     * tenant's rows from another.
     *
     * The `*InTransaction` reads run on a transaction the plugin holds (the
     * token `collections.withTransaction` hands its work, or an
     * in-transaction handler's `transaction`), and `getSingleInTransaction`
     * reads a Single this plugin declared the same way.
     */
    ownCollections: PluginOwnCollectionReads;
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
     * @experimental Queue background work — `ctx.services.jobs.queue({...})` —
     * and run one of the plugin's own sweeps now, `runSweepNow(slug)`.
     *
     * Declaring a job type is `defineJob` in `contributes.jobs`; this is how a
     * plugin asks for one of them to happen.
     */
    jobs: PluginJobsNamespace;
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
   *
   * `emit` delivers once the work that emitted it commits: with `{ tx }`,
   * when that plugin transaction commits; inside a transaction the calling
   * flow holds, when its outermost transaction commits; outside any
   * transaction, at once. Never for work that rolled back, nor for an
   * attempt that was retried.
   */
  events: PluginEvents & PluginDurableEvents;

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
  /**
   * @experimental Take part in keeping every public address to one page:
   * answer from this plugin's record who holds an address, and be told what
   * each document holds after a save.
   */
  publicAddresses: PluginPublicAddresses;

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
   * @experimental Recording this plugin's own webhook events, of the types it
   * declares in `contributes.webhookEvents`, for delivery to the endpoints
   * subscribed to them. Present on every context: a plugin that declares no
   * types has every type refused by name.
   *
   * Required, like the context's other members: `createPluginContext` and
   * `createTestNextly` provide it, and a context built by hand, such as a
   * test double typed as `PluginContext`, adds a `webhooks` of its own.
   */
  webhooks: PluginWebhooksApi;

  /**
   * @experimental The cache tags of this plugin's own data, and their expiry.
   * A read built from the plugin's data carries `cache.tag(part)`; when that
   * data changes, `cache.expire(part)` clears every cached page carrying it,
   * on every instance. Only this plugin's own tags: never content's or another
   * plugin's.
   */
  cache: PluginCacheApi;

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
  /**
   * Keyed one-way digests of values to compare without keeping them, under
   * the plugin's own key, stable across secret rotations.
   */
  readonly digests: KeyedDigests;
  /** Verifying the webhooks the plugin receives, in a common scheme or its own. */
  readonly webhooks: PluginReceivedWebhooks;
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

  /**
   * Where the plugin's own rail item goes when it is opened, for a plugin
   * placed `AdminPlacement.STANDALONE`. Written the way a menu item's `to` is:
   *
   * - one of the plugin's own pages, as `/admin/plugins/<slug>/<path>`, where
   *   `<path>` is a `contributes.admin.pages` entry's `path`;
   * - one of the plugin's own collections, as `/admin/collections/<slug>`,
   *   with the slug the plugin declares. A host's `rename` is applied, as it
   *   is to a menu item naming the collection, so the link follows the slug
   *   the host registered. A sub-path, a query or a hash after either is kept.
   *
   * A reader who may not open it (a collection they cannot read, a page whose
   * `requiredPermission` they lack) is sent where it would go without one.
   * Without it, the rail item opens the first of the plugin's collections the
   * reader can see, in the order its panel lists them, and with none, the
   * first menu item its panel lists. A value naming anything else is ignored,
   * as if unset, and reported at start-up in development.
   *
   * A site can override it per plugin in `admin.pluginOverrides`, as it can
   * `placement` and `order`.
   *
   * @example
   * ```ts
   * admin: {
   *   placement: AdminPlacement.STANDALONE,
   *   landing: "/admin/plugins/analytics/overview",
   * }
   * ```
   */
  landing?: string;

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
 *
 * `W` is the plugin's dashboard widgets, which `definePlugin` infers from `contributes.dashboard`
 * so a site's config, and the admin component map generated from it, can see each one's id,
 * component path and props. It defaults to any widget, which is today's type: a plugin written
 * as a plain object, or in JavaScript, means exactly what it meant.
 */
export interface PluginDefinition<W extends AnyWidget = AnyWidget> {
  /**
   * Unique plugin name.
   * Used for identification and error messages. `app`, in any letter case, is
   * reserved: the site's own permissions are stored under that owner, and a
   * plugin's under its name, so a plugin named `app` is refused at startup.
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
  contributes?: PluginContributions<W>;

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
   * @experimental Runs after a completed `nextly migrate` (and
   * `nextly migrate:fresh`): every migrate that leaves nothing pending, after
   * its schema, access and other post-schema steps. Never at a boot, never in
   * a dry run, and not when `--step` leaves migrations pending.
   *
   * The place for work a deploy owes once the schema is in step and that no
   * request should wait for, such as filling an index for content that
   * existed before it. `run.applied` counts the migrations this run applied,
   * 0 when it found nothing to apply: the hook runs either way.
   *
   * It runs after migrate's lock is released, so two migrates (or a migrate
   * and a running app) can run it at the same time: it must be idempotent and
   * safe when run twice at once. A throw makes the command exit non-zero once
   * every plugin's hook has run; the schema it applied stays applied, and
   * running `nextly migrate` again runs the hook again.
   */
  onMigrate?: (
    context: PluginContext,
    run: { applied: number }
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
  rename?: (map: Record<string, string>) => PluginDefinition<W>;

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

// Generic over the widgets only, inferred from `contributes.dashboard.widgets`, so each keeps its
// id, component path and props for the site's config and the admin component map generated from
// it. Not over the whole definition: inferring that would narrow every field of every plugin,
// and a variable holding one plugin could no longer be given another. With no dashboard, `W`
// has nothing to infer from and stays any widget, which is today's type.
export function definePlugin<W extends AnyWidget = AnyWidget>(
  definition: PluginDefinition<W>
): PluginDefinition<W> {
  // A plugin's name keys what it stores (its secrets, digests and settings). A name holding a lone
  // surrogate encodes to UTF-8 as a replacement character, so two such names would key alike and
  // reach each other's values: refused here, where every keyed use of the name begins.
  if (typeof definition.name === "string" && !isWellFormed(definition.name)) {
    throw NextlyError.configuration({
      logMessage:
        "A plugin's name must be well-formed Unicode: it holds a lone surrogate, which would key its stored values alike with another name's.",
      logContext: { reason: "plugin-name-ill-formed" },
    });
  }
  const withRename: PluginDefinition<W> = {
    ...definition,
    // Framework remap: returns a NEW definition with the rename map
    // merged. The original is left untouched (pure); chainable.
    rename(map: Record<string, string>): PluginDefinition<W> {
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
  // The Singles read a plugin's own-Single read goes through
  // (`ownCollections.getSingleInTransaction`), resolved on first use.
  "singleEntryService",
  // The registries a host read judges a collection's, a Single's and a
  // component's fields from (`ownCollections.*Host*InTransaction`).
  "collectionRegistryService",
  "fieldGroupRegistryService",
  "db",
  "relations",
  "dialect",
  "logger",
  "config",
  "adapter",
  // The registration's job registry and the database its runner uses, so a
  // plugin's `runSweepNow` runs against the instance that built its context,
  // never whichever one the process container holds at the time.
  "jobRegistry",
  "jobsDatabase",
  // The registration's fast webhook drain, or `null` where webhooks are not
  // registered, so a plugin's committed event is offered to the drain of the
  // instance that recorded it.
  "webhookFastDrainScheduler",
  // `nextly_meta`, where each plugin's sealed digest key is kept
  // (`ctx.security.digests`).
  "metaService",
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
): {
  db: PluginDatabase & { raw: PluginRawDatabase };
  /**
   * Run `work` with this plugin's surface bound to a transaction core opened,
   * as the in-transaction phase hands it to a handler.
   */
  bindTo: <T>(
    tx: TransactionContext,
    work: (db: PluginTransaction) => Promise<T>
  ) => Promise<T>;
} {
  const owner: SchemaOwner = plugin
    ? { kind: "plugin", id: bootNameOf(plugin) }
    : { kind: "app" };

  // The schema compiled for the dialect this process runs, asked for by name.
  // Taking the first dialect that had one returned whichever was compiled
  // first — a process that had held another dialect's schema served its
  // tables and its owner rules, refusing this plugin's own tables.
  const active = () => getActiveExtensionSchema(dialect());

  // The handles one transaction's connection offers the surface. One builder
  // for the transaction `ctx.db.transaction` opens and for the write's
  // transaction the in-transaction phase binds, so a handler's `db` is the one
  // a plugin gets from its own transaction.
  //
  // Both handles come from the TRANSACTION's context, not the pool: the
  // adapter's own `getDrizzle()` wraps the pool and would use a different
  // connection, so the plugin's writes would commit on their own and a later
  // throw would roll back an empty transaction while leaving them in place.
  //
  // The relational handle is `tx.drizzleWithRelations(relations)`: the same
  // leased client, with the relations config that populates `query` — the
  // bare instance's `query` namespace is empty. A getter, so the relations are
  // resolved per access as they are outside the transaction, and a
  // transaction that never touches `query` never builds the instance.
  const handlesOf = (
    tx: AdapterTransactionHandles
  ): PluginTransactionHandles => ({
    db: tx.getDrizzle(),
    get relationalDb() {
      return tx.drizzleWithRelations(relations());
    },
    adapterTx: asTransactionContext(tx),
    // Registered from inside the transaction's work, so the adapter holds it
    // for the transaction this call runs in, or joined.
    afterCommit: effect => {
      void holdUntilCommit(adapter(), effect);
    },
  });

  const deps: PluginDatabaseDeps = {
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
    // Whose cached reads a `contributed` write changed: the collection, Single
    // or field group the compiled schema seeded that table from, read per call
    // like the rest of the schema.
    contentEntity: tableName => active()?.entityOwners.get(tableName),
    // Loaded on the first expiry rather than with the context: the context is
    // built at every boot, and most never see a contributed write.
    expireContent: async target => {
      const { expireContentTarget } = await import(
        "./database/expire-content-target"
      );
      await expireContentTarget(target);
    },
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
    // Its handles come from `handlesOf`, above.
    //
    // The work runs through `runAdapterTransaction`, so what it throws reaches
    // the plugin as thrown rather than as the adapter's classification of it.
    // On SQLite it also runs marked as a plugin transaction, as `raw`'s does:
    // a service called inside nests as a savepoint, defers what follows its
    // write until the commit, and refuses what a rollback could not undo.
    // Through the adapter, which keeps the bounds for the calling flow, so
    // the transactions the core services open inside `work` take them too.
    withTransactionBounds: (bounds, work) => {
      const transactions = adapter();
      return transactions.withTransactionBounds === undefined
        ? work()
        : transactions.withTransactionBounds(bounds, work);
    },
    transaction: (fn, options) => {
      const run = (tx: AdapterTransactionHandles) => fn(handlesOf(tx));
      const transactions = adapter();
      // A snapshot: REPEATABLE READ and read-only on PostgreSQL and MySQL
      // (MySQL's default level already, named so a server configured
      // otherwise still gives one). SQLite's transactions are serial, so one
      // is a snapshot already, and nothing is asked of its adapter.
      const adapterOptions: TransactionOptions | undefined =
        options?.isolation === "snapshot" && dialect() !== "sqlite"
          ? { isolationLevel: "repeatable read", readOnly: true }
          : undefined;
      return runAdapterTransaction(
        adapterOptions === undefined
          ? transactions.transaction.bind(transactions)
          : <R>(work: (tx: AdapterTransactionHandles) => Promise<R>) =>
              transactions.transaction(work, adapterOptions),
        (tx: AdapterTransactionHandles) =>
          dialect() === "sqlite"
            ? runInPluginTransaction(() => run(tx))
            : run(tx)
      );
    },
  };
  const surface = createPluginDatabase(deps);

  return {
    db: Object.assign(surface, { raw: rawDb }),
    bindTo: (tx, work) =>
      bindPluginDatabase(deps, handlesOf(tx), work, {
        method: "ctx.hooks.onInTransaction",
      }),
  };
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
export interface AdapterTransactions
  extends AfterCommitAdapter,
    OpenTransactionProbe {
  /**
   * The callback receives the transaction's own context, whose `getDrizzle()`
   * is bound to the transaction's connection. Ignoring it and using the pooled
   * handle runs the work on a DIFFERENT connection on PostgreSQL and MySQL,
   * outside the transaction. Passing a relations config returns an instance
   * on that same connection with the relational query API enabled. On SQLite
   * a call made inside an open transaction nests as a savepoint.
   */
  transaction: <T>(
    work: (tx: AdapterTransactionHandles) => Promise<T>,
    /** The isolation and access mode, where the caller asked for one. */
    options?: TransactionOptions
  ) => Promise<T>;
  /**
   * Run work with every outermost transaction it opens bounded by the
   * database (the adapter's `withTransactionBounds`); absent on an adapter
   * that offers none, where the work runs as given.
   */
  withTransactionBounds?: <T>(
    bounds: PluginTransactionBounds,
    work: () => Promise<T>
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
 * The adapter as keyed digests use it: a session of its own for the first
 * use, and whether the calling flow is in a transaction. Every adapter core
 * ships has both; one that does not is refused with a clear error.
 */
function isDigestKeyAdapter(value: unknown): value is DigestKeyAdapter {
  if (typeof value !== "object" || value === null) return false;
  const methods: readonly (keyof DigestKeyAdapter)[] = [
    "withSession",
    "transactionOpenInFlow",
  ];
  const record = value as Record<string, unknown>;
  return (
    typeof record.dialect === "string" &&
    methods.every(name => typeof record[name] === "function")
  );
}

function asDigestKeyAdapter(adapter: AdapterTransactions): DigestKeyAdapter {
  if (isDigestKeyAdapter(adapter)) return adapter;
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "An unexpected error occurred.",
    logMessage:
      "The adapter this plugin context resolves has no dialect, withSession or transactionOpenInFlow, which keyed digests need.",
    logContext: { reason: "digest-adapter-incomplete" },
  });
}

/**
 * The resolved adapter as received-webhook claims need it, or a named failure
 * when a stand-in lacks a part of it, rather than a TypeError mid-claim.
 */
/**
 * The adapter this context resolves, as a plugin's durable events record
 * through it: checked for the two methods they use rather than cast, so a
 * context built over something less refuses plainly instead of failing on
 * the first event.
 */
function asDurableEventsAdapter(
  adapter: AdapterTransactions
): DurableEventsAdapter {
  const value: unknown = adapter;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).transaction === "function" &&
    typeof (value as Record<string, unknown>).afterCommit === "function"
  ) {
    return value as DurableEventsAdapter;
  }
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "An unexpected error occurred.",
    logMessage:
      "The adapter this plugin context resolves has no transaction or afterCommit, which durable events need.",
    logContext: { reason: "durable-events-adapter-incomplete" },
  });
}

function asReceivedWebhooksAdapter(
  adapter: AdapterTransactions
): ReceivedWebhooksAdapter {
  const value: unknown = adapter;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>).transaction === "function" &&
    typeof (value as Record<string, unknown>).transactionOpenInFlow ===
      "function" &&
    typeof (value as Record<string, unknown>).dialect === "string"
  ) {
    return value as ReceivedWebhooksAdapter;
  }
  throw new NextlyError({
    code: "INTERNAL_ERROR",
    publicMessage: "An unexpected error occurred.",
    logMessage:
      "The adapter this plugin context resolves has no transaction, transactionOpenInFlow or dialect, which received-webhook claims need.",
    logContext: { reason: "received-webhooks-adapter-incomplete" },
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
   * `transaction` nests as a savepoint. Write through it: another service
   * called inside runs on its own connection on PostgreSQL and MySQL, outside
   * this transaction. `ctx.settings.set` is refused inside it on every
   * dialect: write the setting after the transaction.
   *
   * On SQLite the transaction holds the database's only connection until it
   * ends. A service called inside joins it as a savepoint,
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
   *
   * Declaring it is not enough: the app must also list the plugin in
   * `auth.loginPlugins`, or the boot refuses, naming the line to add. A
   * `determineUser` auth hook counts as this capability too, since it decides
   * who is signed in.
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

/**
 * Each registry row's fields, by the row's slug, as the one-row read reduces
 * a row: for a host-types walk that reads every row in one statement.
 */
function fieldsBySlug<R extends { slug: string }, F>(
  records: readonly R[],
  fieldsOf: (record: R) => F
): ReadonlyMap<string, F> {
  return new Map(records.map(record => [record.slug, fieldsOf(record)]));
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
              : T extends "singleEntryService"
                ? SingleEntryService
                : T extends "collectionRegistryService"
                  ? CollectionRegistryService
                  : T extends "fieldGroupRegistryService"
                    ? FieldGroupRegistryService
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
                                : T extends "jobRegistry"
                                  ? JobRegistry
                                  : T extends "jobsDatabase"
                                    ? JobsPassDatabase
                                    : T extends "webhookFastDrainScheduler"
                                      ? WebhookFastDrainScheduler | null
                                      : T extends "metaService"
                                        ? DigestKeyStore
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
    /**
     * Optional, so a registry written before the in-transaction phase still
     * builds a context; `ctx.hooks.onInTransaction` then refuses rather than
     * dropping the handler.
     */
    registerInTransaction?: (
      collection: string,
      runner: InTransactionRunner,
      owner?: HookOwner
    ) => void;
    unregisterInTransaction?: (
      collection: string,
      runner: InTransactionRunner,
      owner?: HookOwner
    ) => void;
    /**
     * Optional for the same reason: a registry without them refuses
     * `ctx.hooks.onCollectionDelete` rather than dropping the handlers.
     */
    registerCollectionDelete?: (
      runner: CollectionDeleteRunner,
      owner?: HookOwner
    ) => void;
    unregisterCollectionDelete?: (
      runner: CollectionDeleteRunner,
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
  // The boot-time name, not the live one: `init` may rename its own
  // definition, and the identity this context attributes — hooks, events,
  // `ctx.self`, the auth grant — is the one the boot resolved.
  const pluginName = plugin === undefined ? undefined : bootNameOf(plugin);

  // Everything registered through this context is attributed to the plugin, so
  // a config reload can rebuild the config's own handlers without deleting a
  // plugin's -- the form builder registers its `afterRead` straight into the
  // `forms` namespace, and nothing would put that back. A context built without
  // a plugin has no identity to attribute to and keeps the registry's default.
  const hookOwner: HookOwner | undefined = pluginName
    ? `plugin:${pluginName}`
    : undefined;

  // One runner per handler, made on its first registration and reused, so
  // `offInTransaction` finds by identity the very runner `onInTransaction`
  // registered for that handler. The runner hands the handler this plugin's
  // database bound to the write's transaction, through the binder
  // `ctx.db.transaction` uses (resolved when a write runs it, by which time
  // the surface below exists).
  const inTransactionRunners = new WeakMap<
    InTransactionHandler,
    InTransactionRunner
  >();
  const inTransactionRunner = (
    handler: InTransactionHandler
  ): InTransactionRunner => {
    const known = inTransactionRunners.get(handler);
    if (known) return known;
    const runner: InTransactionRunner = (tx, write) =>
      bindToTransaction(tx, bound =>
        withWriteTransactionToken(tx, async (transaction, transactionKey) => {
          const read = storedReadOn(tx, write.collection);
          try {
            await handler({
              ...write,
              db: bound,
              transaction,
              transactionKey,
              readStored: read.readStored,
              fieldPaths: read.fieldPaths,
            });
          } catch (error) {
            // The handler's own failure is the write's; reads it left running
            // are waited for, so none outlives the transaction.
            await read.settle();
            throw error;
          }
          const unawaited = await read.settle();
          if (unawaited === undefined) return;
          throw unawaited instanceof Error
            ? unawaited
            : NextlyError.internal({
                logContext: {
                  reason: "in-transaction-read-failed-after-handler",
                  plugin: pluginName,
                },
              });
        })
      );
    inTransactionRunners.set(handler, runner);
    return runner;
  };

  // How the phase names a Single's write: `single:<slug>`.
  const SINGLE_TARGET_PREFIX = singleHookNamespace("");
  // The stored reads an in-transaction handler is handed: on the write's own
  // transaction, scoped to the field types this plugin contributes, as a
  // validator's is scoped to its own, and sharing one registry lookup per
  // collection for the whole handler. Refused once the handler settles, so a
  // read kept past it cannot reach a transaction that has moved on.
  const storedReadOn = (tx: TransactionContext, written: string) => {
    let settled = false;
    let reads: StoredReads | undefined;
    const refuseUnless = (fieldType: string, ownType: boolean) => {
      if (!settled && ownType) return;
      throw NextlyError.internal({
        logContext: {
          reason: settled
            ? "in-transaction-read-after-settle"
            : "in-transaction-read-of-another-field-type",
          plugin: pluginName,
          fieldType,
        },
      });
    };
    // Loaded on first use, as the phase is, and checked again once loaded: a
    // read started as the handler returned must not reach the transaction.
    const open = async (fieldType: string) => {
      const own = plugin?.contributes?.fieldTypes ?? [];
      refuseUnless(
        fieldType,
        own.some(entry => entry.type === fieldType)
      );
      const { storedReadsOn } = await import(
        "../domains/collections/services/stored-field-read"
      );
      refuseUnless(fieldType, true);
      reads ??= storedReadsOn({
        db: tx,
        executor: tx.getDrizzle(),
        defaultLocale:
          getServiceFn("config").localization?.defaultLocale ?? null,
      });
      return reads;
    };
    // Every read accepted before the handler settled, until it settles, so
    // the transaction ends only once they have finished, as the bound
    // database waits for statements the handler started and did not await.
    const inFlight = new Set<Promise<unknown>>();
    const tracked = <T>(work: Promise<T>): Promise<T> => {
      inFlight.add(work);
      const forget = () => inFlight.delete(work);
      void work.then(forget, forget);
      return work;
    };
    return {
      /**
       * Refuse further reads, wait for the ones still running, and answer
       * the first failure among them: one the handler never awaited, which
       * fails the write as an unawaited statement does.
       */
      settle: async (): Promise<unknown> => {
        settled = true;
        const outcomes = await Promise.allSettled([...inFlight]);
        const failed = outcomes.find(
          (outcome): outcome is PromiseRejectedResult =>
            outcome.status === "rejected"
        );
        return failed?.reason;
      },
      readStored: (
        fieldType: string,
        target: PluginStoredValueTarget
      ): Promise<PluginStoredValue> =>
        tracked(open(fieldType).then(reads => reads.read(fieldType, target))),
      fieldPaths: (fieldType: string): Promise<readonly string[]> =>
        tracked(
          open(fieldType).then(reads =>
            reads.fieldPaths(
              written.startsWith(SINGLE_TARGET_PREFIX)
                ? { single: written.slice(SINGLE_TARGET_PREFIX.length) }
                : { collection: written },
              fieldType
            )
          )
        ),
    };
  };

  // Bound here, as both are optional on the registry this context is given.
  const registerInTransaction =
    hookRegistry.registerInTransaction?.bind(hookRegistry);
  const unregisterInTransaction =
    hookRegistry.unregisterInTransaction?.bind(hookRegistry);
  const registerCollectionDelete =
    hookRegistry.registerCollectionDelete?.bind(hookRegistry);
  const unregisterCollectionDelete =
    hookRegistry.unregisterCollectionDelete?.bind(hookRegistry);

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
    onInTransaction: (collection, handler) => {
      // Refused, not dropped: a handler that silently never ran would leave
      // the plugin's rows out of step with every entry written after it.
      if (!registerInTransaction || !unregisterInTransaction) {
        throw NextlyError.internal({
          logContext: {
            reason: "hook-registry-without-in-transaction-phase",
            plugin: pluginName,
          },
        });
      }
      const runner = inTransactionRunner(handler as InTransactionHandler);
      registerInTransaction(collection, runner, hookOwner);
      if (pluginName) {
        recordPluginSubscription(pluginName, () =>
          unregisterInTransaction(collection, runner, hookOwner)
        );
      }
    },
    offInTransaction: (collection, handler) => {
      // A registry without the phase holds none of its handlers.
      unregisterInTransaction?.(
        collection,
        inTransactionRunner(handler as InTransactionHandler),
        hookOwner
      );
    },
    onCollectionDelete: handlers => {
      if (!registerCollectionDelete || !unregisterCollectionDelete) {
        throw NextlyError.internal({
          logContext: {
            reason: "hook-registry-without-collection-delete",
            plugin: pluginName,
          },
        });
      }
      const { impact, inTransaction } = handlers;
      const runner: CollectionDeleteRunner = {
        ...(impact === undefined ? {} : { impact }),
        // The delete's transaction reaches the plugin as a token of its own,
        // open while the handler runs and refused once it settles, as an
        // in-transaction handler's is; a statement it started and did not
        // await finishes before the delete goes on.
        ...(inTransaction === undefined
          ? {}
          : {
              inTransaction: (slug: string, tx: TransactionContext) =>
                withWriteTransactionToken(
                  tx,
                  transaction => inTransaction({ slug, transaction }),
                  "ctx.hooks.onCollectionDelete"
                ),
            }),
      };
      registerCollectionDelete(runner, hookOwner);
      if (pluginName) {
        recordPluginSubscription(pluginName, () =>
          unregisterCollectionDelete(runner, hookOwner)
        );
      }
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
    plugin !== undefined && grants.rawSql.includes(bootNameOf(plugin)),
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
  const { db, bindTo: bindToTransaction } = buildPluginDatabase(
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
  const bus: EventBus = pluginName
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
            return (
              name: EventName,
              payload: unknown,
              options?: PluginEmitOptions
            ) => {
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
              emitAfterCommit(
                () => target.emit(name, payload),
                options?.tx,
                () => getServiceFn("adapter"),
                logger
              );
            };
          }
          const value = Reflect.get(target, prop, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      })
    : rawBus;
  // The durable half, beside the bus: what a plugin records with its work
  // and delivers until each subscriber has it.
  const durable = pluginDurableEvents(plugin, () =>
    asDurableEventsAdapter(getServiceFn("adapter"))
  );
  const emitDurable = durable.emitDurable.bind(durable);
  const onDurable = durable.onDurable.bind(durable);
  const events = new Proxy(bus as unknown as PluginContext["events"], {
    get(target, prop) {
      if (prop === "emitDurable") return emitDurable;
      if (prop === "onDurable") return onDurable;
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  // Built once per context rather than per call: it closes over the
  // allowlist, and nothing about it changes between requests.
  const pluginFetch = plugin ? createPluginFetchFor(plugin) : undefined;
  const pluginPrincipals = plugin ? createPluginPrincipals(plugin) : undefined;
  const pluginLimits = plugin ? createPluginLimits(plugin) : undefined;
  // Whose secrets and webhook types this context reaches: the plugin's, or
  // core's for a context built without one. The boot-time name, not the
  // mutable one: a plugin renaming itself in `init` onto a listed name must
  // not reach that name's secrets or webhook types.
  const owner = plugin === undefined ? "nextly" : bootNameOf(plugin);

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

  // Resolved once: `ctx.self` names the collections, and the own-collection
  // grant is issued for exactly those, so the two cannot disagree.
  const self: PluginSelf = plugin
    ? resolvePluginSelf(plugin)
    : { name: "", collections: {}, singles: {} };

  // Under this plugin's own key, kept in `nextly_meta` sealed in its name.
  // The store and the install's secrets are read per call, as above. One
  // helper for `ctx.security.digests` and for the recipient digests its
  // queued email carries, so the two are one key and agree.
  const digests = createKeyedDigests({
    owner,
    store: () => getServiceFn("metaService"),
    adapter: () => asDigestKeyAdapter(getServiceFn("adapter")),
    // The keyed generations only: a key is sealed and opened with one.
    secrets: () =>
      secretGenerations(env.NEXTLY_SECRET, env.NEXTLY_SECRET_PREVIOUS).filter(
        (generation): generation is string => typeof generation === "string"
      ),
  });
  const emailScope = pluginKeyScope(pluginName);
  if (pluginName) {
    // The digests its queued emails' recipients carry and its exclusions are
    // compared by, withdrawn at teardown with its other subscriptions.
    recordPluginSubscription(
      pluginName,
      useRecipientDigester(emailScope, mailbox =>
        digests.digest(RECIPIENT_DIGEST_PURPOSE, mailbox)
      )
    );
  }

  return {
    services: {
      // Bound to this plugin's boot name, so what its services record names
      // it, whatever the plugin itself says. A rewrite of a Single goes to
      // the Singles service, resolved on its first use.
      collections: wrapCollectionsForPlugin(
        collectionService,
        undefined,
        pluginName,
        () => getServiceFn("singleEntryService")
      ),
      // The Singles service is resolved on the first own-Single read, for
      // the same reason `versions` and `singles` below are resolved on
      // access: a context built by a caller that never reads one asks
      // nothing of it.
      ownCollections: ownCollectionReads(
        collectionService,
        Object.values(self.collections),
        {
          owned: Object.values(self.singles),
          service: () => getServiceFn("singleEntryService"),
        },
        // What a host read is judged against: this plugin's field types, and
        // each schema as the registries hold it when the read is made, so a
        // collection created or changed at runtime is judged as it is now.
        // The registries are asked inside the read's transaction scope, so
        // they read on its connection.
        {
          fieldTypes: (plugin?.contributes?.fieldTypes ?? []).map(
            fieldType => fieldType.type
          ),
          fieldsOf: async (kind, slug) => {
            if (kind === "Single") {
              const record = await getServiceFn(
                "singleRegistryService"
              ).getSingleBySlug(slug);
              return record?.fields ?? null;
            }
            const record = await getServiceFn(
              "collectionRegistryService"
            ).getCollectionBySlug(slug);
            return record === null ? null : collectionFields(record);
          },
          componentFields: async slug =>
            (
              await getServiceFn(
                "fieldGroupRegistryService"
              ).getComponentBySlug(slug)
            )?.fields ?? null,
          // The listings a plugin reads through `services.collections` and
          // `services.singles`, so the host-types walk describes each entry
          // as those do, each beside the fields `fieldsOf` would take from
          // it, from the same statement. The collection listing ignores its
          // request context; its record carries the registry's fields, with
          // the title and slug inputs every collection has, which are of no
          // plugin's type (a registered type cannot take a built-in name).
          listCollections: async limit =>
            (
              await collectionService.listCollections(
                { page: 1, limit, sortBy: "slug", sortOrder: "asc" },
                {}
              )
            ).data.map(record => ({
              record,
              fields: collectionFields(record),
            })),
          // The rows `services.singles.list` lists, in its order, described
          // by its own mapping; the row's declared fields come beside it,
          // since the description drops the component a field names.
          listSingles: async () =>
            (await getServiceFn("singleRegistryService").getAllSingles()).map(
              row => ({
                record: toPluginSingleRecord(row),
                fields: row.fields,
              })
            ),
          // Every row at once, each reduced to its fields exactly as
          // `componentFields` reduces the one row it reads.
          allComponentFields: async () =>
            fieldsBySlug(
              await getServiceFn(
                "fieldGroupRegistryService"
              ).getAllComponents(),
              record => record.fields
            ),
        }
      ),
      // The plugin view, refusing the writes that decide who administers the
      // site; core's own callers keep the unrestricted instance. Resolved on
      // access like `versions` below, so a context built by a caller that
      // never manages users asks nothing of the service it was handed.
      get users() {
        return methodFacade(userService.forPlugins(), PLUGIN_USER_METHODS);
      },
      media: mediaForPlugin(mediaService),
      // A plugin's keys are its own: scoped to its name, so two plugins, or a
      // plugin and the site, never name one send with the same key.
      email: Object.freeze({
        ...methodFacade(
          scopedSender(emailService, emailScope),
          PLUGIN_EMAIL_METHODS
        ),
        // Its own queued emails only, and its own digests, by its scope.
        readQueued: (ids: readonly string[]) =>
          scopedSender(emailService, emailScope).readQueued(ids),
        recipientDigest: (address: string) =>
          scopedSender(emailService, emailScope).recipientDigest(address),
        // Each change of its own queued emails, in the change's transaction,
        // with this plugin's database and collection token bound to it.
        onQueuedEmailChange: (handler: QueuedEmailChangeHandler) => {
          const undo = onQueuedEmailChange(emailScope, (change, tx) =>
            bindToTransaction(tx, db =>
              withWriteTransactionToken(
                tx,
                async transaction => {
                  await handler(change, { db, transaction });
                },
                "ctx.services.email.onQueuedEmailChange"
              )
            )
          );
          if (pluginName) recordPluginSubscription(pluginName, undo);
          return undo;
        },
        // Its own sends only, by the same scope its keys are claimed in.
        forgetSends: (
          input: ForgetSendsInput,
          options?: { tx?: PluginTransaction }
        ) =>
          forgetPluginSends(pluginKeyScope(pluginName), input, {
            tx: options?.tx,
            // The context's own adapter, as its other services use.
            adapter: getServiceFn("adapter"),
            secrets: pluginSettingsSecrets(env),
          }),
      }),
      // Resolved on access, not at construction: `createPluginContext` is
      // exported, and a resolver written before this service existed would
      // otherwise throw while building the context for callers that never
      // touch version history.
      get versions() {
        const versions = getServiceFn("versionsService");
        return Object.freeze({
          ...methodFacade(versions, PLUGIN_VERSIONS_READS),
          ...pluginVersionWrites(() => versions, pluginName),
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
      //
      // Built for THIS plugin, so running a sweep now is limited to the sweeps
      // it contributes; see `plugin-jobs`.
      get jobs() {
        return pluginJobsNamespace(
          plugin?.name,
          contextSweepHost({
            registry: () => getServiceFn("jobRegistry"),
            database: () => getServiceFn("jobsDatabase"),
          })
        );
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
    self,
    config: pluginConfigView(config),
    hooks: pluginHooks,
    publicAddresses: pluginPublicAddresses({
      bindTo: bindToTransaction,
      owner: hookOwner ?? "app",
      dialect: () => getServiceFn("dialect"),
      // Withdrawn at teardown with the plugin's other subscriptions.
      onTeardown: undo => {
        if (pluginName) recordPluginSubscription(pluginName, undo);
      },
    }),
    filters: pluginFilters,
    actions: pluginActions,
    // A plain property rather than a getter: `runPluginRoute` spreads the base
    // context on every request, which would evaluate a top-level getter each
    // time. The instance itself resolves its dependencies lazily instead.
    // Bound to the plugin and to the boot's verdict, so `completeLogin`
    // answers to the grant decided at resolution; a context built for no
    // plugin is core's own and gets the shared one.
    auth: plugin ? getPluginAuthApiFor(plugin, grants) : getPluginAuthApi(),
    // Built once here and kept as a plain property, like `auth`: it holds no
    // per-request state, so the copy every route spreads is the same helper.
    security: {
      passwords: createPasswordHelper({
        breachedPasswords: config.security?.breachedPasswords,
        logger,
      }),
      opaque: createOpaqueSecrets(),
      // Verifying holds no state: the secrets come with each call, from
      // wherever the plugin keeps them. Claims are kept within this plugin's
      // name, on the adapter read per call through this context's own
      // resolver, as the secrets helper's is.
      webhooks: createPluginReceivedWebhooks({
        owner,
        adapter: () => asReceivedWebhooksAdapter(getServiceFn("adapter")),
      }),
      // Kept within this plugin's name. The adapter is read per call, as the
      // context can be built before the database connects, and through this
      // context's own resolver rather than the global container: a context
      // outlives a container being cleared, as on a reload while old plugins
      // finish tearing down. The install's secrets are read per call so a
      // rotation applies at once.
      // Under this plugin's own key, kept in `nextly_meta` sealed in its name.
      // The store and the install's secrets are read per call, as above.
      digests,
      secrets: createOneTimeSecrets({
        owner,
        adapter: () => asSecretsAdapter(getServiceFn("adapter")),
        // Every generation, the unkeyed one included: a secret minted before
        // NEXTLY_SECRET was set stays readable while '[null]' keeps it.
        // The current generation first, the unkeyed one when no NEXTLY_SECRET is set, as the
        // helper writes with the head of this list.
        secrets: () =>
          generationsCurrentFirst(
            env.NEXTLY_SECRET,
            env.NEXTLY_SECRET_PREVIOUS
          ),
      }),
    },
    // Kept within this plugin's name, which decides the types it may record.
    // The adapter is read per call and through this context's own resolver,
    // as the secrets helper's is.
    // Under the same name as its webhooks: a plugin expires its own tags.
    cache: createPluginCache(owner),
    webhooks: createPluginWebhooks(
      owner,
      () => asSecretsAdapter(getServiceFn("adapter")),
      () => getServiceFn("webhookFastDrainScheduler")
    ),
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

/**
 * Deliver a plugin's event once the work that emitted it commits, by the one
 * rule every emit follows: with the plugin's own transaction handle, when
 * that transaction commits; inside a transaction the calling flow holds,
 * when its outermost transaction commits (a savepoint that rolls back drops
 * its own, and a retried attempt's are discarded); outside any transaction,
 * at once. Never for work that rolled back. Called once the name has passed
 * every refusal, so a refused event is never held.
 */
function emitAfterCommit(
  deliver: () => void,
  tx: PluginTransaction | undefined,
  adapter: () => Pick<DrizzleAdapter, "afterCommit">,
  logger: Pick<Logger, "error">
): void {
  if (tx !== undefined) {
    try {
      linkedTransaction(tx, "events.emit").afterCommit(deliver);
    } catch (error) {
      // A handle whose transaction has ended, committed or rolled back, is
      // refused, as every use of it is; the message says what to do instead.
      if (
        NextlyError.is(error) &&
        error.logContext?.reason === "plugin-transaction-finished"
      ) {
        throw NextlyError.validation({
          errors: [
            {
              path: "tx",
              code: "INVALID",
              message:
                "This transaction has already finished: emit without `tx` once the transaction has returned, or emit inside its callback.",
            },
          ],
          logContext: { reason: "plugin-transaction-finished" },
        });
      }
      throw error;
    }
    return;
  }
  // Held while the calling flow is inside a transaction, run now (before
  // this returns) when it is not: the adapter's own rule for what runs after
  // a commit, so a plugin's event and core's after-commit work agree.
  void adapter().afterCommit(deliver, error => {
    logger.error("A plugin's event could not be delivered after commit", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

/**
 * A plugin's `emitDurable` and `onDurable`: its durable events, recorded by
 * the one rule its `emit` follows, and offered for prompt dispatch once
 * they commit; its subscribers, keyed by its boot-time name and the name it
 * gives each, and retired when the plugin is torn down. A context built
 * without a plugin has no events of its own to record, and refuses both.
 */
function pluginDurableEvents(
  plugin: PluginDefinition | undefined,
  adapter: () => DurableEventsAdapter
): PluginDurableEvents {
  if (plugin === undefined) {
    const refusal = (): NextlyError =>
      NextlyError.forbidden({
        logContext: { reason: "durable-events-without-plugin" },
      });
    const refuse = (): never => {
      throw refusal();
    };
    return {
      // Rejects rather than throws, as an emit that is refused for any
      // other reason does.
      emitDurable: () => Promise.reject(refusal()),
      onDurable: refuse,
    };
  }
  const owner = bootNameOf(plugin);
  const recorder = createDurableEventRecorder({
    owner,
    durable: durableEventNames(plugin.contributes?.events),
    adapter,
    kick: getDurableEventsKick,
  });
  return {
    emitDurable: (name, payload, options) =>
      recorder.record(name, payload, options),
    onDurable(name, subscriber, handler) {
      getDurableSubscribers().register(owner, name, subscriber, handler);
      // Torn down with the plugin, as its other subscriptions are: retired,
      // so a re-initialised plugin registers the same names again, and an
      // event dispatched before it has is still owed to them.
      recordPluginSubscription(owner, () =>
        getDurableSubscribers().retireOwner(owner)
      );
    },
  };
}
