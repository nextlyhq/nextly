import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CollectionConfig } from "../collections/config/define-collection";
import type { ComponentConfig } from "../components/config/types";
import type { SingleConfig } from "../singles/config/types";
import { __resetGenerateCacheForTests } from "../openapi/generator/pipeline";

// ─────────────────────────────────────────────────────────────────────
// Mocks
//
// We swap the DI accessors so the handler resolves the registry services
// to in-memory fixtures instead of the real DI container. This keeps the
// test independent of a database while still exercising every path the
// handler takes (registries → generate → ETag → serialize).
// ─────────────────────────────────────────────────────────────────────

const fixture: {
  collections: CollectionConfig[];
  singles: SingleConfig[];
  components: ComponentConfig[];
  servicesRegistered: boolean;
} = {
  collections: [],
  singles: [],
  components: [],
  servicesRegistered: true,
};

vi.mock("../di", () => ({
  isServicesRegistered: () => fixture.servicesRegistered,
  getService: (name: string) => {
    if (name === "collectionRegistryService") {
      return { getAllCollections: async () => fixture.collections };
    }
    if (name === "singleRegistryService") {
      return { getAllSingles: async () => fixture.singles };
    }
    if (name === "componentRegistryService") {
      return { getAllComponents: async () => fixture.components };
    }
    throw new Error(`Unexpected DI lookup in test: ${name}`);
  },
}));

import { openApiHandler } from "./openapi";

beforeEach(() => {
  __resetGenerateCacheForTests();
  fixture.collections = [];
  fixture.singles = [];
  fixture.components = [];
  fixture.servicesRegistered = true;
});

describe("openApiHandler", () => {
  describe("GET /openapi.json", () => {
    it("returns OAS 3.1 JSON with envelope + standard components", async () => {
      fixture.collections = [
        {
          slug: "posts",
          labels: { singular: "Post", plural: "Posts" },
          fields: [{ name: "title", type: "text", required: true }],
        },
      ];

      const res = await openApiHandler.GET(
        new Request("http://localhost/admin/api/openapi/openapi.json")
      );

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/json/);
      expect(res.headers.get("etag")).toMatch(/^W\//);
      expect(res.headers.get("cache-control")).toBe(
        "public, max-age=60, must-revalidate"
      );
      expect(res.headers.get("vary")).toBe("accept, accept-encoding");

      const body = (await res.json()) as {
        openapi: string;
        info: { title: string; version: string };
        paths: Record<string, unknown>;
        components: { schemas: Record<string, unknown> };
      };
      expect(body.openapi).toBe("3.1.0");
      expect(body.info).toEqual({ title: "Nextly API", version: "1.0.0" });
      expect(body.paths["/api/posts"]).toBeDefined();
      expect(body.paths["/api/health"]).toBeDefined();
      expect(body.components.schemas.Post).toBeDefined();
      expect(body.components.schemas.PaginationMeta).toBeDefined();
    });

    it("includes paths contributed by every built-in module", async () => {
      const res = await openApiHandler.GET(
        new Request("http://localhost/admin/api/openapi/openapi.json")
      );
      const body = (await res.json()) as { paths: Record<string, unknown> };
      // Spot-check one path from each module to confirm builtinModules
      // wired in correctly.
      expect(body.paths["/api/health"]).toBeDefined();
      expect(body.paths["/api/auth/login"]).toBeDefined();
      expect(body.paths["/api/users"]).toBeDefined();
      expect(body.paths["/api/media"]).toBeDefined();
      expect(body.paths["/api/email-providers"]).toBeDefined();
      expect(body.paths["/api/email/send"]).toBeDefined();
      expect(body.paths["/api/components"]).toBeDefined();
      expect(body.paths["/api/singles"]).toBeDefined();
      expect(body.paths["/api/collections/schema"]).toBeDefined();
      expect(body.paths["/api/roles"]).toBeDefined();
      expect(body.paths["/api/api-keys"]).toBeDefined();
    });
  });

  describe("GET /openapi.yaml", () => {
    it("returns YAML starting with `openapi: 3.1.0`", async () => {
      const res = await openApiHandler.GET(
        new Request("http://localhost/admin/api/openapi/openapi.yaml")
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/yaml/);
      const text = await res.text();
      expect(text.startsWith("openapi: 3.1.0")).toBe(true);
    });

    it("the .yml suffix is also recognized", async () => {
      const res = await openApiHandler.GET(
        new Request("http://localhost/admin/api/openapi/openapi.yml")
      );
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/application\/yaml/);
    });
  });

  describe("conditional GET (ETag / 304)", () => {
    it("returns 304 with no body when If-None-Match matches", async () => {
      const r1 = await openApiHandler.GET(
        new Request("http://localhost/admin/api/openapi/openapi.json")
      );
      const etag = r1.headers.get("etag")!;
      expect(etag).toBeTruthy();

      const r2 = await openApiHandler.GET(
        new Request("http://localhost/admin/api/openapi/openapi.json", {
          headers: { "if-none-match": etag },
        })
      );
      expect(r2.status).toBe(304);
      expect(r2.headers.get("etag")).toBe(etag);
      expect(await r2.text()).toBe("");
    });

    it("returns a fresh 200 when registry contents change (schemaHash differs)", async () => {
      const r1 = await openApiHandler.GET(
        new Request("http://localhost/admin/api/openapi/openapi.json")
      );
      const etag1 = r1.headers.get("etag")!;

      fixture.collections = [
        {
          slug: "posts",
          labels: { singular: "Post", plural: "Posts" },
          fields: [{ name: "title", type: "text" }],
        },
      ];

      const r2 = await openApiHandler.GET(
        new Request("http://localhost/admin/api/openapi/openapi.json")
      );
      expect(r2.status).toBe(200);
      expect(r2.headers.get("etag")).not.toBe(etag1);
    });

    it("json and yaml have distinct etags for the same schemaHash", async () => {
      const json = await openApiHandler.GET(
        new Request("http://localhost/admin/api/openapi/openapi.json")
      );
      const yaml = await openApiHandler.GET(
        new Request("http://localhost/admin/api/openapi/openapi.yaml")
      );
      expect(json.headers.get("etag")).not.toBe(yaml.headers.get("etag"));
    });
  });

  describe("unknown paths", () => {
    it("returns 404 when the request path does not end in .json/.yaml/.yml", async () => {
      const res = await openApiHandler.GET(
        new Request("http://localhost/admin/api/openapi/spec")
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe("NOT_FOUND");
    });
  });

  describe("services not yet registered", () => {
    it("throws a NextlyError so withErrorHandler can render the canonical 503", async () => {
      fixture.servicesRegistered = false;
      await expect(
        openApiHandler.GET(
          new Request("http://localhost/admin/api/openapi/openapi.json")
        )
      ).rejects.toMatchObject({ statusCode: 503 });
    });
  });
});
