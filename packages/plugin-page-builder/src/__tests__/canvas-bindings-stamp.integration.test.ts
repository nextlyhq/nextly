/**
 * The canvas's first reads carry the change check's mark of what they read,
 * taken before they read it, through the route as a signed-in person on
 * every configured dialect: the same mark the check answers while nothing
 * changes, and a save that lands while the reads are made is not in it, so
 * the next check differs and the canvas reads again.
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
import { defineCollection, defineSingle, text } from "nextly/config";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";

import { person, post, sessionOf } from "./transfer-harness";

const POSTS = "cbs_posts";
const HOME = "cbs_home";

/** Run once as the bindings read draws the post's title, when armed. */
let duringRead: (() => Promise<void>) | undefined;

describe.each(getConfiguredTestDialects())(
  "the canvas's first reads and the change check's mark (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      duringRead = undefined;
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<{ t: TestNextly; owner: string }> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        collections: [
          defineCollection({
            slug: POSTS,
            status: true,
            hooks: {
              afterRead: [
                async ctx => {
                  const doc = (ctx.data ?? {}) as Record<string, unknown>;
                  // The check's own reads name no title: only the canvas's
                  // read of the post does.
                  const run = duringRead;
                  if (run !== undefined && typeof doc.title === "string") {
                    duringRead = undefined;
                    await run();
                  }
                  return doc;
                },
              ],
            },
            fields: [text({ name: "title" })],
          }),
        ],
        singles: [
          defineSingle({ slug: HOME, fields: [text({ name: "tagline" })] }),
        ],
        seedPublic: true,
      });
      // The site's first person is its owner, who may read every source.
      const owner = await person(current, "owner");
      return { t: current, owner: await sessionOf(current, owner) };
    }

    async function savePost(t: TestNextly, title: string): Promise<string> {
      const row = await t.nextly.create({
        collection: POSTS,
        data: { title, status: "published" },
        overrideAccess: true,
      });
      return String(row.item.id);
    }

    const source = (id: string) => ({ kind: "collection", slug: POSTS, id });

    /** The canvas's first reads of a post page bound to the post and the Single. */
    async function bindings(cookie: string, id: string) {
      const answer = await post(cookie, ["canvas-bindings"], {
        source: source(id),
        demand: {
          entry: { fields: ["title"], follows: {} },
          singles: { [HOME]: { fields: ["tagline"], follows: {} } },
          site: false,
          formatsDates: false,
        },
        lists: [POSTS],
      });
      expect(answer.status).toBe(200);
      return answer.body;
    }

    /** The change check's mark for the same sources. */
    async function stampFor(cookie: string, id: string): Promise<string> {
      const answer = await post(cookie, ["canvas-sources", "changed"], {
        source: source(id),
        singles: [HOME],
        lists: [POSTS],
      });
      expect(answer.status).toBe(200);
      return answer.body.stamp as string;
    }

    it("carries the mark the change check answers while nothing changes", async () => {
      const { t, owner } = await boot();
      const id = await savePost(t, "First");

      const read = await bindings(owner, id);
      expect(read.stamp).toBeTypeOf("string");
      expect(await stampFor(owner, id)).toBe(read.stamp);
    });

    it("takes the mark before it reads, so a save landing during the read makes the next check differ", async () => {
      const { t, owner } = await boot();
      const id = await savePost(t, "First");
      duringRead = async () => {
        await t.nextly.updateSingle({
          slug: HOME,
          data: { tagline: "Saved elsewhere", _overwrite: true },
          overrideAccess: true,
        });
      };

      const read = await bindings(owner, id);
      // The save landed while the canvas read.
      expect(duringRead).toBeUndefined();
      expect(await stampFor(owner, id)).not.toBe(read.stamp);
    });
  }
);
