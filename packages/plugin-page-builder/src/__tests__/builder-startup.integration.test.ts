/**
 * The builder's start-up read through Nextly's own request handler, as a
 * signed-in person, on every configured dialect: each read is answered as a
 * request to its own route answers it, a read its route refuses the person is
 * refused alone while the rest answer, a route gated by a declared permission
 * is not one of its reads, and nobody signed in is answered nothing.
 */
// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { builderStartupPath } from "../builder-startup-contract";
import { pageBuilder } from "../plugin";

import { call, holding, person, sessionOf } from "./transfer-harness";

/** The reads the builder opens on, as its hooks ask them. */
const READS = [
  "/loop-collections",
  "/named-queries",
  "/capability",
  "/site/style",
  "/layouts/page-collection",
];

/** GET one of the plugin's routes by its path, query included. */
async function get(
  cookie: string,
  path: string
): Promise<{ status: number; body: Record<string, unknown> }> {
  const at = path.indexOf("?");
  const route = (at === -1 ? path : path.slice(0, at)).slice(1).split("/");
  return call("GET", cookie, route, {
    query: at === -1 ? "" : path.slice(at),
  });
}

describe.each(getConfiguredTestDialects())(
  "the builder's start-up read (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        seedPublic: true,
      });
      return current;
    }

    it("answers each read as a request to its own route answers it", async () => {
      const t = await boot();
      // The site's first person is its owner, who may make every read.
      const owner = await sessionOf(t, await person(t, "owner"));
      const answer = await get(owner, builderStartupPath(READS));
      expect(answer.status).toBe(200);
      const reads = answer.body.reads as Record<
        string,
        { status: number; body?: unknown }
      >;
      expect(Object.keys(reads).sort()).toEqual([...READS].sort());
      for (const read of READS) {
        const own = await get(owner, read);
        expect(own.status, read).toBe(200);
        expect(reads[read], read).toEqual({ status: 200, body: own.body });
      }
    });

    it("refuses a read its route refuses the person, and answers the rest", async () => {
      const t = await boot();
      // The site's first person is its owner; the author comes after.
      await person(t, "owner");
      // May read the media library, and edit nothing the builder opens.
      const { cookie } = await holding(t, ["read-media"]);
      const answer = await get(
        cookie,
        builderStartupPath(["/site/style", "/capability"])
      );
      expect(answer.status).toBe(200);
      const reads = answer.body.reads as Record<
        string,
        { status: number; body?: unknown }
      >;
      // Refused as the route itself refuses it, and nothing of it answered.
      const own = await get(cookie, "/site/style");
      expect(own.status).toBe(403);
      expect(reads["/site/style"]).toEqual({ status: 403 });
      // Answered, as the route answers it.
      expect(reads["/capability"]).toEqual({
        status: 200,
        body: (await get(cookie, "/capability")).body,
      });
    });

    it("answers a route gated by a declared permission with nothing, as not one of its reads", async () => {
      const t = await boot();
      const owner = await sessionOf(t, await person(t, "owner"));
      const answer = await get(
        owner,
        builderStartupPath(["/library/components", "/layouts/choices"])
      );
      expect(answer.status).toBe(200);
      expect(answer.body.reads).toEqual({
        "/library/components": { status: 404 },
        "/layouts/choices": { status: 404 },
      });
    });

    it("answers a read its own route would not serve with nothing", async () => {
      const t = await boot();
      const owner = await sessionOf(t, await person(t, "owner"));
      const answer = await get(
        owner,
        builderStartupPath(["/bindings-to-fix", "/site/style"])
      );
      const reads = answer.body.reads as Record<string, { status: number }>;
      expect(reads["/bindings-to-fix"]).toEqual({ status: 404 });
      expect(reads["/site/style"]?.status).toBe(200);
    });

    it("answers nobody signed in with a refusal and no reads", async () => {
      await boot();
      const answer = await get("", builderStartupPath(READS));
      expect(answer.status).toBe(401);
      expect(answer.body).not.toHaveProperty("reads");
    });
  }
);
