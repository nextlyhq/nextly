/**
 * UserMutationService - Write operations for users
 *
 * Handles user creation, updates, and deletion with validation,
 * role assignment, and email service integration.
 *
 * This service uses the database adapter pattern for multi-database support
 * (PostgreSQL, MySQL, SQLite). For complex queries, it uses direct Drizzle
 * access via the compatibility layer until the adapter is enhanced.
 *
 * @example
 * ```typescript
 * const mutationService = new UserMutationService(adapter, logger);
 *
 * const newUser = await mutationService.createLocalUser({ email: 'user@example.com', name: 'John' });
 * await mutationService.updateUser(userId, { name: 'Jane' });
 * await mutationService.deleteUser(userId);
 * ```
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { Table, Column } from "drizzle-orm";
import { eq } from "drizzle-orm";

import { hashPassword } from "@nextly/auth/password";
import {
  CreateLocalUserSchema,
  UpdateUserSchema,
} from "@nextly/schemas/_zod/user";
import {
  buildCreateUserSchema,
  buildUpdateUserSchema,
} from "@nextly/schemas/user-fields";
import type { MinimalUser } from "@nextly/types/auth";
import type {
  UserInsertData,
  UserUpdateData,
} from "@nextly/types/database-operations";

// PR 4 of unified-error-system migration: ServiceError result-shapes →
// NextlyError throws. Methods now return data directly or throw.
import { actorForWrite, type RequestActor } from "../../../auth/request-actor";
import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import {
  layoutRowId,
  widgetLayoutTables,
  WIDGET_LAYOUT_TABLE,
} from "../../../schemas/widget-layout";
import { BaseService } from "../../../services/base-service";
import type { EmailService } from "../../../services/email/email-service";
import { ServiceContainer } from "../../../services/index";
import type { Logger } from "../../../services/shared";
import { storageTypeToken } from "../../../shared/lib/plugin-storage";
import { requireFilterValue } from "../../../shared/lib/require-filter-value";
import type { UserConfig, UserFieldConfig } from "../../../users/config/types";
import { eraseActorPersonalData } from "../../audit/erase-actor-personal-data";
import {
  buildAcceptInviteLink,
  generateInviteTokenValue,
} from "../../auth/lib/invite-token";
import { affectedRowCount } from "../../auth/services/auth-service";
import { deliveriesTableFor } from "../../email/deliveries-table";
import { eraseRecipientDeliveries } from "../../email/erase-recipient";
import { revalidateMedia } from "../../media/revalidate-media";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import { VersionsRepository } from "../../versions/versions-repository";
import { recordMutationEventInTx } from "../../webhooks/record-mutation-event";

import type { UserExtSchemaService } from "./user-ext-schema-service";

// ============================================================
// Drizzle Runtime Types
// ============================================================

/** The column whose presence means this database can erase an identity. */
/**
 * What a database can record about an erasure.
 *
 * `false` means the table is absent, so there is nothing to erase.
 * `"unstamped"` means the table is there on its pre-erasure shape: the
 * identifying columns exist and are scrubbed, but the column that records when
 * does not, so that evidence is unavailable until the schema is upgraded.
 */
type ErasureShape = "stamped" | "unstamped" | false;

const ERASURE_STAMP_COLUMN = "identity_erased_at";

/**
 * Runtime-generated Drizzle table object (e.g., from `pgTable()` / `mysqlTable()` / `sqliteTable()`).
 * The exact type depends on the dialect; property access (e.g., `table.user_id`) is needed,
 * so we use `Record<string, unknown>` with an intersection of `Table` for Drizzle API compat.
 */
type DrizzleRuntimeTable = Table & Record<string, unknown>;

/**
 * Lint-safe replacement for the unsafe built-in `Function` type used as a
 * callable property holder. The Drizzle query builder methods we access
 * (insert/update/delete/...) return chainable thenables whose static types
 * we deliberately drop. The method type returns the same chainable shape
 * so dot-chaining keeps typing, and awaits resolve to
 * `Record<string, unknown>[]` (a row list) since that is the only shape
 * we ever consume here.
 */
interface DrizzleChain {
  [key: string]: DrizzleChainMethod;
}
type DrizzleChainMethod = (
  ...args: unknown[]
) => DrizzleChain & PromiseLike<Record<string, unknown>[]>;

/**
 * Minimal interface for the Drizzle transaction object returned by
 * BaseService.withTransaction. The real type is dialect-specific
 * (NodePgTransaction / MySql2Transaction / BetterSQLite3Database),
 * but the fluent query API is identical across all three.
 */
interface DrizzleTransactionLike {
  insert(table: unknown): { values(data: unknown): Promise<unknown> };
  update(table: unknown): {
    set(data: unknown): { where(condition: unknown): Promise<unknown> };
  };
  delete(table: unknown): { where(condition: unknown): Promise<unknown> };
  // Whole-row read, which Drizzle spells as `select()` with no projection.
  // Named as its own overload rather than widening the one below: the
  // projected form ends in `.limit()`, and collapsing the two would make a
  // caller that forgot the limit type-check.
  select(): {
    from(table: unknown): {
      // Awaitable as-is, and lockable where the dialect has row locks — the
      // same shape the projected form carries below, for the same reason.
      where(condition: unknown): Promise<Record<string, unknown>[]> & {
        for(strength: "update"): Promise<Record<string, unknown>[]>;
      };
    };
  };
  select(fields: unknown): {
    from(table: unknown): {
      where(condition: unknown): {
        // `.for("update")` exists on the Postgres/MySQL builders (SQLite has no
        // row lock); it is only invoked off SQLite, and the query is awaitable
        // either way.
        limit(count: number): Promise<Record<string, unknown>[]> & {
          for(strength: "update"): Promise<Record<string, unknown>[]>;
        };
      };
    };
  };
}

/**
 * The single capability the user write paths need from the webhook fast-path
 * drain: a synchronous, self-gating kick that runs a bounded delivery after the
 * response. Declared as this narrow interface — which `WebhookFastDrainScheduler`
 * satisfies — rather than the concrete scheduler so the dependency is exactly
 * the method called, and a test can supply a spy without reconstructing the
 * scheduler's private state.
 */
interface WebhookDrainOffer {
  offer(): void;
}

/**
 * The single capability the user write paths need from the webhook retention
 * runner: a bounded, self-gating prune offered after a committed write. Narrow
 * (which `RetentionRunner` satisfies) for the same reason as
 * {@link WebhookDrainOffer}.
 */
interface WebhookRetentionOffer {
  maybeRun(maxBatches?: number): Promise<void>;
}

/**
 * Data for creating a new local user.
 * Index signature allows custom field values from UserConfig.fields to pass through.
 */
export interface CreateLocalUserData {
  email: string;
  name: string;
  image?: string | null;
  /**
   * Omit (or leave empty) to create the account in invite mode: no credential
   * is set and a single-use set-password link is returned for the admin to
   * deliver. Provide a password to set the credential directly.
   */
  password?: string | null;
  roles?: string[];
  isActive?: boolean;
  /**
   * Force the user to replace this password on first sign-in (ASVS 6.4.1).
   * Set by the admin create path when an admin types a password for someone
   * else; NOT derived from password presence, so self-registration and the
   * setup flow (where the person chooses their own password) never trip it.
   */
  mustChangePassword?: boolean;
  /** Custom field values from user_ext */
  [key: string]: unknown;
}

/**
 * Data for updating an existing user.
 * Index signature allows custom field values from UserConfig.fields to pass through.
 */
export interface UpdateUserData {
  email?: string;
  name?: string;
  image?: string;
  password?: string | null;
  emailVerified?: Date | null;
  roles?: string[];
  isActive?: boolean;
  sendWelcomeEmail?: boolean;
  /** Custom field values from user_ext */
  [key: string]: unknown;
}

/**
 * The set-password link handed back when a user is created in invite mode
 * (no password): the copyable link is the artifact, and delivery by email is
 * an optional convenience on top of it.
 */
export interface InviteArtifact {
  /** The copyable set-password link to give to the new user. */
  link: string;
  /** When the link stops working. */
  expiresAt: Date;
}

/**
 * Response type for user mutation operations.
 *
 * Post-migration (PR 4): no `success`/`statusCode`/`message` envelope —
 * methods return the user directly on success or throw NextlyError.
 *
 * `invite` is present only when the account was created in invite mode; the
 * admin needs the link back to deliver it however they choose.
 */
export type UserMutationResponse = MinimalUser & { invite?: InviteArtifact };

/**
 * A user-field value shaped for the `user_ext` column its field maps to.
 *
 * The column builder maps a `date` field, and a plugin type storing as
 * `timestamp`, to a real timestamp column on every dialect, and Drizzle
 * refuses to bind a string to one. The failure surfaces as a `user_ext` insert
 * error, which the create path treats as the table being absent: it disables
 * the extension for the process and writes the user without the value, so a
 * wrong shape is lost rather than reported.
 */
export function coerceUserExtValue(
  value: unknown,
  field: { name?: unknown; type?: unknown }
): unknown {
  const token = storageTypeToken(field);
  const name = typeof field.name === "string" ? field.name : "input";

  // A plugin user field validates through `z.unknown()`, so nothing upstream
  // has looked at the value at all. Whatever reaches here goes straight to the
  // driver, and a failed `user_ext` insert is read as the table being absent —
  // the extension is disabled for the process and the user is written without
  // the value. So the shape is answered for here, where it can still be
  // reported, rather than at the column where it is silently lost.
  if (value !== null && value !== undefined) {
    if (token === "number" && !Number.isFinite(value)) {
      // Not just the type: `NaN` and `Infinity` are numbers that no dialect's
      // numeric column stores faithfully, and the built-in `z.number()` path
      // refuses them too.
      throw userExtValueError(name, "a number");
    }
    if (token === "checkbox" && typeof value !== "boolean") {
      throw userExtValueError(name, "true or false");
    }
    if (token === "date" && value instanceof Date) {
      // An Invalid Date binds as NULL on some drivers and throws on others.
      if (Number.isNaN(value.getTime())) {
        throw userExtValueError(name, "a valid date");
      }
      return value;
    }
    if (token === "date" && typeof value !== "string") {
      throw userExtValueError(name, "a date");
    }
    // Text and long text both hold a string. An object bound to a plain text
    // column fails on SQLite, and that failure is read as the extension table
    // being absent — so without this the value is dropped rather than refused.
    if (
      (token === "text" || token === "textarea") &&
      typeof value !== "string"
    ) {
      throw userExtValueError(name, "text");
    }
    // A JSON column stores what `JSON.stringify` can represent. A BigInt or a
    // cycle throws there, a function or symbol silently becomes `undefined`,
    // and either way the failure is read as the extension table being absent —
    // so the value is answered for here instead of vanishing.
    if (token === "json") {
      try {
        if (JSON.stringify(value) === undefined) {
          throw userExtValueError(name, "a JSON value");
        }
      } catch (error) {
        if (NextlyError.isValidation(error)) throw error;
        throw userExtValueError(name, "a JSON value");
      }
    }
  }

  if (typeof value !== "string") return value;
  if (token !== "date") return value;
  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) return parsed;

  // Refused rather than forwarded. Nothing upstream rejects it — a `date`
  // field validates as `z.union([z.date(), z.string()])` and a plugin type
  // falls to `z.unknown()` — so passing it on reaches the driver, and the
  // caller is told the value was stored when it was not.
  throw userExtValueError(name, "a valid date");
}

/** A refusal naming the field and what its column can hold. */
function userExtValueError(name: string, expected: string): NextlyError {
  return NextlyError.validation({
    errors: [
      {
        path: name,
        code: "INVALID_USER_FIELD_VALUE",
        message: `${name} must be ${expected}.`,
      },
    ],
  });
}

/**
 * The media columns the detach reads back.
 *
 * Deliberately loose: the row is forwarded whole as the event's `previous` and,
 * with two fields overlaid, as its `data`. Naming each column here would be a
 * second declaration of the media shape that nothing keeps in step with the
 * schema — the event only needs the id and the identity of the row.
 */
interface MediaRow {
  id: string;
  [column: string]: unknown;
}

export class UserMutationService extends BaseService {
  private readonly userConfig?: UserConfig;
  private readonly userExtSchemaService?: UserExtSchemaService;

  /** Last known merged field count — used to detect stale caches */
  private lastMergedFieldCount = -1;

  /** Cached runtime Drizzle table object for user_ext (regenerated when fields change) */
  private userExtTable: DrizzleRuntimeTable | null = null;

  /** Cached set of custom field names for quick lookup (regenerated when fields change) */
  private customFieldNames: Set<string> | null = null;

  /** Set to true when a user_ext query fails (table missing), disabling ext operations */
  private userExtDisabled = false;

  /**
   * Audit tables already confirmed to carry the erasure stamp, by table name.
   *
   * Only a confirmed stamp is cached. A table that is absent, or present on its
   * pre-erasure shape, is the state an operator fixes by upgrading, so those
   * are re-probed on each deletion: that costs one catalogue lookup on a rare
   * operation, where caching them would keep answering with a shape the
   * database has since left for the life of the process.
   */
  private readonly erasableTables = new Set<string>();

  /** Cached merged Zod schemas (lazy, rebuilt when merged fields are available) */
  private createSchema: typeof CreateLocalUserSchema;
  private updateSchema: typeof UpdateUserSchema;
  private schemasBuiltWithMerged = false;

  /**
   * Creates a new UserMutationService instance.
   *
   * @param adapter - Database adapter for multi-database support
   * @param logger - Logger instance
   * @param userConfig - Optional user extension configuration
   * @param userExtSchemaService - Optional schema service for generating runtime user_ext table
   * @param emailService - Optional email service for sending welcome emails
   */
  constructor(
    adapter: DrizzleAdapter,
    logger: Logger,
    userConfig?: UserConfig,
    userExtSchemaService?: UserExtSchemaService,
    emailService?: EmailService,
    // Optional so a bare service (CLI, seed, unit test) still records events and
    // simply relies on the scheduled drain; wired from DI on the request paths.
    fastDrainScheduler?: WebhookDrainOffer,
    // Optional bounded retention pass offered after committed writes. The
    // shared runner carries both the webhook outbox and the audit trails, each
    // on its own window and gate; absent only when neither has anything to
    // prune, where the scheduled drain does the work instead.
    retentionRunner?: WebhookRetentionOffer
  ) {
    super(adapter, logger);

    this.userConfig = userConfig;
    this.userExtSchemaService = userExtSchemaService;
    this.emailService = emailService;
    this.fastDrainScheduler = fastDrainScheduler;
    this.retentionRunner = retentionRunner;

    // Build merged Zod schemas when custom fields are configured
    if (userConfig?.fields && userConfig.fields.length > 0) {
      this.createSchema = buildCreateUserSchema(userConfig.fields);
      this.updateSchema = buildUpdateUserSchema(userConfig.fields);
    } else {
      this.createSchema = CreateLocalUserSchema;
      this.updateSchema = UpdateUserSchema;
    }
  }

  // ============================================================
  // User Extension Helpers
  // ============================================================

  /**
   * Get the effective custom fields for this service.
   *
   * Prefers merged fields from `UserExtSchemaService` (code + UI sources,
   * loaded via `loadMergedFields()` at startup) and falls back to
   * `userConfig.fields` (code-only from `defineConfig()`).
   */
  private getEffectiveFields(): UserFieldConfig[] {
    if (this.userExtSchemaService?.hasMergedFields()) {
      return this.userExtSchemaService.getMergedFieldConfigs();
    }
    return this.userConfig?.fields ?? [];
  }

  /**
   * Check if custom user fields are configured (from either source).
   */
  private hasCustomFields(): boolean {
    return this.getEffectiveFields().length > 0;
  }

  /**
   * What this database can record about erasing a trail.
   *
   * Reports the SHAPE rather than a yes/no, because the two callers answer a
   * pre-erasure shape differently and only they can decide that.
   *
   * `false` — the table is absent, so there is no trail and no identifying data
   * to leave behind. `"unstamped"` — the table is there on its pre-erasure
   * shape, on a database whose upgrade did not reach it: the core reconcile
   * pushes only the static tables, and drizzle-kit's SQLite entrypoint takes no
   * table filter, so an ordinary `dc_*` content table reads as an orphan and
   * trips its rename resolver — after which the recovery pass can create
   * missing tables but never alters an existing one. The identifying columns
   * exist there; only the column recording WHEN an erasure happened does not.
   *
   * Neither answer fails the deletion. An account holder's right to have their
   * account removed does not depend on the state of a table they never saw, so
   * a shape that cannot be fully erased is reported and said out loud rather
   * than made a reason to refuse. What the caller does with
   * `"unstamped"` depends on the table: an un-erased `activity_log` row is
   * carried away by its cascading key, while an `audit_log` row has no key and
   * would keep its identifiers indefinitely, so that one is scrubbed without
   * the stamp rather than skipped.
   *
   * A probe that cannot run answers `"stamped"`, so an unreadable catalogue
   * leaves the erasure in place and the deletion fails loudly rather than
   * quietly skipping it.
   */
  private async supportsErasure(
    table: string,
    whatIsLost: string
  ): Promise<ErasureShape> {
    if (this.erasableTables.has(table)) return "stamped";

    let tableExists: boolean;
    try {
      tableExists = await this.adapter.tableExists(table);
    } catch {
      return "stamped";
    }
    if (!tableExists) return false;

    // Introspection rather than a probe query, because this needs an answer
    // and a failed statement is not one. A SELECT that throws cannot say
    // whether the column is missing or the connection blinked, and reading a
    // blink as "legacy shape" would delete an account without erasing it —
    // permanently, since the table no longer cascades. This asks the catalogue
    // directly and propagates anything that goes wrong, so an unanswerable
    // question fails the deletion instead of silently skipping the erasure.
    const snapshot = await introspectLiveSnapshot(this.db, this.dialect, [
      table,
    ]);
    const columns = snapshot.tables.find(t => t.name === table)?.columns ?? [];
    if (!columns.some(c => c.name === ERASURE_STAMP_COLUMN)) {
      this.logger.warn(
        `${table} predates identity erasure (no ${ERASURE_STAMP_COLUMN} ` +
          `column); deleting a user cannot record WHEN ${whatIsLost} was ` +
          "scrubbed from it. Run `nextly migrate` to apply the core schema " +
          "change."
      );
      return "unstamped";
    }

    this.erasableTables.add(table);
    return "stamped";
  }

  /**
   * Check if cached ext data is stale (merged fields changed since last cache).
   * If stale, clear caches so they are regenerated on next access.
   */
  private ensureCachesFresh(): void {
    const currentCount = this.getEffectiveFields().length;
    if (currentCount !== this.lastMergedFieldCount) {
      this.userExtTable = null;
      this.customFieldNames = null;
      this.schemasBuiltWithMerged = false;
      this.userExtDisabled = false;
      this.lastMergedFieldCount = currentCount;
    }
  }

  /**
   * Get or lazily create the runtime Drizzle table object for user_ext.
   * Automatically invalidated when merged fields change.
   */
  private getUserExtTable(): DrizzleRuntimeTable | null {
    this.ensureCachesFresh();
    if (this.userExtDisabled) return null;
    if (this.userExtTable) return this.userExtTable;
    if (!this.hasCustomFields() || !this.userExtSchemaService) return null;

    this.userExtTable = this.userExtSchemaService.generateRuntimeSchema(
      this.getEffectiveFields()
    );
    return this.userExtTable;
  }

  /**
   * Get the set of custom field names for quick lookup.
   * Automatically invalidated when merged fields change.
   */
  private getCustomFieldNames(): Set<string> {
    this.ensureCachesFresh();
    if (this.customFieldNames) return this.customFieldNames;

    this.customFieldNames = new Set<string>();
    for (const field of this.getEffectiveFields()) {
      if ("name" in field && field.name) {
        this.customFieldNames.add(field.name);
      }
    }
    return this.customFieldNames;
  }

  /**
   * Get the Zod create schema, rebuilding with merged fields if needed.
   */
  private getCreateSchema(): typeof CreateLocalUserSchema {
    this.ensureSchemasUpToDate();
    return this.createSchema;
  }

  /**
   * Get the Zod update schema, rebuilding with merged fields if needed.
   */
  private getUpdateSchema(): typeof UpdateUserSchema {
    this.ensureSchemasUpToDate();
    return this.updateSchema;
  }

  /**
   * Rebuild Zod validation schemas if merged fields are available
   * and haven't been incorporated yet.
   */
  private ensureSchemasUpToDate(): void {
    if (this.schemasBuiltWithMerged) return;
    if (!this.userExtSchemaService?.hasMergedFields()) return;

    const fields = this.getEffectiveFields();
    if (fields.length > 0) {
      this.createSchema = buildCreateUserSchema(fields);
      this.updateSchema = buildUpdateUserSchema(fields);
    }
    this.schemasBuiltWithMerged = true;
  }

  /**
   * Extract custom field values from input data.
   * Returns an object with only the keys that match configured custom field names.
   * Values are included even if null/undefined (to ensure user_ext row has all columns).
   */
  private extractCustomFieldValues(
    input: Record<string, unknown>
  ): Record<string, unknown> {
    const values: Record<string, unknown> = {};
    const fieldNames = this.getCustomFieldNames();

    // Keyed by name so a value can be shaped by the column its field maps to.
    const byName = new Map(
      this.getEffectiveFields()
        .filter(
          (field): field is typeof field & { name: string } =>
            "name" in field && typeof field.name === "string"
        )
        .map(field => [field.name, field])
    );

    for (const fieldName of fieldNames) {
      const raw = fieldName in input ? (input[fieldName] ?? null) : null;
      const field = byName.get(fieldName);
      values[fieldName] = field
        ? coerceUserExtValue(raw, { name: fieldName, type: field.type })
        : raw;
    }
    return values;
  }

  private readonly emailService?: EmailService;

  // Post-commit fast-path drain kick, shared with the collection/single/media
  // write paths. Absent on bare services, where the scheduled drain delivers.
  private readonly fastDrainScheduler?: WebhookDrainOffer;

  // Post-commit bounded retention pass, shared with the same write paths. It
  // offers both the webhook outbox and the audit trails; absent only when
  // neither has anything to prune, where the scheduled drain does the work.
  private readonly retentionRunner?: WebhookRetentionOffer;

  // Cap the write-path prune so a user write that happens to win the retention
  // gate is never held up by a large backlog; the scheduled drain owns bulk
  // pruning. Matches the collection/single write-path bound.
  private static readonly WRITE_PATH_PRUNE_BATCHES = 2;

  /**
   * Create a new local user with password authentication.
   *
   * §13.8 + spec note: "User with this email already exists" is sensitive
   * (account enumeration) and now surfaces as a generic
   * NextlyError.duplicate(). Validation errors carry per-field paths but
   * never echo values; identifiers go to logContext.
   *
   * @param actor - Who initiated the write, recorded for event attribution.
   *   Omitted for genuinely internal calls (seed, self-registration), which
   *   record no actor.
   * @throws NextlyError(VALIDATION_ERROR) on input validation / invalid role ids.
   * @throws NextlyError(DUPLICATE) when the email is already registered.
   * @throws NextlyError on DB errors via fromDatabaseError.
   */
  async createLocalUser(
    userData: CreateLocalUserData,
    actor?: RequestActor
  ): Promise<UserMutationResponse> {
    try {
      // Determine if this is the very first user in the database (existence check)
      const isFirstUser = await this.db.query.users.findFirst({
        columns: { id: true },
      });

      // Validate input (merged schema includes custom field validators when configured)
      const validation = this.getCreateSchema().safeParse(userData);
      if (!validation.success) {
        throw NextlyError.validation({
          errors: validation.error.issues.map(i => ({
            path: i.path.join(".") || "input",
            code: i.code.toUpperCase(),
            message: i.message,
          })),
          // Email goes to logContext only — never echoed in the public message.
          logContext: { entity: "user", email: userData.email },
        });
      }

      const { users } = this.tables;

      // 🔴 Derive the hash BEFORE the duplicate lookup, and keep it that way.
      //
      // The obvious reordering -- look the address up first, and skip a
      // deliberately expensive key derivation for a request that is going to be
      // rejected -- was applied here and then reverted, so the reasoning is
      // recorded rather than left to be rediscovered by whoever tries it next.
      //
      // It creates an ACCOUNT-ENUMERATION ORACLE. `/api/auth/register` answers
      // a taken address and a free one with byte-identical responses on purpose
      // (spec §13.2 silent-success), so duration is the only channel left --
      // and `stallResponse` is a FLOOR, not a fixed duration: it pads a fast
      // response up to `loginStallTimeMs` (500ms) and does nothing to a slow
      // one. Check-first therefore returns a taken address at ~500ms and a free
      // one at however long bcrypt takes, measured here at ~2.9s locally and
      // ~9.8s on a loaded runner. The two identical responses become trivially
      // distinguishable by a stopwatch.
      //
      // And it buys almost nothing against the availability concern it was
      // written for. An attacker burning CPU has no reason to send a REGISTERED
      // address: unregistered ones still reach the hash on every request, so
      // check-first only avoids the work in the case nobody attacking would
      // choose. What actually bounds that cost is the per-IP limiter, which
      // already covers this route -- `register` is in the shared auth bucket in
      // `auth/handlers/router.ts` and is checked before dispatch.
      //
      // So both paths pay the hash, both leave at the same time, and the
      // enumeration property the endpoint is designed around holds.
      let passwordHash: string | null = null;
      if (userData.password && userData.password.length > 0) {
        const looksPlain =
          userData.password.length < 32 || !userData.password.includes(":");
        passwordHash = looksPlain
          ? await hashPassword(userData.password)
          : userData.password;
      }

      // Account-enumeration sensitive: the public message stays generic
      // ("Resource already exists.") via NextlyError.duplicate; the email and
      // entity travel only through logContext.
      const existingUser = await this.db.query.users.findFirst({
        where: { email: requireFilterValue(userData.email, "email") },
        columns: { id: true, email: true },
      });
      if (existingUser) {
        throw NextlyError.duplicate({
          logContext: { entity: "user", email: userData.email },
        });
      }

      // If roles are provided, validate they all exist before creating the user.
      // Post-migration: services.roles.getRoleById throws NextlyError(NOT_FOUND)
      // when missing rather than returning {success, data} — catch and treat
      // any thrown error as "role not found" so we batch them into one
      // VALIDATION_ERROR for the caller.
      if (userData.roles && userData.roles.length > 0) {
        const uniqueRoleIds = Array.from(new Set(userData.roles));
        const services = new ServiceContainer(this.adapter);
        const invalidRoleIds: string[] = [];
        for (const rid of uniqueRoleIds) {
          try {
            await services.roles.getRoleById(rid);
          } catch (err) {
            // Only treat NOT_FOUND as the expected "invalid role id" case.
            // Re-throw anything else (transient DB outages, validation
            // failures, etc.) so they surface as 5xx instead of being
            // silently classified as bad role ids.
            if (NextlyError.isNotFound(err)) {
              invalidRoleIds.push(rid);
              continue;
            }
            throw err;
          }
        }
        if (invalidRoleIds.length > 0) {
          // §13.8: per-error message names the field (`roles`) but not the
          // bad values; the invalid ids go to logContext.
          throw NextlyError.validation({
            errors: [
              {
                path: "roles",
                code: "INVALID_ROLE_ID",
                message: "One or more role ids are invalid.",
              },
            ],
            logContext: { invalidRoleIds },
          });
        }
      }

      // Two ways to provision sign-in, decided by whether a password was
      // given. No password → invite mode: the account is created without a
      // credential and a single-use set-password link is minted in the same
      // transaction, so an admin can never be handed a user that has no way
      // in. A password → the admin set it directly and the account is usable
      // at once. The link is the artifact; delivering it by email is optional
      // and left to the caller, so nothing about creation depends on mail.
      const isInvite = passwordHash === null;

      // Insert new user (and user_ext if custom fields are configured)
      const now = new Date();
      const newUserId = randomUUID();
      const values: UserInsertData = {
        id: newUserId,
        email: userData.email,
        name: userData.name,
        passwordHash,
        // An invited account has not proven its address yet; accepting the
        // invite (which requires receiving the link) sets emailVerified in the
        // same step. An admin-set password vouches for the account, so it is
        // verified at creation.
        emailVerified: isInvite ? null : now,
        image: userData.image ?? null,
        isActive: userData.isActive ?? false,
        // Only true when an admin typed the password for someone else; the
        // caller decides, so self-registration/setup never force a change.
        mustChangePassword: userData.mustChangePassword === true,
        createdAt: now,
        updatedAt: now,
      };

      // Mint the invite token value up front (pure computation) so the hash can
      // be written inside the same transaction as the account. Storing only the
      // hash, atomically with the user, guarantees the two never diverge:
      // either the user and their live link both exist, or neither does.
      const inviteValue = isInvite ? generateInviteTokenValue() : null;

      // Extract custom field values before the transaction
      const hasExt = this.hasCustomFields();
      const userExtTable = hasExt ? this.getUserExtTable() : null;
      let customFieldValues: Record<string, unknown> = {};
      if (hasExt) {
        customFieldValues = this.extractCustomFieldValues(userData);
      }

      // Write the invite-token row alongside the user. Shared by the main path
      // and the user_ext self-healing retry so an invited account keeps its
      // link whichever path commits it.
      const insertInviteToken = async (txDb: DrizzleTransactionLike) => {
        if (!inviteValue) return;
        await txDb.insert(this.tables.userInviteTokens).values({
          userId: newUserId,
          tokenHash: inviteValue.tokenHash,
          expires: inviteValue.expiresAt,
        });
      };

      // Record a `user.created` webhook event inside the same transaction that
      // inserts the account, so a subscriber observes the account exactly when
      // it becomes real (and never for a rolled-back create). The payload is
      // deliberately PII-safe: identity only, never the password hash or the
      // invite-token hash. Roles are omitted on purpose: they are assigned after
      // this transaction commits (and the first user's super-admin role is too),
      // so no committed role state exists to report here without a false claim —
      // a creation event asserts identity, and role changes are their own
      // concern. `userCreatedRecorded` captures whether a row was written so the
      // fast drain is offered only for a real event, and only after commit.
      let userCreatedRecorded = false;
      const recordCreatedEvent = async (txDb: DrizzleTransactionLike) => {
        userCreatedRecorded = await recordMutationEventInTx(
          txDb,
          this.dialect,
          {
            type: "user.created",
            resource: { kind: "user", id: newUserId },
            data: {
              id: newUserId,
              email: userData.email,
              name: userData.name ?? null,
            },
            fields: [],
            actor: actor ?? null,
          }
        );
      };

      // Wrap user + user_ext + invite inserts in a transaction for atomicity.
      // tx is a Drizzle transaction (NodePgTransaction / MySql2Transaction /
      // BetterSQLite3Transaction depending on dialect) that exposes the same
      // fluent query API as this.db. See BaseService.withTransaction.
      //
      // Only the user_ext insert self-heals (a missing user_ext table on a fresh
      // DB). A flag records that it was the failing statement, so an unrelated
      // failure — the invite token or the outbox event — propagates as a real
      // error instead of being misdiagnosed as schema drift and silently retried
      // WITHOUT the custom-field data (which would report a created user while
      // dropping its custom fields).
      let userExtInsertFailed = false;
      try {
        await this.withTransaction(async tx => {
          const txDb = tx as DrizzleTransactionLike;
          await txDb.insert(users).values(values);

          // Always create a user_ext row when custom fields are configured
          if (hasExt && userExtTable) {
            try {
              await txDb.insert(userExtTable).values({
                id: randomUUID(),
                user_id: newUserId,
                ...customFieldValues,
                created_at: now,
                updated_at: now,
              });
            } catch (extErr) {
              // Mark user_ext as the failing statement and abort the transaction
              // so the outer catch retries without it. Aborting rather than
              // continuing is required: PostgreSQL poisons the whole transaction
              // after any statement error.
              userExtInsertFailed = true;
              throw extErr;
            }
          }

          await insertInviteToken(txDb);
          await recordCreatedEvent(txDb);
        });
      } catch (txErr) {
        // Self-healing is scoped to a genuine user_ext insert failure (typical on
        // a fresh DB before the user_ext table exists): disable user_ext for this
        // process and retry the user insert alone so the caller still gets a
        // created user. Any other failure is unrelated and must propagate.
        if (userExtInsertFailed && userExtTable) {
          const cause = txErr instanceof Error ? txErr.message : String(txErr);
          this.logger.warn(
            `user_ext insert failed during createLocalUser; disabling user_ext for this process: ${cause}`
          );
          this.userExtDisabled = true;
          await this.withTransaction(async tx => {
            const txDb = tx as DrizzleTransactionLike;
            await txDb.insert(users).values(values);
            await insertInviteToken(txDb);
            await recordCreatedEvent(txDb);
          });
        } else {
          throw txErr;
        }
      }

      // With the account and its outbox row committed, offer the shared
      // post-commit hooks, mirroring the collection/single/media write paths: a
      // bounded retention pass trims old outbox rows even on a
      // user-management-only install that relies on write-triggered maintenance,
      // and the fast-path drain delivers the recorded event immediately instead
      // of at the next scheduled trigger. Both are no-ops when unconfigured;
      // retention runs regardless of a recording, the drain only when one
      // happened.
      await this.retentionRunner?.maybeRun(
        UserMutationService.WRITE_PATH_PRUNE_BATCHES
      );
      if (userCreatedRecorded) this.fastDrainScheduler?.offer();

      // Fetch created user
      const user = await this.db.query.users.findFirst({
        where: { email: requireFilterValue(userData.email, "email") },
        columns: {
          id: true,
          email: true,
          emailVerified: true,
          name: true,
          image: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      if (!user) {
        // We just inserted; if we cannot read the row back, something is
        // genuinely wrong with the connection or the schema. Surface as an
        // internal error with the email captured in logContext.
        throw NextlyError.internal({
          logContext: {
            reason: "post-insert-readback-missing",
            email: userData.email,
          },
        });
      }

      // 🔹 If this is the first user ever, ensure super-admin exists and assign it
      if (!isFirstUser) {
        const services = new ServiceContainer(this.adapter);
        const { id: superAdminRoleId } =
          await services.roles.ensureSuperAdminRole();

        await services.userRoles
          .assignRoleToUser(user.id, superAdminRoleId)
          .catch(error => {
            console.error(
              `Failed to assign super admin role to user with ID ${user.id}:`,
              error
            );
          });
      }

      // 🔹 Assign roles if provided
      if (userData.roles && userData.roles.length > 0) {
        const services = new ServiceContainer(this.adapter);
        for (const rid of userData.roles) {
          await services.userRoles
            .assignRoleToUser(String(user.id), rid)
            .catch(() => undefined);
        }
      }

      // Hand the invite link back to the admin. The token was committed with
      // the account, so the raw value generated up front is guaranteed to
      // match a live row — building the link here is pure string work that
      // cannot fail. Delivery (email, chat, read it aloud) is the admin's
      // choice; the artifact is the link itself.
      const invite = inviteValue
        ? {
            link: buildAcceptInviteLink(inviteValue.token),
            expiresAt: inviteValue.expiresAt,
          }
        : undefined;

      return {
        id: user.id,
        email: user.email,
        emailVerified: user.emailVerified ?? null,
        name: user.name ?? null,
        image: user.image ?? null,
        roles: userData.roles ?? null,
        isActive: user.isActive ?? undefined,
        createdAt: user.createdAt ?? undefined,
        updatedAt: user.updatedAt ?? undefined,
        // Merge custom field values as top-level properties
        ...(hasExt && !this.userExtDisabled ? customFieldValues : {}),
        ...(invite ? { invite } : {}),
      };
    } catch (err) {
      // Re-throw NextlyError unchanged (validation, duplicate, internal, ...).
      // Pattern B: classify DB unique-violations as DUPLICATE so the public
      // message stays generic; everything else routes through fromDatabaseError.
      // Normalise raw driver errors first so the unique-violation branch
      // sees the right kind (otherwise PG 23505 collapses to INTERNAL_ERROR).
      if (NextlyError.is(err)) throw err;
      const dbErr = toDbError(this.dialect, err);
      if (dbErr.kind === "unique-violation") {
        throw NextlyError.duplicate({
          logContext: { entity: "user", email: userData.email },
        });
      }
      throw NextlyError.fromDatabaseError(dbErr);
    }
  }

  /**
   * Update an existing user's data.
   *
   * @throws NextlyError(VALIDATION_ERROR) on schema-validation failure or
   *   when no actionable changes are provided.
   * @throws NextlyError(NOT_FOUND) when the user does not exist.
   * @throws NextlyError(DUPLICATE) on email conflicts.
   * @throws NextlyError on DB errors via fromDatabaseError.
   */
  async updateUser(
    userId: number | string,
    changes: UpdateUserData
  ): Promise<UserMutationResponse> {
    try {
      // Validate input (merged schema includes custom field validators when configured)
      const validation = this.getUpdateSchema().safeParse(changes);
      if (!validation.success) {
        throw NextlyError.validation({
          errors: validation.error.issues.map(i => ({
            path: i.path.join(".") || "input",
            code: i.code.toUpperCase(),
            message: i.message,
          })),
          logContext: { entity: "user", userId },
        });
      }

      const { users } = this.tables;

      // 1) Load current user. §13.8 + spec note: user existence is sensitive
      // (account enumeration); the public message stays generic.
      const currentUser = await this.db.query.users.findFirst({
        where: { id: requireFilterValue(userId, "userId") },
        columns: {
          id: true,
          email: true,
          name: true,
          image: true,
          emailVerified: true,
          isActive: true as unknown as boolean,
        },
      });

      if (!currentUser) {
        throw NextlyError.notFound({
          logContext: { entity: "user", id: userId },
        });
      }

      // 2) Build updateData (only include fields that actually change)
      const updateData: UserUpdateData = {};

      // EMAIL
      if (typeof changes.email !== "undefined") {
        const normalizedNewEmail = (changes.email ?? "").trim().toLowerCase();
        const currentEmailNormalized = (currentUser.email ?? "").toLowerCase();

        if (
          normalizedNewEmail &&
          normalizedNewEmail !== currentEmailNormalized
        ) {
          const existing = await this.db.query.users.findFirst({
            where: { email: requireFilterValue(normalizedNewEmail, "email") },
            columns: { id: true, email: true },
          });

          if (existing && existing.id !== currentUser.id) {
            // §13.8 + account-enumeration: generic public message; the
            // conflict reason + the user/target ids go to logContext.
            throw NextlyError.duplicate({
              logContext: {
                entity: "user",
                reason: "email-conflict",
                userId: currentUser.id,
              },
            });
          }
        }

        if (normalizedNewEmail !== "") updateData.email = normalizedNewEmail;
      }

      if (
        typeof changes.name !== "undefined" &&
        changes.name !== currentUser.name
      ) {
        updateData.name = changes.name;
      }

      // PASSWORD: hash plain-text password before storing
      if (Object.prototype.hasOwnProperty.call(changes, "password")) {
        const rawPassword =
          typeof changes.password === "string" ? changes.password.trim() : "";
        if (rawPassword.length > 0) {
          updateData.passwordHash = await hashPassword(rawPassword);
          // Changing the password satisfies any admin-set must-change
          // requirement, so this update must not leave the account forced
          // through the first-sign-in flow again.
          updateData.mustChangePassword = false;
        }
      }

      // IMAGE: only update if provided in body
      if (Object.prototype.hasOwnProperty.call(changes, "image")) {
        const nextImage = changes.image;
        if (nextImage !== currentUser.image) {
          updateData.image = nextImage;
        }
      }
      if (Object.prototype.hasOwnProperty.call(changes, "emailVerified"))
        if (changes.emailVerified !== currentUser.emailVerified) {
          updateData.emailVerified = changes.emailVerified;
        }

      // ✅ Handle isActive
      if (Object.prototype.hasOwnProperty.call(changes, "isActive")) {
        if (changes.isActive !== currentUser.isActive) {
          updateData.isActive = changes.isActive;
        }
      }

      const hasFieldUpdates = Object.keys(updateData).length > 0;

      // 2b) Extract custom field values from changes (only fields present in payload)
      const hasExt = this.hasCustomFields();
      const customFieldUpdates: Record<string, unknown> = {};
      let hasCustomFieldChanges = false;

      if (hasExt) {
        const fieldNames = this.getCustomFieldNames();
        // Shaped by the same rule the create path uses. An update binds to the
        // same columns, and its failure is read the same way — as the extension
        // table being absent — so an unshaped value would be skipped silently
        // here exactly as it was dropped there.
        const byName = new Map(
          this.getEffectiveFields()
            .filter(
              (field): field is typeof field & { name: string } =>
                "name" in field && typeof field.name === "string"
            )
            .map(field => [field.name, field])
        );
        for (const fieldName of fieldNames) {
          if (fieldName in changes) {
            const raw = (changes as Record<string, unknown>)[fieldName] ?? null;
            const field = byName.get(fieldName);
            customFieldUpdates[fieldName] = field
              ? coerceUserExtValue(raw, { name: fieldName, type: field.type })
              : raw;
            hasCustomFieldChanges = true;
          }
        }
      }

      if (hasFieldUpdates) {
        updateData.updatedAt = new Date();
        await this.db
          .update(users)
          .set(updateData)
          .where(eq(users.id, currentUser.id));
      }

      // 2c) Upsert custom fields in user_ext
      if (hasCustomFieldChanges) {
        const userExtTable = this.getUserExtTable();
        if (userExtTable) {
          try {
            const now = new Date();
            // Required by Drizzle ORM — runtime-generated tables need untyped db access
            const db = this.db as unknown as DrizzleChain;
            // Check if user_ext row exists. DrizzleChain await resolves
            // to Record<string, unknown>[] already.
            const existingExt = await db
              .select({ id: userExtTable.id })
              .from(userExtTable)
              .where(eq(userExtTable.user_id as Column, currentUser.id))
              .limit(1);

            if (existingExt.length > 0) {
              // UPDATE existing row with changed fields only
              await db
                .update(userExtTable)
                .set({ ...customFieldUpdates, updated_at: now })
                .where(eq(userExtTable.user_id as Column, currentUser.id));
            } else {
              // INSERT new row (upsert: row was somehow missing)
              await db.insert(userExtTable).values({
                id: randomUUID(),
                user_id: currentUser.id,
                ...customFieldUpdates,
                created_at: now,
                updated_at: now,
              });
            }
          } catch (err) {
            // user_ext table may not exist on this dialect — disable and skip
            const cause = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `user_ext upsert skipped during updateUser: ${cause}`
            );
            this.userExtDisabled = true;
            hasCustomFieldChanges = false;
          }
        }
      }

      // 3) Handle role updates
      let hasRoleUpdates = !!(changes.roles && changes.roles.length > 0);
      if (hasRoleUpdates) {
        const services = new ServiceContainer(this.adapter);
        // Compare with current roles to avoid no-op updates
        let currentRoleIds: string[] = [];
        try {
          currentRoleIds = await services.userRoles.listUserRoles(
            String(currentUser.id)
          );
        } catch (err) {
          // NOT_FOUND means the user has no roles yet — treat as empty.
          // Re-throw anything else (DB outage, etc.) so it surfaces as 5xx
          // instead of silently masking the real failure.
          if (NextlyError.isNotFound(err)) {
            currentRoleIds = [];
          } else {
            throw err;
          }
        }
        const requestedRoleIds = Array.from(new Set(changes.roles ?? []));
        const currentSet = new Set(currentRoleIds);
        const requestedSet = new Set(requestedRoleIds);
        const setsEqual =
          currentSet.size === requestedSet.size &&
          [...currentSet].every(id => requestedSet.has(id));
        if (setsEqual) {
          hasRoleUpdates = false;
        }

        if (hasRoleUpdates) {
          await this.db
            .delete(this.tables.userRoles)
            .where(eq(this.tables.userRoles.userId, String(currentUser.id)));

          for (const rid of requestedRoleIds) {
            try {
              await services.userRoles.assignRoleToUser(
                String(currentUser.id),
                rid
              );
            } catch (err) {
              // NOT_FOUND means the role id doesn't exist — skip silently
              // since validation above already filtered invalid roles. Re-throw
              // anything else (DB outage etc.) so transient failures aren't
              // hidden behind a "no such role" semantic.
              if (NextlyError.isNotFound(err)) {
                continue;
              }
              throw err;
            }
          }
        }
      }

      // If no valid changes provided, throw a validation error so callers
      // can surface a 400. §13.8: per-error message names the (synthetic)
      // field but never the value.
      if (
        !hasFieldUpdates &&
        !hasRoleUpdates &&
        !hasCustomFieldChanges &&
        !changes.sendWelcomeEmail
      ) {
        throw NextlyError.validation({
          errors: [
            {
              path: "input",
              code: "NO_CHANGES",
              message: "At least one updatable field must be provided.",
            },
          ],
          logContext: { entity: "user", userId: currentUser.id },
        });
      }

      // Fetch updated user
      const user = await this.db.query.users.findFirst({
        where: { id: requireFilterValue(currentUser.id, "userId") },
        columns: {
          id: true,
          email: true,
          emailVerified: true,
          name: true,
          image: true,
          isActive: true as unknown as boolean,
        },
      });

      // Fetch custom fields for response
      const responseCustomFields: Record<string, unknown> = {};
      if (hasExt) {
        const userExtTable = this.getUserExtTable();
        if (userExtTable) {
          try {
            // Required by Drizzle ORM — runtime-generated tables need
            // untyped db access. DrizzleChain await resolves to row list.
            const extDb = this.db as unknown as DrizzleChain;
            const extRows = await extDb
              .select()
              .from(userExtTable)
              .where(eq(userExtTable.user_id as Column, currentUser.id))
              .limit(1);

            if (extRows.length > 0) {
              const fieldNames = this.getCustomFieldNames();
              for (const fieldName of fieldNames) {
                if (fieldName in extRows[0]) {
                  responseCustomFields[fieldName] = extRows[0][fieldName];
                }
              }
            }
          } catch (err) {
            // user_ext table may not exist — self-heal by disabling ext for
            // the rest of this process (matches the established pattern in
            // createLocalUser). Log the cause so a real outage isn't silent;
            // the caller still gets a successful user response since the
            // primary user row already updated.
            const cause = err instanceof Error ? err.message : String(err);
            this.logger.warn(
              `user_ext read failed during updateUser; disabling user_ext for this process: ${cause}`
            );
            this.userExtDisabled = true;
          }
        }
      }

      // ✅ Send welcome email if requested and service is available.
      // Deliberately fire-and-forget: a welcome message is a courtesy, and
      // failing user creation because it could not be delivered would be worse
      // than not sending it. Both failure shapes are logged rather than
      // dropped, since an undelivered message comes back as an unsuccessful
      // result rather than as a throw -- and that covers a provider that
      // failed outright as well as one that accepted the message and refused
      // this recipient.
      if (changes.sendWelcomeEmail && this.emailService) {
        await this.emailService
          .sendWelcomeEmail(user!.email, {
            name: user!.name ?? null,
            email: user!.email,
          })
          .then(result => {
            if (!result.success) {
              this.logger.warn("Welcome email was not delivered", {
                event: "user.welcome_email_failed",
                reason: "not-delivered-to-recipient",
              });
            }
          })
          .catch((error: unknown) => {
            this.logger.warn("Welcome email could not be sent", {
              event: "user.welcome_email_failed",
              error: error instanceof Error ? error.message : String(error),
            });
          });
      }

      return {
        id: user!.id,
        email: user!.email,
        emailVerified: user!.emailVerified ?? null,
        name: user!.name ?? null,
        image: user!.image ?? null,
        roles: changes.roles ?? null,
        isActive: user!.isActive ?? undefined,
        // Merge custom field values as top-level properties
        ...(hasExt ? responseCustomFields : {}),
      };
    } catch (err) {
      // Re-throw NextlyError (validation, not-found, duplicate) unchanged.
      // Pattern B: classify DB unique-violations as DUPLICATE so the public
      // message stays generic; everything else routes through fromDatabaseError.
      // Normalise raw driver errors first so the unique-violation branch
      // sees the right kind.
      if (NextlyError.is(err)) throw err;
      const dbErr = toDbError(this.dialect, err);
      if (dbErr.kind === "unique-violation") {
        throw NextlyError.duplicate({
          logContext: { entity: "user", reason: "email-conflict", userId },
        });
      }
      throw NextlyError.fromDatabaseError(dbErr);
    }
  }

  /**
   * Delete a user and all related data (roles, accounts).
   *
   * §13.8 + spec note: user existence is sensitive (account enumeration);
   * the public message stays generic. The id flows only through logContext.
   *
   * @param actor - Who initiated the delete, recorded for event attribution.
   * @throws NextlyError(NOT_FOUND) when the user does not exist.
   * @throws NextlyError on DB errors via fromDatabaseError.
   */
  async deleteUser(
    userId: number | string,
    actor?: RequestActor
  ): Promise<void> {
    const { users, accounts, userRoles, media } = this.tables;

    // Asked once, before the transaction opens, because a failed statement
    // aborts an open Postgres transaction and there would be no way back.
    //
    // The answer is allowed to be "no". A database whose `activity_log` has
    // never been created carries no trail, and therefore no identifying data
    // for the erasure to remove — the invariant that an account is never
    // deleted while data identifying its owner remains is satisfied by there
    // being none. That is a different thing from an erasure that fails, which
    // still takes the deletion down with it. Databases in this state exist:
    // the SQLite fallback bootstrap in earlier releases created a subset of
    // the core tables, and neither first-run setup nor boot repairs an
    // existing database that is missing one — they only warn.
    // Asked per table rather than once for all of them. A database can carry
    // one and not the other — the SQLite fallback bootstrap created a subset of
    // the core tables — and answering for the pair would let a missing auth log
    // suppress the activity erasure, leaving behind exactly the names and
    // emails the deletion exists to remove.
    const auditTables = this.tables;
    // Normalized here rather than left to the caller: the probes read the
    // catalogue, and a transient metadata failure is a database error like any
    // other. Outside this the raw driver exception would escape ahead of the
    // block that converts one, and the caller would get an untyped throw from
    // an operation whose whole surface is typed.
    let activityShape: ErasureShape;
    let authShape: ErasureShape;
    try {
      activityShape = await this.supportsErasure(
        "activity_log",
        "their name and email"
      );
      authShape = await this.supportsErasure(
        "audit_log",
        "the address and client they connected from"
      );
    } catch (err) {
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }
    // Asked out here for the same reason as the two above: a failed statement
    // aborts an open Postgres transaction, and there would be no way back.
    //
    // A probe that cannot answer is treated as "present" so the erasure is
    // ATTEMPTED. The alternative direction is worse in a way that is hard to
    // see later: reading a transient metadata failure as "no such table" would
    // delete the account and leave its delivery rows behind, silently and
    // permanently, since no later run revisits a deletion that has happened.
    // If the table really is absent, the UPDATE fails and takes the deletion
    // with it, which is the same invariant the audit erasure protects.
    // Read from the preimage inside the transaction and used again after it
    // commits, so it is declared out here rather than in the closure.
    let deletedAddress: string | undefined;
    let deliveriesExist: boolean;
    try {
      deliveriesExist = await this.adapter.tableExists("email_deliveries");
    } catch {
      deliveriesExist = true;
    }

    // Asked out here for the same reason, and treated as present when the
    // probe cannot answer, for the same reason too. `media.uploaded_by`
    // cascades, so skipping the detach on a transient metadata failure would
    // delete the account and let the database destroy its files — silently and
    // permanently, since no later run revisits a deletion that has happened.
    // Attempting it against a genuinely absent table fails the UPDATE and takes
    // the deletion with it, which is the invariant the audit erasure protects:
    // an account is never removed while data belonging to it is left behind.
    //
    // Databases without the table exist. The SQLite fallback bootstrap in
    // earlier releases created a subset of the core tables, and neither
    // first-run setup nor boot repairs an existing database that is missing
    // one.
    let mediaExists: boolean;
    try {
      mediaExists = await this.adapter.tableExists("media");
    } catch {
      mediaExists = true;
    }

    // The account's dashboard arrangement, probed out here for the same reason
    // as the three above: a failed statement aborts an open Postgres
    // transaction and there would be no way back.
    //
    // The row carries the account's identifier and its opaque per-placement
    // configuration, and nothing else removes it — `scope_id` holds a user id
    // by convention rather than by a foreign key, precisely so a future role
    // scope can share the table. Left behind, that configuration outlives the
    // person indefinitely, and an external identity provider that reuses an
    // identifier hands the replacement account its predecessor's dashboard.
    //
    // An unanswerable probe is treated as PRESENT, matching the media and
    // deliveries decisions above: attempting the delete against a genuinely
    // absent table fails the statement and takes the deletion with it, which is
    // the invariant those two protect — an account is never removed while data
    // belonging to it is left behind. Databases without the table exist, since
    // the SQLite fallback bootstrap created a subset of the core tables.
    let widgetLayoutExists: boolean;
    try {
      widgetLayoutExists = await this.adapter.tableExists(WIDGET_LAYOUT_TABLE);
    } catch {
      widgetLayoutExists = true;
    }
    // The two answer a legacy shape differently, because what happens to an
    // un-erased row differs. A legacy `activity_log` still cascades from the
    // account, so its rows go with the deletion and there is nothing left to
    // scrub. `audit_log.actor_user_id` carries no key at all — deliberately, so
    // the trail outlives the account — so an un-erased row keeps the address
    // and client indefinitely, and no later migration can revisit a deletion
    // that has already happened. It is erased either way; only the record of
    // when is lost on a schema with nowhere to put it.
    const erasableAuditTables = {
      ...(activityShape === "stamped" && {
        activityLog: auditTables.activityLog,
      }),
      ...(authShape !== false && { auditLog: auditTables.auditLog }),
    };
    const unstampedAuditTables = new Set<"activityLog" | "auditLog">(
      authShape === "unstamped" ? ["auditLog"] : []
    );

    // Delete user and related data in a single Drizzle transaction so that
    // partial deletes can't leave orphaned rows. The tx alias is a structural
    // type because BaseService.withTransaction yields `unknown` (it can't
    // reference the dialect-specific Drizzle transaction type without binding to
    // all three driver packages); the fluent query API is identical across
    // dialects.
    let userDeletedRecorded = false;
    // Collected inside the transaction, used after it commits: the cache bust
    // must not run until the detach is durable, and the rows cannot be found
    // afterwards because the column that named them is exactly what changed.
    let detachedMediaIds: string[] = [];
    try {
      await this.withTransaction(async tx => {
        const txDb = tx as DrizzleTransactionLike;

        // Read the removed account's identity INSIDE the transaction, right
        // before the delete, so the event reports the row actually being
        // removed. Email and name are read (external systems key on email, not
        // an opaque id). On Postgres/MySQL the read takes a FOR UPDATE row lock,
        // so a concurrent `updateUser` cannot commit between this read and the
        // delete and make the event advertise a stale address; the lock is held
        // until this transaction commits with the removal. SQLite has no row
        // lock, but a write transaction serializes writers, so its transaction
        // already excludes that race. Absence is the NOT_FOUND case — thrown
        // inside the tx, which rolls back and surfaces unchanged through the
        // catch below.
        const preimageQuery = txDb
          .select({ id: users.id, email: users.email, name: users.name })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);
        const preimage = (
          this.dialect === "sqlite"
            ? await preimageQuery
            : await preimageQuery.for("update")
        )[0];
        if (!preimage) {
          throw NextlyError.notFound({
            logContext: { entity: "user", id: userId },
          });
        }

        // Delete user_ext row if custom fields are configured
        if (this.hasCustomFields()) {
          const userExtTable = this.getUserExtTable();
          if (userExtTable) {
            try {
              await txDb
                .delete(userExtTable)
                .where(eq(userExtTable.user_id as Column, userId));
            } catch (err) {
              // user_ext table may not exist on this dialect — skip and disable
              // ext for the rest of this process so subsequent calls don't retry.
              const cause = err instanceof Error ? err.message : String(err);
              this.logger.warn(
                `user_ext delete skipped during deleteUser: ${cause}`
              );
              this.userExtDisabled = true;
            }
          }
        }

        // Delete user roles
        await txDb.delete(userRoles).where(eq(userRoles.userId, userId));

        // Delete user accounts
        await txDb.delete(accounts).where(eq(accounts.userId, userId));

        // And the dashboard arrangement, addressed by the SAME derivation the
        // layout service writes with rather than by a second spelling of the
        // key — two derivations of one identifier agree until one is edited,
        // and the failure here is silent: the delete matches no row, the
        // account goes, and the layout stays.
        if (widgetLayoutExists) {
          const layoutTable = widgetLayoutTables(this.dialect)
            .nextlyWidgetLayout as unknown as { id: Column };
          await txDb
            .delete(layoutTable)
            .where(eq(layoutTable.id, layoutRowId("user", String(userId))));
        }

        // Strip the person out of the audit trail while leaving the trail
        // standing. `activity_log.user_id` carries no foreign key precisely so
        // these rows outlive the account; without this they would outlive it
        // still carrying the name and email of someone who asked to be erased.
        // Inside the transaction, so a failed erasure takes the deletion with
        // it rather than leaving the two out of step.
        if (Object.keys(erasableAuditTables).length > 0) {
          await eraseActorPersonalData(
            txDb,
            erasableAuditTables,
            String(userId),
            new Date(),
            unstampedAuditTables
          );
        }

        // Detach the account's uploads before the row goes.
        //
        // `media.uploaded_by` declares ON DELETE CASCADE, so without this the
        // database destroys every image, document and video the account ever
        // added — beneath every service, hook and access check, with nothing
        // able to intercept it and nothing to warn the admin who asked only to
        // remove a person. An asset library is shared property: a logo uploaded
        // by someone who has since left is still the site's logo, and the
        // attribution is the only part that belonged to them.
        //
        // Nulling the column first leaves the cascade nothing to act on, which
        // is why this is a write rather than a change to the constraint: the
        // rule itself cannot be altered on an existing PostgreSQL database
        // without resolver support the schema pipeline does not have yet.
        // Inside the transaction, so files are never detached from an account
        // whose removal then rolls back.
        if (mediaExists) {
          // Read before writing: the event carries a before and an after, and
          // the ids cannot be recovered once the column naming them is null.
          // Under a row lock, for the same reason the canonical media write
          // takes one before recording. Read unlocked, a concurrent
          // `updateMedia` or `deleteMedia` can commit between this snapshot and
          // the write below — and the events would then carry state already
          // superseded: metadata a subscriber would roll back, or an update for
          // a row that has since been deleted, which downstream reads as the
          // file coming back. The lock makes the snapshot the rows are updated
          // FROM the same one they are evented from.
          //
          // SQLite has no row lock and needs none: its write transaction
          // serialises writers, which is the argument the preimage read above
          // already makes.
          const detachQuery = txDb
            .select()
            .from(media)
            .where(eq(media.uploadedBy as Column, userId));
          const detaching = (this.dialect === "sqlite"
            ? await detachQuery
            : await detachQuery.for("update")) as unknown[] as MediaRow[];

          if (detaching.length > 0) {
            const detachedAt = new Date();
            await txDb
              .update(media)
              .set({ uploadedBy: null, updatedAt: detachedAt })
              .where(eq(media.uploadedBy as Column, userId));

            // `updatedAt` and the outbox row are what `updateMedia` emits for
            // any other metadata change, and a detach is one. Without them a
            // timestamp-based sync sees an unchanged row and media subscribers
            // are never told, so a downstream replica keeps serving the
            // attribution of an account that no longer exists — the erasure
            // holding on this side and not on the other.
            for (const row of detaching) {
              await recordMutationEventInTx(txDb, this.dialect, {
                type: "media.updated",
                resource: { kind: "media", id: String(row.id) },
                data: { ...row, uploadedBy: null, updatedAt: detachedAt },
                previous: row,
                fields: [],
                // Normalised the way every canonical media write normalises
                // it: a deletion reaching this without an explicit actor is a
                // write nobody initiated, which `actorForWrite` represents as
                // `system`. Passing null instead would attribute the same media
                // change differently depending on whether it arrived here or
                // through `updateMedia`, in the durable audit as well as to
                // subscribers.
                actor: actorForWrite(actor, null),
              });
            }

            detachedMediaIds = detaching.map(row => String(row.id));
          }
        }

        // Strip the person out of the delivery log for the same reason, and in
        // the same transaction: those rows carry a keyed hash of the address,
        // and an install holds the key — so they go on answering "was this
        // person written to, and when" for an account that no longer exists.
        // The row itself stays, because "how many sends failed last week"
        // belongs to the install rather than to the recipient.
        //
        // Keyed on the ADDRESS, not the user id: the table records every
        // recipient, and most of them never had an account. This call therefore
        // covers the deleted account's own address and nothing else — someone
        // who was only ever a recipient is erased by calling
        // `eraseRecipientDeliveries` directly, since no account deletion will
        // ever fire for them.
        //
        // Narrowed rather than asserted, because the preimage select resolves
        // to an untyped row. An account carrying no address has no delivery
        // rows keyed to it, so there is nothing here to erase — which is a
        // different outcome from an erasure that was skipped, and this is the
        // only shape that produces it.
        deletedAddress =
          typeof preimage.email === "string" ? preimage.email : undefined;
        if (deliveriesExist && deletedAddress !== undefined) {
          await eraseRecipientDeliveries(
            txDb,
            deliveriesTableFor(this.dialect),
            deletedAddress
          );
        }

        // Delete user, capturing how many rows it removed.
        const deleteResult = await txDb
          .delete(users)
          .where(eq(users.id, userId));

        // Record `user.deleted` only when THIS transaction actually removed the
        // account, in the same transaction so it commits with the removal and
        // never fires for a rolled-back delete. Two concurrent deletes both read
        // the identity above, but only one deletes a row; without this guard the
        // loser would emit a duplicate event with a fresh id that downstream
        // idempotency cannot collapse. PII-safe identity only.
        if (affectedRowCount(deleteResult, this.dialect) > 0) {
          userDeletedRecorded = await recordMutationEventInTx(
            txDb,
            this.dialect,
            {
              type: "user.deleted",
              resource: { kind: "user", id: String(userId) },
              data: {
                id: preimage.id,
                email: preimage.email ?? null,
                name: preimage.name ?? null,
              },
              fields: [],
              actor: actor ?? null,
            }
          );
        }
      });
    } catch (err) {
      if (NextlyError.is(err)) throw err;
      // Normalise raw driver errors so fk/etc. produce the right NextlyError kind.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, err));
    }

    // The detached files changed, so anything cached against them is stale —
    // `uploadedBy` is part of the media shape a read returns. AFTER the commit,
    // because a bust for a detach that then rolled back would be a lie about
    // rows that never moved; best-effort, because the deletion has already
    // happened and reporting it as failed would invite a retry that answers
    // not-found.
    if (detachedMediaIds.length > 0) {
      await revalidateMedia(detachedMediaIds, this.logger);
    }

    // The removed account's recovery points, swept once the deletion is
    // visible. Deliberately a DELETE rather than the scrub the audit surfaces
    // receive: an audit row is a record, and stripping the person from it
    // keeps a trail worth keeping, whereas a recovery point is that person's
    // unsaved draft. Scrubbing its author would strand the snapshot with
    // nobody able to claim it, and nothing else collects autosave rows -- they
    // are excluded from history listings, version reads and retention alike.
    //
    // AFTER the commit rather than before it. Sweeping first would destroy a
    // living person's unsaved work whenever the deletion itself then failed,
    // which is a user-visible loss for an account that still exists. Sweeping
    // here can instead leave rows behind if this pass fails after the account
    // is gone; that is the same window the erasure below already accepts, and
    // the delete is idempotent, so a later pass costs nothing.
    //
    // Atomicity would beat both orderings. It is not available cheaply here:
    // `withTransaction` yields a raw Drizzle handle rather than the adapter
    // surface this repository is built on, so joining the transaction would
    // mean a second implementation of which rows are autosaves.
    try {
      await new VersionsRepository(this.adapter).deleteAutosavesByAuthor(
        String(userId)
      );
    } catch (err) {
      // Never fail the deletion for this. The account is already gone; a
      // surviving recovery point is dead weight rather than a live risk, and
      // reporting the removal as failed would invite a retry that now answers
      // not-found.
      this.logger.error("Failed to remove deleted user's recovery points", {
        userId: String(userId),
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Sweep once more now the removal is visible. The erasure inside the
    // transaction cannot reach an entry that landed after it ran but before the
    // commit — an activity write already in flight when the deletion started —
    // and such an entry carries the identity of an account that no longer
    // exists. Erasing is idempotent, so a second pass over rows already erased
    // costs one indexed update and changes nothing.
    try {
      if (Object.keys(erasableAuditTables).length > 0) {
        await eraseActorPersonalData(
          this.db as Parameters<typeof eraseActorPersonalData>[0],
          erasableAuditTables,
          String(userId),
          new Date(),
          unstampedAuditTables
        );
      }
      // The delivery log needs the same second pass and for the same reason: a
      // send already in flight when the deletion started can insert its row
      // after the in-transaction erasure has chosen its matches, leaving a live
      // digest for an account that no longer exists. Erasing is idempotent —
      // an already-erased row holds the sentinel, which no address hashes to —
      // so a second pass over untouched rows costs one indexed update.
      if (deliveriesExist && deletedAddress !== undefined) {
        await eraseRecipientDeliveries(
          this.db as Parameters<typeof eraseRecipientDeliveries>[0],
          deliveriesTableFor(this.dialect),
          deletedAddress
        );
      }
    } catch (err) {
      // The account is already gone and the caller has been served; failing
      // here would report a completed deletion as an error and invite a retry
      // that finds nothing to delete. Loud enough to act on, quiet enough not
      // to undo a committed write.
      this.logger.error(
        `audit erasure sweep after deleteUser failed for ${Object.keys(
          erasableAuditTables
        ).join(", ")}: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    // With the removal and its outbox row committed, offer the same post-commit
    // hooks as createLocalUser: a bounded retention prune (so user churn on a
    // write-triggered-maintenance install still trims the outbox) and the
    // fast-path drain for the recorded event (same rationale as createLocalUser).
    // Retention runs regardless of a recording, the drain only when one happened.
    await this.retentionRunner?.maybeRun(
      UserMutationService.WRITE_PATH_PRUNE_BATCHES
    );
    if (userDeletedRecorded) this.fastDrainScheduler?.offer();
  }
}
