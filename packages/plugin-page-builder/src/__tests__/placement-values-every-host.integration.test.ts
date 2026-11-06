/**
 * A placement's values are judged on every kind of document that holds them,
 * and on an import.
 *
 * A page is not the only host of placement values: a Single with a blocks
 * field, another component and a pattern each place components too, and an
 * import writes them past every hook. The judgement lives in the blocks
 * field's validation for that reason, and the unit suites pin it there. What
 * only a real write shows is that each host's own write path reaches it:
 * through the dispatcher as an author's save arrives, and through the batch
 * worker with hooks skipped, as an import's does. On each, a value for an
 * exposed field is saved, an id the component does not expose and a value of
 * the wrong type are refused naming the field, and a value the host already
 * held for a field no longer exposed (and never retired) is kept until the
 * write changes it.
 *
 * Per dialect, because each stores the document differently and the kept
 * value is compared with what the dialect reads back.
 *
 * @module __tests__/placement-values-every-host.integration.test
 */

// Set before the harness boots: the dispatcher verifies the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  COMPONENT_INSTANCE_TYPE,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { PAGES_SLUG } from "../collections/pages";
import { PATTERNS_SLUG } from "../collections/patterns";
import { BLOCKS_TYPE } from "../fields/blocksField";
import { pageBuilder } from "../plugin";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);
const HOMEPAGE = "homepage";

type Row = Record<string, unknown>;
type Kind = "page" | "component" | "pattern";

/** A header exposing its headline, as text. */
const HEADER: Row = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "title",
      type: "core/heading",
      version: 1,
      props: { text: "Site name", level: "h2" },
    },
  ],
  exposed: [
    {
      id: "headline",
      label: "Headline",
      nodeId: "title",
      propPath: "text",
      type: "text",
    },
  ],
};

/** A document of `kind` placing the header once, with the values given. */
const placing = (kind: Kind, componentId: string, overrides: Row): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind,
  nodes: [
    {
      id: "p1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: { componentId, overrides },
    },
  ],
});

/** A stored blocks value as a document, whichever way the dialect keeps it. */
function overridesIn(stored: unknown): unknown {
  const document = (
    typeof stored === "string" ? JSON.parse(stored) : stored
  ) as { nodes: { props: Row }[] };
  return document.nodes[0]?.props.overrides;
}

/** The batch worker behind every bulk write, imports included. */
interface BatchEntries {
  createEntries(
    params: { collectionName: string; overrideAccess?: boolean },
    entries: Row[],
    options?: { skipHooks?: boolean }
  ): Promise<{
    successful: number;
    failed: number;
    errors: { index: number; error: string; code?: string }[];
  }>;
}

/** One kind of document that places components, and how it is written. */
interface Host {
  readonly name: string;
  readonly kind: Kind;
  /** The dispatcher path a save of it is sent to. */
  readonly path: () => string[];
  /** The body of that save, around its blocks value. */
  readonly body: (content: Row) => Row;
  /** The overrides its stored value holds. */
  readonly stored: () => Promise<unknown>;
  /** Store `content` straight to its row, past every check. */
  readonly plant: (content: Row) => Promise<void>;
}

describe.each(getConfiguredTestDialects())(
  "a placement's values on every host (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let owner = "";
    let componentId = "";
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      t = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        singles: [
          {
            slug: HOMEPAGE,
            fields: [{ name: "content", type: BLOCKS_TYPE }],
          } as never,
        ],
      });
      // The site's first user is its owner, granted everything: the refusals
      // below are about the values, not about who sends them.
      const first = await t.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      const token = await signAccessToken(
        buildClaims({
          userId: first.item.id,
          email: first.item.email,
          name: "Owner",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      owner = `nextly_session=${token}`;

      componentId = String(
        (
          await t.nextly.create({
            collection: COMPONENTS_SLUG,
            data: {
              title: "Header",
              slug: "header",
              content: HEADER,
              status: "published",
            },
            overrideAccess: true,
          })
        ).item.id
      );
      ids.card = String(
        (
          await t.nextly.create({
            collection: COMPONENTS_SLUG,
            data: {
              title: "Card",
              slug: "card",
              content: placing("component", componentId, {}),
            },
            overrideAccess: true,
          })
        ).item.id
      );
      ids.pattern = String(
        (
          await t.nextly.create({
            collection: PATTERNS_SLUG,
            data: {
              title: "Hero",
              slug: "hero",
              granularity: "section",
              content: placing("pattern", componentId, {}),
            },
            overrideAccess: true,
          })
        ).item.id
      );
      await t.nextly.updateSingle({
        slug: HOMEPAGE,
        data: { content: placing("page", componentId, {}), _overwrite: true },
        overrideAccess: true,
      });
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    async function patch(
      path: string[],
      body: unknown
    ): Promise<{ status: number; text: string }> {
      const response = await createDynamicHandlers().PATCH(
        new Request(`${ORIGIN}/api/${path.join("/")}`, {
          method: "PATCH",
          headers: {
            cookie: `${owner}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ params: path }) }
      );
      return { status: response.status, text: await response.text() };
    }

    /** Write a stored value to `table`'s row `id`, as an older writer left it. */
    async function writeRow(
      table: string,
      id: string,
      content: Row
    ): Promise<void> {
      await t.adapter.update(
        table,
        // SQLite stores a JSON column as text; the others take the value.
        { content: dialect === "sqlite" ? JSON.stringify(content) : content },
        { and: [{ column: "id", op: "=", value: id }] }
      );
    }

    async function collectionTable(slug: string): Promise<string> {
      const registry = t.getService("collectionRegistryService") as unknown as {
        getCollectionBySlug(
          slug: string
        ): Promise<{ tableName: string } | null>;
      };
      return (await registry.getCollectionBySlug(slug))!.tableName;
    }

    /** A collection entry that places the header in its `content`. */
    function entryHost(
      name: string,
      slug: string,
      kind: Kind,
      key: string
    ): Host {
      return {
        name,
        kind,
        path: () => ["collections", slug, "entries", ids[key]!],
        body: content => ({ content }),
        stored: async () =>
          overridesIn(
            (
              (await t.nextly.findByID({
                collection: slug,
                id: ids[key]!,
                depth: 0,
                // The working draft where there is one: what a save stored.
                status: "all",
                draft: true,
                overrideAccess: true,
              })) as Row
            ).content
          ),
        plant: async content =>
          writeRow(await collectionTable(slug), ids[key]!, content),
      };
    }

    async function homepage(): Promise<Row> {
      return (await t.nextly.findSingle({
        slug: HOMEPAGE,
        overrideAccess: true,
      })) as Row;
    }

    const HOSTS: readonly Host[] = [
      {
        name: "a Single",
        kind: "page",
        path: () => ["singles", HOMEPAGE],
        body: content => ({ content }),
        stored: async () => overridesIn((await homepage()).content),
        plant: async content => {
          const registry = t.getService("singleRegistryService") as unknown as {
            getSingleBySlug(
              slug: string
            ): Promise<{ tableName: string } | null>;
          };
          const table = (await registry.getSingleBySlug(HOMEPAGE))!.tableName;
          await writeRow(table, String((await homepage()).id), content);
        },
      },
      entryHost("another component", COMPONENTS_SLUG, "component", "card"),
      entryHost("a pattern", PATTERNS_SLUG, "pattern", "pattern"),
    ];

    describe.each(HOSTS)("on $name", (host: Host) => {
      const save = (overrides: Row) =>
        patch(host.path(), {
          ...host.body(placing(host.kind, componentId, overrides)),
          _overwrite: true,
        });

      it("saves a value for a field the component exposes", async () => {
        const answer = await save({ headline: "Acme launch" });

        expect(answer.status, answer.text).toBe(200);
        expect(await host.stored()).toEqual({ headline: "Acme launch" });
      });

      it("refuses an id the component does not expose, naming it", async () => {
        const before = await host.stored();

        const answer = await save({ headline: "Acme launch", strap: "Mine" });

        expect(answer.status).toBe(400);
        expect(answer.text).toContain('sets \\"strap\\"');
        expect(answer.text).toContain("which that component does not expose");
        expect(await host.stored()).toEqual(before);
      });

      it("refuses a value of the wrong type, naming the field", async () => {
        const before = await host.stored();

        const answer = await save({ headline: 42 });

        expect(answer.status).toBe(400);
        expect(answer.text).toContain("Headline needs text");
        expect(await host.stored()).toEqual(before);
      });

      it("keeps a value it already held for a field no longer exposed, until the write changes it", async () => {
        await host.plant(
          placing(host.kind, componentId, {
            headline: "Acme launch",
            gone: "Held before",
          })
        );
        expect(await host.stored()).toEqual({
          headline: "Acme launch",
          gone: "Held before",
        });

        const kept = await save({ headline: "Edited", gone: "Held before" });

        expect(kept.status, kept.text).toBe(200);
        expect(await host.stored()).toEqual({
          headline: "Edited",
          gone: "Held before",
        });

        // CONTROL: the same id, changed, is judged as newly set.
        const changed = await save({ headline: "Edited", gone: "Changed" });
        expect(changed.status).toBe(400);
        expect(changed.text).toContain('sets \\"gone\\"');
        expect(await host.stored()).toEqual({
          headline: "Edited",
          gone: "Held before",
        });
      });
    });

    it("refuses an imported page with an id its component does not expose, and imports the rest", async () => {
      const handler = t.getService("collectionsHandler") as unknown as {
        getEntryService(): BatchEntries;
      };
      const entry = (slug: string, overrides: Row): Row => ({
        title: slug,
        slug,
        content: placing("page", componentId, overrides),
      });

      const result = await handler
        .getEntryService()
        .createEntries(
          { collectionName: PAGES_SLUG, overrideAccess: true },
          [
            entry("imported", { headline: "Acme launch" }),
            entry("imported-unknown", { strap: "Mine" }),
          ],
          { skipHooks: true }
        );

      // The two entries differ only in their values, so the one refused is
      // refused for the value it sets. A batch reports a refusal by index,
      // without the field's message.
      expect(result.successful).toBe(1);
      expect(result.failed).toBe(1);
      expect(result.errors).toMatchObject([
        { index: 1, code: "VALIDATION_ERROR" },
      ]);
      const found = await t.nextly.find({
        collection: PAGES_SLUG,
        limit: 10,
        depth: 0,
        status: "all",
        overrideAccess: true,
      });
      const items = found.items as Row[];
      expect(items.map(item => item.slug)).toEqual(["imported"]);
      // Stored as sent, not merely created.
      expect(overridesIn(items[0]?.content)).toEqual({
        headline: "Acme launch",
      });
    });
  }
);
