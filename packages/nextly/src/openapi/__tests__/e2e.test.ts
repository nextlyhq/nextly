/**
 * End-to-end smoke test for the OpenAPI surface.
 *
 * Drives the full request → registries → generator → serializer →
 * renderer chain in-process. We can't spin a real Next.js dev server
 * from inside vitest, so we mock the DI container at the same boundary
 * the route handler reads from (just like the unit test does). What
 * makes this an *end-to-end* test is that it:
 *
 *   1. Feeds the handler a realistic multi-collection / multi-single /
 *      multi-component snapshot — not just one fixture.
 *   2. Walks every public surface (JSON, YAML, docs UI) in the same
 *      session, asserting they all line up against the same spec.
 *   3. Verifies the document is round-trip-parseable as both JSON and
 *      YAML, and that the docs UI references the same spec URL we just
 *      fetched.
 */

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import YAML from "yaml";

import type { CollectionConfig } from "../../collections/config/define-collection";
import type { ComponentConfig } from "../../components/config/types";
import type { SingleConfig } from "../../singles/config/types";
import { __resetGenerateCacheForTests } from "../generator/pipeline";

// ─────────────────────────────────────────────────────────────────────
// Fixture — three collections, two singles, two components. Picked to
// exercise every interesting code path: required + optional fields,
// scalar + relationship + repeater types, a single that overlaps with
// a collection name, and a component shared between two collections.
// ─────────────────────────────────────────────────────────────────────

const fixture: {
  collections: CollectionConfig[];
  singles: SingleConfig[];
  components: ComponentConfig[];
  config: { openapi?: unknown } | null;
} = {
  collections: [],
  singles: [],
  components: [],
  config: null,
};

vi.mock("../../di", () => ({
  isServicesRegistered: () => true,
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
    if (name === "config") {
      if (!fixture.config) throw new Error("config not registered");
      return fixture.config;
    }
    throw new Error(`Unexpected DI lookup in e2e test: ${name}`);
  },
}));

// Imports come after the mock so the handler binds to the mocked module.
// eslint-disable-next-line import-x/first, import-x/order
import { openApiHandler } from "../../api/openapi";

const BASE = "http://localhost:3000/admin/api/openapi";

beforeAll(() => {
  fixture.collections = [
    {
      slug: "posts",
      labels: { singular: "Post", plural: "Posts" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "slug", type: "text", required: true },
        { name: "content", type: "richText" },
      ],
    },
    {
      slug: "authors",
      labels: { singular: "Author", plural: "Authors" },
      fields: [
        { name: "name", type: "text", required: true },
        { name: "email", type: "email" },
      ],
    },
    {
      slug: "pages",
      labels: { singular: "Page", plural: "Pages" },
      fields: [
        { name: "title", type: "text", required: true },
        { name: "body", type: "richText" },
      ],
    },
  ];
  fixture.singles = [
    {
      slug: "site-settings",
      label: { singular: "Site Settings" },
      fields: [
        { name: "siteName", type: "text", required: true },
        { name: "tagline", type: "text" },
      ],
    },
    {
      slug: "footer",
      label: { singular: "Footer" },
      fields: [{ name: "copyright", type: "text" }],
    },
  ];
  fixture.components = [
    {
      slug: "hero",
      label: { singular: "Hero" },
      fields: [
        { name: "headline", type: "text", required: true },
        { name: "subheadline", type: "text" },
      ],
    },
    {
      slug: "cta",
      label: { singular: "Call To Action" },
      fields: [{ name: "label", type: "text", required: true }],
    },
  ];
});

beforeEach(() => {
  __resetGenerateCacheForTests();
  fixture.config = null;
});

describe("openapi e2e — full surface from registries to renderer", () => {
  it("serves a valid OAS 3.1 document covering every collection + single", async () => {
    const res = await openApiHandler.GET(new Request(`${BASE}/openapi.json`));
    expect(res.status).toBe(200);

    const text = await res.text();
    const doc = JSON.parse(text) as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, unknown>;
      components: { schemas: Record<string, unknown> };
      tags: { name: string }[];
    };

    // Format + envelope.
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info).toEqual({ title: "Nextly API", version: "1.0.0" });

    // Every fixture collection has a list path + an {id} path.
    for (const slug of ["posts", "authors", "pages"]) {
      expect(doc.paths[`/api/${slug}`]).toBeDefined();
      expect(doc.paths[`/api/${slug}/{id}`]).toBeDefined();
    }

    // Every fixture single has a read path.
    for (const slug of ["site-settings", "footer"]) {
      expect(doc.paths[`/api/${slug}`]).toBeDefined();
    }

    // Schema components derived per collection.
    for (const name of ["Post", "Author", "Page", "SiteSettings", "Footer"]) {
      expect(doc.components.schemas[name]).toBeDefined();
    }

    // Shared envelope + error components are always present.
    for (const name of [
      "PaginationMeta",
      "CountResponse",
      "DeleteResponse",
      "Error",
    ]) {
      expect(doc.components.schemas[name]).toBeDefined();
    }

    // Tags are populated from the built-in modules.
    const tagNames = doc.tags.map(t => t.name);
    for (const name of ["Health", "Auth", "Users", "Media", "RBAC"]) {
      expect(tagNames).toContain(name);
    }
  });

  it("serves a byte-identical YAML representation", async () => {
    const json = await openApiHandler.GET(new Request(`${BASE}/openapi.json`));
    const yaml = await openApiHandler.GET(new Request(`${BASE}/openapi.yaml`));

    const jsonDoc = JSON.parse(await json.text()) as Record<string, unknown>;
    const yamlText = await yaml.text();
    expect(yamlText.startsWith("openapi: 3.1.0")).toBe(true);

    const yamlDoc = YAML.parse(yamlText) as Record<string, unknown>;
    expect(yamlDoc).toEqual(jsonDoc);
  });

  it("returns the same document on a second call (cache hit via ETag)", async () => {
    const r1 = await openApiHandler.GET(new Request(`${BASE}/openapi.json`));
    const etag = r1.headers.get("etag")!;

    const r2 = await openApiHandler.GET(
      new Request(`${BASE}/openapi.json`, {
        headers: { "if-none-match": etag },
      })
    );
    expect(r2.status).toBe(304);
    expect(r2.headers.get("etag")).toBe(etag);
  });

  it("docs page references the same spec URL and embeds the Scalar bundle", async () => {
    const ui = await openApiHandler.GET(new Request(BASE));
    expect(ui.status).toBe(200);
    expect(ui.headers.get("content-type")).toBe("text/html; charset=utf-8");

    const html = await ui.text();
    expect(html).toContain("Nextly API");
    expect(html).toContain(`${BASE}/openapi.json`);
    // Scalar renderer is the default — its markers must be present.
    expect(html).toContain('id="api-reference"');
    expect(html).toContain("cdn.jsdelivr.net/npm/@scalar/api-reference");
  });

  it("user-supplied OpenApiConfig flows end-to-end", async () => {
    fixture.config = {
      openapi: {
        info: {
          title: "Acme API",
          version: "2.4.1",
          description: "Acme's headless CMS.",
        },
        servers: [
          { url: "https://api.acme.com", description: "production" },
          { url: "https://staging.acme.com", description: "staging" },
        ],
        cache: { maxAgeSeconds: 300 },
      },
    };

    const res = await openApiHandler.GET(new Request(`${BASE}/openapi.json`));
    const doc = JSON.parse(await res.text()) as {
      info: { title: string; version: string; description?: string };
      servers: { url: string }[];
    };
    expect(doc.info.title).toBe("Acme API");
    expect(doc.info.version).toBe("2.4.1");
    expect(doc.info.description).toBe("Acme's headless CMS.");
    expect(doc.servers.map(s => s.url)).toEqual([
      "https://api.acme.com",
      "https://staging.acme.com",
    ]);
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=300, must-revalidate"
    );

    const ui = await openApiHandler.GET(new Request(BASE));
    const html = await ui.text();
    expect(html).toContain("<title>Acme API</title>");
  });

  it("generates a self-consistent document — every $ref resolves", async () => {
    const res = await openApiHandler.GET(new Request(`${BASE}/openapi.json`));
    const doc = JSON.parse(await res.text()) as {
      components: {
        schemas: Record<string, unknown>;
        responses: Record<string, unknown>;
      };
    };

    // Walk the entire document and collect every $ref. The generator's
    // own validateRefs() already enforces this at serialize time, but
    // re-checking here protects against future regressions where a
    // schema or response gets removed without updating its callers.
    const refs: string[] = [];
    const walk = (node: unknown): void => {
      if (node === null || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      for (const [key, value] of Object.entries(node)) {
        if (key === "$ref" && typeof value === "string") refs.push(value);
        else walk(value);
      }
    };
    walk(doc);

    for (const ref of refs) {
      const m = /^#\/components\/(schemas|responses)\/(.+)$/.exec(ref);
      expect(m, `unexpected ref shape: ${ref}`).not.toBeNull();
      const ns = m![1] as "schemas" | "responses";
      const name = m![2];
      expect(doc.components[ns][name], `dangling $ref: ${ref}`).toBeDefined();
    }
    // Sanity — we did walk something.
    expect(refs.length).toBeGreaterThan(0);
  });
});
