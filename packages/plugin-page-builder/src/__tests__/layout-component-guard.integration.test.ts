/**
 * A component a Layout uses can be neither deleted nor unpublished through the
 * API.
 *
 * `layout-component-guard.test.ts` pins the guard's reading against a fake
 * Direct API. What only a server can show is that the guard is reached on the
 * paths a REST request and an agent both arrive through, that the refusal
 * survives the envelope with the Layout's name in it, and that the component
 * is left as it was.
 *
 * Per dialect, because the Layout scan runs on the adapter's own connection.
 *
 * @module __tests__/layout-component-guard.integration.test
 */
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { pageBuilder } from "../plugin";

const idOf = (written: unknown) =>
  String((written as { item: { id: unknown } }).item.id);

async function refusalOf(write: Promise<unknown>): Promise<unknown> {
  try {
    await write;
    return undefined;
  } catch (error) {
    return error;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

describe.each(getConfiguredTestDialects())(
  "a component a Layout uses (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    /**
     * A site with two published components, one of them in a published
     * Layout's header, and the writes a case makes on either.
     */
    async function site() {
      current = await createTestNextly({ dialect, plugins: [pageBuilder()] });
      const t = current;
      const component = async (slug: string) =>
        idOf(
          await t.nextly.create({
            collection: COMPONENTS_SLUG,
            data: {
              title: slug,
              slug,
              content: {
                formatVersion: 1,
                kind: "component",
                nodes: [
                  {
                    id: "h",
                    type: "core/heading",
                    version: 1,
                    props: { text: slug, level: 2 },
                  },
                ],
              },
              status: "published",
            },
            overrideAccess: true,
          })
        );
      const used = await component("site-header");
      const spare = await component("spare-header");
      await t.nextly.create({
        collection: LAYOUTS_SLUG,
        data: {
          title: "Marketing",
          slug: "marketing",
          areas: [{ area: "header", component: used }],
          status: "published",
        },
        overrideAccess: true,
      });
      return {
        used,
        spare,
        unpublish: (id: string) =>
          t.nextly.update({
            collection: COMPONENTS_SLUG,
            id,
            data: { status: "draft" },
            overrideAccess: true,
          }),
        remove: (id: string) =>
          t.nextly.delete({
            collection: COMPONENTS_SLUG,
            id,
            overrideAccess: true,
          }),
        statusOf: async (id: string) =>
          (
            (await t.nextly.findByID({
              collection: COMPONENTS_SLUG,
              id,
              overrideAccess: true,
            })) as { status?: unknown } | null
          )?.status,
      };
    }

    it("refuses unpublishing it, naming the Layout, and leaves it published", async () => {
      const s = await site();

      const refused = await refusalOf(s.unpublish(s.used));

      expect(messageOf(refused)).toContain(
        'cannot be unpublished because the Layout "Marketing" uses it'
      );
      expect(await s.statusOf(s.used)).toBe("published");
    });

    it("refuses deleting it, naming the Layout, and keeps it", async () => {
      const s = await site();

      const refused = await refusalOf(s.remove(s.used));

      expect(messageOf(refused)).toContain(
        'cannot be deleted because the Layout "Marketing" uses it'
      );
      expect(await s.statusOf(s.used)).toBe("published");
    });

    it("unpublishes and deletes a component no Layout uses", async () => {
      // The control: a guard refusing every write would pass both cases above.
      const s = await site();

      await expect(s.unpublish(s.spare)).resolves.toBeDefined();
      expect(await s.statusOf(s.spare)).toBe("draft");
      await expect(s.remove(s.spare)).resolves.toBeDefined();
    });
  }
);
