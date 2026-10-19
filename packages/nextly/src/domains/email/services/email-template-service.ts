/**
 * Email Template Service
 *
 * CRUD operations for managing email templates stored in the
 * `email_templates` table, built-in template bootstrapping, layout
 * composition, and who owns each template.
 *
 * A layout is a first-class row with `kind = 'layout'` whose
 * `htmlContent` holds a `{{content}}` placeholder where a template
 * body is injected at send time.
 *
 * Every template has an owner: core, a plugin, or the site. An owner's
 * template follows the owner's current version until the site overrides it;
 * an override keeps the site's version and a copy of the owner's version it
 * started from, so the owner's later changes can be reviewed one by one, and
 * Reset returns it to the owner (`../template-ownership.ts`).
 *
 * @module services/email/email-template-service
 * @since 1.0.0
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq, desc, isNull } from "drizzle-orm";

import type { RequestActor } from "../../../auth/request-actor";
import { toDbError } from "../../../database/errors";
import { getService } from "../../../di";
import { NextlyError } from "../../../errors";
import { maskingServiceLogger } from "../../../observability/mask-emails";
import type { PluginEmailTemplate } from "../../../plugins/contributions";
import { emailTemplatesMysql } from "../../../schemas/email-templates/mysql";
import { emailTemplatesPg } from "../../../schemas/email-templates/postgres";
import { emailTemplatesSqlite } from "../../../schemas/email-templates/sqlite";
import type {
  EmailTemplateInsert,
  EmailTemplateRecord,
  EmailTemplateVariable,
  EmailTemplateVersion,
} from "../../../schemas/email-templates/types";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import { isUniqueViolation } from "../../../shared/lib/unique-violation";
import {
  changedTemplateFields,
  recordTemplateActivity,
  type EmailTemplateActivityInput,
} from "../template-activity";
import {
  applyOwnerChoices,
  ownerChanges,
  type OwnerChange,
  type OwnerChangeChoice,
} from "../template-merge";
import {
  absentPluginFor,
  buildTemplateOwnerRegistry,
  detailsOf,
  isProtectedOwner,
  ownerOf,
  ownershipFromConfig,
  sameStoredValue,
  sameVersion,
  storedOwner,
  versionDigest,
  versionOf,
  type KeptBase,
  type OwnedTemplate,
  type RegistryInput,
  type TemplateOwnerRegistry,
} from "../template-ownership";
import type { EmailAttachmentInput, EmailConfig } from "../types";

import {
  DEFAULT_APP_NAME,
  renderTemplate,
  type RenderedTemplate,
  type TemplateFields,
} from "./render-template";
import {
  BUILT_IN_TEMPLATES,
  DEFAULT_LAYOUT_SLUG,
  LAYOUT_CONTENT_PLACEHOLDER,
} from "./templates";

// ============================================================
// Constants
// ============================================================

/** Legacy reserved slugs migrated into the unified layout row on boot. */
const LEGACY_HEADER_SLUG = "_email-header";
const LEGACY_FOOTER_SLUG = "_email-footer";

/** The fields an owner versions and an override replaces. */
const VERSION_FIELDS = [
  "subject",
  "htmlContent",
  "plainTextContent",
  "preheader",
] as const;

/** What an owner says about a template beside its version (see OwnerDetails). */
const DETAIL_FIELDS = ["description", "variables"] as const;

/** What a new template holds where its input leaves a field out. */
const NEW_TEMPLATE_DEFAULTS = {
  kind: "template" as const,
  plainTextContent: null,
  preheader: null,
  layoutId: null,
  fromOverride: null,
  replyTo: null,
  variables: null,
  useLayout: true,
  isActive: true,
  providerId: null,
  attachments: null,
  description: null,
};

function orDefault<K extends keyof typeof NEW_TEMPLATE_DEFAULTS>(
  data: CreateEmailTemplateInput,
  key: K
):
  | NonNullable<CreateEmailTemplateInput[K]>
  | (typeof NEW_TEMPLATE_DEFAULTS)[K] {
  return data[key] ?? NEW_TEMPLATE_DEFAULTS[key];
}

/** The columns `updateTemplate` writes when given; the slug and kind are fixed once created. */
const UPDATABLE_FIELDS = [
  "name",
  "subject",
  "htmlContent",
  "plainTextContent",
  "preheader",
  "layoutId",
  "fromOverride",
  "replyTo",
  "variables",
  "useLayout",
  "isActive",
  "providerId",
  "attachments",
  "description",
] as const satisfies ReadonlyArray<keyof UpdateEmailTemplateInput>;

/** The owner's current version and details, kept as an override's base. */
function keptBase(entry: OwnedTemplate): KeptBase {
  return { ...entry.version, details: detailsOf(entry.defaults) };
}

// ============================================================
// Input Types
// ============================================================

/**
 * Input for creating a new email template.
 * Extends EmailTemplateInsert (all required + optional fields).
 */
export type CreateEmailTemplateInput = EmailTemplateInsert;

/**
 * Input for updating an existing email template.
 * All fields are optional — only provided fields are updated.
 * Note: `slug` cannot be changed after creation.
 */
export interface UpdateEmailTemplateInput {
  name?: string;
  subject?: string;
  htmlContent?: string;
  plainTextContent?: string | null;
  preheader?: string | null;
  layoutId?: string | null;
  fromOverride?: string | null;
  replyTo?: string | null;
  variables?: EmailTemplateVariable[] | null;
  useLayout?: boolean;
  isActive?: boolean;
  providerId?: string | null;
  attachments?: EmailAttachmentInput[] | null;
  description?: string | null;
}

/** What the running site contributes to ownership: its plugins and its code. */
export interface TemplateOwnershipInput {
  /** Each running plugin, by name, with the templates it contributes. */
  plugins: ReadonlyArray<{
    name: string;
    templates: ReadonlyArray<PluginEmailTemplate>;
  }>;
  /** `email.templates` from `defineConfig()`. */
  codeTemplates?: EmailConfig["templates"];
}

/**
 * An overridden template beside its owner's current version. A type alias
 * rather than an interface so it carries an implicit index signature and can
 * be handed to the response helpers as it is.
 */
export type EmailTemplateComparison = {
  /** The owner's version the override started from. */
  base: EmailTemplateVersion;
  /** The owner's version now. */
  theirs: EmailTemplateVersion;
  /** The site's version now. */
  mine: EmailTemplateVersion;
  /** Each change the owner made since `base`, to review one by one. */
  changes: OwnerChange[];
};

/** What an applied review replaced, so it can be undone. */
export interface OwnerUpdateUndo {
  /** The site's version before the review was applied. */
  version: EmailTemplateVersion;
  /** The owner's version the override was based on before. */
  base: EmailTemplateVersion;
  /**
   * Digests of the version the review produced and of the owner's version it
   * was rebased on. Undo only puts the old version back while the template
   * still holds exactly these, so a later edit, review or owner update is
   * never overwritten by an undo that was meant for an earlier state.
   */
  applied: string;
  appliedBase: string;
}

/** A stored row: the record's columns, with ownership as stored. */
type StoredTemplateRow = Omit<
  EmailTemplateRecord,
  "owner" | "overridden" | "ownerChanged" | "setInCode"
> & {
  ownerKind: string | null;
  ownerName: string | null;
  overridden: boolean | null;
  baseDigest: string | null;
  baseVersion: KeptBase | null;
};

// ============================================================
// Email Template Service
// ============================================================

/** Union of all dialect-specific email_templates table definitions. */
type EmailTemplatesTable =
  | typeof emailTemplatesPg
  | typeof emailTemplatesMysql
  | typeof emailTemplatesSqlite;

export class EmailTemplateService extends BaseService {
  private emailTemplates: EmailTemplatesTable;

  /**
   * Product name a layout's `{{appName}}` falls back to.
   *
   * Held here because a preview must fill it exactly as a send does; without
   * it a configured installation previews its own layouts under the wrong
   * name, which is the defect this service used to have in a worse form.
   */
  private readonly appName: string;

  /**
   * Who owns what. Core's templates are known from the start; the running
   * plugins and the site's code are added by `configureOwnership`, which the
   * boot calls before seeding. Until then the registry is incomplete and the
   * boot reconciliation does not run (see `ensureBuiltInTemplates`).
   */
  private registry: TemplateOwnerRegistry;

  constructor(adapter: DrizzleAdapter, logger: Logger, appName?: string) {
    // Masked here whatever logger an app supplied: what this service logs,
    // a provider error quoting a recipient included, never carries a full
    // email address outside development and test.
    super(adapter, maskingServiceLogger(logger));

    this.appName = appName ?? DEFAULT_APP_NAME;
    this.registry = buildTemplateOwnerRegistry({
      builtIns: BUILT_IN_TEMPLATES,
      plugins: [],
      complete: false,
    }).registry;

    switch (this.dialect) {
      case "postgresql":
        this.emailTemplates = emailTemplatesPg;
        break;
      case "mysql":
        this.emailTemplates = emailTemplatesMysql;
        break;
      case "sqlite":
        this.emailTemplates = emailTemplatesSqlite;
        break;
      default:
        // `this.dialect` is narrowed to `never` after the exhaustive switch;
        // String() coercion satisfies @typescript-eslint/restrict-template-expressions.
        throw new Error(`Unsupported dialect: ${String(this.dialect)}`);
    }
  }

  // ============================================================
  // Ownership
  // ============================================================

  /**
   * Register the running plugins' templates and the site's code templates.
   *
   * Core registers first, so a plugin cannot take over one of core's slugs;
   * between two plugins contributing one slug, the first keeps it. Each
   * ignored contribution is logged with both owners named.
   */
  configureOwnership(input: TemplateOwnershipInput): void {
    const built: RegistryInput = {
      builtIns: BUILT_IN_TEMPLATES,
      plugins: input.plugins,
      codeTemplates: input.codeTemplates,
      complete: true,
    };
    const { registry, conflicts } = buildTemplateOwnerRegistry(built);
    this.registry = registry;
    for (const conflict of conflicts) {
      this.logger.warn(
        "Ignored a plugin's email template: another owner already has its slug",
        {
          slug: conflict.slug,
          keptBy: conflict.kept.kind === "plugin" ? conflict.kept.name : "core",
          ignoredFrom: conflict.ignored,
        }
      );
    }
  }

  /** A stored row as callers see it, with its owner and override state. */
  private toRecord(row: StoredTemplateRow): EmailTemplateRecord {
    const {
      ownerKind,
      ownerName,
      overridden: storedOverridden,
      baseDigest,
      baseVersion: _baseVersion,
      ...columns
    } = row;
    const owner = ownerOf(row.slug, { ownerKind, ownerName }, this.registry);
    const overridden = owner.kind !== "site" && storedOverridden === true;
    const entry = this.registry.owned.get(row.slug);
    return {
      ...columns,
      kind: columns.kind ?? "template",
      description: columns.description ?? null,
      owner,
      overridden,
      ownerChanged: overridden && !!entry && baseDigest !== entry.digest,
      setInCode: this.registry.setInCode.has(row.slug),
    };
  }

  /** The registry entry an owned template follows, or a refusal naming why there is none. */
  private ownedEntry(record: EmailTemplateRecord): OwnedTemplate {
    const entry = this.registry.owned.get(record.slug);
    if (!entry || !isProtectedOwner(record.owner)) {
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          record.owner.kind === "site"
            ? "This template is your site's own, so it has no owner's version."
            : "This template's owner isn't running, so it has no current version.",
        logContext: { slug: record.slug, owner: record.owner },
      });
    }
    return entry;
  }

  // ============================================================
  // CRUD Methods
  // ============================================================

  /**
   * Record a template mutation without letting the trail decide the request.
   *
   * The write has already committed by the time this runs, so a failure to
   * record must not be reported to the caller as a failed mutation — that would
   * tell them the opposite of the truth. It must not be silent either: a trail
   * that quietly stops being written is indistinguishable from a system nobody
   * is changing, so the failure becomes a log line here.
   */
  private async recordActivity(
    input: EmailTemplateActivityInput
  ): Promise<void> {
    try {
      await recordTemplateActivity(input);
    } catch (error) {
      try {
        this.logger.error("Failed to record email template activity", {
          action: input.action,
          templateId: input.templateId,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // A logger that throws must not take the mutation with it either.
      }
    }
  }

  /**
   * A layout row must contain exactly one `{{content}}` placeholder: zero
   * appends the body after the wrapper, and more than one drops the content
   * after the second marker when the layout is applied. Reject malformed
   * layouts at write time so rendering can rely on the invariant.
   */
  private assertLayoutMarker(kind: string, htmlContent: string): void {
    if (kind !== "layout") return;
    const markerCount =
      htmlContent.split(LAYOUT_CONTENT_PLACEHOLDER).length - 1;
    if (markerCount !== 1) {
      throw NextlyError.validation({
        errors: [
          {
            path: "htmlContent",
            code: "INVALID",
            message: `A layout must contain exactly one ${LAYOUT_CONTENT_PLACEHOLDER} placeholder (found ${markerCount}).`,
          },
        ],
        logContext: { kind, markerCount },
      });
    }
  }

  /**
   * Create a new email template. A template created here is the site's own.
   *
   * @throws NextlyError BUSINESS_RULE_VIOLATION if slug is reserved
   * @throws NextlyError DUPLICATE if slug already exists
   */
  async createTemplate(
    data: CreateEmailTemplateInput,
    actor?: RequestActor | null
  ): Promise<EmailTemplateRecord> {
    this.assertLayoutMarker(orDefault(data, "kind"), data.htmlContent);
    const id = randomUUID();
    const now = new Date();

    const values = {
      id,
      name: data.name,
      slug: data.slug,
      kind: orDefault(data, "kind"),
      subject: data.subject,
      htmlContent: data.htmlContent,
      plainTextContent: orDefault(data, "plainTextContent"),
      preheader: orDefault(data, "preheader"),
      layoutId: orDefault(data, "layoutId"),
      fromOverride: orDefault(data, "fromOverride"),
      replyTo: orDefault(data, "replyTo"),
      variables: orDefault(data, "variables"),
      useLayout: orDefault(data, "useLayout"),
      isActive: orDefault(data, "isActive"),
      providerId: orDefault(data, "providerId"),
      attachments: orDefault(data, "attachments"),
      description: orDefault(data, "description"),
      ...storedOwner({ kind: "site" }),
      overridden: false,
      createdAt: now,
      updatedAt: now,
    };

    try {
      await this.db.insert(this.emailTemplates).values(values);
    } catch (error) {
      // Pattern B: surface unique-violation as DUPLICATE (409) so the admin UI
      // can show a friendly "slug already exists" message; everything else
      // flows through the default DB → NextlyError mapping. The driver throws
      // a raw error, so normalise via toDbError(dialect) before classifying.
      const dbErr = toDbError(this.dialect, error);
      if (dbErr.kind === "unique-violation") {
        throw NextlyError.duplicate({
          logContext: { reason: "template-slug-conflict", slug: data.slug },
        });
      }
      throw NextlyError.fromDatabaseError(dbErr);
    }

    const created = await this.getTemplate(id);
    // Recorded after the insert commits, so a trail that cannot be written
    // never turns a template that exists into a reported failure.
    await this.recordActivity({
      action: "create",
      templateId: created.id,
      templateName: created.name,
      templateKind: created.kind,
      actor,
    });
    return created;
  }

  /** The stored row by id. */
  private async getRow(id: string): Promise<StoredTemplateRow> {
    const results = await this.db
      .select()
      .from(this.emailTemplates)
      .where(eq(this.emailTemplates.id, id))
      .limit(1);

    if (results.length === 0) {
      // Identifier (`id`) goes into logContext per spec §13.8. The factory
      // emits the canonical "Not found." public sentence.
      throw NextlyError.notFound({ logContext: { id } });
    }

    return results[0] as StoredTemplateRow;
  }

  /** The stored row by slug, or null. */
  private async getRowBySlug(slug: string): Promise<StoredTemplateRow | null> {
    const results = await this.db
      .select()
      .from(this.emailTemplates)
      .where(eq(this.emailTemplates.slug, slug))
      .limit(1);
    return (results[0] as StoredTemplateRow | undefined) ?? null;
  }

  /**
   * Get a single email template by ID.
   *
   * @throws NextlyError NOT_FOUND if template doesn't exist
   */
  async getTemplate(id: string): Promise<EmailTemplateRecord> {
    return this.toRecord(await this.getRow(id));
  }

  /**
   * Get a single email template by slug.
   *
   * Returns `null` if no template matches the slug.
   */
  async getTemplateBySlug(slug: string): Promise<EmailTemplateRecord | null> {
    const row = await this.getRowBySlug(slug);
    return row ? this.toRecord(row) : null;
  }

  /**
   * The template a send by slug should render, and whether the site's code
   * version (`email.templates`) takes its place.
   *
   * The order is the site's override, then the site's code, then the owner's
   * default. A stored row that is not overridden holds the owner's default, so
   * the code version wins over it; an override wins over the code. A row the
   * boot reconciliation has not reached yet is treated as it was before
   * ownership existed, when a stored row always won, so an existing site sends
   * what it sent until the reconciliation decides.
   */
  async resolveForSend(slug: string): Promise<{
    template: EmailTemplateRecord | null;
    preferCode: boolean;
  }> {
    const row = await this.getRowBySlug(slug);
    if (!row) return { template: null, preferCode: true };
    return {
      template: this.toRecord(row),
      preferCode: row.ownerKind !== null && row.overridden !== true,
    };
  }

  /**
   * List email templates, ordered by creation date (newest first).
   *
   * Returns every row including layouts (`kind = 'layout'`); callers
   * that want only message bodies filter by `kind === 'template'`.
   */
  async listTemplates(): Promise<EmailTemplateRecord[]> {
    const results = await this.db
      .select()
      .from(this.emailTemplates)
      .orderBy(desc(this.emailTemplates.createdAt));

    return (results as StoredTemplateRow[]).map(row => this.toRecord(row));
  }

  /**
   * Update an existing email template.
   *
   * Template `slug` cannot be changed after creation. Changing what an owned
   * template says (its subject, preheader, HTML, plain text, description or
   * declared variables) overrides it,
   * as the explicit Override does: the change is the site's, and the owner's
   * later versions wait for review rather than overwriting it at the next
   * boot.
   *
   * @throws NextlyError NOT_FOUND if template doesn't exist
   */
  async updateTemplate(
    id: string,
    data: UpdateEmailTemplateInput,
    actor?: RequestActor | null
  ): Promise<EmailTemplateRecord> {
    const existing = await this.getRow(id);
    const record = this.toRecord(existing);

    // Validate the effective post-update row (a layout must keep exactly one
    // `{{content}}` marker). Kind is immutable on update, so use the existing
    // kind with the incoming html when provided.
    this.assertLayoutMarker(
      existing.kind,
      data.htmlContent ?? existing.htmlContent
    );

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    for (const field of UPDATABLE_FIELDS) {
      if (data[field] !== undefined) updateData[field] = data[field];
    }
    const overriding = this.overridesOwner(existing, record, updateData);
    if (overriding) {
      const entry = this.ownedEntry(record);
      updateData.overridden = true;
      updateData.baseVersion = keptBase(entry);
      updateData.baseDigest = entry.digest;
    }

    try {
      await this.db
        .update(this.emailTemplates)
        .set(updateData)
        .where(eq(this.emailTemplates.id, id));
    } catch (error) {
      // Default Pattern A: drizzle hands us the raw driver error, so normalise
      // through toDbError(dialect) first to get a DbError; fromDatabaseError
      // then produces a NextlyError with a generic public message and the
      // dialect-specific code stashed in logContext.
      throw NextlyError.fromDatabaseError(toDbError(this.dialect, error));
    }

    const updated = await this.getTemplate(id);
    // Compared against the row as it was, so an update that submitted every
    // field but moved none produces no entry. `updatedAt` is excluded: it moves
    // on every write by definition and would make every no-op look like a
    // change. The kept base copy is internal bookkeeping, named by
    // `overridden` alone.
    const {
      updatedAt: _ignored,
      baseVersion: _base,
      baseDigest: _digest,
      ...touched
    } = updateData;
    await this.recordActivity({
      action: "update",
      templateId: updated.id,
      templateName: updated.name,
      templateKind: updated.kind,
      changedFields: changedTemplateFields({ ...existing }, touched),
      operation: overriding ? "override" : undefined,
      actor,
    });
    return updated;
  }

  /**
   * Whether an update makes an owned template the site's. An edit to what the
   * owner sets (its version, or what it says about the template) does: the
   * next boot would otherwise put the owner's back. Name, layout use and the
   * other settings are the site's anyway and change nothing here.
   */
  private overridesOwner(
    existing: StoredTemplateRow,
    record: EmailTemplateRecord,
    updateData: Record<string, unknown>
  ): boolean {
    if (
      !isProtectedOwner(record.owner) ||
      record.overridden ||
      !this.registry.owned.has(record.slug)
    ) {
      return false;
    }
    return [...VERSION_FIELDS, ...DETAIL_FIELDS].some(
      field =>
        updateData[field] !== undefined &&
        !sameStoredValue(updateData[field] ?? null, existing[field] ?? null)
    );
  }

  /**
   * Delete an email template.
   *
   * Core's templates and an installed plugin's cannot be deleted: their owner
   * would recreate them at the next boot, so a delete would quietly mean
   * Reset. The site's own templates, and those of a plugin that is no longer
   * installed, can be, and are not recreated. Custom layouts may be deleted —
   * templates referencing them fall back to the default layout. Idempotent —
   * returns successfully if the template doesn't exist.
   *
   * @throws NextlyError BUSINESS_RULE_VIOLATION if the template is owned by
   *   core or an installed plugin
   */
  async deleteTemplate(id: string, actor?: RequestActor | null): Promise<void> {
    let template: EmailTemplateRecord | null = null;
    try {
      template = await this.getTemplate(id);
    } catch (error) {
      // If template doesn't exist, consider it already deleted (idempotent).
      // Use NextlyError.isCode for cross-realm safe NOT_FOUND detection.
      if (NextlyError.isCode(error, "NOT_FOUND")) {
        this.logger.info(
          `Template ${id} not found during delete — already deleted`,
          { id }
        );
        return;
      }
      throw error;
    }

    if (
      isProtectedOwner(template.owner) ||
      template.slug === DEFAULT_LAYOUT_SLUG
    ) {
      // Spec §13.8: identifiers are operator-only. Public sentence is generic.
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          template.kind === "layout"
            ? "This layout belongs to its owner and can't be deleted. Reset it to the owner's version instead."
            : "This template belongs to its owner and can't be deleted. Reset it to the owner's version instead.",
        logContext: { id, slug: template.slug, owner: template.owner },
      });
    }

    await this.db
      .delete(this.emailTemplates)
      .where(eq(this.emailTemplates.id, id));

    // The name is read from the row fetched above: after the delete there is
    // nothing left to label the entry with, and an unlabelled row is the one
    // whose subject a reader can never recover.
    await this.recordActivity({
      action: "delete",
      templateId: id,
      templateName: template.name,
      templateKind: template.kind,
      actor,
    });
  }

  // ============================================================
  // Override, Reset and the owner's updates
  // ============================================================

  /**
   * Override an owned template: from now on it holds the site's version.
   *
   * The site's version starts from the owner's current one, or from
   * `options.version` where the caller supplies the starting text (an
   * override of a template set in code starts from what the code produced).
   * The owner's current version is kept, so its later changes can be reviewed
   * against it. Overriding a template that is already overridden changes
   * nothing.
   */
  async overrideTemplate(
    id: string,
    options?: { version?: Partial<EmailTemplateVersion> },
    actor?: RequestActor | null
  ): Promise<EmailTemplateRecord> {
    const row = await this.getRow(id);
    const record = this.toRecord(row);
    const entry = this.ownedEntry(record);
    if (record.overridden) return record;

    const start: EmailTemplateVersion = {
      ...versionOf(row),
      ...(options?.version ?? {}),
    };
    this.assertLayoutMarker(row.kind, start.htmlContent);

    await this.db
      .update(this.emailTemplates)
      .set({
        ...start,
        overridden: true,
        baseVersion: keptBase(entry),
        baseDigest: entry.digest,
        updatedAt: new Date(),
      })
      .where(eq(this.emailTemplates.id, id));

    await this.recordActivity({
      action: "update",
      templateId: id,
      templateName: record.name,
      templateKind: record.kind,
      changedFields: [
        "overridden",
        ...changedTemplateFields({ ...versionOf(row) }, { ...start }),
      ],
      operation: "override",
      actor,
    });
    return this.getTemplate(id);
  }

  /**
   * Return an overridden template to its owner's current version and end the
   * override. For a template set in code, the code's version is what sends
   * once the override ends. Resetting one that is not overridden changes
   * nothing.
   */
  async resetTemplate(
    id: string,
    actor?: RequestActor | null
  ): Promise<EmailTemplateRecord> {
    const row = await this.getRow(id);
    const record = this.toRecord(row);
    const entry = this.ownedEntry(record);
    if (!record.overridden) return record;

    // The owner's version and details; the site's settings (name, layout use,
    // provider, From, Reply-To, attachments, active) stay as they are.
    const restored = this.ownerColumns(entry);
    await this.db
      .update(this.emailTemplates)
      .set({
        ...restored,
        overridden: false,
        baseVersion: null,
        baseDigest: null,
        updatedAt: new Date(),
      })
      .where(eq(this.emailTemplates.id, id));

    await this.recordActivity({
      action: "update",
      templateId: id,
      templateName: entry.defaults.name,
      templateKind: record.kind,
      changedFields: [
        "overridden",
        ...changedTemplateFields({ ...row }, { ...restored }),
      ],
      operation: "reset",
      actor,
    });
    return this.getTemplate(id);
  }

  /**
   * An overridden template beside its owner's current version, with each
   * change the owner made since the override started.
   */
  async compareTemplate(id: string): Promise<EmailTemplateComparison> {
    const row = await this.getRow(id);
    const record = this.toRecord(row);
    const entry = this.ownedEntry(record);
    this.assertOverridden(record);
    const base = versionOf(row.baseVersion ?? entry.version);
    const mine = versionOf(row);
    return {
      base,
      theirs: entry.version,
      mine,
      changes: ownerChanges(base, entry.version, mine),
    };
  }

  /**
   * Apply a review of the owner's update: each change keeps the site's
   * version, takes the owner's, or takes text the person wrote, all at once.
   * The override stays, now based on the owner's current version, so the same
   * changes are not offered again. Returns what it replaced, for Undo.
   */
  async applyOwnerUpdate(
    id: string,
    choices: Readonly<Record<string, OwnerChangeChoice>>,
    actor?: RequestActor | null
  ): Promise<{ template: EmailTemplateRecord; undo: OwnerUpdateUndo }> {
    const row = await this.getRow(id);
    const record = this.toRecord(row);
    const entry = this.ownedEntry(record);
    this.assertOverridden(record);

    const base = versionOf(row.baseVersion ?? entry.version);
    const mine = versionOf(row);
    const merged = applyOwnerChoices(base, entry.version, mine, choices);
    this.assertLayoutMarker(row.kind, merged.htmlContent);

    await this.db
      .update(this.emailTemplates)
      .set({
        ...merged,
        // Rebased on the owner's version; the details the site's copy is
        // compared against are a separate matter and carry over.
        baseVersion: {
          ...entry.version,
          details: row.baseVersion?.details ?? detailsOf(entry.defaults),
        },
        baseDigest: entry.digest,
        updatedAt: new Date(),
      })
      .where(eq(this.emailTemplates.id, id));

    await this.recordActivity({
      action: "update",
      templateId: id,
      templateName: record.name,
      templateKind: record.kind,
      changedFields: changedTemplateFields({ ...mine }, { ...merged }),
      operation: "apply-owner-update",
      actor,
    });
    return {
      template: await this.getTemplate(id),
      undo: {
        version: mine,
        base,
        applied: versionDigest(merged),
        appliedBase: entry.digest,
      },
    };
  }

  /**
   * Undo an applied review: put back the site's version and the base it had,
   * so the owner's update is offered again.
   */
  async undoOwnerUpdate(
    id: string,
    undo: OwnerUpdateUndo,
    actor?: RequestActor | null
  ): Promise<EmailTemplateRecord> {
    const row = await this.getRow(id);
    const record = this.toRecord(row);
    this.ownedEntry(record);
    this.assertOverridden(record);
    if (
      versionDigest(versionOf(row)) !== undo.applied ||
      row.baseDigest !== undo.appliedBase
    ) {
      throw new NextlyError({
        code: "CONFLICT",
        publicMessage:
          "This template changed after the update was applied, so it can't be undone. Review it again instead.",
        logContext: { id, slug: record.slug },
      });
    }
    const version = versionOf(undo.version);
    const base = versionOf(undo.base);
    this.assertLayoutMarker(row.kind, version.htmlContent);

    await this.db
      .update(this.emailTemplates)
      .set({
        ...version,
        baseVersion: { ...base, details: row.baseVersion?.details },
        baseDigest: versionDigest(base),
        updatedAt: new Date(),
      })
      .where(eq(this.emailTemplates.id, id));

    await this.recordActivity({
      action: "update",
      templateId: id,
      templateName: record.name,
      templateKind: record.kind,
      changedFields: changedTemplateFields(
        { ...versionOf(row) },
        { ...version }
      ),
      operation: "undo-owner-update",
      actor,
    });
    return this.getTemplate(id);
  }

  private assertOverridden(record: EmailTemplateRecord): void {
    if (record.overridden) return;
    throw new NextlyError({
      code: "BUSINESS_RULE_VIOLATION",
      publicMessage:
        "This template isn't overridden, so it already follows its owner's version.",
      logContext: { slug: record.slug },
    });
  }

  // ============================================================
  // Template Preview
  // ============================================================

  /**
   * Preview a saved template with sample data.
   *
   * Returns the narrower `{ subject, html }` its published callers expect,
   * DERIVED from the full render rather than composed separately. Composed
   * separately it silently dropped the preheader, left a layout's own
   * `{{year}}`/`{{appName}}` blank, and escaped a subject that is delivered as
   * plain text — so authors were shown something no recipient would receive.
   *
   * @throws NextlyError NOT_FOUND if template doesn't exist
   */
  async previewTemplate(
    id: string,
    sampleData: Record<string, unknown>
  ): Promise<{ subject: string; html: string }> {
    const template = await this.getTemplate(id);
    const { subject, html } = await this.previewDraft(template, sampleData);
    return { subject, html };
  }

  /**
   * Render fields that may never have been saved.
   *
   * The authoring surface previews what is being typed, which the id-addressed
   * preview structurally cannot show: it reads the stored row, and during
   * creation there is no row at all. Resolving WHICH layout wraps the draft
   * still needs the database, so that half stays here while the composition is
   * the shared one — the saved and unsaved paths cannot drift apart.
   */
  async previewDraft(
    draft: TemplateFields & Pick<EmailTemplateRecord, "layoutId">,
    sampleData: Record<string, unknown>
  ): Promise<RenderedTemplate> {
    const layout = draft.useLayout ? await this.getLayoutFor(draft) : null;
    return renderTemplate(draft, layout, sampleData, {
      appName: this.appName,
    });
  }

  // ============================================================
  // Built-in Template Bootstrap and ownership reconciliation
  // ============================================================

  /**
   * Bring the stored templates in line with their owners. Idempotent, and run
   * at every boot.
   *
   * First folds any legacy `_email-header` / `_email-footer` rows into the
   * unified default layout. Then, once the running plugins and what the site's
   * code sets are known, every owned template is reconciled (see
   * `reconcileOwnedRow`) and every other template is given its owner. A boot
   * path that has not called `configureOwnership` reads them from the
   * registered config here; with no config to read, only missing built-ins are
   * created and stored rows are left exactly as they are: a row cannot be
   * judged against owners nobody has listed.
   */
  async ensureBuiltInTemplates(): Promise<void> {
    if (!this.registry.complete) this.configureOwnershipFromConfig();
    await this.migrateLegacyLayout();

    // The `kind` column is added to existing tables as nullable; rows that
    // predate it come back null. Backfill them to `template` (the default
    // layout is already tagged `layout` by the migration above).
    await this.db
      .update(this.emailTemplates)
      .set({ kind: "template" })
      .where(isNull(this.emailTemplates.kind));

    const rows = (await this.db
      .select()
      .from(this.emailTemplates)) as StoredTemplateRow[];
    const bySlug = new Map(rows.map(row => [row.slug, row]));

    for (const entry of this.registry.owned.values()) {
      const row = bySlug.get(entry.slug);
      if (!row) {
        await this.insertOwned(entry);
      } else if (this.registry.complete) {
        await this.reconcileOwnedRow(row, entry);
      }
    }

    if (!this.registry.complete) return;
    for (const row of rows) {
      if (row.ownerKind !== null || this.registry.owned.has(row.slug)) continue;
      // Not owned by anything running: a known plugin's leftover, or the
      // site's own.
      const plugin = absentPluginFor(row.slug);
      await this.db
        .update(this.emailTemplates)
        .set({
          ...storedOwner(
            plugin ? { kind: "plugin", name: plugin } : { kind: "site" }
          ),
          overridden: false,
        })
        .where(eq(this.emailTemplates.id, row.id));
    }
  }

  /**
   * Read ownership from the registered config, for a boot path that seeds
   * templates without calling `configureOwnership` first (a cold boot through
   * the request handlers). Leaves the registry incomplete when there is no
   * config to read, as in a bare service.
   */
  private configureOwnershipFromConfig(): void {
    let config: Parameters<typeof ownershipFromConfig>[0];
    try {
      config = getService("config");
    } catch {
      return;
    }
    this.configureOwnership(ownershipFromConfig(config));
  }

  /**
   * The columns an owner sets on a template it already has: its version and
   * kind, and what it says about the template. The name and whether a layout
   * wraps it are the site's settings once the template exists, as the
   * provider, From and the rest are.
   */
  private ownerColumns(entry: OwnedTemplate) {
    return {
      ...entry.version,
      kind: entry.defaults.kind ?? "template",
      ...detailsOf(entry.defaults),
    };
  }

  /** Create an owned template that has no row. */
  private async insertOwned(entry: OwnedTemplate): Promise<void> {
    const now = new Date();
    const t = entry.defaults;
    try {
      await this.db.insert(this.emailTemplates).values({
        id: randomUUID(),
        slug: t.slug,
        name: t.name,
        useLayout: t.useLayout ?? true,
        ...this.ownerColumns(entry),
        layoutId: t.layoutId ?? null,
        fromOverride: t.fromOverride ?? null,
        replyTo: t.replyTo ?? null,
        isActive: t.isActive ?? true,
        providerId: t.providerId ?? null,
        attachments: t.attachments ?? null,
        ...storedOwner(entry.owner),
        overridden: false,
        baseVersion: null,
        baseDigest: null,
        createdAt: now,
        updatedAt: now,
      });
      this.logger.info(`Created email template: ${t.slug}`);
    } catch (error) {
      // Two first starts seed at once (several instances, or a dev server
      // beside a build): the one that loses hits the unique slug, and the row
      // it wanted is there. Any other failure is warned of, and seeding goes on.
      if (isUniqueViolation(error)) {
        this.logger.debug(
          `Email template "${t.slug}" was created by another process`
        );
        return;
      }
      this.logger.warn(`Failed to create email template "${t.slug}"`, {
        error,
      });
    }
  }

  /**
   * Reconcile one stored owned template with its owner. The name, layout use
   * and other settings are the site's and never change here.
   *
   * - **Not reconciled before**, or now owned by someone else: see
   *   `adoptOwner`.
   * - **Overridden**: the site's version stays; see `followOwnerDetails`.
   * - **Following its owner**: its version, kind and details are rewritten
   *   whenever the owner's move.
   */
  private async reconcileOwnedRow(
    row: StoredTemplateRow,
    entry: OwnedTemplate
  ): Promise<void> {
    const owner = storedOwner(entry.owner);
    if (
      row.ownerKind !== owner.ownerKind ||
      row.ownerName !== owner.ownerName
    ) {
      await this.adoptOwner(row, entry);
    } else if (row.overridden === true) {
      await this.followOwnerDetails(row, entry);
    } else {
      await this.followOwner(row, entry);
    }
  }

  /**
   * A template the owner takes for the first time (an install that predates
   * ownership), or again (a plugin's template whose plugin runs again).
   *
   * A row that says something different from the owner's version keeps
   * saying it, as an override based on the owner's version, so no earlier
   * edit is lost. So does one the site's code sets on an install that
   * predates ownership, which keeps sending the stored template it sent until
   * Reset. Either way the owner's details are taken: stored declarations on an
   * install that predates ownership are mostly an older release's, and
   * neither declarations nor a description change what a send renders.
   */
  private async adoptOwner(
    row: StoredTemplateRow,
    entry: OwnedTemplate
  ): Promise<void> {
    const firstTime = row.ownerKind === null;
    const keepSitesVersion =
      !sameVersion(versionOf(row), entry.version) ||
      (firstTime && this.registry.setInCode.has(row.slug)) ||
      row.overridden === true;
    const owner = storedOwner(entry.owner);
    const where = eq(this.emailTemplates.id, row.id);
    if (keepSitesVersion) {
      await this.db
        .update(this.emailTemplates)
        .set({
          ...owner,
          ...detailsOf(entry.defaults),
          overridden: true,
          baseVersion: {
            ...(row.baseVersion ?? entry.version),
            details: detailsOf(entry.defaults),
          },
          baseDigest: row.baseDigest ?? entry.digest,
        })
        .where(where);
      return;
    }
    await this.db
      .update(this.emailTemplates)
      .set({
        ...owner,
        ...this.ownerColumns(entry),
        overridden: false,
        baseVersion: null,
        baseDigest: null,
      })
      .where(where);
  }

  /**
   * An overridden template keeps the site's version; whether the owner's
   * moved is read from the kept digest. Its details follow the owner while
   * the site's still equal the owner's as of the site's copy, removals
   * included; once the site has changed them, the site's stay.
   */
  private async followOwnerDetails(
    row: StoredTemplateRow,
    entry: OwnedTemplate
  ): Promise<void> {
    const owners = detailsOf(entry.defaults);
    const kept = row.baseVersion?.details;
    // The site changed them: they stay.
    if (kept && !sameStoredValue(detailsOf(row), kept)) return;
    // Already the owner's, and recorded as such.
    if (kept && sameStoredValue(kept, owners)) return;
    await this.db
      .update(this.emailTemplates)
      .set({
        ...owners,
        baseVersion: {
          ...versionOf(row.baseVersion ?? entry.version),
          details: owners,
        },
      })
      .where(eq(this.emailTemplates.id, row.id));
  }

  /** A template following its owner: rewritten whenever the owner's version, kind or details move. */
  private async followOwner(
    row: StoredTemplateRow,
    entry: OwnedTemplate
  ): Promise<void> {
    const wanted = this.ownerColumns(entry);
    const current = {
      ...versionOf(row),
      kind: row.kind ?? "template",
      ...detailsOf(row),
    };
    if (sameStoredValue(current, wanted)) return;
    await this.db
      .update(this.emailTemplates)
      .set({ ...wanted, updatedAt: new Date() })
      .where(eq(this.emailTemplates.id, row.id));
    this.logger.info(
      `Updated email template to its owner's version: ${row.slug}`
    );
  }

  // ============================================================
  // Layout Resolution
  // ============================================================

  /**
   * List all layout rows (`kind = 'layout'`), newest first.
   */
  async listLayouts(): Promise<EmailTemplateRecord[]> {
    const results = await this.db
      .select()
      .from(this.emailTemplates)
      .where(eq(this.emailTemplates.kind, "layout"))
      .orderBy(desc(this.emailTemplates.createdAt));

    return (results as StoredTemplateRow[]).map(row => this.toRecord(row));
  }

  /**
   * Get the default layout row, or null if none exists yet.
   *
   * The default layout is uniquely identified by BOTH the `default-layout` slug
   * and `kind = 'layout'`. Matching the slug alone would let a regular template
   * named `default-layout` masquerade as the (undeletable) wrapper, and matching
   * any `kind = 'layout'` row would resolve an arbitrary custom layout as the
   * default and cause legacy migration to be skipped.
   */
  async getDefaultLayout(): Promise<EmailTemplateRecord | null> {
    const rows = await this.db
      .select()
      .from(this.emailTemplates)
      .where(
        and(
          eq(this.emailTemplates.slug, DEFAULT_LAYOUT_SLUG),
          eq(this.emailTemplates.kind, "layout")
        )
      )
      .limit(1);

    const row = rows[0] as StoredTemplateRow | undefined;
    return row ? this.toRecord(row) : null;
  }

  /**
   * Resolve the layout that wraps a given template: its explicit
   * `layoutId` when set and valid, otherwise the default layout.
   * Returns null when no layout exists at all.
   */
  async getLayoutFor(
    template: Pick<EmailTemplateRecord, "layoutId">
  ): Promise<EmailTemplateRecord | null> {
    if (template.layoutId) {
      try {
        const layout = await this.getTemplate(template.layoutId);
        if (layout.kind === "layout") return layout;
      } catch (error) {
        if (!NextlyError.isCode(error, "NOT_FOUND")) throw error;
      }
    }
    return this.getDefaultLayout();
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Fold legacy `_email-header` / `_email-footer` rows into a single
   * default layout row (`header + {{content}} + footer`), preserving
   * any operator customisations, then delete the legacy rows.
   * Idempotent — a no-op once a layout row exists.
   */
  private async migrateLegacyLayout(): Promise<void> {
    const existingLayout = await this.getDefaultLayout();
    if (existingLayout) return;

    const [header, footer] = await Promise.all([
      this.getRowBySlug(LEGACY_HEADER_SLUG),
      this.getRowBySlug(LEGACY_FOOTER_SLUG),
    ]);
    if (!header && !footer) return;

    const wrapper = `${header?.htmlContent ?? ""}${LAYOUT_CONTENT_PLACEHOLDER}${footer?.htmlContent ?? ""}`;
    const now = new Date();

    // Idempotent + ordered: confirm the default layout exists (creating it only
    // when absent, so re-runs and concurrent bootstraps don't insert duplicates)
    // BEFORE removing the legacy rows, so a failure can never delete the legacy
    // content without a replacement layout in place. A single atomic transaction
    // isn't used because SQLite requires a synchronous transaction callback,
    // which is incompatible with these async queries across dialects. The row
    // is left unowned: the reconciliation compares it with core's layout and,
    // since it holds the site's header and footer, keeps it as an override.
    const existing = await this.getDefaultLayout();
    if (!existing) {
      await this.db.insert(this.emailTemplates).values({
        id: randomUUID(),
        name: "Default Layout",
        slug: DEFAULT_LAYOUT_SLUG,
        kind: "layout",
        subject: "",
        htmlContent: wrapper,
        plainTextContent: null,
        preheader: null,
        layoutId: null,
        fromOverride: null,
        replyTo: null,
        variables: null,
        useLayout: false,
        isActive: true,
        providerId: null,
        createdAt: now,
        updatedAt: now,
      });
    }

    if (header) {
      await this.db
        .delete(this.emailTemplates)
        .where(eq(this.emailTemplates.id, header.id));
    }
    if (footer) {
      await this.db
        .delete(this.emailTemplates)
        .where(eq(this.emailTemplates.id, footer.id));
    }

    this.logger.info("Migrated legacy email layout rows into default layout.");
  }
}
