/**
 * Tests for EmailTemplateService
 *
 * Covers:
 * 1. CRUD operations: create, get, update, delete, list templates
 * 2. Template slug uniqueness — creating duplicate throws
 * 3. Layout resolution: getDefaultLayout, getLayoutFor, legacy migration
 * 4. Built-in template bootstrapping: ensureBuiltInTemplates (idempotent)
 * 5. Template preview with layout composition ({{content}})
 *
 * Uses in-memory SQLite with better-sqlite3, following the pattern
 * from `email-provider-service.test.ts`.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { NextlyError } from "../../../errors";
import { emailTemplatesSqlite } from "../../../schemas/email-templates/sqlite";
import type { Logger } from "../../../shared/types";
import { EmailTemplateService } from "../services/email-template-service";

// ── Mock env BEFORE any service imports touch it ───────────────────────────
vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!",
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
      preheader TEXT,
      kind TEXT NOT NULL DEFAULT 'template',
      layout_id TEXT,
      variables TEXT,
      use_layout INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      provider_id TEXT,
      from_override TEXT,
      reply_to TEXT,
      attachments TEXT,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000),
      updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now') * 1000)
    );
    CREATE UNIQUE INDEX IF NOT EXISTS et_slug_unique ON email_templates(slug);
  `);
  const db = drizzle({ client: sqlite, schema: { emailTemplatesSqlite } });
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
        NextlyError
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

    it("cannot delete the default layout", async () => {
      const layout = await service.createTemplate({
        name: "Default Layout",
        slug: "default-layout",
        kind: "layout",
        subject: "",
        htmlContent: "<div>{{content}}</div>",
        useLayout: false,
      });

      await expect(service.deleteTemplate(layout.id)).rejects.toThrow(
        NextlyError
      );

      await expect(service.deleteTemplate(layout.id)).rejects.toMatchObject({
        code: "BUSINESS_RULE_VIOLATION",
      });
    });

    it("allows deleting a custom (non-default) layout", async () => {
      const layout = await service.createTemplate({
        name: "Promo Layout",
        slug: "promo-layout",
        kind: "layout",
        subject: "",
        htmlContent: "<div>{{content}}</div>",
        useLayout: false,
      });

      await service.deleteTemplate(layout.id);

      await expect(service.getTemplate(layout.id)).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
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

    it("includes layout rows tagged with kind = 'layout'", async () => {
      await service.createTemplate({
        name: "Regular",
        slug: "regular-template",
        subject: "S",
        htmlContent: "<p>body</p>",
      });
      await service.createTemplate({
        name: "Default Layout",
        slug: "default-layout",
        kind: "layout",
        subject: "",
        htmlContent: "<div>{{content}}</div>",
        useLayout: false,
      });

      const list = await service.listTemplates();
      const bySlug = Object.fromEntries(list.map(t => [t.slug, t]));

      expect(bySlug["regular-template"].kind).toBe("template");
      expect(bySlug["default-layout"].kind).toBe("layout");
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

      // Pattern B in createTemplate(): unique-violation surfaces as DUPLICATE
      // (409) instead of the generic DATABASE_ERROR — friendlier for the admin
      // UI to render a "slug already exists" hint.
      await expect(
        service.createTemplate({
          name: "Duplicate",
          slug: "unique-slug",
          subject: "S2",
          htmlContent: "<p>body2</p>",
        })
      ).rejects.toMatchObject({ code: "DUPLICATE" });
    });
  });

  // ── Layout Resolution ───────────────────────────────────────────────────

  describe("getDefaultLayout()", () => {
    it("returns null when no layout exists", async () => {
      expect(await service.getDefaultLayout()).toBeNull();
    });

    it("returns the default-layout row when present", async () => {
      await service.createTemplate({
        name: "Default Layout",
        slug: "default-layout",
        kind: "layout",
        subject: "",
        htmlContent: "<div>{{content}}</div>",
        useLayout: false,
      });

      const layout = await service.getDefaultLayout();
      expect(layout).not.toBeNull();
      expect(layout!.slug).toBe("default-layout");
      expect(layout!.kind).toBe("layout");
    });
  });

  describe("getLayoutFor()", () => {
    it("falls back to the default layout when layoutId is unset", async () => {
      await service.createTemplate({
        name: "Default Layout",
        slug: "default-layout",
        kind: "layout",
        subject: "",
        htmlContent: "<div>{{content}}</div>",
        useLayout: false,
      });
      const tpl = await service.createTemplate({
        name: "Body",
        slug: "body-tpl",
        subject: "S",
        htmlContent: "<p>hi</p>",
      });

      const layout = await service.getLayoutFor(tpl);
      expect(layout!.slug).toBe("default-layout");
    });

    it("resolves an explicit layoutId", async () => {
      const custom = await service.createTemplate({
        name: "Promo Layout",
        slug: "promo-layout",
        kind: "layout",
        subject: "",
        htmlContent: "<main>{{content}}</main>",
        useLayout: false,
      });
      const tpl = await service.createTemplate({
        name: "Body",
        slug: "body-tpl-2",
        subject: "S",
        htmlContent: "<p>hi</p>",
        layoutId: custom.id,
      });

      const layout = await service.getLayoutFor(tpl);
      expect(layout!.slug).toBe("promo-layout");
    });
  });

  describe("legacy layout migration", () => {
    it("folds legacy _email-header/_email-footer rows into the default layout", async () => {
      // Seed pre-consolidation rows the way older builds stored them.
      await service.createTemplate({
        name: "Email Header",
        slug: "_email-header",
        subject: "",
        htmlContent: "<html><body>",
        useLayout: false,
      });
      await service.createTemplate({
        name: "Email Footer",
        slug: "_email-footer",
        subject: "",
        htmlContent: "</body></html>",
        useLayout: false,
      });

      await service.ensureBuiltInTemplates();

      const layout = await service.getDefaultLayout();
      expect(layout).not.toBeNull();
      expect(layout!.kind).toBe("layout");
      expect(layout!.htmlContent).toBe("<html><body>{{content}}</body></html>");

      // Legacy rows are removed.
      expect(await service.getTemplateBySlug("_email-header")).toBeNull();
      expect(await service.getTemplateBySlug("_email-footer")).toBeNull();
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
      const layout = await service.getTemplateBySlug("default-layout");

      expect(welcome).not.toBeNull();
      expect(passwordReset).not.toBeNull();
      expect(emailVerification).not.toBeNull();
      expect(layout).not.toBeNull();
      expect(layout!.kind).toBe("layout");
      // No legacy magic-slug rows are created.
      expect(await service.getTemplateBySlug("_email-header")).toBeNull();
      expect(await service.getTemplateBySlug("_email-footer")).toBeNull();
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

    it("injects the body into the layout at {{content}} when useLayout is true", async () => {
      await service.createTemplate({
        name: "Default Layout",
        slug: "default-layout",
        kind: "layout",
        subject: "",
        htmlContent: "<html><body>{{content}}</body></html>",
        useLayout: false,
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

    it("interpolates variables in the layout wrapper (not the body)", async () => {
      await service.createTemplate({
        name: "Default Layout",
        slug: "default-layout",
        kind: "layout",
        subject: "",
        htmlContent:
          "<header>{{appName}}</header>{{content}}<footer>{{year}} {{appName}}</footer>",
        useLayout: false,
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
      await service.createTemplate({
        name: "Default Layout",
        slug: "default-layout",
        kind: "layout",
        subject: "",
        htmlContent: "<header>H</header>{{content}}<footer>F</footer>",
        useLayout: false,
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
