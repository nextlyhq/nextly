/**
 * A block's own CSS class names through the API, on every configured dialect:
 * set on a Section by the builder's update op and saved, drawn on the
 * published page after the classes Nextly generates, cleared again, and
 * refused on save when a name is one a block may not carry, naming each such
 * name, with nothing saved.
 *
 * What only a server shows: the save judges the stored document through the
 * blocks field, and the published route draws it from the database.
 *
 * @module __tests__/block-css-classes.integration.test
 */

// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  applyOps,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";
import { createBlockResolver } from "@nextlyhq/blocks-react";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { createPublicBlocksPage } from "@nextlyhq/blocks-react/next";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { asOverwrite } from "../document-version";
import { pageBuilder } from "../plugin";

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const hero: BlockNode = {
  id: "hero",
  type: "core/section",
  version: 1,
  props: { as: "section" },
  slots: {
    children: [
      {
        id: "hero-text",
        type: "core/heading",
        version: 1,
        props: { text: "Plans from $29", level: "h2" },
      },
    ],
  },
};

const pageOf = (nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

async function storedContent(
  t: TestNextly,
  id: string
): Promise<BlockDocument> {
  const item = (await t.nextly.findByID({
    collection: "pages",
    id,
    depth: 0,
    overrideAccess: true,
  })) as { content: BlockDocument | string };
  // A dialect without a JSON column hands the stored text back as written.
  return typeof item.content === "string"
    ? (JSON.parse(item.content) as BlockDocument)
    : item.content;
}

async function save(t: TestNextly, id: string, content: BlockDocument) {
  return t.nextly.update({
    collection: "pages",
    id,
    // Published with the change, so the published page shows it.
    data: asOverwrite({ status: "published", content }),
    overrideAccess: true,
  });
}

/** The section's class list on the published page. */
async function publishedClasses(t: TestNextly): Promise<string[]> {
  const route = createPublicBlocksPage({
    collections: ["pages"],
    field: "content",
    nextly: t.nextly as never,
    blocks: createBlockResolver(coreBlocks),
  });
  const element = (await route.ContentPage({
    params: { slug: ["pricing"] },
  })) as ReactElement;
  const html = renderToStaticMarkup(element);
  const match = /<section [^>]*class="([^"]*)"/.exec(html);
  if (match === null) throw new Error("no section on the page");
  return match[1]!.split(" ");
}

/**
 * The refusal a save answers with: each error's code and message, after
 * checking it is the field's own refusal, answered as a validation error.
 */
async function refusal(
  write: Promise<unknown>
): Promise<{ code?: string; message?: string }[]> {
  try {
    await write;
  } catch (error) {
    const refused = error as {
      statusCode?: number;
      code?: string;
      publicData?: { errors?: { code?: string; message?: string }[] };
    };
    const errors = refused.publicData?.errors;
    if (errors === undefined) throw error;
    expect(refused.statusCode).toBe(400);
    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(errors.map(entry => entry.code)).toEqual(["invalid-css-classes"]);
    return errors;
  }
  throw new Error("the save was not refused");
}

describe.each(getConfiguredTestDialects())(
  "a block's own CSS classes through the API (%s)",
  (dialect: TestDialect) => {
    it("are set by the update op, drawn on the published page, and cleared", async () => {
      const t = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        seedPublic: true,
      });
      current = t;
      const created = (await t.nextly.create({
        collection: "pages",
        data: {
          title: "Pricing",
          slug: "pricing",
          content: pageOf([hero]),
          status: "published",
        },
        overrideAccess: true,
      })) as { item: { id: string } };

      const before = await publishedClasses(t);
      expect(before.every(name => name.startsWith("nx-"))).toBe(true);

      const classed = applyOps(
        await storedContent(t, String(created.item.id)),
        [
          {
            kind: "update",
            id: "hero",
            patch: { cssClasses: "promo hero-dark" },
          },
        ]
      ).document;
      await save(t, String(created.item.id), classed);
      expect(
        (await storedContent(t, String(created.item.id))).nodes[0]?.cssClasses
      ).toBe("promo hero-dark");
      expect(await publishedClasses(t)).toEqual([
        ...before,
        "promo",
        "hero-dark",
      ]);

      const cleared = applyOps(
        await storedContent(t, String(created.item.id)),
        [{ kind: "update", id: "hero", patch: {}, unset: ["cssClasses"] }]
      ).document;
      await save(t, String(created.item.id), cleared);
      expect(
        (await storedContent(t, String(created.item.id))).nodes[0]
      ).not.toHaveProperty("cssClasses");
      expect(await publishedClasses(t)).toEqual(before);
    });

    it("are refused on save when a name can't be used, naming it, and nothing is saved", async () => {
      const t = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        seedPublic: true,
      });
      current = t;
      const created = (await t.nextly.create({
        collection: "pages",
        data: {
          title: "Pricing",
          slug: "pricing",
          content: pageOf([{ ...hero, cssClasses: "promo" }]),
          status: "published",
        },
        overrideAccess: true,
      })) as { item: { id: string } };

      const errors = await refusal(
        save(
          t,
          String(created.item.id),
          pageOf([{ ...hero, cssClasses: "2col .x nx-box ok" }])
        )
      );
      const words = errors.map(error => error.message ?? "").join("\n");
      expect(words).toContain('"2col"');
      expect(words).toContain('".x"');
      expect(words).toContain('"nx-box"');
      expect(words).not.toContain('"ok"');

      expect(
        (await storedContent(t, String(created.item.id))).nodes[0]?.cssClasses
      ).toBe("promo");
    });

    it("are refused on create too", async () => {
      const t = await createTestNextly({
        dialect,
        plugins: [pageBuilder()],
        seedPublic: true,
      });
      current = t;
      const errors = await refusal(
        t.nextly.create({
          collection: "pages",
          data: {
            title: "Pricing",
            slug: "pricing",
            content: pageOf([{ ...hero, cssClasses: "#hero" }]),
          },
          overrideAccess: true,
        })
      );
      expect(errors.map(error => error.message).join("\n")).toContain(
        '"#hero" starts with "#"'
      );
    });
  }
);
