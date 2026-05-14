import { describe, expect, it } from "vitest";

import type { SingleConfig } from "../../singles/config/types";
import type { OperationIR } from "../ir/types";

import { inferFromSingles } from "./infer-singles";

const SiteSettings: SingleConfig = {
  slug: "site-settings",
  label: { singular: "Site Settings" },
  fields: [
    { name: "siteName", type: "text", required: true },
    { name: "tagline", type: "text" },
  ],
};

function byOp(operations: readonly OperationIR[]) {
  return Object.fromEntries(operations.map(op => [op.operationId, op]));
}

describe("inferFromSingles — operations", () => {
  it("emits exactly two operations per single (read + update)", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    const ids = operations.map(o => o.operationId).sort();
    expect(ids).toEqual(["site-settings.read", "site-settings.update"]);
  });

  it("uses label.singular as the tag", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    for (const op of operations) {
      expect(op.tags).toEqual(["Site Settings"]);
    }
  });

  it("falls back to slug when label.singular is missing", () => {
    const NoLabel: SingleConfig = {
      slug: "header",
      fields: [{ name: "title", type: "text" }],
    };
    const { operations } = inferFromSingles([NoLabel]);
    expect(operations[0]?.tags).toEqual(["header"]);
  });

  it("paths are both /api/{slug} (no path param — singles have no id segment)", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    for (const op of operations) {
      expect(op.path).toBe("/api/site-settings");
    }
  });

  it("methods are GET and PATCH", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    const ops = byOp(operations);
    expect(ops["site-settings.read"]?.method).toBe("GET");
    expect(ops["site-settings.update"]?.method).toBe("PATCH");
  });

  it("neither operation has an `id` path parameter", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    for (const op of operations) {
      const hasId = op.parameters.some(p => p.name === "id" && p.in === "path");
      expect(hasId).toBe(false);
    }
  });

  it("read accepts populate and locale query params", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    const read = byOp(operations)["site-settings.read"]!;
    const names = read.parameters.map(p => p.name).sort();
    expect(names).toEqual(["locale", "populate"]);
  });

  it("update has no query params (single is fully addressable at base path)", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    const update = byOp(operations)["site-settings.update"]!;
    expect(update.parameters).toEqual([]);
  });

  it("every operation declares the three security schemes", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    for (const op of operations) {
      expect(op.security).toEqual([
        { bearerAuth: [] },
        { cookieAuth: [] },
        { apiKeyAuth: [] },
      ]);
    }
  });
});

describe("inferFromSingles — request bodies + responses", () => {
  it("update requestBody references UpdateSiteSettings", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    const update = byOp(operations)["site-settings.update"]!;
    const schema = update.requestBody?.content["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/UpdateSiteSettings",
    });
    expect(update.requestBody?.required).toBe(true);
  });

  it("read has no request body", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    expect(byOp(operations)["site-settings.read"]?.requestBody).toBeUndefined();
  });

  it("read 200 returns the bare single schema", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    const read = byOp(operations)["site-settings.read"]!;
    const schema = (
      read.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({ $ref: "#/components/schemas/SiteSettings" });
  });

  it("update 200 references MutationResponseSiteSettings", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    const update = byOp(operations)["site-settings.update"]!;
    const schema = (
      update.responses["200"] as {
        content?: { "application/json"?: { schema?: unknown } };
      }
    ).content?.["application/json"]?.schema;
    expect(schema).toEqual({
      $ref: "#/components/schemas/MutationResponseSiteSettings",
    });
  });

  it("each op references Unauthorized / Forbidden / RateLimited / InternalServerError", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    for (const op of operations) {
      expect(op.responses["401"]).toEqual({
        $ref: "#/components/responses/Unauthorized",
      });
      expect(op.responses["403"]).toEqual({
        $ref: "#/components/responses/Forbidden",
      });
      expect(op.responses["429"]).toEqual({
        $ref: "#/components/responses/RateLimited",
      });
      expect(op.responses["500"]).toEqual({
        $ref: "#/components/responses/InternalServerError",
      });
    }
  });

  it("update includes 400 ValidationError (read does not)", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    const ops = byOp(operations);
    expect(ops["site-settings.update"]?.responses["400"]).toEqual({
      $ref: "#/components/responses/ValidationError",
    });
    expect(ops["site-settings.read"]?.responses["400"]).toBeUndefined();
  });

  it("no 404 on singles (the resource is auto-initialized on read)", () => {
    const { operations } = inferFromSingles([SiteSettings]);
    for (const op of operations) {
      expect(op.responses["404"]).toBeUndefined();
    }
  });
});

describe("inferFromSingles — schemas", () => {
  it("emits SiteSettings (read) and UpdateSiteSettings — NO Create", () => {
    const { schemas } = inferFromSingles([SiteSettings]);
    expect(schemas.SiteSettings).toBeDefined();
    expect(schemas.UpdateSiteSettings).toBeDefined();
    expect(schemas.CreateSiteSettings).toBeUndefined();
  });

  it("emits MutationResponseSiteSettings — NOT List / Bulk", () => {
    const { schemas } = inferFromSingles([SiteSettings]);
    expect(schemas.MutationResponseSiteSettings).toBeDefined();
    expect(schemas.ListResponseSiteSettings).toBeUndefined();
    expect(schemas.BulkResponseSiteSettings).toBeUndefined();
  });

  it("SiteSettings (read) includes readOnly id + createdAt + updatedAt", () => {
    const { schemas } = inferFromSingles([SiteSettings]);
    const site = schemas.SiteSettings as {
      properties?: Record<string, Record<string, unknown>>;
    };
    expect(site.properties?.id).toMatchObject({
      type: "string",
      readOnly: true,
    });
    expect(site.properties?.createdAt).toMatchObject({
      type: "string",
      format: "date-time",
      readOnly: true,
    });
    expect(site.properties?.updatedAt).toMatchObject({
      type: "string",
      format: "date-time",
      readOnly: true,
    });
  });

  it("adds _status enum when status: true", () => {
    const Versioned: SingleConfig = {
      ...SiteSettings,
      status: true,
    };
    const { schemas } = inferFromSingles([Versioned]);
    const site = schemas.SiteSettings as {
      properties?: Record<string, unknown>;
    };
    expect(site.properties?._status).toEqual({
      type: "string",
      enum: ["draft", "published"],
      readOnly: true,
    });
  });

  it("registers nested repeater item schemas via deriveNestedItemSchemas", () => {
    const WithRepeater: SingleConfig = {
      slug: "header",
      label: { singular: "Header" },
      fields: [
        {
          name: "links",
          type: "repeater",
          fields: [
            { name: "label", type: "text" },
            { name: "url", type: "text" },
          ],
        },
      ],
    };
    const { schemas } = inferFromSingles([WithRepeater]);
    expect(schemas.Header__LinksItem).toBeDefined();
  });

  it("returns empty arrays / schemas for empty input", () => {
    const { operations, schemas } = inferFromSingles([]);
    expect(operations).toEqual([]);
    expect(schemas).toEqual({});
  });
});
