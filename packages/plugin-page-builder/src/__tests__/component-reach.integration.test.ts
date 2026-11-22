/**
 * How many pages a change to a header reaches, against a real instance,
 * through Nextly's own request handler with a signed session: the number the
 * bar says while the header is edited in place ("changes show on N pages")
 * and the header's own view says, read from the one component facts route.
 * Distinct pages, through the site's default set, a named set and a direct
 * placement, a page reached two ways counted once.
 *
 * @module __tests__/component-reach.integration.test
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { COMPONENT_INSTANCE_TYPE } from "@nextlyhq/blocks-engine";
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

import { LAYOUTS_SLUG } from "../collections/layouts";
import { ensureDefaultLayout } from "../default-layout/ensure-default";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import {
  readLayoutSettings,
  writeLayoutSettings,
} from "../default-layout/store";
import {
  componentFactsPath,
  PAGE_BUILDER_PLUGIN_NAME,
  type ComponentFactsResponse,
} from "../library-contract";
import { pageBuilder } from "../plugin";
import { USAGE_BACKFILL_JOB } from "../usage-backfill-job";
import { indexIsWhole } from "../usage-index-health";
import {
  USAGE_HEALTH_SERVICE,
  type UsageHealthService,
} from "../usage-health-service";
import { componentUsageIndex } from "../component-usage";

const SLUGS = {
  layouts: LAYOUTS_SLUG,
  settings: PAGE_BUILDER_SETTINGS_SLUG,
} as const;
const ORIGIN = "http://localhost";
const PAGES = "pages";

const idOf = (created: unknown) =>
  String((created as { item: { id: string | number } }).item.id);

describe.each(getConfiguredTestDialects())(
  "how many pages a header reaches (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let plugin = pageBuilder();

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
    });

    async function boot(): Promise<TestNextly> {
      plugin = pageBuilder();
      current = await createTestNextly({
        dialect,
        plugins: [plugin],
        seedPublic: true,
      });
      await ensureDefaultLayout({
        nextly: current.nextly,
        slugs: SLUGS,
        warn: () => {},
      });
      return current;
    }

    /** An author who may read components, signed in. */
    async function author(t: TestNextly): Promise<string> {
      const created = await t.nextly.users.create({
        email: "author@example.com",
        password: "Password123!",
        data: { name: "Author", isActive: true },
      });
      const userId = created.item.id;
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const read = permissions.items.find(
        item => item.slug === "read-components"
      );
      if (read === undefined) throw new Error("read-components is not seeded");
      const role = await t.nextly.roles.create({
        data: { name: "Readers", slug: "readers", permissionIds: [read.id] },
      });
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(userId, role.item.id);
      expect(assigned.success).toBe(true);
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: "author@example.com",
          name: "Author",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    /**
     * The usage index swept over every stored document, by the plugin's own
     * backfill job, until it reports itself whole: a site keeps it whole as
     * it runs, and a count over an index that is not says "at least".
     */
    async function indexSettled(): Promise<void> {
      const job = plugin.contributes?.jobs?.find(
        entry => entry.slug === USAGE_BACKFILL_JOB
      );
      const health = plugin.contributes?.services?.[
        USAGE_HEALTH_SERVICE
      ]?.() as UsageHealthService | undefined;
      if (job === undefined || health === undefined) {
        throw new Error("the page builder contributed no backfill job");
      }
      for (let tick = 0; tick < 20; tick += 1) {
        if (indexIsWhole(await health.read(componentUsageIndex))) return;
        await job.handler(
          null as never,
          {
            user: null,
            now: new Date(),
            deadline: new Date(Date.now() + 60_000),
            content: {},
          } as never
        );
      }
      throw new Error("the usage index never became whole");
    }

    /** The component facts route, as the editor asks it. */
    async function facts(
      cookie: string,
      id: string
    ): Promise<{ status: number; text: string; body: ComponentFactsResponse }> {
      const handlers = createDynamicHandlers();
      const [path = "", query = ""] = componentFactsPath(id).split("?");
      const sub = path.split("/").filter(Boolean);
      const url = `${ORIGIN}/api/plugins/${PAGE_BUILDER_PLUGIN_NAME}/${sub.join("/")}?${query}`;
      const response = await handlers.GET(
        new Request(url, { headers: { cookie, origin: ORIGIN } }),
        {
          params: Promise.resolve({
            params: ["plugins", ...PAGE_BUILDER_PLUGIN_NAME.split("/"), ...sub],
          }),
        }
      );
      const text = await response.text();
      const parsed = (text === "" ? {} : JSON.parse(text)) as {
        item?: ComponentFactsResponse;
      } & ComponentFactsResponse;
      return { status: response.status, text, body: parsed.item ?? parsed };
    }

    async function component(t: TestNextly, slug: string): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: "components",
          data: {
            title: slug,
            slug,
            area: "header",
            content: { formatVersion: 1, kind: "component", nodes: [] },
            status: "published",
          },
          overrideAccess: true,
        })
      );
    }

    async function set(
      t: TestNextly,
      slug: string,
      header: string
    ): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: LAYOUTS_SLUG,
          data: {
            title: slug,
            slug,
            areas: [{ area: "header", component: header }],
            status: "published",
          },
          overrideAccess: true,
        })
      );
    }

    async function page(
      t: TestNextly,
      slug: string,
      choice: { layout?: string; noHeaderFooter?: boolean },
      places?: string
    ): Promise<string> {
      return idOf(
        await t.nextly.create({
          collection: PAGES,
          data: {
            title: `Title ${slug}`,
            slug,
            content: {
              formatVersion: 1,
              kind: "page",
              nodes:
                places === undefined
                  ? []
                  : [
                      {
                        id: `${slug}-header`,
                        type: COMPONENT_INSTANCE_TYPE,
                        version: 1,
                        props: { componentId: places },
                      },
                    ],
            },
            ...choice,
            status: "published",
          },
          overrideAccess: true,
        })
      );
    }

    it("counts every page showing the header, through the default set, a named set and a direct placement, once each", async () => {
      const t = await boot();
      const header = await component(t, "site-header");
      const other = await component(t, "other-header");
      const everywhere = await set(t, "everywhere", header);
      const landing = await set(t, "landing", header);
      const elsewhere = await set(t, "elsewhere", other);
      await writeLayoutSettings(
        t.nextly,
        SLUGS,
        await readLayoutSettings(t.nextly, SLUGS),
        { defaultLayout: everywhere }
      );
      // Through the default set: one page following it, one naming it.
      await page(t, "home", {});
      await page(t, "contact", { layout: everywhere });
      // Through a named set.
      await page(t, "about", { layout: landing });
      // Placed on the page directly, with no set's header around it.
      await page(t, "promo", { layout: landing, noHeaderFooter: true }, header);
      // Reached two ways, counted once.
      await page(t, "both", { layout: landing }, header);
      // Not reached: another set's header, and no header at all.
      await page(t, "press", { layout: elsewhere });
      await page(t, "bare", { layout: landing, noHeaderFooter: true });

      await indexSettled();
      const answer = await facts(await author(t), header);

      expect(answer.status, answer.text).toBe(200);
      expect(answer.body.pages).toEqual({ count: 5, complete: true });
    });
  }
);
