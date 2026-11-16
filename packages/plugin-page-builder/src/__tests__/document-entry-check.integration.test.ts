/**
 * Every way a document enters storage runs the engine's full check.
 *
 * The editor checks its own edits against kept sizes and no longer probes
 * every object for a value the writer refuses: documents it builds from its
 * own operations are plain data. What stops an unwritable or oversized
 * document reaching a row is the full check where a document enters from
 * outside, so this writes each refused document through each door: an API
 * write, the save a builder makes over HTTP, and an import. Each is refused,
 * and nothing is stored.
 *
 * A BigInt cannot travel as JSON, so it can only arrive through the in-process
 * API; over HTTP and in an import file, the oversized document is the case.
 *
 * @module __tests__/document-entry-check.integration.test
 */

process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { DEFAULT_LIMITS } from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { asOverwrite } from "../document-version";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import { IMPORT_ROUTE_PATH } from "../transfer/transfer-contract";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
// The cap the server enforces on every document: the engine's own.
const MAX_BYTES = DEFAULT_LIMITS.maxBytes;
// The server's words for it, which the editor's own refusal repeats.
const TOO_LARGE = `Document exceeds the maximum of ${String(MAX_BYTES)} bytes.`;

const heading = (id: string, props: Record<string, unknown>) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { level: "h2", ...props },
});
const documentOf = (kind: string, props: Record<string, unknown>) => ({
  formatVersion: 1,
  kind,
  nodes: [heading("h", props)],
});

/**
 * The refusal of a value JSON cannot write. Core's own JSON field check gives
 * it, before the engine's validator is reached: the first gate that refuses.
 */
const UNWRITABLE = "must be JSON-serializable";

/**
 * Why a write was refused, as the error says it, so a test pins the reason
 * rather than only that something threw. A write that saved is `undefined`.
 */
async function refusal(write: Promise<unknown>): Promise<string | undefined> {
  try {
    await write;
    return undefined;
  } catch (error) {
    const said = error as { message?: unknown; publicData?: unknown };
    return `${String(said.message)} ${JSON.stringify(said.publicData ?? null)}`;
  }
}

/** The documents the full check refuses, each for a different reason. */
const REFUSED = {
  "a BigInt": () => documentOf("page", { text: "x", count: 1n }),
  "a boxed BigInt": () => documentOf("page", { text: "x", count: Object(1n) }),
  "a document over the byte cap": () =>
    documentOf("page", { text: "x".repeat(MAX_BYTES) }),
} as const;

/** What each refusal says. */
const SAYS: Record<keyof typeof REFUSED, string> = {
  "a BigInt": UNWRITABLE,
  "a boxed BigInt": UNWRITABLE,
  "a document over the byte cap": TOO_LARGE,
};

describe.each(getConfiguredTestDialects())(
  "a document entering storage (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let cookie = "";

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        seedPublic: true,
      });
      // The first user holds every permission.
      const owner = await t.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      const token = await signAccessToken(
        buildClaims({
          userId: owner.item.id,
          email: "owner@example.com",
          name: "Owner",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      cookie = `nextly_session=${token}`;
    });

    afterAll(async () => {
      await t?.destroy();
    });

    /** A request as a signed-in browser makes it. */
    async function send(
      method: "POST" | "PATCH",
      params: string[],
      body: unknown
    ): Promise<{ status: number; text: string }> {
      const handlers = createDynamicHandlers();
      const response = await handlers[method](
        new Request(`${ORIGIN}/api/${params.join("/")}`, {
          method,
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ params }) }
      );
      return { status: response.status, text: await response.text() };
    }

    const pluginRoute = (...route: string[]) => [
      "plugins",
      ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
      ...route,
    ];

    async function pagesTitled(title: string): Promise<number> {
      const found = await t.nextly.find({
        collection: "pages",
        where: { title: { equals: title } },
        overrideAccess: true,
      });
      return found.items.length;
    }

    it.each(Object.keys(REFUSED) as (keyof typeof REFUSED)[])(
      "refuses %s on an API write, storing nothing",
      async reason => {
        const title = `api ${reason}`;
        expect(
          await refusal(
            t.nextly.create({
              collection: "pages",
              data: {
                title,
                slug: `api-${Date.now()}`,
                content: REFUSED[reason](),
              },
              overrideAccess: true,
            })
          )
        ).toContain(SAYS[reason]);
        expect(await pagesTitled(title)).toBe(0);
      }
    );

    it.each(Object.keys(REFUSED) as (keyof typeof REFUSED)[])(
      "refuses %s on a save over the API, keeping the stored page",
      async reason => {
        const created = await t.nextly.create({
          collection: "pages",
          data: {
            title: `save ${reason}`,
            slug: `save-${Date.now()}`,
            content: documentOf("page", { text: "kept" }),
          },
          overrideAccess: true,
        });
        const id = String(created.item.id);
        expect(
          await refusal(
            t.nextly.update({
              collection: "pages",
              id,
              data: asOverwrite({ content: REFUSED[reason]() }),
              overrideAccess: true,
            })
          )
        ).toContain(SAYS[reason]);
        const stored = await t.nextly.findByID({
          collection: "pages",
          id,
          overrideAccess: true,
        });
        expect(JSON.stringify(stored)).toContain("kept");
      }
    );

    it("refuses an oversized page on the builder's save over HTTP, with the server's words", async () => {
      const created = await t.nextly.create({
        collection: "pages",
        data: {
          title: "http save",
          slug: `http-${Date.now()}`,
          content: documentOf("page", { text: "kept" }),
        },
        overrideAccess: true,
      });
      const id = String(created.item.id);
      const response = await send(
        "PATCH",
        ["collections", "pages", "entries", id],
        {
          content: REFUSED["a document over the byte cap"](),
          _overwrite: true,
        }
      );
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.text).toContain(TOO_LARGE);
      const stored = await t.nextly.findByID({
        collection: "pages",
        id,
        overrideAccess: true,
      });
      expect(JSON.stringify(stored)).toContain("kept");
    });

    it("refuses an import whose document is past the byte cap, storing nothing", async () => {
      const slug = `imported-${Date.now()}`;
      const component = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "Imported",
          slug,
          content: documentOf("component", { text: "MARKER" }),
        },
        overrideAccess: true,
      });
      const id = String(component.item.id);
      const exported = await send(
        "POST",
        pluginRoute("transfer", "components", id, "export"),
        {}
      );
      expect(exported.status).toBe(200);
      // The file as exported, its document then enlarged past the cap by hand.
      const parsed = JSON.parse(exported.text) as Record<string, unknown>;
      const file = (parsed.item ?? parsed) as unknown;
      // A new id and slug, so the import adds an item rather than meeting the
      // one it was exported from.
      const fresh = `fresh-${Date.now()}`;
      const enlarged = JSON.parse(
        JSON.stringify(file)
          .replaceAll(id, crypto.randomUUID())
          .replaceAll(slug, fresh)
          .replace("MARKER", "x".repeat(MAX_BYTES))
      ) as unknown;

      const preview = await send(
        "POST",
        pluginRoute(...IMPORT_ROUTE_PATH.split("/").filter(Boolean)),
        {
          file: enlarged,
          dryRun: true,
        }
      );
      const fingerprint = (
        JSON.parse(preview.text) as {
          item?: { preview?: { fingerprint?: string } };
        }
      ).item?.preview?.fingerprint;
      const imported = await send(
        "POST",
        pluginRoute(...IMPORT_ROUTE_PATH.split("/").filter(Boolean)),
        {
          file: enlarged,
          ...(fingerprint === undefined ? {} : { expect: fingerprint }),
        }
      );
      expect(imported.status).toBeGreaterThanOrEqual(400);
      expect(`${preview.text} ${imported.text}`).toContain(TOO_LARGE);
      const stored = await t.nextly.find({
        collection: COMPONENTS_SLUG,
        where: { slug: { equals: fresh } },
        overrideAccess: true,
      });
      expect(stored.items).toHaveLength(0);
    });
  }
);
