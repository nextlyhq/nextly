import { afterEach, describe, expect, it } from "vitest";

import type { FieldConfig } from "@nextly/collections";
import type { DynamicCollectionRecord } from "../../../schemas/dynamic-collections/types";
import {
  clearFieldTypes,
  registerFieldType,
} from "../field-types/field-type-registry";
import { ZodGenerator } from "./zod-generator";

const createCollection = (
  fields: FieldConfig[],
  overrides?: Partial<DynamicCollectionRecord>
): DynamicCollectionRecord =>
  ({
    slug: "article",
    labels: { singular: "Article", plural: "Articles" },
    description: "Article collection description",
    timestamps: true,
    fields,
    ...overrides,
  }) as unknown as DynamicCollectionRecord;

/**
 * Extracts a field's generated schema definition line from the schema code.
 * e.g., returns "z.string().min(5).max(50)" for a line `  title: z.string().min(5).max(50),`
 */
function extractFieldSchema(
  code: string,
  fieldName: string
): string | undefined {
  const line = code
    .split("\n")
    .find(l => l.trimStart().startsWith(`${fieldName}:`));
  if (!line) return undefined;
  const afterColon = line.substring(line.indexOf(":") + 1).trim();
  return afterColon.endsWith(",") ? afterColon.slice(0, -1) : afterColon;
}

/**
 * Extracts the inner schema string of a nested group field `groupName`.
 * e.g., for `  meta: z.object({ title: z.string() }),`, returns `title: z.string()`
 */
function extractGroupObjectInner(
  code: string,
  groupName: string
): string | undefined {
  const line = code
    .split("\n")
    .find(l => l.trimStart().startsWith(`${groupName}:`));
  if (!line) return undefined;
  const trimmed = line.trim();
  const prefix = `${groupName}: z.object({`;
  const startIdx = trimmed.indexOf(prefix);
  if (startIdx === -1) return undefined;
  const afterPrefix = trimmed.substring(startIdx + prefix.length);
  return afterPrefix.replace(/\s*\}\),?$/, "").trim();
}

afterEach(() => {
  clearFieldTypes();
});

describe("ZodGenerator — Top-level vs Nested equivalence", () => {
  const testCases: Array<{
    kind: string;
    field: FieldConfig;
  }> = [
    {
      kind: "text with min/max and required",
      field: {
        name: "testField",
        type: "text",
        minLength: 5,
        maxLength: 100,
        required: true,
      } as FieldConfig,
    },
    {
      kind: "text with hasMany and min/max rows",
      field: {
        name: "testField",
        type: "text",
        hasMany: true,
        minRows: 2,
        maxRows: 10,
        required: false,
      } as FieldConfig,
    },
    {
      kind: "textarea with min/max length",
      field: {
        name: "testField",
        type: "textarea",
        minLength: 10,
        maxLength: 500,
        required: true,
      } as FieldConfig,
    },
    {
      kind: "password with min/max length",
      field: {
        name: "testField",
        type: "password",
        minLength: 8,
        maxLength: 64,
        required: true,
      } as FieldConfig,
    },
    {
      kind: "email required",
      field: {
        name: "testField",
        type: "email",
        required: true,
      } as FieldConfig,
    },
    {
      kind: "richtext optional",
      field: {
        name: "testField",
        type: "richText",
        required: false,
      } as FieldConfig,
    },
    {
      kind: "code field",
      field: {
        name: "testField",
        type: "code",
        required: true,
      } as FieldConfig,
    },
    {
      kind: "number with min/max",
      field: {
        name: "testField",
        type: "number",
        min: 0,
        max: 100,
        required: true,
      } as FieldConfig,
    },
    {
      kind: "number with hasMany",
      field: {
        name: "testField",
        type: "number",
        hasMany: true,
        minRows: 1,
        maxRows: 5,
        required: false,
      } as FieldConfig,
    },
    {
      kind: "checkbox field",
      field: {
        name: "testField",
        type: "checkbox",
        required: true,
      } as FieldConfig,
    },
    {
      kind: "date field",
      field: {
        name: "testField",
        type: "date",
        required: true,
      } as FieldConfig,
    },
    {
      kind: "select field with options",
      field: {
        name: "testField",
        type: "select",
        options: [
          { label: "Draft", value: "draft" },
          { label: "Published", value: "published" },
          { label: "Archived", value: "archived" },
        ],
        required: true,
      } as FieldConfig,
    },
    {
      kind: "select field with hasMany",
      field: {
        name: "testField",
        type: "select",
        options: [
          { label: "Tech", value: "tech" },
          { label: "News", value: "news" },
        ],
        hasMany: true,
        required: false,
      } as FieldConfig,
    },
    {
      kind: "radio field with options",
      field: {
        name: "testField",
        type: "radio",
        options: [
          { label: "Light", value: "light" },
          { label: "Dark", value: "dark" },
        ],
        required: true,
      } as FieldConfig,
    },
    {
      kind: "upload field single",
      field: {
        name: "testField",
        type: "upload",
        required: true,
      } as FieldConfig,
    },
    {
      kind: "upload field with hasMany",
      field: {
        name: "testField",
        type: "upload",
        hasMany: true,
        required: false,
      } as FieldConfig,
    },
    {
      kind: "relationship field single",
      field: {
        name: "testField",
        type: "relationship",
        relationTo: "users",
        required: true,
      } as FieldConfig,
    },
    {
      kind: "relationship field polymorphic hasMany",
      field: {
        name: "testField",
        type: "relationship",
        relationTo: ["users", "teams"],
        hasMany: true,
        required: false,
      } as FieldConfig,
    },
    {
      kind: "json field",
      field: {
        name: "testField",
        type: "json",
        required: false,
      } as FieldConfig,
    },
    {
      kind: "chips field with min/max",
      field: {
        name: "testField",
        type: "chips",
        minChips: 1,
        maxChips: 5,
        required: true,
      } as FieldConfig,
    },
  ];

  for (const { kind, field } of testCases) {
    it(`produces equivalent Zod schema top-level vs nested for ${kind}`, () => {
      const gen = new ZodGenerator({ includeComments: false });

      // Top-level field
      const topCol = createCollection([field]);
      const topResult = gen.generateSchema(topCol);
      const topSchema = extractFieldSchema(topResult.code, "testField");

      // Nested inside a group
      const nestedGroupField: FieldConfig = {
        name: "nestedGroup",
        type: "group",
        required: true,
        fields: [field],
      } as FieldConfig;
      const nestedCol = createCollection([nestedGroupField]);
      const nestedResult = gen.generateSchema(nestedCol);
      const nestedInner = extractGroupObjectInner(
        nestedResult.code,
        "nestedGroup"
      );

      expect(topSchema).toBeDefined();
      expect(nestedInner).toBeDefined();
      expect(nestedInner).toBe(`testField: ${topSchema}`);
    });
  }
});

describe("ZodGenerator — Individual Field Generation", () => {
  const gen = new ZodGenerator({ includeComments: false });

  it("generates string validation with min and max for text fields", () => {
    const col = createCollection([
      {
        name: "title",
        type: "text",
        minLength: 3,
        maxLength: 50,
        required: true,
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("title: z.string().min(3).max(50),");
  });

  it("generates array of strings for text fields with hasMany", () => {
    const col = createCollection([
      {
        name: "tags",
        type: "text",
        hasMany: true,
        minRows: 1,
        maxRows: 5,
        required: false,
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain(
      "tags: z.array(z.string()).min(1).max(5).nullish(),"
    );
  });

  it("generates number schema with min and max bounds", () => {
    const col = createCollection([
      {
        name: "rating",
        type: "number",
        min: 1,
        max: 5,
        required: true,
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("rating: z.number().min(1).max(5),");
  });

  it("generates enum schema for select fields with options", () => {
    const col = createCollection([
      {
        name: "status",
        type: "select",
        options: [
          { label: "Active", value: "active" },
          { label: "Pending", value: "pending" },
          { label: "Disabled", value: "disabled" },
        ],
        required: true,
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain(
      'status: z.enum(["active", "pending", "disabled"]),'
    );
  });

  it("falls back to z.string() for select fields with empty options", () => {
    const col = createCollection([
      {
        name: "emptySelect",
        type: "select",
        options: [],
        required: true,
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("emptySelect: z.string(),");
  });

  it("generates enum schema for radio fields", () => {
    const col = createCollection([
      {
        name: "plan",
        type: "radio",
        options: [
          { label: "Free", value: "free" },
          { label: "Pro", value: "pro" },
        ],
        required: true,
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain('plan: z.enum(["free", "pro"]),');
  });

  it("generates datetime schema for date fields", () => {
    const col = createCollection([
      {
        name: "publishedAt",
        type: "date",
        required: false,
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("publishedAt: z.string().datetime().nullish(),");
  });

  it("generates boolean schema for checkbox fields", () => {
    const col = createCollection([
      {
        name: "isFeatured",
        type: "checkbox",
        required: true,
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("isFeatured: z.boolean(),");
  });

  it("generates email validation for email fields", () => {
    const col = createCollection([
      {
        name: "contactEmail",
        type: "email",
        required: true,
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("contactEmail: z.string().email(),");
  });

  it("generates polymorphic schema for upload fields with array relationTo", () => {
    const col = createCollection([
      {
        name: "attachment",
        type: "upload",
        relationTo: ["images", "documents"],
        required: true,
      } as unknown as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain(
      "attachment: z.object({ relationTo: z.string(), value: z.string() }),"
    );
  });

  it("generates polymorphic array schema for upload fields with relationTo and hasMany", () => {
    const col = createCollection([
      {
        name: "attachments",
        type: "upload",
        relationTo: ["images", "documents"],
        hasMany: true,
        required: false,
      } as unknown as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("attachments: z.array(z.string()).nullish(),");
  });

  it("generates polymorphic array schema for relationship fields with hasMany", () => {
    const col = createCollection([
      {
        name: "relatedItems",
        type: "relationship",
        relationTo: ["posts", "pages"],
        hasMany: true,
        required: true,
      } as unknown as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain(
      "relatedItems: z.array(z.object({ relationTo: z.string(), value: z.string() })),"
    );
  });

  it("generates chips schema with minChips and maxChips", () => {
    const col = createCollection([
      {
        name: "keywords",
        type: "chips",
        minChips: 2,
        maxChips: 8,
        required: true,
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("keywords: z.array(z.string()).min(2).max(8),");
  });

  it("generates z.any() for JSON fields", () => {
    const col = createCollection([
      {
        name: "metadata",
        type: "json",
        required: false,
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("metadata: z.any().nullish(),");
  });

  it("generates empty object schema for groups without data fields", () => {
    const col = createCollection([
      {
        name: "emptyGroup",
        type: "group",
        fields: [],
        required: true,
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("emptyGroup: z.object({}),");
  });
});

describe("ZodGenerator — Nested Recursion Depth", () => {
  const gen = new ZodGenerator({ includeComments: false });

  it("handles group nested inside another group", () => {
    const col = createCollection([
      {
        name: "level1",
        type: "group",
        required: true,
        fields: [
          {
            name: "level2",
            type: "group",
            required: true,
            fields: [
              {
                name: "deepText",
                type: "text",
                minLength: 4,
                required: true,
              } as FieldConfig,
            ],
          } as FieldConfig,
        ],
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain(
      "level1: z.object({ level2: z.object({ deepText: z.string().min(4) }) }),"
    );
  });

  it("handles repeater nested inside a group", () => {
    const col = createCollection([
      {
        name: "configGroup",
        type: "group",
        required: true,
        fields: [
          {
            name: "items",
            type: "repeater",
            minRows: 1,
            maxRows: 3,
            required: true,
            fields: [
              {
                name: "key",
                type: "text",
                required: true,
              } as FieldConfig,
              {
                name: "value",
                type: "number",
                required: false,
              } as FieldConfig,
            ],
          } as FieldConfig,
        ],
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain(
      "configGroup: z.object({ items: z.array(z.object({ key: z.string(), value: z.number().nullish() })).min(1).max(3) }),"
    );
  });

  it("handles group nested inside a repeater", () => {
    const col = createCollection([
      {
        name: "sections",
        type: "repeater",
        required: true,
        fields: [
          {
            name: "header",
            type: "group",
            required: true,
            fields: [
              {
                name: "title",
                type: "text",
                required: true,
              } as FieldConfig,
            ],
          } as FieldConfig,
        ],
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain(
      "sections: z.array(z.object({ header: z.object({ title: z.string() }) })),"
    );
  });
});

describe("ZodGenerator — Plugin Fields & Storage Fallback", () => {
  it("emits custom plugin zod schema with parentheses when provided", () => {
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "@acme/ratings#Rating",
      codegen: {
        zodSchema: () => "z.number().min(1).max(5)",
      },
    });

    const gen = new ZodGenerator({ includeComments: false });
    const col = createCollection([
      {
        name: "userScore",
        type: "rating",
        required: false,
      } as unknown as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("userScore: (z.number().min(1).max(5)).nullish(),");
  });

  it("falls back to storage type schema when plugin declares no zodSchema", () => {
    registerFieldType({
      type: "custom-count",
      storage: "number",
      component: "@acme/count#Count",
    });

    const gen = new ZodGenerator({ includeComments: false });
    const col = createCollection([
      {
        name: "count",
        type: "custom-count",
        required: true,
      } as unknown as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("count: z.number(),");
  });

  it("handles plugin storage fallback inside nested group", () => {
    registerFieldType({
      type: "custom-badge",
      storage: "text",
      component: "@acme/badge#Badge",
    });

    const gen = new ZodGenerator({ includeComments: false });
    const col = createCollection([
      {
        name: "details",
        type: "group",
        required: true,
        fields: [
          {
            name: "badge",
            type: "custom-badge",
            required: false,
          } as unknown as FieldConfig,
        ],
      } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain(
      "details: z.object({ badge: z.string().nullish() }),"
    );
  });
});

describe("ZodGenerator — Schema Variants & Exports", () => {
  it("generates Base, CreateInput (omits id/timestamps), and UpdateInput (partial except id) schemas", () => {
    const gen = new ZodGenerator({
      includeComments: true,
      generateTypes: true,
    });
    const col = createCollection([
      { name: "title", type: "text", required: true } as FieldConfig,
      { name: "body", type: "textarea", required: false } as FieldConfig,
    ]);
    const { code, filename, collectionSlug } = gen.generateSchema(col);

    expect(filename).toBe("article.zod.ts");
    expect(collectionSlug).toBe("article");

    // Base Schema
    expect(code).toContain("export const ArticleSchema = z.object({");
    expect(code).toContain("  id: z.string(),");
    expect(code).toContain("  title: z.string(),");
    expect(code).toContain("  body: z.string().nullish(),");
    expect(code).toContain("  createdAt: z.string().datetime(),");
    expect(code).toContain("  updatedAt: z.string().datetime(),");

    // Create Input Schema
    expect(code).toContain(
      "export const ArticleCreateInputSchema = ArticleSchema.omit({\n  id: true,\n  createdAt: true,\n  updatedAt: true,\n});"
    );

    // Update Input Schema
    expect(code).toContain(
      "export const ArticleUpdateInputSchema = ArticleSchema.partial().required({\n  id: true,\n});"
    );

    // Type Exports
    expect(code).toContain(
      "export type Article = z.infer<typeof ArticleSchema>;"
    );
    expect(code).toContain(
      "export type ArticleCreateInput = z.infer<typeof ArticleCreateInputSchema>;"
    );
    expect(code).toContain(
      "export type ArticleUpdateInput = z.infer<typeof ArticleUpdateInputSchema>;"
    );
  });

  it("respects schemaPrefix option", () => {
    const gen = new ZodGenerator({ schemaPrefix: "Cms" });
    const col = createCollection([
      { name: "title", type: "text", required: true } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).toContain("export const CmsArticleSchema = z.object({");
    expect(code).toContain(
      "export const CmsArticleCreateInputSchema = CmsArticleSchema.omit({"
    );
    expect(code).toContain(
      "export const CmsArticleUpdateInputSchema = CmsArticleSchema.partial().required({"
    );
  });

  it("omits type exports when generateTypes is false", () => {
    const gen = new ZodGenerator({ generateTypes: false });
    const col = createCollection([
      { name: "title", type: "text", required: true } as FieldConfig,
    ]);
    const { code } = gen.generateSchema(col);
    expect(code).not.toContain("export type Article =");
  });

  it("generates index file with sorted exports for multiple collections", () => {
    const gen = new ZodGenerator();
    const cols = [
      createCollection([], { slug: "posts" }),
      createCollection([], { slug: "authors" }),
      createCollection([], { slug: "categories" }),
    ];

    const indexFile = gen.generateIndexFile(cols);
    expect(indexFile.filename).toBe("index.ts");
    expect(indexFile.code).toContain('export * from "./authors.zod";');
    expect(indexFile.code).toContain('export * from "./categories.zod";');
    expect(indexFile.code).toContain('export * from "./posts.zod";');

    const authorIdx = indexFile.code.indexOf('"./authors.zod"');
    const catIdx = indexFile.code.indexOf('"./categories.zod"');
    const postIdx = indexFile.code.indexOf('"./posts.zod"');
    expect(authorIdx).toBeLessThan(catIdx);
    expect(catIdx).toBeLessThan(postIdx);
  });

  it("generates all schemas with generateAllSchemas", () => {
    const gen = new ZodGenerator();
    const cols = [
      createCollection([], { slug: "posts" }),
      createCollection([], { slug: "authors" }),
    ];
    const results = gen.generateAllSchemas(cols);
    expect(results).toHaveLength(2);
    expect(results[0].collectionSlug).toBe("posts");
    expect(results[1].collectionSlug).toBe("authors");
  });
});
