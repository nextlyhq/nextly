/**
 * The editor's change check, through the route as a signed-in person, on
 * every configured dialect: its mark stays the same while nothing the canvas
 * reads changes, changes once the page's entry is saved, an entry is added
 * to a listed collection or any of its entries is edited, or a bound Single
 * is saved, and never moves for a source the person may not read.
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

import { holding, person, post, sessionOf } from "./transfer-harness";

const POSTS = "csc_posts";
const HOME = "csc_home";

describe.each(getConfiguredTestDialects())(
  "the canvas's change check (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
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

    /** The mark, as `cookie` is answered it, for a post page listing posts. */
    async function stampFor(cookie: string, id: string): Promise<string> {
      const answer = await post(cookie, ["canvas-sources", "changed"], {
        source: { kind: "collection", slug: POSTS, id },
        singles: [HOME],
        lists: [POSTS],
      });
      expect(answer.status).toBe(200);
      expect(answer.body.stamp).toBeTypeOf("string");
      return answer.body.stamp as string;
    }

    it("changes when the entry, a listed collection or a bound Single changes, and only then", async () => {
      const { t, owner } = await boot();
      const id = await savePost(t, "First");
      await t.nextly.updateSingle({
        slug: HOME,
        data: { tagline: "Hello", _overwrite: true },
        overrideAccess: true,
      });

      const start = await stampFor(owner, id);
      expect(await stampFor(owner, id)).toBe(start);

      await t.nextly.update({
        collection: POSTS,
        id,
        data: { title: "First, edited", _overwrite: true },
        overrideAccess: true,
      });
      const afterEntry = await stampFor(owner, id);
      expect(afterEntry).not.toBe(start);

      await savePost(t, "Second");
      const afterList = await stampFor(owner, id);
      expect(afterList).not.toBe(afterEntry);

      await t.nextly.updateSingle({
        slug: HOME,
        data: { tagline: "Hello again", _overwrite: true },
        overrideAccess: true,
      });
      expect(await stampFor(owner, id)).not.toBe(afterList);
    });

    it("changes when an older entry of a listed collection is edited, whichever entry was newest", async () => {
      const { t, owner } = await boot();
      const page = await savePost(t, "The page");
      const older = await savePost(t, "Older");
      const newer = await savePost(t, "Newer");
      const edit = (id: string, title: string) =>
        t.nextly.update({
          collection: POSTS,
          id,
          data: { title, _overwrite: true },
          overrideAccess: true,
        });
      // The older entry edited once: it is now the newest, at its second
      // version, and the other is still at its first.
      await edit(older, "Older, edited");
      const before = await stampFor(owner, page);
      // The other edited once too: now the newest at the same version.
      await edit(newer, "Newer, edited");
      expect(await stampFor(owner, page)).not.toBe(before);
    });

    it("never moves for a source the person may not read", async () => {
      const { t } = await boot();
      const id = await savePost(t, "Private");
      // Granted nothing on the posts or the Single: only the library.
      const { cookie } = await holding(t, ["read-media"]);
      const start = await stampFor(cookie, id);

      await t.nextly.update({
        collection: POSTS,
        id,
        data: { title: "Changed", _overwrite: true },
        overrideAccess: true,
      });
      await savePost(t, "Another");
      expect(await stampFor(cookie, id)).toBe(start);
    });
  }
);
