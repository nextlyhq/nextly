/**
 * Custom CSS written with a page, on every dialect: the page's own CSS is
 * saved in its draft on Save, drawn on the live page on Publish (after the
 * site's CSS) and taken back with an older version on restore; a change to
 * the page's or a block's CSS is judged on the server on every write
 * (refused from someone without the site settings permission and from any
 * API key, and where the checker refuses a line); moving, duplicating and
 * deleting a block that has CSS, and placing a saved section that carries
 * some, is allowed to anyone who may edit the page; and each change is
 * audited with hashes and sizes, never the CSS.
 */
import { compilePageCss, type BlockDocument } from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { afterEach, describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";
import { customCssPolicy } from "../site-code/css-check";
import { DOCUMENT_CSS_SAVED_AUDIT } from "../site-code/page-code-audit";

const SITE_CSS = ".site-mark { color: olive; }";
const PAGE_CSS = "h1 { color: rebeccapurple; }";
const BLOCK_CSS = "selector { border: 4px solid blue; }";
const OTHER_CSS = "selector { border: 4px solid red; }";

/** A block, with CSS where given, and where it was placed from. */
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

/** A page with these blocks, and its own CSS where given. */
function page(
  nodes: Record<string, unknown>[] = [block("t1")],
  css?: string
): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "page",
    nodes,
    ...(css === undefined ? {} : { settings: { customCss: css } }),
  };
}

const EDIT_PAGES = [
  "create-pages",
  "read-pages",
  "update-pages",
  "publish-pages",
];

describe.each(getConfiguredTestDialects())(
  "custom CSS written with a page (%s)",
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
          name: `Custom CSS ${name}`,
          slug: `custom-css-${name}`,
          permissionIds: ids,
        },
      });
      await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
        created.item.id,
        role.item.id
      );
      return created.item.id;
    }

    /** A page made by trusted code, holding `content`. */
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

    /** The page's blocks value, live or as its draft. */
    async function contentOf(
      t: TestNextly,
      id: string,
      draft: boolean
    ): Promise<unknown> {
      const row = (await t.nextly.findByID({
        collection: "pages",
        id,
        overrideAccess: true,
        status: "all",
        depth: 0,
        ...(draft ? { draft: true } : {}),
      })) as unknown as Record<string, unknown>;
      return typeof row.content === "string"
        ? JSON.parse(row.content)
        : row.content;
    }

    /** The live page's sheet, as the published route compiles it. */
    async function liveSheet(t: TestNextly, id: string): Promise<string> {
      const document = (await contentOf(t, id, false)) as BlockDocument;
      return compilePageCss(document, {
        breakpoints: { viewport: [], container: [] },
        customCss: customCssPolicy(SITE_CSS),
      }).css;
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

    /** Save `content` to the page's draft, or publish it, as `who`. */
    const save = (
      t: TestNextly,
      id: string,
      who: string,
      content: Record<string, unknown>,
      publish = false
    ) =>
      refusalOf(() =>
        t.nextly.update({
          collection: "pages",
          id,
          data: {
            content,
            _overwrite: true,
            ...(publish ? { status: "published" } : {}),
          },
          ...(publish ? {} : { draft: true }),
          user: { id: who },
          overrideAccess: false,
        } as never)
      );

    /** The audit rows a change to custom CSS wrote. */
    async function auditRows(
      t: TestNextly
    ): Promise<Array<Record<string, unknown>>> {
      const rows = await t.adapter.select<{ metadata: unknown }>("audit_log", {
        where: {
          and: [{ column: "kind", op: "=", value: DOCUMENT_CSS_SAVED_AUDIT }],
        },
      });
      return rows.map(
        row =>
          (typeof row.metadata === "string"
            ? JSON.parse(row.metadata)
            : row.metadata) as Record<string, unknown>
      );
    }

    it("saves page CSS in the draft, draws it live after the site's on publish, restores an older version's, and audits it without the CSS", async () => {
      const t = await boot();
      const manager = await holding(
        t,
        "manager",
        ...EDIT_PAGES,
        "manage-page-builder-site"
      );
      const id = await made(t, "pricing", page());

      // Saved as a draft: on the draft, not on the live page.
      expect(await save(t, id, manager, page(undefined, PAGE_CSS))).toBe(
        "saved"
      );
      expect(JSON.stringify(await contentOf(t, id, true))).toContain(
        "rebeccapurple"
      );
      expect(await liveSheet(t, id)).not.toContain("rebeccapurple");

      // Published: on the live page, after the site's CSS.
      expect(await save(t, id, manager, page(undefined, PAGE_CSS), true)).toBe(
        "saved"
      );
      const live = await liveSheet(t, id);
      expect(live).toContain("rebeccapurple");
      expect(live.indexOf("olive")).toBeGreaterThanOrEqual(0);
      expect(live.indexOf("olive")).toBeLessThan(live.indexOf("rebeccapurple"));

      // Restoring the version from before the CSS takes it out of the draft.
      const versions = (await t.nextly.versions.list({
        collection: "pages",
        id,
        overrideAccess: true,
      } as never)) as unknown as { items: { versionNo: number }[] };
      const oldest = Math.min(...versions.items.map(row => row.versionNo));
      await t.nextly.versions.restore({
        collection: "pages",
        id,
        versionNo: oldest,
        fields: ["content"],
        _overwrite: true,
        user: { id: manager },
        overrideAccess: false,
      } as never);
      expect(JSON.stringify(await contentOf(t, id, true))).not.toContain(
        "rebeccapurple"
      );

      // Each change audited: hashes and sizes, which page, never the CSS.
      const rows = await auditRows(t);
      const added = rows.find(row => row.cssChars === PAGE_CSS.length);
      expect(added).toMatchObject({
        collection: "pages",
        entryId: id,
        field: "content",
        cssCharsBefore: 0,
      });
      expect(added?.cssSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(rows.some(row => row.cssChars === 0)).toBe(true);
      expect(JSON.stringify(rows)).not.toContain("rebeccapurple");
    });

    it("refuses a CSS change from an editor and from an API key, and CSS the checker refuses, naming the line", async () => {
      const t = await boot();
      const editor = await holding(t, "editor", ...EDIT_PAGES);
      const manager = await holding(
        t,
        "manager",
        ...EDIT_PAGES,
        "manage-page-builder-site"
      );
      const id = await made(
        t,
        "about",
        page([block("t1", { customCss: BLOCK_CSS })])
      );
      // The page's making, by trusted code, wrote its own row.
      const madeRows = (await auditRows(t)).length;

      const refused =
        "Only people who can change site settings can change custom CSS.";
      // The page's CSS, and a block's CSS changed in place.
      expect(
        await save(
          t,
          id,
          editor,
          page([block("t1", { customCss: BLOCK_CSS })], PAGE_CSS)
        )
      ).toContain(refused);
      expect(
        await save(t, id, editor, page([block("t1", { customCss: OTHER_CSS })]))
      ).toContain(refused);
      // A key whose maker may change site settings, and whose own scope may
      // too, is still refused.
      const handler = t.getService<{
        updateEntry: (
          params: Record<string, unknown>,
          data: Record<string, unknown>
        ) => Promise<{ success: boolean; message?: string; data?: unknown }>;
      }>("collectionsHandler");
      const keyed = await handler.updateEntry(
        {
          collectionName: "pages",
          entryId: id,
          userId: manager,
          authenticatedScope: {
            actorType: "apiKey",
            permissions: [...EDIT_PAGES, "manage-page-builder-site"],
          },
        },
        {
          content: page([block("t1", { customCss: OTHER_CSS })]),
          _overwrite: true,
        }
      );
      expect(keyed.success).toBe(false);
      expect(JSON.stringify(keyed)).toContain(
        "An API key can't change custom CSS."
      );
      // What the checker refuses, named by its line.
      expect(
        await save(
          t,
          id,
          manager,
          page(
            [block("t1", { customCss: BLOCK_CSS })],
            "p { color: red; }\n@import url(https://example.com/x.css);"
          )
        )
      ).toContain("Line 2: @import isn't allowed.");
      // Nothing of it was stored, and nothing audited.
      const stored = JSON.stringify(await contentOf(t, id, true));
      expect(stored).not.toContain("solid red");
      expect(stored).not.toContain("@import");
      expect(await auditRows(t)).toHaveLength(madeRows);
      // The manager may.
      expect(
        await save(
          t,
          id,
          manager,
          page([block("t1", { customCss: OTHER_CSS })])
        )
      ).toBe("saved");
    });

    it("lets an editor duplicate, move and delete a block that has CSS, and place a saved section that carries some, but not change it", async () => {
      const t = await boot();
      const editor = await holding(t, "editor", ...EDIT_PAGES);
      const id = await made(
        t,
        "home",
        page([block("a", { customCss: BLOCK_CSS }), block("b")])
      );

      // Duplicated: both copies keep the CSS.
      expect(
        await save(
          t,
          id,
          editor,
          page([
            block("a", { customCss: BLOCK_CSS }),
            block("a2", { customCss: BLOCK_CSS }),
            block("b"),
          ])
        )
      ).toBe("saved");
      const duplicated = (await contentOf(t, id, true)) as {
        nodes: { customCss?: string }[];
      };
      expect(
        duplicated.nodes.filter(node => node.customCss === BLOCK_CSS)
      ).toHaveLength(2);
      // Moved, then deleted.
      expect(
        await save(
          t,
          id,
          editor,
          page([
            block("b"),
            block("a2", { customCss: BLOCK_CSS }),
            block("a", { customCss: BLOCK_CSS }),
          ])
        )
      ).toBe("saved");
      expect(
        await save(
          t,
          id,
          editor,
          page([block("b"), block("a", { customCss: BLOCK_CSS })])
        )
      ).toBe("saved");

      // A saved section a manager made, whose block carries CSS.
      const section = (await t.nextly.create({
        collection: "patterns",
        data: {
          title: "Banner",
          slug: "banner",
          granularity: "section",
          content: {
            ...page([block("x", { customCss: OTHER_CSS })]),
            kind: "pattern",
          },
          status: "published",
        },
        overrideAccess: true,
      })) as unknown as { item?: { id: string }; id?: string };
      const sectionId = String(section.item?.id ?? section.id);
      const origin = { from: "pattern", id: sectionId, digest: "d" };
      // Placed by the editor: allowed.
      const placed = [
        block("b"),
        block("a", { customCss: BLOCK_CSS }),
        block("x1", { customCss: OTHER_CSS, origin }),
      ];
      expect(await save(t, id, editor, page(placed))).toBe("saved");
      // Then changing the placed block's CSS: refused.
      expect(
        await save(
          t,
          id,
          editor,
          page([
            block("b"),
            block("a", { customCss: BLOCK_CSS }),
            block("x1", { customCss: "selector { color: green; }", origin }),
          ])
        )
      ).toContain("Only people who can change site settings");
    });
  }
);
