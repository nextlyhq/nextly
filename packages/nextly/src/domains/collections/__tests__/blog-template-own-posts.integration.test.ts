/**
 * The blog template's Posts, as it ships, lets an author change only the
 * posts they wrote, and an editor every post.
 *
 * The collection is the template's own file, loaded by a path built at run
 * time (the template is its own project, so a static import would pull it
 * into this package's type check); its `nextly` imports resolve to this
 * package's source (see `src/__tests__/template-imports.ts`). Its rules are
 * judged by a real Nextly on each configured dialect, for accounts whose
 * roles are granted through the real role writers: an editor holding every
 * posts permission including `publish-posts`, and two authors holding
 * create, read, update and delete on posts but not publish.
 *
 * What separates the template's rule from the one it replaced: an author
 * holding `update-posts` and `delete-posts` changes another author's post
 * under a rule that checks only the grant, and is refused it here.
 *
 * @module domains/collections/__tests__/blog-template-own-posts.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import type { CollectionConfig } from "../../../collections/config/define-collection";
import {
  account,
  role,
  seedPermissions,
} from "../../../direct-api/__tests__/checked-access-fixtures";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

const TEMPLATE = new URL("../../../../../../templates/blog/", import.meta.url);

/**
 * One collection the blog template exports, loaded by a path built at run
 * time, which TypeScript does not follow.
 */
async function templateCollection(
  file: string,
  name: string
): Promise<CollectionConfig> {
  const module: Record<string, unknown> = await import(
    fileURLToPath(new URL(file, TEMPLATE))
  );
  const exported = module[name];
  if (
    typeof exported !== "object" ||
    exported === null ||
    typeof (exported as { slug?: unknown }).slug !== "string"
  ) {
    throw new Error(`the template's ${file} exports no ${name} collection`);
  }
  return exported as CollectionConfig;
}

const POSTS = "posts";
/** Every posts action the seed's editor holds. */
const EDITOR_ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "publish",
  "unpublish",
];
/** Every posts action the seed's author holds. */
const AUTHOR_ACTIONS = ["create", "read", "update", "delete"];

let current: TestNextly | undefined;
afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

/** The Direct API's collection calls, typed where the shim is not. */
interface Direct {
  create(a: Record<string, unknown>): Promise<{ item: { id: string } }>;
  update(a: Record<string, unknown>): Promise<{ item: { id: string } }>;
  delete(a: Record<string, unknown>): Promise<unknown>;
}

interface World {
  t: TestNextly;
  direct: Direct;
  editor: string;
  author: string;
  otherAuthor: string;
  /** Two posts by `author`, one by `otherAuthor`, one by `editor`. */
  posts: { own: string; ownToo: string; others: string; editors: string };
}

async function boot(dialect: TestDialect): Promise<World> {
  const [Posts, Categories, Tags] = await Promise.all([
    templateCollection("src/collections/Posts/index.ts", "Posts"),
    templateCollection("src/collections/Categories.ts", "Categories"),
    templateCollection("src/collections/Tags.ts", "Tags"),
  ]);
  const t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    collections: [Posts, Categories, Tags],
  });
  current = t;
  await seedPermissions(t);
  // The install's first account is its administrator, whom no rule binds;
  // made first so the callers below are not.
  await account(t, "founder@example.com");
  const editorRole = await role(
    t,
    "blogtest-editor",
    EDITOR_ACTIONS.map(action => `${action}-${POSTS}`)
  );
  const authorRole = await role(
    t,
    "blogtest-author",
    AUTHOR_ACTIONS.map(action => `${action}-${POSTS}`)
  );
  const editor = await account(t, "editor@example.com", [editorRole]);
  const author = await account(t, "author@example.com", [authorRole]);
  const otherAuthor = await account(t, "other@example.com", [authorRole]);

  const direct = t.nextly as unknown as Direct;
  // Made as trusted server code, as the seed makes them, naming the author.
  const post = async (title: string, by: string) =>
    String(
      (
        await direct.create({
          collection: POSTS,
          data: { title, author: by },
        })
      ).item.id
    );
  const posts = {
    own: await post("Mine", author),
    ownToo: await post("Mine too", author),
    others: await post("Theirs", otherAuthor),
    editors: await post("The editor's", editor),
  };
  return { t, direct, editor, author, otherAuthor, posts };
}

/** A checked call made as `id`. */
const as = (id: string) => ({ user: { id }, overrideAccess: false });

/** The stored row of a post, read past every access check. */
async function stored(
  t: TestNextly,
  id: string
): Promise<Record<string, unknown> | undefined> {
  const rows = await t.adapter.select<Record<string, unknown>>(
    `dc_${POSTS}`,
    {}
  );
  return rows.find(row => String(row.id) === id);
}

/** Who a stored post names as its author. */
const authorOf = async (t: TestNextly, id: string) =>
  (await stored(t, id))?.author;

describe.each(getConfiguredTestDialects())(
  "the blog template's Posts rules (%s)",
  dialect => {
    it("let an author edit and delete their own post", async () => {
      const { t, direct, author, posts } = await boot(dialect);
      await direct.update({
        collection: POSTS,
        id: posts.own,
        data: { title: "Mine, edited" },
        ...as(author),
      });
      expect((await stored(t, posts.own))?.title).toBe("Mine, edited");

      await direct.delete({ collection: POSTS, id: posts.own, ...as(author) });
      expect(await stored(t, posts.own)).toBeUndefined();
    });

    it("refuse an author another author's post, and leave it unchanged", async () => {
      const { t, direct, author, posts } = await boot(dialect);
      await expect(
        direct.update({
          collection: POSTS,
          id: posts.others,
          data: { title: "Taken over" },
          ...as(author),
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        direct.delete({ collection: POSTS, id: posts.others, ...as(author) })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const theirs = await stored(t, posts.others);
      expect(theirs?.title).toBe("Theirs");
    });

    it("let an author's bulk update change only their own posts", async () => {
      const { t, author, posts } = await boot(dialect);
      const result = await t
        .getService("collectionsHandler")
        .bulkUpdateByQuery({
          collectionName: POSTS,
          where: {
            title: { in: ["Mine", "Mine too", "Theirs", "The editor's"] },
          },
          data: { excerpt: "Bulk edited" },
          ...as(author),
        });

      expect(result).toMatchObject({ successCount: 2, failedCount: 0 });
      expect((await stored(t, posts.own))?.excerpt).toBe("Bulk edited");
      expect((await stored(t, posts.ownToo))?.excerpt).toBe("Bulk edited");
      expect((await stored(t, posts.others))?.excerpt ?? null).toBeNull();
      expect((await stored(t, posts.editors))?.excerpt ?? null).toBeNull();
    });

    it("let an editor edit and delete any post", async () => {
      const { t, direct, editor, posts } = await boot(dialect);
      await direct.update({
        collection: POSTS,
        id: posts.others,
        data: { title: "Edited by the editor" },
        ...as(editor),
      });
      expect((await stored(t, posts.others))?.title).toBe(
        "Edited by the editor"
      );

      await direct.delete({ collection: POSTS, id: posts.own, ...as(editor) });
      expect(await stored(t, posts.own)).toBeUndefined();
    });

    it("make a new post by an author theirs", async () => {
      const { t, direct, author } = await boot(dialect);
      const created = await direct.create({
        collection: POSTS,
        data: { title: "Freshly written" },
        ...as(author),
      });
      expect(await authorOf(t, String(created.item.id))).toBe(author);
    });

    it("keep an author from naming someone else as a post's author", async () => {
      const { t, direct, author, otherAuthor, posts } = await boot(dialect);
      // On create, the value is dropped and the post is the author's own.
      const created = await direct.create({
        collection: POSTS,
        data: { title: "Under another name", author: otherAuthor },
        ...as(author),
      });
      expect(await authorOf(t, String(created.item.id))).toBe(author);

      // On update, the value is dropped and the post keeps its author.
      await direct.update({
        collection: POSTS,
        id: posts.own,
        data: { title: "Handed away", author: otherAuthor },
        ...as(author),
      });
      expect((await stored(t, posts.own))?.title).toBe("Handed away");
      expect(await authorOf(t, posts.own)).toBe(author);
    });

    it("let an editor give a post another author", async () => {
      const { t, direct, editor, otherAuthor, posts } = await boot(dialect);
      await direct.update({
        collection: POSTS,
        id: posts.own,
        data: { author: otherAuthor },
        ...as(editor),
      });
      expect(await authorOf(t, posts.own)).toBe(otherAuthor);
    });
  }
);
