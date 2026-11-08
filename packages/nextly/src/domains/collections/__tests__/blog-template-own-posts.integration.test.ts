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
 * The public credit follows the same line: a post's `byline` (a profile in
 * the template's Authors) is chosen only by a caller who may publish posts,
 * and a new post is credited to its writer's own profile. An account has one
 * profile at most. A visual blog's Posts carries no code hooks, so the
 * template's plugin registers the two that fill the owner and the credit.
 *
 * @module domains/collections/__tests__/blog-template-own-posts.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { resetSessionStandingForTests } from "../../../auth/session/session-standing";
import type { CollectionConfig } from "../../../collections/config/define-collection";
import type { PluginDefinition } from "../../../plugins/plugin-context";
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
import { createDynamicHandlers } from "../../../routeHandler";

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
const AUTHORS = "authors";
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
  resetSessionStandingForTests();
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
  /** The author profiles of `author` and `otherAuthor`. */
  profiles: { author: string; other: string };
}

/**
 * The template's plugin, loaded as its collections are: by a path built at
 * run time.
 */
async function templatePlugin(): Promise<PluginDefinition> {
  const module: Record<string, unknown> = await import(
    fileURLToPath(new URL("src/collections/Posts/credit-plugin.ts", TEMPLATE))
  );
  const plugin = module.postsCreditPlugin;
  if (typeof plugin !== "object" || plugin === null || !("init" in plugin)) {
    throw new Error("the template's credit-plugin.ts exports no plugin");
  }
  return plugin as PluginDefinition;
}

/**
 * Posts as a visual blog registers it: the same fields, with no hooks and
 * no field rules, since the snapshot it comes from can hold no function.
 */
function asVisual(posts: CollectionConfig): CollectionConfig {
  return {
    ...posts,
    hooks: undefined,
    fields: posts.fields.map(field => {
      const { access: _access, ...rest } = field as typeof field & {
        access?: unknown;
      };
      return rest as typeof field;
    }),
  };
}

/**
 * How the install registers Posts: as the code-first config does, or as a
 * visual blog does, with or without the template's plugin.
 */
type Approach = "code-first" | "visual" | "visual without the plugin";

async function boot(
  dialect: TestDialect,
  approach: Approach = "code-first"
): Promise<World> {
  const [Posts, Authors, Categories, Tags] = await Promise.all([
    templateCollection("src/collections/Posts/index.ts", "Posts"),
    templateCollection("src/collections/Authors.ts", "Authors"),
    templateCollection("src/collections/Categories.ts", "Categories"),
    templateCollection("src/collections/Tags.ts", "Tags"),
  ]);
  const t = await createTestNextly({
    ...(dialect === "sqlite" ? {} : { dialect }),
    collections: [
      approach === "code-first" ? Posts : asVisual(Posts),
      Authors,
      Categories,
      Tags,
    ],
    ...(approach === "visual" ? { plugins: [await templatePlugin()] } : {}),
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
  // Profiles made as trusted server code, as the seed makes them.
  const profile = async (name: string, accountId: string) =>
    String(
      (
        await direct.create({
          collection: AUTHORS,
          data: {
            title: name,
            name,
            slug: name.toLowerCase(),
            account: accountId,
          },
        })
      ).item.id
    );
  const profiles = {
    author: await profile("Author", author),
    other: await profile("Other", otherAuthor),
  };
  // Made as trusted server code, as the seed makes them, naming the author
  // and, for the author's own, their profile.
  const post = async (title: string, by: string, byline?: string) =>
    String(
      (
        await direct.create({
          collection: POSTS,
          data: { title, author: by, ...(byline ? { byline } : {}) },
        })
      ).item.id
    );
  const posts = {
    own: await post("Mine", author, profiles.author),
    ownToo: await post("Mine too", author),
    others: await post("Theirs", otherAuthor),
    editors: await post("The editor's", editor),
  };
  return { t, direct, editor, author, otherAuthor, posts, profiles };
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

/** The profile a stored post credits, `null` for none. */
const bylineOf = async (t: TestNextly, id: string) =>
  (await stored(t, id))?.byline ?? null;

/**
 * A REST update of post `id` as the signed-in `userId`, as the admin sends
 * it, answered with its status.
 */
async function restUpdate(
  userId: string,
  id: string,
  data: Record<string, unknown>
): Promise<number> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.test`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  const handlers = createDynamicHandlers() as unknown as Record<
    string,
    (request: Request, context: unknown) => Promise<Response>
  >;
  const path = ["collections", POSTS, "entries", id];
  const res = await handlers.PATCH!(
    new Request(`http://localhost/api/${path.join("/")}`, {
      method: "PATCH",
      headers: {
        cookie: `nextly_session=${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ...data, _overwrite: true }),
    }),
    { params: Promise.resolve({ params: path }) }
  );
  return res.status;
}

describe.each(getConfiguredTestDialects())(
  "the blog template's Posts rules (%s)",
  dialect => {
    it("let an author edit and delete their own post", async () => {
      const { t, direct, author, posts } = await boot(dialect);
      await direct.update({
        collection: POSTS,
        id: posts.own,
        data: { title: "Mine, edited", _overwrite: true },
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
          data: { title: "Taken over", _overwrite: true },
          ...as(author),
        })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        direct.delete({ collection: POSTS, id: posts.others, ...as(author) })
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const theirs = await stored(t, posts.others);
      expect(theirs?.title).toBe("Theirs");
    });

    // The admin edits over REST, so an author edits their own post there and
    // is refused another's, which is left as it was.
    it("let an author edit their own post over REST, and refuse another's", async () => {
      const { t, author, posts } = await boot(dialect);
      const theirs = await stored(t, posts.others);

      expect(await restUpdate(author, posts.own, { title: "Edited" })).toBe(
        200
      );
      // A title of its own, so a slug derived from it can't collide with the
      // one just written and answer for the refusal.
      expect(
        await restUpdate(author, posts.others, { title: "Taken over" })
      ).toBe(403);
      expect((await stored(t, posts.own))?.title).toBe("Edited");
      expect(await stored(t, posts.others)).toEqual(theirs);
    });

    // A yes-or-no check names no post, so it can't say which posts the
    // filter leaves an author: it answers no, and yes to an editor.
    it("answer an author no and an editor yes when asked whether they may update posts", async () => {
      const { t, editor, author } = await boot(dialect);
      const may = (userId: string, operation: "read" | "update") =>
        t.nextly.access.check({ userId, operation, resource: POSTS });

      expect(await may(author, "update")).toBe(false);
      expect(await may(editor, "update")).toBe(true);
      expect(await may(author, "read")).toBe(true);
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
          // The author's rules are under test, not versions.
          data: { excerpt: "Bulk edited", _overwrite: true },
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
        data: { title: "Edited by the editor", _overwrite: true },
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
        data: { title: "Handed away", author: otherAuthor, _overwrite: true },
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
        data: { author: otherAuthor, _overwrite: true },
        ...as(editor),
      });
      expect(await authorOf(t, posts.own)).toBe(otherAuthor);
    });

    it("credit an author's new post to their own profile, even when they name another's", async () => {
      const { t, direct, author, profiles } = await boot(dialect);
      const unnamed = await direct.create({
        collection: POSTS,
        data: { title: "Credited to me" },
        ...as(author),
      });
      expect(await bylineOf(t, String(unnamed.item.id))).toBe(profiles.author);

      // The other profile is dropped, and the post is credited to theirs.
      const named = await direct.create({
        collection: POSTS,
        data: { title: "Credited to another", byline: profiles.other },
        ...as(author),
      });
      expect(await bylineOf(t, String(named.item.id))).toBe(profiles.author);
    });

    it("keep an author from moving their post's credit to another profile", async () => {
      const { t, direct, author, posts, profiles } = await boot(dialect);
      await direct.update({
        collection: POSTS,
        id: posts.own,
        data: {
          title: "Re-credited",
          byline: profiles.other,
          _overwrite: true,
        },
        ...as(author),
      });
      expect((await stored(t, posts.own))?.title).toBe("Re-credited");
      expect(await bylineOf(t, posts.own)).toBe(profiles.author);
    });

    it("let an editor credit a post to any profile", async () => {
      const { t, direct, editor, posts, profiles } = await boot(dialect);
      const created = await direct.create({
        collection: POSTS,
        data: { title: "For another", byline: profiles.other },
        ...as(editor),
      });
      expect(await bylineOf(t, String(created.item.id))).toBe(profiles.other);

      await direct.update({
        collection: POSTS,
        id: posts.own,
        data: { byline: profiles.other, _overwrite: true },
        ...as(editor),
      });
      expect(await bylineOf(t, posts.own)).toBe(profiles.other);
    });

    it("refuse a second profile for an account that has one", async () => {
      const { t, direct, author } = await boot(dialect);
      await expect(
        direct.create({
          collection: AUTHORS,
          data: {
            title: "Author again",
            name: "Author again",
            slug: "author-again",
            account: author,
          },
        })
      ).rejects.toThrow();
      const rows = await t.adapter.select<Record<string, unknown>>(
        `dc_${AUTHORS}`,
        {}
      );
      expect(rows.filter(row => row.account === author)).toHaveLength(1);
    });

    // A visual blog's Posts has no hooks of its own; the template's plugin
    // registers them, so a new post there is owned and credited as on a
    // code-first blog. Without the plugin the same post is neither, which is
    // what shows the plugin, not the collection, filled them.
    it("own and credit an author's new post on a visual blog, through the template's plugin", async () => {
      const visual = await boot(dialect, "visual");
      const created = await visual.direct.create({
        collection: POSTS,
        data: { title: "Written on a visual blog" },
        ...as(visual.author),
      });
      const id = String(created.item.id);
      expect(await authorOf(visual.t, id)).toBe(visual.author);
      expect(await bylineOf(visual.t, id)).toBe(visual.profiles.author);
      await visual.t.destroy();
      current = undefined;

      const bare = await boot(dialect, "visual without the plugin");
      const plain = await bare.direct.create({
        collection: POSTS,
        data: { title: "Written with no plugin" },
        ...as(bare.author),
      });
      expect(
        (await authorOf(bare.t, String(plain.item.id))) ?? null
      ).toBeNull();
      expect(await bylineOf(bare.t, String(plain.item.id))).toBeNull();
    });
  }
);
