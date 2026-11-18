/**
 * A page's own code, on every dialect: saved with the page (in its draft on
 * Save, live on Publish, and back with an older version on restore), judged
 * on the server on every write that changes it (refused from someone without
 * the site settings permission, from any API key, and where the site code
 * checks refuse it), and audited with hashes, sizes and counts, never the
 * code.
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pageBuilderContent } from "../page-content";
import { pageBuilder } from "../plugin";
import { PAGE_CODE_SAVED_AUDIT } from "../site-code/page-code-audit";

// No request here, so no draft mode: the published page as a visitor gets it.
vi.mock("next/headers", () => ({
  draftMode: async () => ({ isEnabled: false }),
}));

/** What the page adds to its own head: harmless, and easy to find. */
const CODE = { head: "<script>window.pageCodeTest = 1</script>", body: "" };

/** A page document, with `code` where given. */
function page(code?: Record<string, string>): Record<string, unknown> {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "t1",
        type: "core/text",
        version: 1,
        props: { text: "Hello" },
      },
    ],
    ...(code === undefined ? {} : { settings: { code } }),
  };
}

describe.each(getConfiguredTestDialects())(
  "a page's own code (%s)",
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
          name: `Page code ${name}`,
          slug: `page-code-${name}`,
          permissionIds: ids,
        },
      });
      await new ServiceContainer(t.adapter).userRoles.assignRoleToUser(
        created.item.id,
        role.item.id
      );
      return created.item.id;
    }

    const EDIT_PAGES = [
      "create-pages",
      "read-pages",
      "update-pages",
      "publish-pages",
    ];

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
      return row.content;
    }

    /** What the published page carries in its head, as `<PageCode>` writes it. */
    async function liveHead(t: TestNextly, id: string): Promise<string> {
      const document = await contentOf(t, id, false);
      // As the published route draws it: what `pageBuilderContent()` puts
      // around the page.
      const { before, after } = await pageBuilderContent().around({ document });
      expect(after ?? null).toBeNull();
      const written = before ?? null;
      return written === null ? "" : renderToStaticMarkup(written as never);
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

    /** The audit rows a change to page code wrote. */
    async function auditRows(
      t: TestNextly
    ): Promise<Array<Record<string, unknown>>> {
      const rows = await t.adapter.select<{ metadata: unknown }>("audit_log", {
        where: {
          and: [{ column: "kind", op: "=", value: PAGE_CODE_SAVED_AUDIT }],
        },
      });
      return rows.map(
        row =>
          (typeof row.metadata === "string"
            ? JSON.parse(row.metadata)
            : row.metadata) as Record<string, unknown>
      );
    }

    it("saves the code in the draft, makes it live on publish, restores an older version's, and audits it without the code", async () => {
      const t = await boot();
      const manager = await holding(
        t,
        "manager",
        ...EDIT_PAGES,
        "manage-page-builder-site"
      );
      const made = (await t.nextly.create({
        collection: "pages",
        data: {
          title: "Pricing",
          slug: "pricing",
          status: "published",
          content: page(),
        },
        overrideAccess: true,
      })) as unknown as { item?: { id: string }; id?: string };
      const id = String(made.item?.id ?? made.id);

      // Saved as a draft: on the draft, not on the live page.
      await t.nextly.update({
        collection: "pages",
        id,
        data: { content: page(CODE), _overwrite: true },
        draft: true,
        user: { id: manager },
        overrideAccess: false,
      } as never);
      expect(JSON.stringify(await contentOf(t, id, true))).toContain(
        "pageCodeTest"
      );
      expect(await liveHead(t, id)).toBe("");

      // Published: on the live page.
      await t.nextly.update({
        collection: "pages",
        id,
        data: { content: page(CODE), status: "published", _overwrite: true },
        user: { id: manager },
        overrideAccess: false,
      } as never);
      const live = await liveHead(t, id);
      expect(live).toContain("window.pageCodeTest = 1");
      expect(live).toContain('data-nx-site-code="head"');

      // Restoring the version from before the code takes it out of the
      // draft again.
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
        // The page's blocks, which hold its code.
        fields: ["content"],
        _overwrite: true,
        user: { id: manager },
        overrideAccess: false,
      } as never);
      expect(JSON.stringify(await contentOf(t, id, true))).not.toContain(
        "pageCodeTest"
      );

      // Each change audited: hashes, sizes and counts, which page, never
      // the code.
      const rows = await auditRows(t);
      expect(rows.length).toBeGreaterThanOrEqual(2);
      expect(rows[0]).toMatchObject({
        collection: "pages",
        entryId: id,
        field: "content",
        headChars: CODE.head.length,
        inlineScripts: 1,
      });
      expect(rows[0]?.headSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(JSON.stringify(rows)).not.toContain("pageCodeTest");
    });

    it("refuses a change from someone without the site settings permission, from an API key, and code the checks refuse", async () => {
      const t = await boot();
      const editor = await holding(t, "editor", ...EDIT_PAGES);
      const manager = await holding(
        t,
        "manager",
        ...EDIT_PAGES,
        "manage-page-builder-site"
      );
      const made = (await t.nextly.create({
        collection: "pages",
        data: { title: "About", slug: "about", content: page() },
        overrideAccess: true,
      })) as unknown as { item?: { id: string }; id?: string };
      const id = String(made.item?.id ?? made.id);
      const write = (who: string, code: Record<string, string>) =>
        refusalOf(() =>
          t.nextly.update({
            collection: "pages",
            id,
            data: { content: page(code), _overwrite: true },
            user: { id: who },
            overrideAccess: false,
          } as never)
        );

      expect(await write(editor, CODE)).toContain(
        "Only people who can change site settings can change a page's code."
      );
      // A key whose maker may change site settings, and whose own scope
      // may too, is still refused.
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
        { content: page(CODE), _overwrite: true }
      );
      expect(keyed.success).toBe(false);
      expect(JSON.stringify(keyed)).toContain(
        "An API key can't change a page's code."
      );
      // What the site code rules can't store.
      expect(
        await write(manager, { head: "", body: "<div>not code</div>" })
      ).toContain("PAGE_CODE_REFUSED");
      // Nothing of it was stored.
      expect(JSON.stringify(await contentOf(t, id, true))).not.toContain(
        "pageCodeTest"
      );
      expect(await auditRows(t)).toEqual([]);
      // The manager may.
      expect(await write(manager, CODE)).toBe("saved");
    });
  }
);
