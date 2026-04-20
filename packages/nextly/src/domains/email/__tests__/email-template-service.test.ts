/**
 * Tests for EmailTemplateService
 *
 * Covers:
 * 1. CRUD operations: create, get, update, delete, list templates
 * 2. Template slug uniqueness — creating duplicate throws
 * 3. Reserved slug protection — cannot create with `_email-header` or `_email-footer`
 * 4. Layout management: getLayout, updateLayout (header/footer)
 * 5. Built-in template bootstrapping: ensureBuiltInTemplates (idempotent)
 * 6. Template preview with variable interpolation
 *
 * Uses in-memory SQLite with better-sqlite3, following the pattern
 * from `email-provider-service.test.ts`.
 */

import type { DrizzleAdapter } from "@revnixhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { ServiceError } from "../../../errors/service-error";
import { emailTemplatesSqlite } from "../../../schemas/email-templates/sqlite";
import type { Logger } from "../../../shared/types";
import { EmailTemplateService } from "../services/email-template-service";

// ── Mock env BEFORE any service imports touch it ───────────────────────────
vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET_RESOLVED: "test-secret-must-be-32chars-long!!",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
  },
}));

// ── Helpers ────────────────────────────────────────────────────────────────

function makeAdapter(db: ReturnType<typeof drizzle>): unknown {
  return {
    dialect: "sqlite" as const,
    getDrizzle: () => db,
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    connect: async () => {},
    disconnect: async () => {},
    executeQuery: async () => [],
    transaction: async (
      fn: (tx: ReturnType<typeof drizzle>) => Promise<unknown>
    ) => fn(db),
  };
}

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function createInMemoryDb() {
  const sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS email_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      subject TEXT NOT NULL,
      html_content TEXT NOT NULL,
      plain_text_content TEXT,
      variables TEXT,
      use_layout INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      provider_id TEXT,
      attachments TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS et_slug_unique ON email_templates(slug);
  `);
  const db = drizzle(sqlite, { schema: { emailTemplatesSqlite } });
  return { sqlite, db };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe("EmailTemplateService", () => {
  let sqlite: Database.Database;
  let service: EmailTemplateService;

  beforeEach(() => {
    vi.clearAllMocks();
    const { sqlite: s, db } = createInMemoryDb();
    sqlite = s;
    service = new EmailTemplateService(
      makeAdapter(db) as unknown as DrizzleAdapter,
      logger
    );
  });

  afterEach(() => {
    sqlite.close();
  });

  // ── CRUD ────────────────────────────────────────────────────────────────

  describe("createTemplate()", () => {
    it("creates a template and returns a full record with id and timestamps", async () => {
      const result = await service.createTemplate({
        name: "Welcome",
        slug: "welcome",
        subject: "Welcome, {{name}}!",
        htmlContent: "<h1>Welcome, {{name}}!</h1>",
      });

      expect(result.id).toEqual(expect.any(String));
      expect(result.id.length).toBeGreaterThan(0);
      expect(result.name).toBe("Welcome");
      expect(result.slug).toBe("welcome");
      expect(result.subject).toBe("Welcome, {{name}}!");
      expect(result.htmlContent).toBe("<h1>Welcome, {{name}}!</h1>");
      expect(result.plainTextContent).toBeNull();
      expect(result.useLayout).toBe(true);
      expect(result.isActive).toBe(true);
      expect(result.providerId).toBeNull();
      expect(result.createdAt).toBeInstanceOf(Date);
      expect(result.updatedAt).toBeInstanceOf(Date);
    });

    it("stores optional fields (plainTextContent, variables, providerId)", async () => {
      const result = await service.createTemplate({
        name: "Reset Password",
        slug: "reset-password",
        subject: "Reset your password",
        htmlContent: "<p>Click {{link}}</p>",
        plainTextContent: "Click {{link}}",
        variables: [
          { name: "link", description: "Reset link", required: true },
        ],
        useLayout: false,
        isActive: false,
        providerId: "provider-123",
      });

      expect(result.plainTextContent).toBe("Click {{link}}");
      expect(result.variables).toEqual([
        { name: "link", description: "Reset link", required: true },
      ]);
      expect(result.useLayout).toBe(false);
      expect(result.isActive).toBe(false);
      expect(result.providerId).toBe("provider-123");
    });
  });

  describe("getTemplate()", () => {
    it("returns the template by ID", async () => {
      const created = await service.createTemplate({
        name: "Test",
        slug: "test-get",
        subject: "Subject",
        htmlContent: "<p>Body</p>",
      });

      const fetched = await service.getTemplate(created.id);

      expect(fetched.id).toBe(created.id);
      expect(fetched.slug).toBe("test-get");
    });

    it("throws NOT_FOUND for a nonexistent ID", async () => {
      await expect(service.getTemplate("nonexistent-id")).rejects.toThrow(
        ServiceError
      );

      await expect(service.getTemplate("nonexistent-id")).rejects.toMatchObject(
        { code: "NOT_FOUND" }
      );
    });
  });

  describe("getTemplateBySlug()", () => {
    it("returns the template by slug", async () => {
      await service.createTemplate({
        name: "By Slug",
        slug: "by-slug",
        subject: "Subject",
        htmlContent: "<p>Body</p>",
      });

      const result = await service.getTemplateBySlug("by-slug");

      expect(result).not.toBeNull();
      expect(result!.slug).toBe("by-slug");
    });

    it("returns null when slug is not found", async () => {
      const result = await service.getTemplateBySlug("nonexistent-slug");

      expect(result).toBeNull();
    });
  });

  describe("updateTemplate()", () => {
    it("updates only the provided fields", async () => {
      const created = await service.createTemplate({
        name: "Original",
        slug: "update-test",
        subject: "Original Subject",
        htmlContent: "<p>Original</p>",
      });

      const updated = await service.updateTemplate(created.id, {
        name: "Updated Name",
        subject: "Updated Subject",
      });

      expect(updated.name).toBe("Updated Name");
      expect(updated.subject).toBe("Updated Subject");
      // Unchanged fields preserved
      expect(updated.htmlContent).toBe("<p>Original</p>");
      expect(updated.slug).toBe("update-test");
    });

    it("updates updatedAt on every call", async () => {
      const created = await service.createTemplate({
        name: "Timestamp Test",
        slug: "ts-test",
        subject: "Subject",
        htmlContent: "<p>Body</p>",
      });

      const updated = await service.updateTemplate(created.id, {
        name: "Timestamp Test Updated",
      });

      expect(updated.updatedAt.getTime()).toBeGreaterThanOrEqual(
        created.updatedAt.getTime()
      );
    });

    it("throws NOT_FOUND when updating a nonexistent template", async () => {
      await expect(
        service.updateTemplate("nonexistent-id", { name: "Fail" })
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });

  describe("deleteTemplate()", () => {
    it("deletes an existing template", async () => {
      const created = await service.createTemplate({
        name: "To Delete",
        slug: "delete-me",
        subject: "Subject",
        htmlContent: "<p>Gone</p>",
      });

      await service.deleteTemplate(created.id);

      // Verify it's gone
      await expect(service.getTemplate(created.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    });

    it("is idempotent — no error on missing ID", async () => {
      await expect(
        service.deleteTemplate("nonexistent-id")
      ).resolves.toBeUndefined();
    });

    it("cannot delete layout templates", async () => {
      await service.updateLayout({ header: "<header>Test</header>" });

      const headerTemplate = await service.getTemplateBySlug("_email-header");
      expect(headerTemplate).not.toBeNull();

      await expect(service.deleteTemplate(headerTemplate!.id)).rejects.toThrow(
        ServiceError
      );

      await expect(
        service.deleteTemplate(headerTemplate!.id)
      ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
    });
  });

  describe("listTemplates()", () => {
    it("lists all non-layout templates", async () => {
      await service.createTemplate({
        name: "First",
        slug: "first",
        subject: "S",
        htmlContent: "<p>1</p>",
      });
      await service.createTemplate({
        name: "Second",
        slug: "second",
        subject: "S",
        htmlContent: "<p>2</p>",
      });

      const list = await service.listTemplates();

      expect(list.length).toBe(2);
      const slugs = list.map(t => t.slug);
      expect(slugs).toContain("first");
      expect(slugs).toContain("second");
    });

    it("returns newest templates first when timestamps differ", async () => {
      // Create first template
      const first = await service.createTemplate({
        name: "Older",
        slug: "older",
        subject: "S",
        htmlContent: "<p>1</p>",
      });

      // Manually shift the first template's createdAt back so timestamps differ
      sqlite.exec(
        `UPDATE email_templates SET created_at = created_at - 10000 WHERE id = '${first.id}'`
      );

      await service.createTemplate({
        name: "Newer",
        slug: "newer",
        subject: "S",
        htmlContent: "<p>2</p>",
      });

      const list = await service.listTemplates();

      expect(list.length).toBe(2);
      expect(list[0].slug).toBe("newer");
      expect(list[1].slug).toBe("older");
    });

    it("excludes layout templates from the list", async () => {
      await service.createTemplate({
        name: "Regular",
        slug: "regular-template",
        subject: "S",
        htmlContent: "<p>body</p>",
      });
      await service.updateLayout({
        header: "<header>H</header>",
        footer: "<footer>F</footer>",
      });

      const list = await service.listTemplates();

      const slugs = list.map(t => t.slug);
      expect(slugs).toContain("regular-template");
      expect(slugs).not.toContain("_email-header");
      expect(slugs).not.toContain("_email-footer");
    });
  });

  // ── Slug Uniqueness ─────────────────────────────────────────────────────

  describe("slug uniqueness", () => {
    it("throws when creating a template with a duplicate slug", async () => {
      await service.createTemplate({
        name: "Original",
        slug: "unique-slug",
        subject: "S",
        htmlContent: "<p>body</p>",
      });

      await expect(
        service.createTemplate({
          name: "Duplicate",
          slug: "unique-slug",
          subject: "S2",
          htmlContent: "<p>body2</p>",
        })
      ).rejects.toThrow(ServiceError);
    });
  });

  // ── Reserved Slug Protection ────────────────────────────────────────────

  describe("reserved slug protection", () => {
    it("rejects creating a template with _email-header slug", async () => {
      await expect(
        service.createTemplate({
          name: "Sneaky Header",
          slug: "_email-header",
          subject: "S",
          htmlContent: "<p>not allowed</p>",
        })
      ).rejects.toThrow(ServiceError);

      await expect(
        service.createTemplate({
          name: "Sneaky Header",
          slug: "_email-header",
          subject: "S",
          htmlContent: "<p>not allowed</p>",
        })
      ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
    });

    it("rejects creating a template with _email-footer slug", async () => {
      await expect(
        service.createTemplate({
          name: "Sneaky Footer",
          slug: "_email-footer",
          subject: "S",
          htmlContent: "<p>not allowed</p>",
        })
      ).rejects.toThrow(ServiceError);

      await expect(
        service.createTemplate({
          name: "Sneaky Footer",
          slug: "_email-footer",
          subject: "S",
          htmlContent: "<p>not allowed</p>",
        })
      ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
    });
  });

  // ── Layout Management ───────────────────────────────────────────────────

  describe("getLayout()", () => {
    it("returns empty strings when no layout templates exist", async () => {
      const layout = await service.getLayout();

      expect(layout.header).toBe("");
      expect(layout.footer).toBe("");
    });

    it("returns stored header and footer after updateLayout", async () => {
      await service.updateLayout({
        header: "<header>My Header</header>",
        footer: "<footer>My Footer</footer>",
      });

      const layout = await service.getLayout();

      expect(layout.header).toBe("<header>My Header</header>");
      expect(layout.footer).toBe("<footer>My Footer</footer>");
    });
  });

  describe("updateLayout()", () => {
    it("creates layout templates if they do not exist", async () => {
      await service.updateLayout({
        header: "<header>New</header>",
        footer: "<footer>New</footer>",
      });

      const headerTemplate = await service.getTemplateBySlug("_email-header");
      const footerTemplate = await service.getTemplateBySlug("_email-footer");

      expect(headerTemplate).not.toBeNull();
      expect(headerTemplate!.htmlContent).toBe("<header>New</header>");
      expect(footerTemplate).not.toBeNull();
      expect(footerTemplate!.htmlContent).toBe("<footer>New</footer>");
    });

    it("updates existing layout templates without creating duplicates", async () => {
      await service.updateLayout({
        header: "<header>V1</header>",
        footer: "<footer>V1</footer>",
      });
      await service.updateLayout({
        header: "<header>V2</header>",
        footer: "<footer>V2</footer>",
      });

      const layout = await service.getLayout();

      expect(layout.header).toBe("<header>V2</header>");
      expect(layout.footer).toBe("<footer>V2</footer>");
    });

    it("can update header only without touching footer", async () => {
      await service.updateLayout({
        header: "<header>H1</header>",
        footer: "<footer>F1</footer>",
      });
      await service.updateLayout({
        header: "<header>H2</header>",
      });

      const layout = await service.getLayout();

      expect(layout.header).toBe("<header>H2</header>");
      expect(layout.footer).toBe("<footer>F1</footer>");
    });

    it("can update footer only without touching header", async () => {
      await service.updateLayout({
        header: "<header>H1</header>",
        footer: "<footer>F1</footer>",
      });
      await service.updateLayout({
        footer: "<footer>F2</footer>",
      });

      const layout = await service.getLayout();

      expect(layout.header).toBe("<header>H1</header>");
      expect(layout.footer).toBe("<footer>F2</footer>");
    });
  });

  // ── Built-in Template Bootstrap ─────────────────────────────────────────

  describe("ensureBuiltInTemplates()", () => {
    it("creates all built-in templates on first call", async () => {
      await service.ensureBuiltInTemplates();

      // Verify the expected built-in slugs exist
      const welcome = await service.getTemplateBySlug("welcome");
      const passwordReset = await service.getTemplateBySlug("password-reset");
      const emailVerification =
        await service.getTemplateBySlug("email-verification");
      const header = await service.getTemplateBySlug("_email-header");
      const footer = await service.getTemplateBySlug("_email-footer");

      expect(welcome).not.toBeNull();
      expect(passwordReset).not.toBeNull();
      expect(emailVerification).not.toBeNull();
      expect(header).not.toBeNull();
      expect(footer).not.toBeNull();
    });

    it("is idempotent — second call does not duplicate templates", async () => {
      await service.ensureBuiltInTemplates();
      await service.ensureBuiltInTemplates();

      // listTemplates excludes layout templates, so we check all templates
      // by querying the known slugs individually
      const welcome = await service.getTemplateBySlug("welcome");
      expect(welcome).not.toBeNull();

      // The list should still have 3 non-layout templates
      const list = await service.listTemplates();
      const welcomeCount = list.filter(t => t.slug === "welcome").length;
      expect(welcomeCount).toBe(1);
    });

    it("skips templates that already exist from earlier runs", async () => {
      // Create one built-in template manually first
      await service.createTemplate({
        name: "Custom Welcome",
        slug: "welcome",
        subject: "My Custom Welcome",
        htmlContent: "<p>Custom welcome</p>",
      });

      await service.ensureBuiltInTemplates();

      // The manually created one should not be overwritten
      const welcome = await service.getTemplateBySlug("welcome");
      expect(welcome!.subject).toBe("My Custom Welcome");
    });
  });

  // ── Template Preview ────────────────────────────────────────────────────

  describe("previewTemplate()", () => {
    it("interpolates {{variables}} in subject and html", async () => {
      const template = await service.createTemplate({
        name: "Preview Test",
        slug: "preview-test",
        subject: "Hello, {{name}}!",
        htmlContent: "<h1>Welcome, {{name}}!</h1><p>Your code: {{code}}</p>",
        useLayout: false,
      });

      const preview = await service.previewTemplate(template.id, {
        name: "Alice",
        code: "12345",
      });

      expect(preview.subject).toBe("Hello, Alice!");
      expect(preview.html).toBe(
        "<h1>Welcome, Alice!</h1><p>Your code: 12345</p>"
      );
    });

    it("replaces missing variables with empty string", async () => {
      const template = await service.createTemplate({
        name: "Missing Vars",
        slug: "missing-vars",
        subject: "Hi {{name}}",
        htmlContent: "<p>{{greeting}}, {{name}}!</p>",
        useLayout: false,
      });

      const preview = await service.previewTemplate(template.id, {});

      expect(preview.subject).toBe("Hi ");
      expect(preview.html).toBe("<p>, !</p>");
    });

    it("HTML-escapes variable values by default", async () => {
      const template = await service.createTemplate({
        name: "XSS Test",
        slug: "xss-test",
        subject: "Subject",
        htmlContent: "<p>{{content}}</p>",
        useLayout: false,
      });

      const preview = await service.previewTemplate(template.id, {
        content: '<script>alert("xss")</script>',
      });

      expect(preview.html).toBe(
        "<p>&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;</p>"
      );
    });

    it("wraps content with layout header/footer when useLayout is true", async () => {
      // Set up layout
      await service.updateLayout({
        header: "<html><body>",
        footer: "</body></html>",
      });

      const template = await service.createTemplate({
        name: "Layout Preview",
        slug: "layout-preview",
        subject: "Subject",
        htmlContent: "<p>Content</p>",
        useLayout: true,
      });

      const preview = await service.previewTemplate(template.id, {});

      expect(preview.html).toBe("<html><body><p>Content</p></body></html>");
    });

    it("interpolates variables in layout header and footer too", async () => {
      await service.updateLayout({
        header: "<header>{{appName}}</header>",
        footer: "<footer>{{year}} {{appName}}</footer>",
      });

      const template = await service.createTemplate({
        name: "Layout Vars",
        slug: "layout-vars",
        subject: "{{appName}} Notification",
        htmlContent: "<p>Hello from {{appName}}</p>",
        useLayout: true,
      });

      const preview = await service.previewTemplate(template.id, {
        appName: "Nextly",
        year: "2026",
      });

      expect(preview.subject).toBe("Nextly Notification");
      expect(preview.html).toBe(
        "<header>Nextly</header><p>Hello from Nextly</p><footer>2026 Nextly</footer>"
      );
    });

    it("does not wrap with layout when useLayout is false", async () => {
      await service.updateLayout({
        header: "<header>H</header>",
        footer: "<footer>F</footer>",
      });

      const template = await service.createTemplate({
        name: "No Layout",
        slug: "no-layout",
        subject: "S",
        htmlContent: "<p>Bare</p>",
        useLayout: false,
      });

      const preview = await service.previewTemplate(template.id, {});

      expect(preview.html).toBe("<p>Bare</p>");
    });

    it("throws NOT_FOUND for a nonexistent template ID", async () => {
      await expect(
        service.previewTemplate("nonexistent-id", {})
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
