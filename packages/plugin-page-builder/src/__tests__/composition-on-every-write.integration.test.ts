/**
 * A composed document is judged on every path a write can take.
 *
 * The unit suites judge the composition against an in-memory store. What only
 * a database can show is the part core contributes: that the field's
 * validation runs on the batch path with hooks skipped, that its reads are on
 * the batch's own transaction — so a row an earlier entry of the same batch
 * wrote is seen — that a status-only publish is judged on the document it
 * promotes, and that a component save finds the pages placing it through the
 * usage index the page writes maintain.
 *
 * Per dialect, because the transaction a read joins is the adapter's.
 *
 * @module __tests__/composition-on-every-write.integration.test
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

type Node = Record<string, unknown>;

const text = (id: string): Node => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: 2 },
});

const box = (id: string, children: Node[]): Node => ({
  id,
  type: "core/box",
  version: 1,
  props: {},
  slots: { children },
});

const placing = (id: string, componentId: string, extra: Node = {}): Node => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
  ...extra,
});

const document = (
  kind: "page" | "component",
  nodes: Node[],
  envelope: Node = {}
) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind,
  nodes,
  ...envelope,
});

/** The validation issues a refused write carries. */
function issuesOf(
  error: unknown
): Array<{ path: string; code: string; message: string }> {
  return (
    (
      error as {
        publicData?: {
          errors?: Array<{ path: string; code: string; message: string }>;
        };
      }
    ).publicData?.errors ?? []
  );
}

const codesOf = (error: unknown) => issuesOf(error).map(issue => issue.code);

/** What a write threw, or `undefined` when it went through. */
async function refusalOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
}

/** The entry service, as a translated collection's writes reach it. */
interface TranslatedEntries {
  createEntry(
    params: {
      collectionName: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Record<string, unknown>
  ): Promise<{ success: boolean; data: unknown }>;
  updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Record<string, unknown>
  ): Promise<{ success: boolean }>;
  publishAllLocales(params: {
    collectionName: string;
    entryId: string;
    overrideAccess?: boolean;
  }): Promise<{ success: boolean }>;
}

/** The batch worker behind every bulk write, imports included. */
interface BatchEntries {
  updateEntries(
    params: { collectionName: string; overrideAccess?: boolean },
    entries: { id: string; data: Record<string, unknown> }[],
    options?: { skipHooks?: boolean }
  ): Promise<{
    successful: number;
    failed: number;
    errors: { error: string }[];
  }>;
}

function batchOf(t: TestNextly): BatchEntries {
  const handler = t.getService("collectionsHandler") as unknown as {
    getEntryService(): BatchEntries;
  };
  return handler.getEntryService();
}

/**
 * Write a component's live content straight to its row, past every check, as
 * an older writer could have left it.
 */
async function plant(
  t: TestNextly,
  dialect: TestDialect,
  id: string,
  nodes: Node[]
): Promise<void> {
  const registry = t.getService("collectionRegistryService") as unknown as {
    getCollectionBySlug(slug: string): Promise<{ tableName: string } | null>;
  };
  const table = (await registry.getCollectionBySlug(COMPONENTS_SLUG))!
    .tableName;
  const planted = document("component", nodes);
  await t.adapter.update(
    table,
    // SQLite stores a JSON column as text; the others take the value.
    { content: dialect === "sqlite" ? JSON.stringify(planted) : planted },
    { and: [{ column: "id", op: "=", value: id }] }
  );
}

describe.each(getConfiguredTestDialects())(
  "composition judged on every write path (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /** Boot with a small depth limit, so a too-deep document stays readable. */
    async function boot(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder({ limits: { ...DEFAULT_LIMITS, maxDepth: 4 } })],
      });
      return current;
    }

    async function component(
      t: TestNextly,
      slug: string,
      nodes: Node[],
      envelope: Node = {}
    ) {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: slug,
          slug,
          content: document("component", nodes, envelope),
        },
        overrideAccess: true,
      });
      return String(created.item.id);
    }

    async function storedContent(t: TestNextly, id: string): Promise<unknown> {
      const row = await t.nextly.findByID({
        collection: COMPONENTS_SLUG,
        id,
        depth: 0,
        status: "all",
        draft: true,
        overrideAccess: true,
      });
      return (row as Record<string, unknown>).content;
    }

    it("refuses a loop an import writes with hooks skipped", async () => {
      const t = await boot();
      const a = await component(t, "a", [text("t1")]);
      const b = await component(t, "b", [placing("n1", a)]);

      const result = await batchOf(t).updateEntries(
        { collectionName: COMPONENTS_SLUG, overrideAccess: true },
        [
          {
            id: a,
            data: { content: document("component", [placing("n2", b)]) },
          },
        ],
        { skipHooks: true }
      );

      expect(result.failed, JSON.stringify(result)).toBe(1);
      // And nothing landed: `a` still holds only its text.
      expect(JSON.stringify(await storedContent(t, a))).not.toContain(b);
    });

    it("refuses the second half of a loop two entries of one batch close", async () => {
      // Each entry alone closes nothing against the library as committed. Only
      // a read on the batch's own transaction sees the first entry's row when
      // the second is judged.
      const t = await boot();
      const a = await component(t, "a", [text("t1")]);
      const b = await component(t, "b", [text("t2")]);

      const result = await batchOf(t).updateEntries(
        { collectionName: COMPONENTS_SLUG, overrideAccess: true },
        [
          {
            id: a,
            data: { content: document("component", [placing("n1", b)]) },
          },
          {
            id: b,
            data: { content: document("component", [placing("n2", a)]) },
          },
        ],
        { skipHooks: true }
      );

      expect(result.successful, JSON.stringify(result)).toBe(1);
      expect(result.failed).toBe(1);
      expect(JSON.stringify(await storedContent(t, b))).not.toContain(a);
    });

    it("refuses a status-only publish whose pending draft closes a loop", async () => {
      // The loop is planted in storage directly, as an older writer could have
      // left it: `b`'s live row places `a`, and `a`'s pending draft places `b`.
      // Publishing `a` by status alone promotes that draft, and is what is judged.
      const t = await boot();
      const a = await component(t, "a", [text("t1")]);
      const b = await component(t, "b", [text("t2")]);
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: a,
        data: { status: "published" },
        overrideAccess: true,
      });
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: a,
        data: { content: document("component", [placing("n1", b)]) },
        overrideAccess: true,
      });
      await plant(t, dialect, b, [placing("n2", a)]);

      const refused = await refusalOf(
        t.nextly.update({
          collection: COMPONENTS_SLUG,
          id: a,
          data: { status: "published" },
          overrideAccess: true,
        })
      );

      expect(codesOf(refused)).toEqual(["COMPONENT_CYCLE"]);
    });

    it("refuses a page that composes past the depth limit", async () => {
      const t = await boot();
      const deep = await component(t, "deep", [box("d1", [text("d2")])]);

      // Placed four deep and two deep inside: five, past the limit of four,
      // while the page alone is four and the component alone two.
      const pastLimit = page(t, [
        box("p1", [box("p2", [box("p3", [placing("i1", deep)])])]),
      ]);
      expect(codesOf(await refusalOf(pastLimit))).toEqual(["depth-exceeded"]);

      // CONTROL: one level higher ends exactly at the limit, which fits.
      await expect(
        page(t, [box("p1", [box("p2", [placing("i1", deep)])])])
      ).resolves.toBeDefined();
    });

    it("refuses page content a placement puts where the component cannot hold it", async () => {
      const t = await boot();
      const row = await component(
        t,
        "row",
        [
          {
            id: "c",
            type: "core/columns",
            version: 1,
            props: {},
            slots: { children: [] },
          },
        ],
        { slots: { cells: { label: "Cells", nodeId: "c", slot: "children" } } }
      );

      const refused = await refusalOf(
        page(t, [
          placing("i1", row, { slots: { cells: [text("not-a-column")] } }),
        ])
      );

      expect(codesOf(refused)).toContain("not-allowed-in-slot");
    });

    it("refuses deepening a component a page places at the depth limit", async () => {
      const t = await boot();
      const deep = await component(t, "deep", [box("d1", [text("d2")])]);
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: deep,
        data: { status: "published" },
        overrideAccess: true,
      });
      // Placed three deep and two deep inside: exactly the limit of four.
      const home = await page(t, [
        box("p1", [box("p2", [placing("i1", deep)])]),
      ]);
      // The usage index is maintained once the page's write commits.
      await t.events.settle();

      const refused = await refusalOf(
        t.nextly.update({
          collection: COMPONENTS_SLUG,
          id: deep,
          data: {
            status: "published",
            content: document("component", [
              box("d1", [box("d2", [text("d3")])]),
            ]),
          },
          overrideAccess: true,
        })
      );

      expect(codesOf(refused)).toEqual(["COMPONENT_HOST_BROKEN"]);
      // How many and which rule; the page itself is named only to the server
      // log, since it was found and read as the system.
      expect(issuesOf(refused)[0]!.message).toContain("break 1 document");
      expect(issuesOf(refused)[0]!.message).not.toContain(String(home.item.id));
    });

    /**
     * A component whose two forms disagree on depth: published three deep, its
     * pending draft one deep. A page placing it three deep fits the limit of
     * four against the draft and is past it against what is published.
     */
    async function componentDeeperWhenPublished(t: TestNextly) {
      const id = await component(t, "split", [
        box("d1", [box("d2", [text("d3")])]),
      ]);
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id,
        data: { status: "published" },
        overrideAccess: true,
      });
      // No status named: stored as the working draft, the live row untouched.
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id,
        data: { content: document("component", [text("d1")]) },
        overrideAccess: true,
      });
      return id;
    }

    function publish(t: TestNextly, id: string) {
      return t.nextly.update({
        collection: "pages",
        id,
        data: { status: "published" },
        overrideAccess: true,
      });
    }

    it("refuses a status-only first publication the published forms put past the limit", async () => {
      const t = await boot();
      const split = await componentDeeperWhenPublished(t);
      // A draft page is judged against the forms a preview shows: the draft.
      const home = await page(
        t,
        [box("p1", [box("p2", [placing("i1", split)])])],
        "draft"
      );

      // The page has no working draft of its own: its row is what goes live.
      const refused = await refusalOf(publish(t, String(home.item.id)));

      // Named on the field, so the editor can show it where the content is.
      expect(issuesOf(refused)).toEqual([
        expect.objectContaining({ path: "content", code: "depth-exceeded" }),
      ]);
    });

    it("refuses a status-only republish after an unpublish the published forms put past the limit", async () => {
      const t = await boot();
      const split = await componentDeeperWhenPublished(t);
      // CONTROL: placed at the top, the published form fits too, so the page
      // publishes; this also shows the publish path itself goes through.
      const home = await page(t, [placing("i1", split)], "draft");
      const id = String(home.item.id);
      await expect(publish(t, id)).resolves.toBeDefined();
      await t.nextly.update({
        collection: "pages",
        id,
        data: { status: "draft" },
        overrideAccess: true,
      });
      // Deepened while unpublished, which a draft is judged on the draft forms for.
      await t.nextly.update({
        collection: "pages",
        id,
        data: {
          content: document("page", [
            box("p1", [box("p2", [placing("i1", split)])]),
          ]),
        },
        overrideAccess: true,
      });

      const refused = await refusalOf(publish(t, id));

      expect(issuesOf(refused)).toEqual([
        expect.objectContaining({ path: "content", code: "depth-exceeded" }),
      ]);
    });

    it("refuses publishing every language of a translated page when one language composes past the limit as published", async () => {
      const t = await bootTranslated();
      const entries = translatedEntries(t);
      const split = await componentDeeperWhenPublished(t);
      // English places the component at the top, which fits in both forms.
      const created = await entries.createEntry(
        { collectionName: "articles", overrideAccess: true, locale: "en" },
        {
          title: "Home",
          content: document("page", [placing("i1", split)]),
          status: "draft",
        }
      );
      expect(created.success, JSON.stringify(created)).toBe(true);
      const id = String((created.data as { id: unknown }).id);
      // German places it three deep: judged as a draft, against the draft forms.
      const german = await entries.updateEntry(
        {
          collectionName: "articles",
          entryId: id,
          locale: "de",
          overrideAccess: true,
        },
        {
          title: "Start",
          content: document("page", [
            box("p1", [box("p2", [placing("i1", split)])]),
          ]),
          status: "draft",
        }
      );
      expect(german.success, JSON.stringify(german)).toBe(true);

      const result = await entries.publishAllLocales({
        collectionName: "articles",
        entryId: id,
        overrideAccess: true,
      });

      // This path reports a refusal in its result rather than by throwing.
      expect(result.success).toBe(false);
      expect(JSON.stringify(result)).toContain("depth-exceeded");
      expect(JSON.stringify(result)).toContain('"path":"content"');
    });

    it("refuses a status-only publish on a collection that keeps no drafts", async () => {
      // No working draft can exist here at all: the row as stored is what
      // every publish puts live.
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder({ limits: { ...DEFAULT_LIMITS, maxDepth: 4 } })],
        collections: [
          {
            slug: "notes",
            status: true,
            fields: [
              { name: "title", type: "text" },
              { name: "content", type: BLOCKS_TYPE },
            ],
          } as never,
        ],
      });
      const t = current;
      const split = await componentDeeperWhenPublished(t);
      const note = await t.nextly.create({
        collection: "notes",
        data: {
          title: "Note",
          content: document("page", [
            box("p1", [box("p2", [placing("i1", split)])]),
          ]),
          status: "draft",
        },
        overrideAccess: true,
      });

      const refused = await refusalOf(
        t.nextly.update({
          collection: "notes",
          id: String(note.item.id),
          data: { status: "published" },
          overrideAccess: true,
        })
      );

      expect(issuesOf(refused)).toEqual([
        expect.objectContaining({ path: "content", code: "depth-exceeded" }),
      ]);
    });

    it("does not re-judge a translation already live when its status is sent again", async () => {
      const t = await bootTranslated();
      const entries = translatedEntries(t);
      const shallow = await component(t, "shallow", [text("s1")]);
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id: shallow,
        data: { status: "published" },
        overrideAccess: true,
      });
      const created = await entries.createEntry(
        { collectionName: "articles", overrideAccess: true, locale: "en" },
        { title: "Home", content: document("page", []), status: "draft" }
      );
      const id = String((created.data as { id: unknown }).id);
      // German goes live placing the component three deep, which fits.
      const deepGerman = document("page", [
        box("p1", [box("p2", [placing("i1", shallow)])]),
      ]);
      const live = await entries.updateEntry(
        {
          collectionName: "articles",
          entryId: id,
          locale: "de",
          overrideAccess: true,
        },
        { title: "Start", content: deepGerman, status: "published" }
      );
      expect(live.success, JSON.stringify(live)).toBe(true);
      // The component deepens in storage, as an older writer could have left
      // it, so German as stored would now be refused if it were judged.
      await plant(t, dialect, shallow, [box("d1", [box("d2", [text("d3")])])]);

      const again = await entries.updateEntry(
        {
          collectionName: "articles",
          entryId: id,
          locale: "de",
          overrideAccess: true,
        },
        { status: "published" }
      );

      // Nothing goes live that was not live already, so nothing is judged.
      expect(again.success, JSON.stringify(again)).toBe(true);
    });

    /** A translated collection holding a blocks field, per language. */
    async function bootTranslated(): Promise<TestNextly> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder({ limits: { ...DEFAULT_LIMITS, maxDepth: 4 } })],
        collections: [
          {
            slug: "articles",
            status: true,
            localized: true,
            fields: [
              { name: "title", type: "text", localized: true },
              { name: "content", type: BLOCKS_TYPE, localized: true },
            ],
          } as never,
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      return current;
    }

    function translatedEntries(t: TestNextly): TranslatedEntries {
      return (
        t.getService("collectionsHandler") as unknown as {
          getEntryService(): TranslatedEntries;
        }
      ).getEntryService();
    }

    function page(
      t: TestNextly,
      nodes: Node[],
      status?: "draft" | "published"
    ) {
      return t.nextly.create({
        collection: "pages",
        data: {
          title: "Home",
          slug: `home-${String(Math.random()).slice(2, 8)}`,
          content: document("page", nodes),
          ...(status === undefined ? {} : { status }),
        },
        overrideAccess: true,
      });
    }
  }
);
