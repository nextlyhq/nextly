/**
 * The readiness question asked before a publish, and the offer's write, through
 * the real routes, as two authors.
 *
 * One author may publish pages and only read components and Layouts; the other
 * may publish all three. The first is told what the page needs and that they
 * cannot publish it, and accepting the offer anyway publishes nothing of it;
 * the page still publishes. The second publishes everything the page needs,
 * deepest first, and the next question finds nothing left.
 */
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
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { LAYOUTS_SLUG } from "../collections/layouts";
import { PAGES_SLUG } from "../collections/pages";
import { PAGE_BUILDER_SETTINGS_SLUG } from "../default-layout/settings-single";
import { writeLayoutSettings } from "../default-layout/store";
import { PAGE_BUILDER_PLUGIN_NAME } from "../library-contract";
import { pageBuilder } from "../plugin";
import {
  PUBLISH_DEPENDENCIES_ROUTE_PATH,
  PUBLISH_READINESS_ROUTE_PATH,
  type PublishDependenciesResult,
  type PublishReadinessResponse,
} from "../publish-readiness-contract";

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
    overrideAccess?: boolean;
  }): Promise<{ item: { id: string | number } }>;
  findByID(args: {
    collection: string;
    id: string;
    status?: "all";
    overrideAccess?: boolean;
  }): Promise<Record<string, unknown>>;
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

const ORIGIN = "http://localhost";

const idOf = (created: { item: { id: string | number } }) =>
  String(created.item.id);

const heading = (id: string) => ({
  id,
  type: "core/heading",
  version: 1,
  props: { text: id, level: "h2" },
});

const placing = (ids: readonly string[]) =>
  ids.map((componentId, i) => ({
    id: `place-${String(i)}`,
    type: COMPONENT_INSTANCE_TYPE,
    version: 1,
    props: { componentId },
  }));

/** A component document: its own heading, then the components it places. */
const componentDocument = (name: string, places: readonly string[] = []) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [heading(`${name}-h`), ...placing(places)],
});

const pageDocument = (places: readonly string[]) => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [heading("page-h"), ...placing(places)],
});

/** One request to a plugin route, as `key`. */
function route(path: string, key: string, body: unknown): Promise<Response> {
  const segments = [
    "plugins",
    ...PAGE_BUILDER_PLUGIN_NAME.split("/"),
    path.slice(1),
  ];
  const request = new Request(`${ORIGIN}/api/${segments.join("/")}`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });
  return createDynamicHandlers().POST(request, {
    params: Promise.resolve({ params: segments }),
  });
}

/** One status-only write through the REST catch-all, as `key`. */
function setStatus(
  collection: string,
  id: string,
  key: string,
  status: "published" | "draft" = "published"
): Promise<Response> {
  const path = `collections/${collection}/entries/${id}`;
  const request = new Request(`${ORIGIN}/api/${path}`, {
    method: "PATCH",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    // A status change, made whatever is stored: it says to overwrite.
    body: JSON.stringify({ status, _overwrite: true }),
  });
  return createDynamicHandlers().PATCH(request, {
    params: Promise.resolve({ params: path.split("/") }),
  });
}

describe.each(getConfiguredTestDialects())(
  "publishing a page with its unpublished parts (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let direct: Direct;
    /** Publishes pages; only reads components and Layouts. */
    let pageAuthor = "";
    /** Publishes pages, components and Layouts. */
    let siteEditor = "";
    /** Publishes pages and reads Layouts; may not read components at all. */
    let blindAuthor = "";
    /** Publishes pages and Layouts; may not read components at all. */
    let layoutAuthor = "";
    let card = "";
    let badge = "";
    let header = "";
    let landing = "";
    let page = "";

    async function statusOf(collection: string, id: string) {
      const row = await direct.findByID({
        collection,
        id,
        status: "all",
        overrideAccess: true,
      });
      return row.status;
    }

    async function readiness(key: string): Promise<PublishReadinessResponse> {
      const res = await route(PUBLISH_READINESS_ROUTE_PATH, key, {
        documents: [pageDocument([card])],
        layout: landing,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      return (await res.json()) as PublishReadinessResponse;
    }

    beforeAll(async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      t = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [pageBuilder()],
      });
      direct = t.nextly as unknown as Direct;

      const owner = await direct.users.create({
        data: {
          email: "owner@publish-readiness.test",
          password: "Password123!",
          name: "Owner",
          isActive: true,
        },
      });
      const seeded = await direct.permissions.find({ limit: 1000 });
      async function keyHolding(name: string, slugs: string[]) {
        const ids = slugs.map(slug => {
          const found = seeded.items.find(item => item.slug === slug);
          if (found === undefined) throw new Error(`${slug} is not seeded`);
          return found.id;
        });
        const role = await direct.roles.create({
          data: { name, slug: name, permissionIds: ids },
        });
        const keys = t.getService("apiKeyService") as unknown as ApiKeys;
        return (
          await keys.createApiKey(owner.item.id, {
            name,
            tokenType: "role-based",
            roleId: role.item.id,
            expiresIn: "unlimited",
          })
        ).key;
      }
      const pageGrants = ["create", "read", "update", "publish"].map(
        action => `${action}-${PAGES_SLUG}`
      );
      const reads = [COMPONENTS_SLUG, LAYOUTS_SLUG].map(slug => `read-${slug}`);
      pageAuthor = await keyHolding("page-author", [...pageGrants, ...reads]);
      blindAuthor = await keyHolding("blind-author", [
        ...pageGrants,
        `read-${LAYOUTS_SLUG}`,
      ]);
      layoutAuthor = await keyHolding("layout-author", [
        ...pageGrants,
        `read-${LAYOUTS_SLUG}`,
        `update-${LAYOUTS_SLUG}`,
        `publish-${LAYOUTS_SLUG}`,
      ]);
      siteEditor = await keyHolding("site-editor", [
        ...pageGrants,
        ...reads,
        `update-${COMPONENTS_SLUG}`,
        `publish-${COMPONENTS_SLUG}`,
        `unpublish-${COMPONENTS_SLUG}`,
        `update-${LAYOUTS_SLUG}`,
        `publish-${LAYOUTS_SLUG}`,
      ]);

      const make = async (collection: string, data: Record<string, unknown>) =>
        idOf(
          await direct.create({
            collection,
            data: { status: "draft", ...data },
            overrideAccess: true,
          })
        );
      // `badge` is placed only inside `card`, which is unpublished: the first
      // look at the page cannot see it.
      badge = await make(COMPONENTS_SLUG, {
        title: "Badge",
        slug: "badge",
        content: componentDocument("badge"),
      });
      card = await make(COMPONENTS_SLUG, {
        title: "Pricing card",
        slug: "pricing-card",
        content: componentDocument("card", [badge]),
      });
      header = await make(COMPONENTS_SLUG, {
        title: "Site header",
        slug: "site-header",
        content: componentDocument("header"),
      });
      landing = await make(LAYOUTS_SLUG, {
        title: "Landing",
        slug: "landing",
        areas: [{ area: "header", component: header }],
      });
      page = await make(PAGES_SLUG, {
        title: "Pricing",
        slug: "pricing",
        content: pageDocument([card]),
        layout: landing,
      });
    }, 180_000);

    afterAll(async () => {
      vi.restoreAllMocks();
      await t?.destroy();
    });

    it("tells a page author what the page needs, and that they may publish none of it", async () => {
      const answer = await readiness(pageAuthor);
      expect(answer).toEqual({
        // Each after what it places: the badge before the card placing it.
        dependencies: [
          { kind: "component", id: badge, title: "Badge", mayPublish: false },
          {
            kind: "component",
            id: card,
            title: "Pricing card",
            mayPublish: false,
          },
          {
            kind: "component",
            id: header,
            title: "Site header",
            mayPublish: false,
          },
          { kind: "layout", id: landing, title: "Landing", mayPublish: false },
        ],
        missing: 0,
      });
    });

    it("answers an author who may not read components, naming none of them", async () => {
      // Asked before any publish, so not refused for want of the component
      // library; the components are counted under opaque keys, never by the
      // ids a system read found.
      const answer = await readiness(blindAuthor);
      expect(answer.dependencies).toEqual([
        { kind: "component", id: "hidden-1", title: null, mayPublish: false },
        { kind: "component", id: "hidden-2", title: null, mayPublish: false },
        { kind: "component", id: "hidden-3", title: null, mayPublish: false },
        { kind: "layout", id: landing, title: "Landing", mayPublish: false },
      ]);
      const ids = new Set([badge, card, header]);
      expect(answer.dependencies.some(entry => ids.has(entry.id))).toBe(false);
    });

    it("publishes none of it for that author, and still publishes their page", async () => {
      const res = await route(PUBLISH_DEPENDENCIES_ROUTE_PATH, pageAuthor, {
        dependencies: [
          { kind: "component", id: card },
          { kind: "layout", id: landing },
        ],
      });
      expect(res.status, await res.clone().text()).toBe(200);
      const { item } = (await res.json()) as {
        item: PublishDependenciesResult;
      };
      expect(item.published).toEqual([]);
      expect(item.refused).toEqual([
        {
          kind: "component",
          id: card,
          reason: "You don't have permission to publish it.",
        },
        {
          kind: "layout",
          id: landing,
          reason: "You don't have permission to publish it.",
        },
      ]);
      expect(await statusOf(COMPONENTS_SLUG, card)).toBe("draft");
      expect(await statusOf(LAYOUTS_SLUG, landing)).toBe("draft");

      const published = await setStatus(PAGES_SLUG, page, pageAuthor);
      expect(published.status, await published.clone().text()).toBe(200);
      expect(await statusOf(PAGES_SLUG, page)).toBe("published");
    });

    it("publishes a Layout for an author who may publish it but read no component", async () => {
      // A Layout of its own, so the cases that publish `landing` are not
      // reordered by this one.
      const plain = idOf(
        await direct.create({
          collection: LAYOUTS_SLUG,
          data: { title: "Plain", slug: "plain", areas: [], status: "draft" },
          overrideAccess: true,
        })
      );
      const res = await route(PUBLISH_DEPENDENCIES_ROUTE_PATH, layoutAuthor, {
        dependencies: [{ kind: "layout", id: plain }],
      });
      expect(res.status, await res.clone().text()).toBe(200);
      const { item } = (await res.json()) as {
        item: PublishDependenciesResult;
      };
      expect(item).toEqual({
        published: [{ kind: "layout", id: plain }],
        refused: [],
      });
      expect(await statusOf(LAYOUTS_SLUG, plain)).toBe("published");
    });

    it("offers everything to an author who may publish it, and publishes it as them", async () => {
      const answer = await readiness(siteEditor);
      expect(answer.dependencies.every(entry => entry.mayPublish)).toBe(true);

      const res = await route(PUBLISH_DEPENDENCIES_ROUTE_PATH, siteEditor, {
        dependencies: answer.dependencies.map(({ kind, id }) => ({ kind, id })),
      });
      expect(res.status, await res.clone().text()).toBe(200);
      const { item } = (await res.json()) as {
        item: PublishDependenciesResult;
      };
      expect(item.refused).toEqual([]);
      for (const id of [badge, card, header]) {
        expect(await statusOf(COMPONENTS_SLUG, id)).toBe("published");
      }
      expect(await statusOf(LAYOUTS_SLUG, landing)).toBe("published");

      // Nothing is left to offer.
      expect(await readiness(siteEditor)).toEqual({
        dependencies: [],
        missing: 0,
      });
    });

    it("names a component that was published, then unpublished, then placed", async () => {
      const promo = idOf(
        await direct.create({
          collection: COMPONENTS_SLUG,
          data: {
            title: "Promo",
            slug: "promo",
            content: componentDocument("promo"),
            status: "published",
          },
          overrideAccess: true,
        })
      );
      // Unpublished while nothing places it, which is when it may be.
      const unpublished = await setStatus(
        COMPONENTS_SLUG,
        promo,
        siteEditor,
        "draft"
      );
      expect(unpublished.status, await unpublished.clone().text()).toBe(200);
      expect(await statusOf(COMPONENTS_SLUG, promo)).toBe("draft");

      const res = await route(PUBLISH_READINESS_ROUTE_PATH, siteEditor, {
        documents: [pageDocument([promo])],
        layout: null,
      });
      expect(
        ((await res.json()) as PublishReadinessResponse).dependencies
      ).toEqual([
        { kind: "component", id: promo, title: "Promo", mayPublish: true },
      ]);
    });

    it("answers a form of nine blocks fields, naming what the last one needs", async () => {
      // A form may hold any number of blocks fields, each one document of the
      // request: the ninth is asked about as the first is.
      const footnote = idOf(
        await direct.create({
          collection: COMPONENTS_SLUG,
          data: {
            title: "Footnote",
            slug: "footnote",
            content: componentDocument("footnote"),
            status: "draft",
          },
          overrideAccess: true,
        })
      );
      const res = await route(PUBLISH_READINESS_ROUTE_PATH, siteEditor, {
        documents: [
          ...Array.from({ length: 8 }, () => pageDocument([])),
          pageDocument([footnote]),
        ],
        layout: null,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(
        ((await res.json()) as PublishReadinessResponse).dependencies
      ).toEqual([
        {
          kind: "component",
          id: footnote,
          title: "Footnote",
          mayPublish: true,
        },
      ]);
    });

    it("refuses a request past the work one may ask for, however small each document", async () => {
      // Each document counts as one node at least: eight documents of the
      // largest size allowed, in empty ones, and one more.
      const res = await route(PUBLISH_READINESS_ROUTE_PATH, siteEditor, {
        documents: Array.from({ length: 8 * 5000 + 1 }, () => ({})),
        layout: null,
      });
      expect(res.status).toBe(400);
    });

    it("names the header of the site's default Layout for a page that names none", async () => {
      // A page with no Layout of its own, still drawing its header and
      // footer, is drawn inside the site's default: that default's header
      // component is one it needs, and the default itself is not offered.
      const crest = idOf(
        await direct.create({
          collection: COMPONENTS_SLUG,
          data: {
            title: "Crest",
            slug: "crest",
            content: componentDocument("crest"),
            status: "draft",
          },
          overrideAccess: true,
        })
      );
      const site = idOf(
        await direct.create({
          collection: LAYOUTS_SLUG,
          data: {
            title: "Site",
            slug: "site",
            areas: [{ area: "header", component: crest }],
            status: "published",
          },
          overrideAccess: true,
        })
      );
      // A fixture: the settings set whatever they hold.
      await writeLayoutSettings(
        t.nextly as unknown as Parameters<typeof writeLayoutSettings>[0],
        { layouts: LAYOUTS_SLUG, settings: PAGE_BUILDER_SETTINGS_SLUG },
        "overwrite",
        { defaultLayout: site }
      );
      const res = await route(PUBLISH_READINESS_ROUTE_PATH, siteEditor, {
        documents: [pageDocument([])],
        layout: null,
        siteDefault: true,
      });
      expect(res.status, await res.clone().text()).toBe(200);
      expect(
        ((await res.json()) as PublishReadinessResponse).dependencies
      ).toEqual([
        { kind: "component", id: crest, title: "Crest", mayPublish: true },
      ]);
    });

    it("refuses a body it does not accept, naming nothing", async () => {
      const res = await route(PUBLISH_READINESS_ROUTE_PATH, siteEditor, {
        documents: "not a list",
      });
      expect(res.status).toBe(400);
    });
  }
);
