/**
 * @module route-handler/dev-schema-handler.test
 * @since v0.0.3-alpha (Plan D3)
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setHandlerConfig } from "./auth-handler";
import { handleDevSchemaRequest } from "./dev-schema-handler";

let dir: string;
const ORIGINAL_ENV = process.env.NODE_ENV;

function req(method: string, body?: unknown): Request {
  return new Request("http://x/admin/api/_dev/schema", {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dev-schema-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  process.env.NODE_ENV = "development";
  setHandlerConfig({
    db: { uiSchemaFile: "./ui-schema.json" },
  } as unknown as Parameters<typeof setHandlerConfig>[0]);
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env.NODE_ENV = ORIGINAL_ENV;
});

describe("handleDevSchemaRequest", () => {
  it("POST collection writes the manifest and returns 200", async () => {
    const res = await handleDevSchemaRequest(
      req("POST", {
        slug: "events",
        fields: [{ name: "title", type: "text" }],
      }),
      ["_dev", "schema", "collection"],
      "POST"
    );
    expect(res.status).toBe(200);
    const written = JSON.parse(
      await readFile(join(dir, "ui-schema.json"), "utf-8")
    );
    expect(written.collections[0].slug).toBe("events");
  });

  it("rejects an invalid entity with 400 and leaves the file untouched", async () => {
    await writeFile(
      join(dir, "ui-schema.json"),
      JSON.stringify({
        version: 1,
        collections: [],
        singles: [],
        components: [],
      })
    );
    const before = await readFile(join(dir, "ui-schema.json"), "utf-8");
    const res = await handleDevSchemaRequest(
      req("POST", { slug: "Bad Slug", fields: [] }),
      ["_dev", "schema", "collection"],
      "POST"
    );
    expect(res.status).toBe(400);
    expect(await readFile(join(dir, "ui-schema.json"), "utf-8")).toBe(before);
  });

  it("DELETE removes a collection by slug", async () => {
    await writeFile(
      join(dir, "ui-schema.json"),
      JSON.stringify({
        version: 1,
        collections: [
          { slug: "events", fields: [{ name: "title", type: "text" }] },
        ],
        singles: [],
        components: [],
      })
    );
    const res = await handleDevSchemaRequest(
      req("DELETE"),
      ["_dev", "schema", "collection", "events"],
      "DELETE"
    );
    expect(res.status).toBe(200);
    const written = JSON.parse(
      await readFile(join(dir, "ui-schema.json"), "utf-8")
    );
    expect(written.collections).toEqual([]);
  });

  it("404s an unknown kind", async () => {
    const res = await handleDevSchemaRequest(
      req("POST", {}),
      ["_dev", "schema", "widget"],
      "POST"
    );
    expect(res.status).toBe(404);
  });

  it("404s when NODE_ENV is not development (defense in depth)", async () => {
    process.env.NODE_ENV = "production";
    const res = await handleDevSchemaRequest(
      req("POST", {
        slug: "events",
        fields: [{ name: "title", type: "text" }],
      }),
      ["_dev", "schema", "collection"],
      "POST"
    );
    expect(res.status).toBe(404);
  });
});
