/**
 * Written templates through the template service, on a real in-memory SQLite
 * table: how they are saved, refused and rendered.
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { createSqliteAdapter } from "@nextlyhq/adapter-sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDrizzleKitForDialect } from "../../../database/drizzle-kit-lazy";
import { emailBrandTables } from "../../../schemas/email-brand";
import { emailTemplatesSqlite } from "../../../schemas/email-templates/sqlite";
import { splitStatements } from "../../schema/pipeline/sql-statement-utils";
import { draftPreviewSchema } from "../draft-preview-request";
import { EmailTemplateService } from "../services/email-template-service";
import type { WrittenDocument } from "../written/document";

import { silentLogger } from "./template-ownership-fixture";

let adapter: DrizzleAdapter;
let service: EmailTemplateService;

beforeEach(async () => {
  adapter = createSqliteAdapter({ memory: true }) as unknown as DrizzleAdapter;
  await adapter.connect();
  const kit = await getDrizzleKitForDialect("sqlite");
  const statements = await kit.generateMigration(
    await kit.generateDrizzleJson({}),
    await kit.generateDrizzleJson({
      emailTemplatesSqlite,
      ...emailBrandTables("sqlite"),
    })
  );
  for (const statement of splitStatements(statements)) {
    await adapter.executeQuery(statement);
  }
  service = new EmailTemplateService(adapter, silentLogger);
  service.configureOwnership({ plugins: [] });
  await service.ensureBuiltInTemplates();
});

afterEach(async () => {
  await adapter.disconnect();
});

const BLOCKS: WrittenDocument = {
  version: 1,
  blocks: [
    { type: "heading", text: [{ type: "text", text: "Your order" }] },
    {
      type: "text",
      text: [
        { type: "text", text: "Thanks, " },
        { type: "chip", variable: "name", fallback: "friend" },
        { type: "text", text: "." },
      ],
    },
  ],
};

const written = (blocks: unknown = BLOCKS) =>
  service.createTemplate({
    name: "Order",
    slug: "order",
    subject: "Your order",
    htmlContent: "",
    format: "written",
    blocks: blocks as WrittenDocument,
  });

describe("a written template", () => {
  it("is stored with its blocks, and its HTML and plain text written from them", async () => {
    const created = await written();
    expect(created).toMatchObject({ format: "written", blocks: BLOCKS });
    expect(created.htmlContent).toContain("Your order</h1>");
    expect(created.plainTextContent).toContain("Your order");
  });

  it("renders from its blocks inside the layout, as a send does", async () => {
    const created = await written();
    const sent = await service.renderStored(created, { name: "Priya" });
    expect(sent.html).toContain("<!DOCTYPE html>");
    expect(sent.html).toContain(">Thanks, Priya.</p>");
    expect(sent.text).toBe("Your order\n\nThanks, Priya.\n\n");
    expect((await service.renderStored(created, {})).html).toContain(
      ">Thanks, friend.</p>"
    );
  });

  it("changes when its blocks do, and only then", async () => {
    const created = await written();
    const updated = await service.updateTemplate(created.id, {
      blocks: {
        version: 1,
        blocks: [
          { type: "heading", text: [{ type: "text", text: "Shipped" }] },
        ],
      },
    });
    expect(updated.htmlContent).toContain("Shipped</h1>");
    expect(updated.htmlContent).not.toContain("Your order");

    const renamed = await service.updateTemplate(created.id, {
      name: "Shipping",
    });
    expect(renamed.htmlContent).toBe(updated.htmlContent);
  });

  it("refuses blocks that don't pass their rules, naming where", async () => {
    await expect(
      written({
        version: 1,
        blocks: [
          {
            type: "button",
            label: [{ type: "text", text: "Go" }],
            link: { url: "javascript:alert(1)" },
          },
        ],
      })
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      publicData: {
        errors: [expect.objectContaining({ path: "blocks.blocks.0.link.url" })],
      },
    });
  });

  it("refuses HTML given in place of its blocks", async () => {
    const created = await written();
    await expect(
      service.updateTemplate(created.id, { htmlContent: "<p>x</p>" })
    ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
  });

  it("previews from unsaved blocks", async () => {
    const preview = await service.previewDraft(
      {
        subject: "Hi",
        htmlContent: "",
        plainTextContent: null,
        preheader: null,
        useLayout: false,
        kind: "template",
        layoutId: null,
        format: "written",
        blocks: BLOCKS,
      },
      { name: "Sam" }
    );
    expect(preview.html).toContain(">Thanks, Sam.</p>");
  });
});

describe("the same written email, wherever it is rendered", () => {
  it("renders identically for a send, a preview of the saved template and a preview of its draft", async () => {
    const created = await written();
    const data = { name: "Priya" };

    const sent = await service.renderStored(created, data);
    const previewed = await service.previewTemplate(created.id, data);
    const drafted = await service.previewDraft(
      {
        subject: created.subject,
        htmlContent: "",
        plainTextContent: null,
        preheader: created.preheader,
        useLayout: created.useLayout,
        kind: created.kind,
        layoutId: created.layoutId,
        format: "written",
        blocks: created.blocks,
      },
      data
    );

    expect(previewed).toEqual({ subject: sent.subject, html: sent.html });
    expect(drafted).toEqual(sent);
    // The control: it is the written body, in the layout.
    expect(sent.html).toContain(">Thanks, Priya.</p>");
    expect(sent.html).toContain("<!DOCTYPE html>");
  });
});

describe("a coded template", () => {
  it("is what a template is unless it is written", async () => {
    const coded = await service.createTemplate({
      name: "News",
      slug: "news",
      subject: "News",
      htmlContent: "<p>News</p>",
    });
    expect(coded).toMatchObject({ format: "code", blocks: null });
    const reset = await service.getTemplateBySlug("password-reset");
    expect(reset).toMatchObject({ format: "code", blocks: null });
  });

  it("is never turned into blocks", async () => {
    const coded = await service.createTemplate({
      name: "News",
      slug: "news",
      subject: "News",
      htmlContent: "<p>News</p>",
    });
    await expect(
      service.updateTemplate(coded.id, { blocks: BLOCKS })
    ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
    await expect(
      service.updateTemplate(coded.id, { format: "written" })
    ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
    expect(await service.getTemplate(coded.id)).toMatchObject({
      format: "code",
      htmlContent: "<p>News</p>",
    });
  });

  it("can't be created with blocks, and a layout can't be written", async () => {
    await expect(
      service.createTemplate({
        name: "News",
        slug: "news",
        subject: "News",
        htmlContent: "<p>News</p>",
        blocks: BLOCKS,
      })
    ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
    await expect(
      service.createTemplate({
        name: "Frame",
        slug: "frame",
        kind: "layout",
        subject: "",
        htmlContent: "{{content}}",
        format: "written",
        blocks: BLOCKS,
      })
    ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
  });
});

describe("a draft", () => {
  const draft = (fields: Record<string, unknown>) =>
    draftPreviewSchema.safeParse({
      template: {
        subject: "Hi",
        htmlContent: "",
        useLayout: false,
        kind: "template",
        ...fields,
      },
      data: {},
    });

  it.each([
    ["blocks on a coded draft", { format: "code", blocks: BLOCKS }],
    ["blocks with no format", { blocks: BLOCKS }],
    ["a written draft without blocks", { format: "written", blocks: null }],
    ["a written layout", { format: "written", blocks: BLOCKS, kind: "layout" }],
    [
      "a written partial",
      { format: "written", blocks: BLOCKS, kind: "partial" },
    ],
  ])("refuses %s, as a save does", async (_case, fields) => {
    expect(draft(fields).success).toBe(false);
    await expect(
      service.createTemplate({
        name: "Draft",
        slug: "draft",
        subject: "Hi",
        htmlContent: "",
        ...(fields as object),
      })
    ).rejects.toMatchObject({ code: "BUSINESS_RULE_VIOLATION" });
  });

  it("accepts what a save accepts", () => {
    // The control: the refusals above are about the combination, not the fields.
    expect(draft({ format: "written", blocks: BLOCKS }).success).toBe(true);
    expect(draft({ format: "code", blocks: null }).success).toBe(true);
    expect(draft({}).success).toBe(true);
  });
});

describe("a written template a plugin later claims", () => {
  it("is coded again once reset to the plugin's version", async () => {
    const created = await service.createTemplate({
      name: "Paid",
      slug: "orders-paid",
      subject: "Paid",
      htmlContent: "",
      format: "written",
      blocks: BLOCKS,
    });
    const claimed = new EmailTemplateService(adapter, silentLogger);
    claimed.configureOwnership({
      plugins: [
        {
          name: "@acme/plugin-orders",
          templates: [
            {
              slug: "orders-paid",
              name: "Order paid",
              subject: "Thanks for your payment",
              htmlContent: "<p>We received {{amount}}.</p>",
            },
          ],
        },
      ],
    });
    await claimed.ensureBuiltInTemplates();
    expect(await claimed.getTemplate(created.id)).toMatchObject({
      overridden: true,
      format: "written",
    });

    await claimed.resetTemplate(created.id);

    const reset = await claimed.getTemplate(created.id);
    expect(reset).toMatchObject({
      overridden: false,
      format: "code",
      blocks: null,
      htmlContent: "<p>We received {{amount}}.</p>",
    });
    const sent = await claimed.renderStored(reset, { amount: "$5" });
    expect(sent.html).toContain("We received $5.");
    expect(sent.html).not.toContain("Thanks, ");
  });
});
