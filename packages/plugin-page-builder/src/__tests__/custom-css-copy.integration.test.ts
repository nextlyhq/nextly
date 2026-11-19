/**
 * Custom CSS and page code copied unchanged from an entry the caller can
 * read, on every dialect: duplicating a page, saving a selection as a
 * section and turning one into a component keep the CSS and page code the
 * source holds, for someone without the site settings permission and for an
 * API key, because core reads the source as the caller before it creates
 * the copy. Text the source doesn't hold (an override, an edit), a source the
 * caller can't read, a draft-only text the caller couldn't see, and a copy
 * claimed through a REST request's body, query or headers are all refused.
 *
 * Through Nextly's own request handler with a signed session for the routes,
 * and the Direct API for a duplicate.
 *
 * @module __tests__/custom-css-copy.integration.test
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
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

const PAGE_CSS = "h1 { color: rebeccapurple; }";
const BLOCK_CSS = "selector { border: 4px solid blue; }";
const OTHER_CSS = "selector { border: 4px solid red; }";
const DRAFT_CSS = "selector { border: 4px dashed green; }";
const CODE = { head: "<script>window.copiedCodeTest = 1</script>", body: "" };

const CSS_REFUSED =
  "Only people who can change site settings can change custom CSS.";
const KEY_CSS_REFUSED = "An API key can't change custom CSS.";

const EDIT_PAGES = [
  "create-pages",
  "read-pages",
  "update-pages",
  "publish-pages",
];
const MAKE_LIBRARY = [
  "create-patterns",
  "publish-patterns",
  "read-patterns",
  "create-components",
  "publish-components",
  "read-components",
];

/** A block, with CSS where given. */
function block(
  id: string,
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id,
    type: "core/text",
    version: 1,
    props: { text: id },
    ...extra,
  };
}

/** A page with these blocks, and its own CSS and code where given. */
function page(
  nodes: Record<string, unknown>[],
  settings: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "page",
    nodes,
    ...(Object.keys(settings).length === 0 ? {} : { settings }),
  };
}

/** The page every case copies: page CSS, a block's CSS, and page code. */
const SOURCE = page([block("a", { customCss: BLOCK_CSS }), block("b")], {
  customCss: PAGE_CSS,
  code: CODE,
});

describe.each(getConfiguredTestDialects())(
  "custom CSS and page code copied unchanged (%s)",
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
      // The site's first user is its owner, granted everything. Made first,
      // so the people below hold only what the test gives them.
      await current.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      return current;
    }

    /** A person holding exactly the permissions named, by slug. */
    async function holding(
      t: TestNextly,
      name: string,
      ...slugs: string[]
    ): Promise<string> {
      const created = await t.nextly.users.create({
        email: `${name}@example.com`,
        password: "Password123!",
        data: { name, isActive: true },
      });
      const permissions = await t.nextly.permissions.find({ limit: 1000 });
      const ids = slugs.map(slug => {
        const found = permissions.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      const role = await t.nextly.roles.create({
        data: {
          name: `Copy ${name}`,
          slug: `copy-${name}`,
          permissionIds: ids,
        },
      });
      await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
        created.item.id,
        role.item.id
      );
      return created.item.id;
    }

    /** A signed session cookie for `userId`. */
    async function sessionOf(t: TestNextly, userId: string): Promise<string> {
      const user = await t.nextly.users.findByID({ id: userId });
      if (user === null) throw new Error(`no user ${userId}`);
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: user.email,
          name: user.name ?? "",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    /** A POST through the app's own request handler, as `cookie`. */
    async function post(
      cookie: string,
      segments: string[],
      body: unknown,
      extra: { query?: string; headers?: Record<string, string> } = {}
    ): Promise<{ status: number; text: string }> {
      const handlers = createDynamicHandlers();
      const url = `${ORIGIN}/api/${segments.join("/")}${extra.query ?? ""}`;
      const response = await handlers.POST(
        new Request(url, {
          method: "POST",
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
            ...extra.headers,
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ params: segments }) }
      );
      return { status: response.status, text: await response.text() };
    }

    /** A plugin route's segments. */
    const route = (...path: string[]) => [
      "plugins",
      ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
      ...path,
    ];

    /** A published page made by trusted code, holding `content`. */
    async function made(
      t: TestNextly,
      slug: string,
      content: Record<string, unknown>
    ): Promise<string> {
      const created = (await t.nextly.create({
        collection: "pages",
        data: { title: slug, slug, status: "published", content },
        overrideAccess: true,
      })) as unknown as { item?: { id: string }; id?: string };
      return String(created.item?.id ?? created.id);
    }

    /** A stored blocks value, parsed. */
    function parsed(value: unknown): Record<string, unknown> {
      return (typeof value === "string" ? JSON.parse(value) : value) as Record<
        string,
        unknown
      >;
    }

    /** A write's refusal, or "saved". */
    async function refusalOf(run: () => Promise<unknown>): Promise<string> {
      try {
        await run();
      } catch (error) {
        return JSON.stringify(error);
      }
      return "saved";
    }

    /** Duplicate the page as `who`, with overrides where given. */
    const duplicate = (
      t: TestNextly,
      id: string,
      who: string,
      overrides?: Record<string, unknown>
    ) =>
      t.nextly.duplicate({
        collection: "pages",
        id,
        ...(overrides === undefined ? {} : { overrides }),
        user: { id: who },
        overrideAccess: false,
      } as never) as unknown as Promise<{ item: Record<string, unknown> }>;

    it("lets an editor duplicate a page keeping its CSS and page code, and refuses an override that changes either", async () => {
      const t = await boot();
      const editor = await holding(t, "editor", ...EDIT_PAGES);
      const id = await made(t, "pricing", SOURCE);

      const copy = await duplicate(t, id, editor);
      const content = parsed(copy.item.content);
      expect(content.settings).toMatchObject({
        customCss: PAGE_CSS,
        code: CODE,
      });
      expect(JSON.stringify(content.nodes)).toContain(BLOCK_CSS);

      // An override that changes the page's CSS, a block's, or the code.
      const changed = (
        nodes: Record<string, unknown>[],
        settings: Record<string, unknown>
      ) =>
        refusalOf(() =>
          duplicate(t, id, editor, { content: page(nodes, settings) })
        );
      expect(
        await changed([block("a", { customCss: BLOCK_CSS })], {
          customCss: OTHER_CSS,
          code: CODE,
        })
      ).toContain(CSS_REFUSED);
      expect(
        await changed([block("a", { customCss: OTHER_CSS })], {
          customCss: PAGE_CSS,
          code: CODE,
        })
      ).toContain(CSS_REFUSED);
      expect(
        await changed([block("a", { customCss: BLOCK_CSS })], {
          customCss: PAGE_CSS,
          code: { head: "<script>window.other = 1</script>", body: "" },
        })
      ).toContain(
        "Only people who can change site settings can change a page's code."
      );
      // Kept by kind: the page's own CSS text placed on a block is new there.
      expect(
        await changed([block("a", { customCss: PAGE_CSS })], {
          customCss: PAGE_CSS,
          code: CODE,
        })
      ).toContain(CSS_REFUSED);
    });

    it("lets an API key duplicate a page byte for byte, and refuses its changed CSS", async () => {
      const t = await boot();
      const editor = await holding(t, "keyowner", ...EDIT_PAGES);
      const id = await made(t, "about", SOURCE);
      const handler = t.getService<{
        duplicateEntry: (
          params: Record<string, unknown>
        ) => Promise<{ success: boolean; data?: unknown }>;
      }>("collectionsHandler");
      const keyed = (overrides?: Record<string, unknown>) =>
        handler.duplicateEntry({
          collectionName: "pages",
          entryId: id,
          userId: editor,
          authenticatedScope: { actorType: "apiKey", permissions: EDIT_PAGES },
          ...(overrides === undefined ? {} : { overrides }),
        });

      const copied = await keyed();
      expect(copied.success).toBe(true);
      expect(JSON.stringify(copied.data)).toContain("rebeccapurple");

      const changed = await keyed({
        content: page([block("a", { customCss: OTHER_CSS })], {
          customCss: PAGE_CSS,
          code: CODE,
        }),
      });
      expect(changed.success).toBe(false);
      expect(JSON.stringify(changed)).toContain(KEY_CSS_REFUSED);
    });

    it("lets an editor save blocks with CSS as a section and turn them into a component, refusing changed CSS and a source they can't read", async () => {
      const t = await boot();
      const editor = await holding(t, "maker", ...EDIT_PAGES, ...MAKE_LIBRARY);
      // May make library entries, but can't read pages at all.
      const stranger = await holding(t, "stranger", ...MAKE_LIBRARY);
      const id = await made(t, "home", SOURCE);
      const asEditor = await sessionOf(t, editor);
      const asStranger = await sessionOf(t, stranger);
      const source = { collection: "pages", id, field: "content" };
      const edited = page([block("a", { customCss: OTHER_CSS }), block("b")]);

      const section = (cookie: string, document: unknown, title: string) =>
        post(cookie, route("save-as-pattern"), {
          document,
          selectedIds: ["a"],
          fields: { title, granularity: "section" },
          source,
        });
      const component = (cookie: string, document: unknown, title: string) =>
        post(cookie, route("components", "from-selection"), {
          action: "convert",
          apply: "library",
          document,
          selectedIds: ["a"],
          fields: { title },
          page: source,
        });

      // As stored: allowed, and the library entry keeps the block's CSS.
      const saved = await section(asEditor, SOURCE, "Hero");
      expect(saved.status, saved.text).toBe(201);
      expect(saved.text).toContain(BLOCK_CSS);
      const converted = await component(asEditor, SOURCE, "Card");
      expect(converted.status, converted.text).toBe(201);
      const components = await t.nextly.find({
        collection: "components",
        overrideAccess: true,
        depth: 0,
      });
      expect(JSON.stringify(components.items)).toContain(BLOCK_CSS);

      // CSS the page doesn't hold: refused.
      const changedSection = await section(asEditor, edited, "Changed");
      expect(changedSection.text).toContain(CSS_REFUSED);
      const changedComponent = await component(asEditor, edited, "Changed");
      expect(changedComponent.text).toContain(CSS_REFUSED);

      // A source the caller can't read: refused as not found.
      expect((await section(asStranger, SOURCE, "Hidden")).status).toBe(404);
      expect((await component(asStranger, SOURCE, "Hidden")).status).toBe(404);
    });

    it("vouches a draft's CSS only for a caller the read shows the draft", async () => {
      const t = await boot();
      const manager = await holding(
        t,
        "manager",
        ...EDIT_PAGES,
        "manage-page-builder-site"
      );
      const editor = await holding(
        t,
        "drafter",
        ...EDIT_PAGES,
        ...MAKE_LIBRARY
      );
      // May read the live page, not edit or publish it: never shown a draft.
      const reader = await holding(t, "reader", "read-pages", ...MAKE_LIBRARY);
      const id = await made(t, "news", SOURCE);
      // A pending draft holding CSS the live page doesn't.
      const drafted = page([block("a", { customCss: DRAFT_CSS }), block("b")]);
      expect(
        await refusalOf(() =>
          t.nextly.update({
            collection: "pages",
            id,
            data: { content: drafted, _overwrite: true },
            draft: true,
            user: { id: manager },
            overrideAccess: false,
          } as never)
        )
      ).toBe("saved");

      const section = async (who: string, document: unknown, title: string) =>
        post(await sessionOf(t, who), route("save-as-pattern"), {
          document,
          selectedIds: ["a"],
          fields: { title, granularity: "section" },
          source: { collection: "pages", id, field: "content" },
        });

      // The reader: the live CSS vouches, the draft's doesn't.
      const live = await section(reader, SOURCE, "Live");
      expect(live.status, live.text).toBe(201);
      const hidden = await section(reader, drafted, "Draft");
      expect(hidden.text).toContain(CSS_REFUSED);
      // An editor, whom the read shows the draft: it vouches.
      const shown = await section(editor, drafted, "Draft too");
      expect(shown.status, shown.text).toBe(201);
    });

    it("never takes a copy from a REST request's body, query or headers", async () => {
      const t = await boot();
      const editor = await holding(t, "rester", ...EDIT_PAGES);
      const cookie = await sessionOf(t, editor);
      // B holds the CSS; A holds none.
      const holder = await made(t, "holder", SOURCE);
      const plain = await made(t, "plain", page([block("a")]));
      const claim = {
        collection: "pages",
        id: holder,
        forms: ["published"],
        fields: ["content"],
      };
      const forged = {
        query: `?copiedFrom=${encodeURIComponent(JSON.stringify(claim))}`,
        headers: { "x-copied-from": JSON.stringify(claim) },
      };
      const css = page([block("a", { customCss: BLOCK_CSS })], {
        customCss: PAGE_CSS,
      });

      // A create claiming to copy B.
      const created = await post(
        cookie,
        ["collections", "pages", "entries"],
        {
          title: "Claimed",
          slug: "claimed",
          content: css,
          copiedFrom: claim,
        },
        forged
      );
      expect(created.text).toContain(CSS_REFUSED);

      // A duplicate of A whose override brings B's CSS, claiming to copy B.
      const duplicated = await post(
        cookie,
        ["collections", "pages", "entries", plain, "duplicate"],
        { overrides: { content: css }, copiedFrom: claim },
        forged
      );
      expect(duplicated.text).toContain(CSS_REFUSED);

      // The same duplicate of B itself: core read B, so B vouches.
      const real = await post(
        cookie,
        ["collections", "pages", "entries", holder, "duplicate"],
        { overrides: { content: css } }
      );
      expect(real.status, real.text).toBe(201);
    });
  }
);
