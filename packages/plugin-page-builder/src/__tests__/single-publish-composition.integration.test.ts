/**
 * A Single's blocks are judged against the published library when it goes live.
 *
 * A draft is judged against the forms a preview shows, which are the drafts of
 * the components it places. Publishing makes the document's readers the
 * public, who receive the published forms, so each way a Single is published
 * must judge it again as published: `publishAllLocales` promoting a pending
 * change whose snapshot still says draft, and a publish with nothing pending,
 * which puts the stored row live as it stands.
 *
 * Per dialect, because the refusal comes from reads on the publish's own
 * transaction.
 *
 * @module __tests__/single-publish-composition.integration.test
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

const SLUG = "landing";

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

const placing = (id: string, componentId: string): Node => ({
  id,
  type: COMPONENT_INSTANCE_TYPE,
  version: 1,
  props: { componentId },
});

const document = (kind: "page" | "component", nodes: Node[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind,
  nodes,
});

interface Singles {
  update(
    slug: string,
    data: Record<string, unknown>,
    options: { locale?: string; overrideAccess?: boolean }
  ): Promise<{ success: boolean }>;
  publishAllLocales(
    slug: string,
    options: { overrideAccess?: boolean }
  ): Promise<unknown>;
}

/** The issues a refused publish carries, or `undefined` when it went through. */
async function refusalOf(
  publish: Promise<unknown>
): Promise<Array<{ path: string; code: string }> | undefined> {
  try {
    await publish;
    return undefined;
  } catch (error) {
    return (
      (
        error as {
          publicData?: { errors?: Array<{ path: string; code: string }> };
        }
      ).publicData?.errors ?? []
    );
  }
}

describe.each(getConfiguredTestDialects())(
  "a Single's blocks judged as published when it goes live (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /**
     * A localized Single with drafts, and a small depth limit. Its blocks are
     * translated unless `sharedContent`, which keeps one document for every
     * language on the main row.
     */
    async function boot(
      sharedContent = false
    ): Promise<{ t: TestNextly; singles: Singles }> {
      current = await createTestNextly({
        dialect,
        plugins: [pageBuilder({ limits: { ...DEFAULT_LIMITS, maxDepth: 4 } })],
        singles: [
          {
            slug: SLUG,
            localized: true,
            status: true,
            versions: { drafts: true },
            fields: [
              { name: "title", type: "text", localized: true },
              {
                name: "content",
                type: BLOCKS_TYPE,
                localized: !sharedContent,
              },
            ],
          } as never,
        ],
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      return {
        t: current,
        singles: current.getService("singleEntryService") as unknown as Singles,
      };
    }

    /**
     * A component published three deep whose pending draft is one deep. Placed
     * three deep, it fits the limit of four as a draft and not as published.
     */
    async function componentDeeperWhenPublished(t: TestNextly) {
      const created = await t.nextly.create({
        collection: COMPONENTS_SLUG,
        data: {
          title: "split",
          slug: "split",
          content: document("component", [
            box("d1", [box("d2", [text("d3")])]),
          ]),
        },
        overrideAccess: true,
      });
      const id = String(created.item.id);
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id,
        data: { status: "published" },
        overrideAccess: true,
      });
      await t.nextly.update({
        collection: COMPONENTS_SLUG,
        id,
        data: { content: document("component", [text("d1")]) },
        overrideAccess: true,
      });
      return id;
    }

    const threeDeep = (split: string) =>
      document("page", [box("p1", [box("p2", [placing("i1", split)])])]);

    it("refuses publishing every language when a pending change composes past the limit as published", async () => {
      const { t, singles } = await boot();
      const split = await componentDeeperWhenPublished(t);
      // The default language stays a draft, so the main row says draft; German
      // is live, with the component at the top, which fits as published too.
      const english = await singles.update(
        SLUG,
        { content: document("page", [placing("i1", split)]), status: "draft" },
        { locale: "en", overrideAccess: true }
      );
      expect(english.success, JSON.stringify(english)).toBe(true);
      const german = await singles.update(
        SLUG,
        {
          content: document("page", [placing("i1", split)]),
          status: "published",
        },
        { locale: "de", overrideAccess: true }
      );
      expect(german.success, JSON.stringify(german)).toBe(true);
      // A status-less edit of live German is held as its pending change, and
      // judged against the draft forms, which it fits. The change is held
      // under the main row's status, a draft's.
      const held = await singles.update(
        SLUG,
        { content: threeDeep(split) },
        { locale: "de", overrideAccess: true }
      );
      expect(held.success, JSON.stringify(held)).toBe(true);

      const issues = await refusalOf(
        singles.publishAllLocales(SLUG, { overrideAccess: true })
      );

      // Named on the field, so the editor can show it where the content is.
      expect(issues).toEqual([
        expect.objectContaining({ path: "content", code: "depth-exceeded" }),
      ]);
    });

    it("refuses publishing every language when a draft with nothing pending composes past the limit as published", async () => {
      const { t, singles } = await boot();
      const split = await componentDeeperWhenPublished(t);
      // Never published: the edit is the stored row itself, judged as a draft.
      const draft = await singles.update(
        SLUG,
        { content: threeDeep(split), status: "draft" },
        { locale: "en", overrideAccess: true }
      );
      expect(draft.success, JSON.stringify(draft)).toBe(true);

      const issues = await refusalOf(
        singles.publishAllLocales(SLUG, { overrideAccess: true })
      );

      expect(issues).toEqual([
        expect.objectContaining({ path: "content", code: "depth-exceeded" }),
      ]);
    });

    it("refuses publishing every language when only shared content was edited and it composes past the limit as published", async () => {
      // No language was written, so no translation row exists: the shared
      // blocks live on the main row alone, which goes live with its status.
      const { t, singles } = await boot(true);
      const split = await componentDeeperWhenPublished(t);
      const shared = await singles.update(
        SLUG,
        { content: threeDeep(split) },
        { overrideAccess: true }
      );
      expect(shared.success, JSON.stringify(shared)).toBe(true);
      // A Single created with no translated defaults has no translation row
      // at all; the write above may have left the default language's, so the
      // state is made exact here.
      await t.adapter.delete(`single_${SLUG}_locales`, {
        and: [{ column: "_locale", op: "IS NOT NULL" }],
      });

      const issues = await refusalOf(
        singles.publishAllLocales(SLUG, { overrideAccess: true })
      );

      expect(issues).toEqual([
        expect.objectContaining({ path: "content", code: "depth-exceeded" }),
      ]);
    });

    it("refuses a status-only publish of a draft language the published forms put past the limit", async () => {
      const { t, singles } = await boot();
      const split = await componentDeeperWhenPublished(t);
      const draft = await singles.update(
        SLUG,
        { content: threeDeep(split), status: "draft" },
        { locale: "en", overrideAccess: true }
      );
      expect(draft.success, JSON.stringify(draft)).toBe(true);

      // `update` reports a refusal in its result rather than by throwing.
      const published = (await singles.update(
        SLUG,
        { status: "published" },
        { locale: "en", overrideAccess: true }
      )) as { success: boolean; errors?: unknown; error?: unknown };

      expect(published.success).toBe(false);
      expect(JSON.stringify(published)).toContain("depth-exceeded");
    });
  }
);
