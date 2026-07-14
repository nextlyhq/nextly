/**
 * Email Template Service
 *
 * CRUD operations for managing email templates stored in the
 * `email_templates` table. Supports template variable interpolation,
 * built-in template bootstrapping, and layout composition.
 *
 * A layout is a first-class row with `kind = 'layout'` whose
 * `htmlContent` holds a `{{content}}` placeholder where a template
 * body is injected at send time.
 *
 * @module services/email/email-template-service
 * @since 1.0.0
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { and, eq, desc, isNull } from "drizzle-orm";

import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
import type { PluginEmailTemplate } from "../../../plugins/contributions";
import { emailTemplatesMysql } from "../../../schemas/email-templates/mysql";
import { emailTemplatesPg } from "../../../schemas/email-templates/postgres";
import { emailTemplatesSqlite } from "../../../schemas/email-templates/sqlite";
import type {
  EmailTemplateInsert,
  EmailTemplateRecord,
  EmailTemplateVariable,
} from "../../../schemas/email-templates/types";
import type { Logger } from "../../../services/shared";
import { BaseService } from "../../../shared/base-service";
import type { EmailAttachmentInput } from "../types";

import { interpolateTemplate } from "./template-engine";
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
}

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

  constructor(adapter: DrizzleAdapter, logger: Logger) {
    super(adapter, logger);

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
  // CRUD Methods
  // ============================================================

  /**
   * Create a new email template.
   *
   * @throws NextlyError BUSINESS_RULE_VIOLATION if slug is reserved
   * @throws NextlyError DUPLICATE if slug already exists
   */
  async createTemplate(
    data: CreateEmailTemplateInput
  ): Promise<EmailTemplateRecord> {
    const id = randomUUID();
    const now = new Date();

    const values = {
      id,
      name: data.name,
      slug: data.slug,
      kind: data.kind ?? "template",
      subject: data.subject,
      htmlContent: data.htmlContent,
      plainTextContent: data.plainTextContent ?? null,
      preheader: data.preheader ?? null,
      layoutId: data.layoutId ?? null,
      fromOverride: data.fromOverride ?? null,
      replyTo: data.replyTo ?? null,
      variables: data.variables ?? null,
      useLayout: data.useLayout ?? true,
      isActive: data.isActive ?? true,
      providerId: data.providerId ?? null,
      attachments: data.attachments ?? null,
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

    return this.getTemplate(id);
  }

  /**
   * Get a single email template by ID.
   *
   * @throws NextlyError NOT_FOUND if template doesn't exist
   */
  async getTemplate(id: string): Promise<EmailTemplateRecord> {
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

    return results[0] as EmailTemplateRecord;
  }

  /**
   * Get a single email template by slug.
   *
   * Returns `null` if no template matches the slug.
   */
  async getTemplateBySlug(slug: string): Promise<EmailTemplateRecord | null> {
    const results = await this.db
      .select()
      .from(this.emailTemplates)
      .where(eq(this.emailTemplates.slug, slug))
      .limit(1);

    if (results.length === 0) return null;
    return results[0] as EmailTemplateRecord;
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

    return results as EmailTemplateRecord[];
  }

  /**
   * Update an existing email template.
   *
   * Template `slug` cannot be changed after creation.
   *
   * @throws NextlyError NOT_FOUND if template doesn't exist
   */
  async updateTemplate(
    id: string,
    data: UpdateEmailTemplateInput
  ): Promise<EmailTemplateRecord> {
    await this.getTemplate(id);

    const updateData: Record<string, unknown> = {
      updatedAt: new Date(),
    };

    if (data.name !== undefined) updateData.name = data.name;
    if (data.subject !== undefined) updateData.subject = data.subject;
    if (data.htmlContent !== undefined)
      updateData.htmlContent = data.htmlContent;
    if (data.plainTextContent !== undefined)
      updateData.plainTextContent = data.plainTextContent;
    if (data.preheader !== undefined) updateData.preheader = data.preheader;
    if (data.layoutId !== undefined) updateData.layoutId = data.layoutId;
    if (data.fromOverride !== undefined)
      updateData.fromOverride = data.fromOverride;
    if (data.replyTo !== undefined) updateData.replyTo = data.replyTo;
    if (data.variables !== undefined) updateData.variables = data.variables;
    if (data.useLayout !== undefined) updateData.useLayout = data.useLayout;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;
    if (data.providerId !== undefined) updateData.providerId = data.providerId;
    if (data.attachments !== undefined)
      updateData.attachments = data.attachments;

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

    return this.getTemplate(id);
  }

  /**
   * Delete an email template.
   *
   * The default layout is undeletable (it is the fallback wrapper).
   * Custom layouts may be deleted — templates referencing them fall
   * back to the default via the `layoutId` set-null FK. Idempotent —
   * returns successfully if the template doesn't exist.
   *
   * @throws NextlyError BUSINESS_RULE_VIOLATION if deleting the default layout
   */
  async deleteTemplate(id: string): Promise<void> {
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

    if (template.slug === DEFAULT_LAYOUT_SLUG) {
      // Spec §13.8: identifiers are operator-only. Public sentence is generic.
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage: "Cannot delete the default layout.",
        statusCode: 422,
        logContext: { id, slug: template.slug },
      });
    }

    await this.db
      .delete(this.emailTemplates)
      .where(eq(this.emailTemplates.id, id));
  }

  // ============================================================
  // Template Preview
  // ============================================================

  /**
   * Preview a template with sample data.
   *
   * Replaces `{{variable}}` placeholders with values from `sampleData`.
   * Supports dot-notation nested variables (`{{user.name}}`), HTML-escapes
   * values by default to prevent XSS, and wraps with shared layout
   * (header/footer) when `useLayout` is enabled.
   *
   * @throws NextlyError NOT_FOUND if template doesn't exist
   */
  async previewTemplate(
    id: string,
    sampleData: Record<string, unknown>
  ): Promise<{ subject: string; html: string }> {
    const template = await this.getTemplate(id);

    const subject = interpolateTemplate(template.subject, sampleData);
    const body = interpolateTemplate(template.htmlContent, sampleData);

    // Layout rows preview as-is; message bodies wrap in their layout.
    if (template.kind === "layout" || !template.useLayout) {
      return { subject, html: body };
    }

    const layout = await this.getLayoutFor(template);
    if (!layout) return { subject, html: body };

    return { subject, html: this.renderWithLayout(layout, body, sampleData) };
  }

  /**
   * Inject an already-rendered body into a layout wrapper at its
   * `{{content}}` placeholder. The layout's own `{{variable}}`
   * placeholders (e.g. `{{year}}`, `{{appName}}`) are interpolated;
   * the body is spliced in verbatim (never re-escaped).
   */
  renderWithLayout(
    layout: EmailTemplateRecord,
    body: string,
    variables: Record<string, unknown>
  ): string {
    // A well-formed layout has exactly one `{{content}}` marker (enforced on
    // save). Be defensive for legacy/malformed rows: use the FIRST marker as the
    // slot and preserve the rest of the wrapper, and if there is no marker at
    // all, append the body after the wrapper so nothing is silently dropped.
    const markerIndex = layout.htmlContent.indexOf(LAYOUT_CONTENT_PLACEHOLDER);
    if (markerIndex === -1) {
      return interpolateTemplate(layout.htmlContent, variables) + body;
    }
    const before = layout.htmlContent.slice(0, markerIndex);
    const after = layout.htmlContent.slice(
      markerIndex + LAYOUT_CONTENT_PLACEHOLDER.length
    );
    const head = interpolateTemplate(before, variables);
    const tail = interpolateTemplate(after, variables);
    return head + body + tail;
  }

  // ============================================================
  // Built-in Template Bootstrap
  // ============================================================

  /**
   * Ensure built-in templates exist in the database.
   *
   * First folds any legacy `_email-header` / `_email-footer` rows into
   * the unified default layout, then auto-creates the default layout,
   * welcome, password-reset, and email-verification templates if they
   * don't already exist. Idempotent — skips templates that already exist.
   */
  async ensureBuiltInTemplates(): Promise<void> {
    await this.migrateLegacyLayout();

    // The `kind` column is added to existing tables as nullable; rows that
    // predate it come back null. Backfill them to `template` (the default
    // layout is already tagged `layout` by the migration above).
    await this.db
      .update(this.emailTemplates)
      .set({ kind: "template" })
      .where(isNull(this.emailTemplates.kind));

    for (const template of BUILT_IN_TEMPLATES) {
      const existing = await this.getTemplateBySlug(template.slug);
      if (existing) continue;

      const id = randomUUID();
      const now = new Date();

      const values = {
        id,
        name: template.name,
        slug: template.slug,
        kind: template.kind ?? "template",
        subject: template.subject,
        htmlContent: template.htmlContent,
        plainTextContent: template.plainTextContent ?? null,
        preheader: template.preheader ?? null,
        layoutId: template.layoutId ?? null,
        fromOverride: template.fromOverride ?? null,
        replyTo: template.replyTo ?? null,
        variables: template.variables ?? null,
        useLayout: template.useLayout ?? true,
        isActive: template.isActive ?? true,
        providerId: template.providerId ?? null,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await this.db.insert(this.emailTemplates).values(values);
        this.logger.info(`Created built-in email template: ${template.slug}`);
      } catch (error) {
        // Ignore duplicate slug errors (race condition safety)
        this.logger.warn(
          `Failed to create built-in template "${template.slug}" — may already exist`,
          { error }
        );
      }
    }
  }

  /**
   * Seed plugin-contributed email templates (C2/D65). Idempotent by slug — a
   * template whose slug already exists is skipped, so an admin's edits to it (or
   * a built-in) are never clobbered.
   */
  async ensurePluginTemplates(templates: PluginEmailTemplate[]): Promise<void> {
    for (const template of templates) {
      const existing = await this.getTemplateBySlug(template.slug);
      if (existing) continue;

      const now = new Date();
      const values = {
        id: randomUUID(),
        name: template.name,
        slug: template.slug,
        subject: template.subject,
        htmlContent: template.htmlContent,
        plainTextContent: template.plainTextContent ?? null,
        variables: (template.variables ?? null) as
          | EmailTemplateVariable[]
          | null,
        useLayout: template.useLayout ?? true,
        isActive: true,
        providerId: null,
        createdAt: now,
        updatedAt: now,
      };

      try {
        await this.db.insert(this.emailTemplates).values(values);
        this.logger.info(`Created plugin email template: ${template.slug}`);
      } catch (error) {
        this.logger.warn(
          `Failed to create plugin template "${template.slug}" — may already exist`,
          { error }
        );
      }
    }
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

    return results as EmailTemplateRecord[];
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

    return (rows[0] as EmailTemplateRecord | undefined) ?? null;
  }

  /**
   * Resolve the layout that wraps a given template: its explicit
   * `layoutId` when set and valid, otherwise the default layout.
   * Returns null when no layout exists at all.
   */
  async getLayoutFor(
    template: EmailTemplateRecord
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
      this.getTemplateBySlug(LEGACY_HEADER_SLUG),
      this.getTemplateBySlug(LEGACY_FOOTER_SLUG),
    ]);
    if (!header && !footer) return;

    const wrapper = `${header?.htmlContent ?? ""}${LAYOUT_CONTENT_PLACEHOLDER}${footer?.htmlContent ?? ""}`;
    const now = new Date();

    // Idempotent + ordered: confirm the default layout exists (creating it only
    // when absent, so re-runs and concurrent bootstraps don't insert duplicates)
    // BEFORE removing the legacy rows, so a failure can never delete the legacy
    // content without a replacement layout in place. A single atomic transaction
    // isn't used because SQLite requires a synchronous transaction callback,
    // which is incompatible with these async queries across dialects.
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
