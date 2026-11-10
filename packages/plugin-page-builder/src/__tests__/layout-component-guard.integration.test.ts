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

// Set before the harness boots: the REST case verifies its session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { definePlugin, type PluginDefinition } from "@nextlyhq/plugin-sdk";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type CreateTestNextlyOptions,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { pageBuilder } from "../plugin";
import { USAGE_BACKFILL_JOB } from "../usage-backfill-job";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

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

/**
 * Another plugin whose own `beforeUpdate` hook retires a component renamed
 * "Retired": an ordinary save that a hook, not the caller, makes an unpublish.
 */
/** The plugin's own backfill job, as it contributes it. */
function backfillTick(plugin: PluginDefinition): () => Promise<unknown> {
  const job = plugin.contributes?.jobs?.find(
    entry => entry.slug === USAGE_BACKFILL_JOB
  );
  if (job === undefined) throw new Error("the page builder has no backfill");
  return async () =>
    job.handler(
      null as never,
      {
        user: null,
        now: new Date(),
        deadline: new Date(Date.now() + 60_000),
        content: {},
      } as never
    );
}

const retiring = definePlugin({
  name: "@test/retiring",
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    ctx.hooks.on("beforeUpdate", COMPONENTS_SLUG, hook => {
      const data = (hook as { data?: Record<string, unknown> }).data;
      if (data?.title !== "Retired") return data;
      return { ...data, status: "draft" };
    });
  },
});

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
    async function site(
      others: NonNullable<CreateTestNextlyOptions["plugins"]> = []
    ) {
      const plugin = pageBuilder();
      current = await createTestNextly({
        dialect,
        plugins: [plugin, ...others],
      });
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
      // The usage index walked whole, so an unpublish of a component no
      // document places is let through rather than refused as unconfirmed.
      await backfillTick(plugin)();
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
        t,
        used,
        spare,
        rename: (id: string, title: string) =>
          t.nextly.update({
            collection: COMPONENTS_SLUG,
            id,
            data: { title, _overwrite: true },
            overrideAccess: true,
          }),
        unpublish: (id: string) =>
          t.nextly.update({
            collection: COMPONENTS_SLUG,
            id,
            data: { status: "draft", _overwrite: true },
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

    it("refuses an unpublish another plugin's hook makes of an ordinary save", async () => {
      // The caller only renames; the other plugin's `beforeUpdate` sets the
      // status. The status judged is the one the write would store.
      const s = await site([retiring]);

      const refused = await refusalOf(s.rename(s.used, "Retired"));

      expect(messageOf(refused)).toContain(
        'cannot be unpublished because the Layout "Marketing" uses it'
      );
      expect(await s.statusOf(s.used)).toBe("published");
      // CONTROL: the same hook retiring a component no Layout uses.
      await expect(s.rename(s.spare, "Retired")).resolves.toBeDefined();
      expect(await s.statusOf(s.spare)).toBe("draft");
    });

    it("answers a REST unpublish with 409 CONFLICT naming the Layout", async () => {
      const s = await site();
      // The instance's first user is its super admin.
      const owner = await s.t.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      const token = await signAccessToken(
        buildClaims({
          userId: owner.item.id,
          email: "owner@example.com",
          name: "Owner",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      const path = ["collections", COMPONENTS_SLUG, "entries", s.used];
      const response = await createDynamicHandlers().PATCH(
        new Request(`${ORIGIN}/api/${path.join("/")}`, {
          method: "PATCH",
          headers: {
            cookie: `nextly_session=${token}; nextly_csrf=${CSRF}`,
            "x-csrf-token": CSRF,
            origin: ORIGIN,
            "content-type": "application/json",
          },
          body: JSON.stringify({ status: "draft", _overwrite: true }),
        }),
        { params: Promise.resolve({ params: path }) }
      );

      expect(response.status).toBe(409);
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      expect(body.error?.code).toBe("CONFLICT");
      expect(body.error?.message).toContain(
        'cannot be unpublished because the Layout "Marketing" uses it'
      );
      expect(await s.statusOf(s.used)).toBe("published");
    });

    it("unpublishes and deletes a component no Layout uses", async () => {
      // The control: a guard refusing every write would pass both cases above.
      const s = await site();

      await expect(s.unpublish(s.spare)).resolves.toBeDefined();
      expect(await s.statusOf(s.spare)).toBe("draft");
      // A component's own delete goes only through Delete component, so the
      // delete is refused all the same, but by that rule: this guard let it
      // through.
      const refused = await refusalOf(s.remove(s.spare));
      expect(messageOf(refused)).toContain("Delete component");
      expect(messageOf(refused)).not.toContain("Layout");
    });
  }
);
