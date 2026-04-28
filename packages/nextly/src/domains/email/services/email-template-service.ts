/**
 * Email Template Service
 *
 * CRUD operations for managing email templates stored in the
 * `email_templates` table. Supports template variable interpolation,
 * built-in template bootstrapping, and shared email layout
 * (header/footer) management.
 *
 * Layout templates use reserved slugs `_email-header` and
 * `_email-footer` and are stored as regular template rows.
 *
 * @module services/email/email-template-service
 * @since 1.0.0
 */

import { randomUUID } from "crypto";

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import { eq, desc } from "drizzle-orm";

import { toDbError } from "../../../database/errors";
import { NextlyError } from "../../../errors";
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
import { BUILT_IN_TEMPLATES } from "./templates";

// ============================================================
// Constants
// ============================================================

/** Reserved slug for the shared email header layout. */
const LAYOUT_HEADER_SLUG = "_email-header";

/** Reserved slug for the shared email footer layout. */
const LAYOUT_FOOTER_SLUG = "_email-footer";

/** Reserved slugs that cannot be used by user-created templates. */
const RESERVED_SLUGS = new Set([LAYOUT_HEADER_SLUG, LAYOUT_FOOTER_SLUG]);

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
    if (RESERVED_SLUGS.has(data.slug)) {
      // Spec §13.8: identifiers (the slug value) belong in logContext, not in
      // the public message. Public sentence stays generic and ends with a period.
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          "That slug is reserved for layout templates. Use updateLayout() instead.",
        statusCode: 422,
        logContext: { slug: data.slug },
      });
    }

    const id = randomUUID();
    const now = new Date();

    const values = {
      id,
      name: data.name,
      slug: data.slug,
      subject: data.subject,
      htmlContent: data.htmlContent,
      plainTextContent: data.plainTextContent ?? null,
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
   * List all email templates, ordered by creation date (newest first).
   *
   * Excludes layout templates (`_email-header`, `_email-footer`)
   * from the listing. Use `getLayout()` to access layout templates.
   */
  async listTemplates(): Promise<EmailTemplateRecord[]> {
    const results = await this.db
      .select()
      .from(this.emailTemplates)
      .orderBy(desc(this.emailTemplates.createdAt));

    return (results as EmailTemplateRecord[]).filter(
      row => !RESERVED_SLUGS.has(row.slug)
    );
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
   * Cannot delete layout templates — use `updateLayout()` to modify them.
   * Idempotent — returns successfully if template doesn't exist.
   *
   * @throws NextlyError BUSINESS_RULE_VIOLATION if template is a layout template
   */
  async deleteTemplate(id: string): Promise<void> {
    // Check if template exists and validate it's not a layout template
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

    if (RESERVED_SLUGS.has(template.slug)) {
      // Spec §13.8: identifiers are operator-only. Public sentence is generic.
      throw new NextlyError({
        code: "BUSINESS_RULE_VIOLATION",
        publicMessage:
          "Cannot delete layout templates. Use updateLayout() to modify them.",
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
    let html = interpolateTemplate(template.htmlContent, sampleData);

    // Wrap with layout if enabled
    if (template.useLayout) {
      const layout = await this.getLayout();
      const header = interpolateTemplate(layout.header, sampleData);
      const footer = interpolateTemplate(layout.footer, sampleData);
      html = header + html + footer;
    }

    return { subject, html };
  }

  // ============================================================
  // Built-in Template Bootstrap
  // ============================================================

  /**
   * Ensure built-in templates exist in the database.
   *
   * Auto-creates welcome, password-reset, email-verification templates
   * and `_email-header` / `_email-footer` layout templates if they
   * don't already exist. Idempotent — skips templates that already exist.
   */
  async ensureBuiltInTemplates(): Promise<void> {
    for (const template of BUILT_IN_TEMPLATES) {
      const existing = await this.getTemplateBySlug(template.slug);
      if (existing) continue;

      const id = randomUUID();
      const now = new Date();

      const values = {
        id,
        name: template.name,
        slug: template.slug,
        subject: template.subject,
        htmlContent: template.htmlContent,
        plainTextContent: template.plainTextContent ?? null,
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

  // ============================================================
  // Layout Management
  // ============================================================

  /**
   * Get the shared email layout (header + footer).
   *
   * Returns the `htmlContent` of the `_email-header` and `_email-footer`
   * reserved template rows. Returns empty strings if layout templates
   * haven't been created yet.
   */
  async getLayout(): Promise<{ header: string; footer: string }> {
    const [headerTemplate, footerTemplate] = await Promise.all([
      this.getTemplateBySlug(LAYOUT_HEADER_SLUG),
      this.getTemplateBySlug(LAYOUT_FOOTER_SLUG),
    ]);

    return {
      header: headerTemplate?.htmlContent ?? "",
      footer: footerTemplate?.htmlContent ?? "",
    };
  }

  /**
   * Update the shared email header or footer.
   *
   * Creates layout templates if they don't exist yet.
   */
  async updateLayout(data: {
    header?: string;
    footer?: string;
  }): Promise<void> {
    const now = new Date();

    if (data.header !== undefined) {
      await this.upsertLayoutTemplate(
        LAYOUT_HEADER_SLUG,
        "Email Header",
        data.header,
        now
      );
    }

    if (data.footer !== undefined) {
      await this.upsertLayoutTemplate(
        LAYOUT_FOOTER_SLUG,
        "Email Footer",
        data.footer,
        now
      );
    }
  }

  // ============================================================
  // Private Helpers
  // ============================================================

  /**
   * Insert or update a layout template by slug.
   */
  private async upsertLayoutTemplate(
    slug: string,
    name: string,
    htmlContent: string,
    now: Date
  ): Promise<void> {
    const existing = await this.getTemplateBySlug(slug);

    if (existing) {
      await this.db
        .update(this.emailTemplates)
        .set({ htmlContent, updatedAt: now })
        .where(eq(this.emailTemplates.id, existing.id));
    } else {
      const id = randomUUID();

      await this.db.insert(this.emailTemplates).values({
        id,
        name,
        slug,
        subject: "",
        htmlContent,
        plainTextContent: null,
        variables: null,
        useLayout: false,
        isActive: true,
        providerId: null,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}
