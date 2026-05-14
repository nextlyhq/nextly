import { beforeEach, describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { ComponentConfig } from "../../components/config/types";
import type { SingleConfig } from "../../singles/config/types";

import type { Registries } from "./collect";
import type { ModuleContributor } from "./define-module";
import {
  __resetGenerateCacheForTests,
  generate,
  type GenerateArgs,
} from "./pipeline";

function makeRegistries(args: {
  collections?: readonly CollectionConfig[];
  singles?: readonly SingleConfig[];
  components?: readonly ComponentConfig[];
}): Registries {
  return {
    collections: { getAllCollections: async () => args.collections ?? [] },
    singles: { getAllSingles: async () => args.singles ?? [] },
    components: { getAllComponents: async () => args.components ?? [] },
  };
}

const baseArgs = (overrides: Partial<GenerateArgs> = {}): GenerateArgs => ({
  registries: makeRegistries({}),
  modules: [],
  info: { title: "Test API", version: "1.0.0" },
  schemaHash: "h-empty",
  format: "json",
  ...overrides,
});

const Posts: CollectionConfig = {
  slug: "posts",
  labels: { singular: "Post", plural: "Posts" },
  fields: [{ name: "title", type: "text", required: true }],
};

const SiteSettings: SingleConfig = {
  slug: "site-settings",
  label: { singular: "Site Settings" },
  fields: [{ name: "siteName", type: "text" }],
};

beforeEach(() => {
  __resetGenerateCacheForTests();
});

describe("generate — minimal", () => {
  it("returns a valid OAS 3.1 JSON document with info passed through", async () => {
    const result = await generate(baseArgs());
    expect(result.contentType).toBe("application/json");
    const doc = JSON.parse(result.body.toString("utf8"));
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toEqual({ title: "Test API", version: "1.0.0" });
  });

  it("always emits envelope + error + security components, even for empty registries", async () => {
    const result = await generate(baseArgs());
    const doc = JSON.parse(result.body.toString("utf8"));
    expect(doc.components.schemas.PaginationMeta).toBeDefined();
    expect(doc.components.schemas.CountResponse).toBeDefined();
    expect(doc.components.schemas.DeleteResponse).toBeDefined();
    expect(doc.components.schemas.Error).toBeDefined();
    expect(doc.components.responses.Unauthorized).toBeDefined();
    expect(doc.components.securitySchemes.bearerAuth).toBeDefined();
    expect(doc.components.securitySchemes.cookieAuth).toBeDefined();
    expect(doc.components.securitySchemes.apiKeyAuth).toBeDefined();
  });

  it("returns a Buffer body", async () => {
    const result = await generate(baseArgs());
    expect(Buffer.isBuffer(result.body)).toBe(true);
  });

  it('etag matches `W/"<cacheKey>"` pattern', async () => {
    const result = await generate(baseArgs());
    expect(result.etag).toMatch(/^W\/"[a-f0-9]+:json"$/);
  });
});

describe("generate — collections + singles wiring", () => {
  it("emits all six collection operations as path entries", async () => {
    const result = await generate(
      baseArgs({
        registries: makeRegistries({ collections: [Posts] }),
        schemaHash: "h-posts",
      })
    );
    const doc = JSON.parse(result.body.toString("utf8"));
    expect(doc.paths["/api/posts"]).toBeDefined();
    expect(Object.keys(doc.paths["/api/posts"]).sort()).toEqual([
      "get",
      "post",
    ]);
    expect(doc.paths["/api/posts/{id}"]).toBeDefined();
    expect(doc.paths["/api/posts/count"]).toBeDefined();
    expect(doc.components.schemas.Post).toBeDefined();
    expect(doc.components.schemas.ListResponsePost).toBeDefined();
  });

  it("emits two single operations as path entries", async () => {
    const result = await generate(
      baseArgs({
        registries: makeRegistries({ singles: [SiteSettings] }),
        schemaHash: "h-singles",
      })
    );
    const doc = JSON.parse(result.body.toString("utf8"));
    expect(doc.paths["/api/site-settings"]).toBeDefined();
    expect(Object.keys(doc.paths["/api/site-settings"]).sort()).toEqual([
      "get",
      "patch",
    ]);
    expect(doc.components.schemas.SiteSettings).toBeDefined();
    expect(doc.components.schemas.UpdateSiteSettings).toBeDefined();
  });
});

describe("generate — module contributions", () => {
  const healthModule: ModuleContributor = {
    name: "health",
    tag: { name: "Health", description: "Service liveness." },
    operations: [
      {
        path: "/api/health",
        method: "GET",
        versions: ["1.0"],
        operationId: "health.get",
        tags: ["Health"],
        parameters: [],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/HealthResponse" },
              },
            },
          },
        },
        security: [],
        extensions: {},
      },
    ],
    schemas: {
      HealthResponse: {
        type: "object",
        required: ["ok"],
        properties: { ok: { type: "boolean" } },
      },
    },
  };

  it("merges module operations into the paths block", async () => {
    const result = await generate(
      baseArgs({ modules: [healthModule], schemaHash: "h-mod" })
    );
    const doc = JSON.parse(result.body.toString("utf8"));
    expect(doc.paths["/api/health"].get.operationId).toBe("health.get");
  });

  it("merges module schemas into components.schemas", async () => {
    const result = await generate(
      baseArgs({ modules: [healthModule], schemaHash: "h-mod" })
    );
    const doc = JSON.parse(result.body.toString("utf8"));
    expect(doc.components.schemas.HealthResponse).toBeDefined();
  });

  it("merges module tags into the doc-level tags array", async () => {
    const result = await generate(
      baseArgs({ modules: [healthModule], schemaHash: "h-mod" })
    );
    const doc = JSON.parse(result.body.toString("utf8"));
    expect(doc.tags).toEqual(
      expect.arrayContaining([
        { name: "Health", description: "Service liveness." },
      ])
    );
  });
});

describe("generate — cache behavior", () => {
  it("second call with identical args returns the same Buffer reference (cache hit)", async () => {
    const args = baseArgs({ schemaHash: "h-cache" });
    const a = await generate(args);
    const b = await generate(args);
    expect(b.body).toBe(a.body);
    expect(b.etag).toBe(a.etag);
  });

  it("different schemaHash produces a cache miss (different buffer)", async () => {
    const a = await generate(baseArgs({ schemaHash: "h-one" }));
    const b = await generate(baseArgs({ schemaHash: "h-two" }));
    expect(b.body).not.toBe(a.body);
    expect(b.etag).not.toBe(a.etag);
  });

  it("json and yaml share the same schemaHash but cache independently", async () => {
    const json = await generate(
      baseArgs({ schemaHash: "h-fmt", format: "json" })
    );
    const yaml = await generate(
      baseArgs({ schemaHash: "h-fmt", format: "yaml" })
    );
    expect(json.contentType).toBe("application/json");
    expect(yaml.contentType).toBe("application/yaml");
    expect(json.body).not.toBe(yaml.body);
    expect(json.etag).not.toBe(yaml.etag);
  });

  it("changing info or modules also produces a new cache entry", async () => {
    const a = await generate(
      baseArgs({
        schemaHash: "h-same",
        info: { title: "A", version: "1.0.0" },
      })
    );
    const b = await generate(
      baseArgs({
        schemaHash: "h-same",
        info: { title: "B", version: "1.0.0" },
      })
    );
    expect(b.body).not.toBe(a.body);
  });

  it("yaml output starts with `openapi: 3.1.0` line", async () => {
    const result = await generate(
      baseArgs({ schemaHash: "h-yaml", format: "yaml" })
    );
    expect(result.body.toString("utf8").startsWith("openapi: 3.1.0")).toBe(
      true
    );
  });
});
