/**
 * The header & footer area routes as an author reaches them: through core's
 * request handler, with a real API key per role, against a real database.
 *
 * The unit suite pins what the routes ask of the Direct API. This pins what
 * that asking MEANS: who is refused (no update or no publish on sets, no read
 * of components), that a chosen component is what the set's PUBLISHED
 * version names with every other area kept, that a component nobody
 * published and a set holding unpublished changes are refused with the set
 * left as it was, and that the list holds only the published components
 * marked for the area.
 *
 * "Create a header" on the canvas's band is pinned here too: it creates the
 * header as the caller and puts it in the site default's empty area, and it
 * refuses, creating nothing, a caller who may not change sets or create a
 * published component, and a default whose area is not empty.
 *
 * @module __tests__/layout-area.integration.test
 */

// Read once, when the harness validates its environment; API keys are signed
// with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import {
  readLayoutSettings,
  writeLayoutSettings,
  type DefaultLayoutDirectApi,
} from "../default-layout/store";
import {
  areaComponentsPath,
  defaultAreaPath,
  layoutAreaPath,
  type AreaComponentsResponse,
  type WrittenArea,
} from "../layout-area-contract";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";

/** The Direct API calls this suite makes staff and content with, trusted. */
interface Direct {
  users: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
  permissions: {
    find(args: {
      limit: number;
    }): Promise<{ items: { id: string; slug: string }[] }>;
  };
  roles: {
    create(args: {
      data: Record<string, unknown>;
    }): Promise<{ item: { id: string } }>;
  };
  create(args: {
    collection: string;
    data: Record<string, unknown>;
    overrideAccess: true;
  }): Promise<{ item: { id: string | number } }>;
  update(args: {
    collection: string;
    id: string;
    data: Record<string, unknown>;
    overrideAccess: true;
  }): Promise<unknown>;
  find(args: {
    collection: string;
    where?: Record<string, unknown>;
    status?: string;
    depth?: number;
    overrideAccess: true;
  }): Promise<{ items: Record<string, unknown>[] }>;
  findByID(args: {
    collection: string;
    id: string;
    status?: string;
    draft?: boolean;
    depth?: number;
    overrideAccess: true;
  }): Promise<Record<string, unknown> | null>;
}

interface ApiKeys {
  createApiKey(
    userId: string,
    input: {
      name: string;
      tokenType: string;
      roleId?: string;
      expiresIn: string;
    }
  ): Promise<{ key: string }>;
}

/** One request to a plugin route through core's handler, as `key`. */
async function ask(
  method: "GET" | "PATCH" | "POST",
  path: string,
  key: string,
  body?: unknown
): Promise<Response> {
  const handlers = createDynamicHandlers();
  const [pathname = "", search = ""] = path.split("?");
  const segments = [
    "plugins",
    ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
    ...pathname.slice(1).split("/").map(decodeURIComponent),
  ];
  const request = new Request(
    `http://localhost/api/${segments.map(encodeURIComponent).join("/")}${search === "" ? "" : `?${search}`}`,
    {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  );
  return handlers[method](request, {
    params: Promise.resolve({ params: segments }),
  });
}

/** How many roles this file has made, for names that stay short. */
let rolesMade = 0;

const idOf = (created: { item: { id: string | number } }) =>
  String(created.item.id);

const SLUGS = {
  layouts: LAYOUTS_SLUG,
  settings: PAGE_BUILDER_SETTINGS_SLUG,
} as const;

describe.each(getConfiguredTestDialects())(
  "the header & footer area routes (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let direct: Direct;
    /** May read sets and components, and update and publish sets. */
    let chooser = "";
    /** Everything the chooser holds except publishing sets. */
    let noPublish = "";
    /** Everything the chooser holds except updating sets. */
    let noUpdate = "";
    /** May update and publish sets, and read them, but not components. */
    let noComponents = "";
    /** The chooser's rights, and creating and publishing components. */
    let creator = "";
    /** The creator's rights except publishing sets. */
    let creatorNoSetPublish = "";
    /** The creator's rights except publishing components. */
    let creatorNoComponentPublish = "";
    const ids = {
      starterHeader: "",
      starterFooter: "",
      ridgeline: "",
      unpublished: "",
      anywhere: "",
      footerOnly: "",
    };
    /** The seed's own starter header and footer, which every list holds. */
    const seedStarters = new Set<string>();

    async function component(
      slug: string,
      area: "header" | "footer" | null,
      status: "published" | "draft"
    ): Promise<string> {
      return idOf(
        await direct.create({
          collection: "components",
          data: {
            title: slug,
            slug,
            ...(area === null ? {} : { area }),
            content: { formatVersion: 1, kind: "component", nodes: [] },
            status,
          },
          overrideAccess: true,
        })
      );
    }

    /** A published set holding the starter's header and footer. */
    async function set(slug: string): Promise<string> {
      return idOf(
        await direct.create({
          collection: LAYOUTS_SLUG,
          data: {
            title: slug,
            slug,
            areas: [
              { area: "header", component: ids.starterHeader },
              { area: "footer", component: ids.starterFooter },
            ],
            status: "published",
          },
          overrideAccess: true,
        })
      );
    }

    /** The Direct API as the default's settings are read and written. */
    const settingsApi = () => t.nextly as unknown as DefaultLayoutDirectApi;

    /** A published set showing only the starter footer, made the default. */
    async function defaultWithoutHeader(slug: string): Promise<string> {
      const id = idOf(
        await direct.create({
          collection: LAYOUTS_SLUG,
          data: {
            title: slug,
            slug,
            areas: [{ area: "footer", component: ids.starterFooter }],
            status: "published",
          },
          overrideAccess: true,
        })
      );
      await writeLayoutSettings(
        settingsApi(),
        SLUGS,
        await readLayoutSettings(settingsApi(), SLUGS),
        { defaultLayout: id }
      );
      return id;
    }

    /** Every component's id, whatever its state. */
    async function componentIds(): Promise<string[]> {
      const found = await direct.find({
        collection: "components",
        status: "all",
        depth: 0,
        overrideAccess: true,
      });
      return found.items.map(row => String(row.id)).sort();
    }

    /** The areas a set names, by area: its published version, or as saved. */
    async function areasOf(
      id: string,
      as: "published" | "saved" = "published"
    ): Promise<Record<string, string>> {
      const row =
        as === "published"
          ? (
              await direct.find({
                collection: LAYOUTS_SLUG,
                where: { id: { equals: id } },
                status: "published",
                depth: 0,
                overrideAccess: true,
              })
            ).items[0]
          : await direct.findByID({
              collection: LAYOUTS_SLUG,
              id,
              status: "all",
              draft: true,
              depth: 0,
              overrideAccess: true,
            });
      const rows = (
        typeof row?.areas === "string" ? JSON.parse(row.areas) : row?.areas
      ) as { area: string; component: unknown }[];
      return Object.fromEntries(
        rows.map(entry => [entry.area, String(entry.component)])
      );
    }

    beforeAll(async () => {
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        seedPublic: true,
        plugins: [pageBuilder()],
      });
      direct = t.nextly as unknown as Direct;

      // The first user is the super-admin every key is minted by; a key may
      // hold no more than its owner does.
      const owner = await direct.users.create({
        data: {
          email: "owner@example.com",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });
      const seeded = await direct.permissions.find({ limit: 500 });

      /** A key whose role holds exactly the permissions named. */
      async function keyHolding(slugs: string[]): Promise<string> {
        rolesMade += 1;
        const roleTag = `la-${rolesMade}`;
        const permissionIds = slugs.map(slug => {
          const found = seeded.items.find(item => item.slug === slug);
          if (found === undefined) {
            throw new Error(`${slug} is not seeded, so a role grants nothing`);
          }
          return found.id;
        });
        const role = await direct.roles.create({
          data: {
            name: `Role ${roleTag}`,
            slug: `r-${roleTag}`,
            permissionIds,
          },
        });
        const keys = t.getService("apiKeyService") as unknown as ApiKeys;
        const { key } = await keys.createApiKey(owner.item.id, {
          name: `key ${roleTag}`,
          tokenType: "role-based",
          roleId: role.item.id,
          expiresIn: "unlimited",
        });
        return key;
      }

      const reads = ["read-layouts", "read-components"];
      chooser = await keyHolding([
        ...reads,
        "update-layouts",
        "publish-layouts",
      ]);
      noPublish = await keyHolding([...reads, "update-layouts"]);
      noUpdate = await keyHolding([...reads, "publish-layouts"]);
      noComponents = await keyHolding([
        "read-layouts",
        "update-layouts",
        "publish-layouts",
      ]);
      const components = ["create-components", "publish-components"];
      creator = await keyHolding([
        ...reads,
        "update-layouts",
        "publish-layouts",
        ...components,
      ]);
      creatorNoSetPublish = await keyHolding([
        ...reads,
        "update-layouts",
        ...components,
      ]);
      creatorNoComponentPublish = await keyHolding([
        ...reads,
        "update-layouts",
        "publish-layouts",
        "create-components",
      ]);

      ids.starterHeader = await component("starter-h", "header", "published");
      ids.starterFooter = await component("starter-f", "footer", "published");
      ids.ridgeline = await component("ridgeline", "header", "published");
      ids.unpublished = await component("unfinished", "header", "draft");
      ids.anywhere = await component("anywhere", null, "published");
      ids.footerOnly = await component("plain-f", "footer", "published");

      // The boot seeds a default without awaiting it; wait for it, so a
      // default these cases choose is never overwritten by the seed.
      for (let tries = 0; tries < 120; tries += 1) {
        if ((await readLayoutSettings(settingsApi(), SLUGS)).defaultLayout) {
          break;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      const { seededLayout } = await readLayoutSettings(settingsApi(), SLUGS);
      if (seededLayout !== null) {
        for (const id of Object.values(await areasOf(seededLayout))) {
          seedStarters.add(id);
        }
      }
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    describe("putting a component in a set's area", () => {
      it("refuses a caller who may update sets but not publish them, and one who may publish but not update, leaving the set as it was", async () => {
        const main = await set("refused");
        for (const key of [noPublish, noUpdate]) {
          const response = await ask(
            "PATCH",
            layoutAreaPath(main, "header"),
            key,
            { component: ids.ridgeline }
          );
          expect(response.status, await response.clone().text()).toBe(403);
        }
        expect(await areasOf(main, "saved")).toEqual({
          header: ids.starterHeader,
          footer: ids.starterFooter,
        });
      });

      it("puts the component in the area of the PUBLISHED set, keeping the other area, with nothing left waiting", async () => {
        const main = await set("chosen");
        const response = await ask(
          "PATCH",
          layoutAreaPath(main, "header"),
          chooser,
          { component: ids.ridgeline }
        );
        expect(response.status, await response.clone().text()).toBe(200);
        const body = (await response.json()) as {
          message: string;
          item: WrittenArea;
        };
        expect(body.item).toEqual({
          set: { id: main, title: "chosen" },
          area: "header",
          component: { id: ids.ridgeline, title: "ridgeline" },
        });
        expect(body.message).toBe(
          "ridgeline is now the header of every page that uses the chosen header & footer."
        );
        expect(await areasOf(main)).toEqual({
          header: ids.ridgeline,
          footer: ids.starterFooter,
        });
        const saved = await direct.findByID({
          collection: LAYOUTS_SLUG,
          id: main,
          status: "all",
          draft: true,
          depth: 0,
          overrideAccess: true,
        });
        expect(saved?._isWorkingDraft === true).toBe(false);
        // The starter it replaced is still there, published, to choose again.
        const starter = await direct.find({
          collection: "components",
          where: { id: { equals: ids.starterHeader } },
          status: "published",
          overrideAccess: true,
        });
        expect(starter.items).toHaveLength(1);
      });

      it("refuses a component nobody published, leaving the set as it was", async () => {
        const main = await set("unpublished-choice");
        const response = await ask(
          "PATCH",
          layoutAreaPath(main, "header"),
          chooser,
          { component: ids.unpublished }
        );
        expect(response.status).toBe(404);
        expect(await areasOf(main, "saved")).toEqual({
          header: ids.starterHeader,
          footer: ids.starterFooter,
        });
      });

      it("refuses a set holding changes not published yet, which the publish would ship", async () => {
        const main = await set("pending");
        // An edit saved to a published set, naming no status, waits as its
        // working draft while the published version stays live.
        await direct.update({
          collection: LAYOUTS_SLUG,
          id: main,
          data: { title: "pending, edited", _overwrite: true },
          overrideAccess: true,
        });
        const response = await ask(
          "PATCH",
          layoutAreaPath(main, "header"),
          chooser,
          { component: ids.ridgeline }
        );
        expect(response.status, await response.clone().text()).toBe(409);
        expect(await areasOf(main)).toEqual({
          header: ids.starterHeader,
          footer: ids.starterFooter,
        });
      });
    });

    describe("the components marked for an area", () => {
      it("lists only the published ones marked for that area, by title, with their pictures when asked", async () => {
        const response = await ask(
          "GET",
          areaComponentsPath("header", { pictures: true }),
          chooser
        );
        expect(response.status, await response.clone().text()).toBe(200);
        const body = (await response.json()) as AreaComponentsResponse;
        const own = (items: AreaComponentsResponse["items"]) =>
          items.filter(item => !seedStarters.has(item.id));
        expect(own(body.items)).toEqual([
          { id: ids.ridgeline, title: "ridgeline" },
          { id: ids.starterHeader, title: "starter-h" },
        ]);
        expect(body.meta.mayChoose).toBe(true);
        expect(body.meta.more).toBe(false);
        expect(
          Object.keys(body.meta.definitions)
            .filter(id => !seedStarters.has(id))
            .sort()
        ).toEqual([ids.ridgeline, ids.starterHeader].sort());

        const footers = (await (
          await ask("GET", areaComponentsPath("footer"), chooser)
        ).json()) as AreaComponentsResponse;
        expect(own(footers.items).map(item => item.title)).toEqual([
          "plain-f",
          "starter-f",
        ]);
        // Not asked for pictures: none sent.
        expect(footers.meta.definitions).toEqual({});
      });

      it("tells a caller who may not publish sets that they may not choose", async () => {
        const response = await ask(
          "GET",
          areaComponentsPath("header"),
          noPublish
        );
        expect(response.status).toBe(200);
        expect(
          ((await response.json()) as AreaComponentsResponse).meta.mayChoose
        ).toBe(false);
      });

      it("refuses a caller who may not read components", async () => {
        const response = await ask(
          "GET",
          areaComponentsPath("header"),
          noComponents
        );
        expect(response.status).toBe(403);
      });
    });
    describe("creating a header for the default's empty area", () => {
      it("creates the header as the caller, published and marked for the area, and puts it in the default's PUBLISHED version", async () => {
        const main = await defaultWithoutHeader("band-create");
        const before = await componentIds();
        const response = await ask("POST", defaultAreaPath("header"), creator);
        expect(response.status, await response.clone().text()).toBe(200);
        const body = (await response.json()) as {
          message: string;
          item: WrittenArea;
        };
        const created = body.item.component.id;
        expect(body.item).toEqual({
          set: { id: main, title: "band-create" },
          area: "header",
          component: { id: created, title: "Header" },
        });
        expect(body.message).toBe(
          "Header was created. It is now the header of every page that uses the band-create header & footer."
        );
        expect(before).not.toContain(created);
        expect(await areasOf(main)).toEqual({
          header: created,
          footer: ids.starterFooter,
        });
        const row = await direct.findByID({
          collection: "components",
          id: created,
          status: "published",
          depth: 0,
          overrideAccess: true,
        });
        expect(row).toMatchObject({ area: "header", status: "published" });
        // The starter's design: a header with something in it, not empty.
        const content = (
          typeof row?.content === "string"
            ? JSON.parse(row.content)
            : row?.content
        ) as { kind?: string; nodes?: unknown[] };
        expect(content.kind).toBe("component");
        expect(content.nodes?.length ?? 0).toBeGreaterThan(0);
      });

      it("refuses an area that already shows a component, creating nothing", async () => {
        await defaultWithoutHeader("band-filled");
        const before = await componentIds();
        const response = await ask("POST", defaultAreaPath("footer"), creator);
        expect(response.status, await response.clone().text()).toBe(409);
        expect(await componentIds()).toEqual(before);
      });

      it("refuses a caller who may not publish sets before creating anything", async () => {
        const main = await defaultWithoutHeader("band-no-set-publish");
        const before = await componentIds();
        const response = await ask(
          "POST",
          defaultAreaPath("header"),
          creatorNoSetPublish
        );
        expect(response.status, await response.clone().text()).toBe(403);
        expect(await componentIds()).toEqual(before);
        expect(await areasOf(main, "saved")).toEqual({
          footer: ids.starterFooter,
        });
      });

      it("refuses a caller who may not create components, and one who may not publish them, leaving no component and the default as it was", async () => {
        const main = await defaultWithoutHeader("band-no-component");
        const before = await componentIds();
        for (const key of [chooser, creatorNoComponentPublish]) {
          const response = await ask("POST", defaultAreaPath("header"), key);
          expect(response.ok, await response.clone().text()).toBe(false);
        }
        expect(await componentIds()).toEqual(before);
        expect(await areasOf(main, "saved")).toEqual({
          footer: ids.starterFooter,
        });
      });
    });
  }
);
