/**
 * What an author holding page-editing and component-reading rights, and no
 * more, may change of a component placed on a page: its exposed fields, and
 * nothing else.
 *
 * The unit suites pin the placement-value rules against fake definitions, and
 * core's own suites pin a refused update. What only a real write through the
 * dispatcher shows is both together, for the one author this split exists for:
 * the page write that sets an exposed value is saved, the page write that
 * reaches past the exposures into the component is refused naming what it
 * set, and the component's own row cannot be written at all. A super-admin
 * makes the same component write as the control, so the refusal is about the
 * author's rights rather than a request the server cannot take.
 *
 * Per dialect, because the stored page is read back on the adapter's own
 * connection, where each dialect stores the document differently.
 *
 * @module __tests__/placement-values-rights.integration.test
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
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { COMPONENTS_SLUG } from "../collections/components";
import { PAGES_SLUG } from "../collections/pages";
import { pageBuilder } from "../plugin";

const ORIGIN = "http://localhost";
const CSRF = "c".repeat(64);

type Row = Record<string, unknown>;

/**
 * A header exposing its headline (text), its level (a choice of two) and
 * whether its button is shown. The strap under the headline is not exposed:
 * it is the component's own text.
 */
const HEADER: Row = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "component",
  nodes: [
    {
      id: "headline",
      type: "core/heading",
      version: 1,
      props: { text: "Site name", level: "h2" },
    },
    {
      id: "strap",
      type: "core/text",
      version: 1,
      props: { text: "Made with care" },
    },
    {
      id: "cta",
      type: "core/button",
      version: 1,
      props: { label: "Get started", href: "/signup" },
    },
  ],
  exposed: [
    {
      id: "headline",
      label: "Headline",
      nodeId: "headline",
      propPath: "text",
      type: "text",
    },
    {
      id: "level",
      label: "Heading level",
      nodeId: "headline",
      propPath: "level",
      type: "select",
      options: [
        { value: "h2", label: "H2" },
        { value: "h3", label: "H3" },
      ],
    },
    {
      id: "ctaShown",
      label: "Button shown",
      nodeId: "cta",
      propPath: "visibility",
      type: "visibility",
    },
  ],
};

/** A page placing the header once, with the values given. */
const placing = (componentId: string, overrides?: Row): Row => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    {
      id: "p1",
      type: COMPONENT_INSTANCE_TYPE,
      version: 1,
      props: {
        componentId,
        ...(overrides === undefined ? {} : { overrides }),
      },
    },
  ],
});

/** A stored blocks value as a document, whichever way the dialect keeps it. */
function documentOf(stored: unknown): Row {
  return (typeof stored === "string" ? JSON.parse(stored) : stored) as Row;
}

describe.each(getConfiguredTestDialects())(
  "an author who may edit pages and only read components (%s)",
  (dialect: TestDialect) => {
    let t: TestNextly;
    let owner = "";
    let author = "";
    let componentId = "";
    let pageId = "";

    /** A session cookie for a person, signed as the dispatcher checks it. */
    async function sessionOf(
      user: { id: string; email: string },
      name: string
    ): Promise<string> {
      const token = await signAccessToken(
        buildClaims({
          userId: user.id,
          email: user.email,
          name,
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    beforeAll(async () => {
      t = await createTestNextly({ dialect, plugins: [pageBuilder()] });
      // The site's first user is its owner, granted everything. Made first, so
      // the author below holds only what the role gives them.
      const first = await t.nextly.users.create({
        email: "owner@example.com",
        password: "Password123!",
        data: { name: "Owner", isActive: true },
      });
      owner = await sessionOf(first.item, "Owner");

      const created = await t.nextly.users.create({
        email: "author@example.com",
        password: "Password123!",
        data: { name: "Author", isActive: true },
      });
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const ids = ["read-pages", "update-pages", `read-${COMPONENTS_SLUG}`].map(
        slug => {
          const found = permissions.items.find(item => item.slug === slug);
          if (found === undefined) throw new Error(`${slug} is not seeded`);
          return found.id;
        }
      );
      const role = await t.nextly.roles.create({
        data: { name: "Page author", slug: "page-author", permissionIds: ids },
      });
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(created.item.id, role.item.id);
      expect(assigned.success).toBe(true);
      author = await sessionOf(created.item, "Author");

      componentId = String(
        (
          await t.nextly.create({
            collection: COMPONENTS_SLUG,
            data: {
              title: "Site header",
              slug: "site-header",
              content: HEADER,
              status: "published",
            },
            overrideAccess: true,
          })
        ).item.id
      );
      pageId = String(
        (
          await t.nextly.create({
            collection: PAGES_SLUG,
            data: {
              title: "Home",
              slug: "home",
              content: placing(componentId),
            },
            overrideAccess: true,
          })
        ).item.id
      );
    }, 180_000);

    afterAll(async () => {
      await t?.destroy();
    });

    /** One request through the real dispatcher, as a browser would make it. */
    async function patch(
      path: string[],
      cookie: string,
      body: unknown
    ): Promise<{ status: number; text: string }> {
      const response = await createDynamicHandlers().PATCH(
        new Request(`${ORIGIN}/api/${path.join("/")}`, {
          method: "PATCH",
          headers: {
            cookie: `${cookie}; nextly_csrf=${CSRF}`,
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

    const writePage = (overrides: Row) =>
      patch(["collections", PAGES_SLUG, "entries", pageId], author, {
        content: placing(componentId, overrides),
        _overwrite: true,
      });

    async function storedOverrides(): Promise<unknown> {
      const row = (await t.nextly.findByID({
        collection: PAGES_SLUG,
        id: pageId,
        depth: 0,
        // The working draft where there is one: what the write stored.
        status: "all",
        draft: true,
        overrideAccess: true,
      })) as Row;
      const nodes = documentOf(row.content).nodes as { props: Row }[];
      return nodes[0]?.props.overrides;
    }

    async function storedComponent(): Promise<Row> {
      const row = (await t.nextly.findByID({
        collection: COMPONENTS_SLUG,
        id: componentId,
        depth: 0,
        // The working draft where there is one: what the write stored.
        status: "all",
        draft: true,
        overrideAccess: true,
      })) as Row;
      return documentOf(row.content);
    }

    /** The header with its strap rewritten: a change to its own design. */
    const redesigned = (): Row => ({
      ...HEADER,
      nodes: (HEADER.nodes as Row[]).map(node =>
        node.id === "strap"
          ? { ...node, props: { text: "Rewritten by the author" } }
          : node
      ),
    });

    it("saves the page with values for the fields the component exposes", async () => {
      const answer = await writePage({
        headline: "Acme launch",
        level: "h3",
        ctaShown: false,
      });

      expect(answer.status, answer.text).toBe(200);
      expect(await storedOverrides()).toEqual({
        headline: "Acme launch",
        level: "h3",
        ctaShown: false,
      });
    });

    it("refuses a page write that sets a part the component does not expose, naming it", async () => {
      const before = await storedOverrides();

      const answer = await writePage({
        headline: "Acme launch",
        strap: "Rewritten by the author",
      });

      expect(answer.status).toBe(400);
      expect(answer.text).toContain('sets \\"strap\\"');
      expect(answer.text).toContain("which that component does not expose");
      expect(await storedOverrides()).toEqual(before);
    });

    it("refuses a page write that gives an exposed choice a value it does not offer", async () => {
      const before = await storedOverrides();

      const answer = await writePage({ headline: "Acme launch", level: "h1" });

      expect(answer.status).toBe(400);
      expect(answer.text).toContain("Heading level needs one of: h2, h3");
      expect(await storedOverrides()).toEqual(before);
    });

    it("refuses the author's write to the component itself, and keeps its design", async () => {
      const answer = await patch(
        ["collections", COMPONENTS_SLUG, "entries", componentId],
        author,
        { content: redesigned(), _overwrite: true }
      );

      expect(answer.status, answer.text).toBe(403);
      expect(JSON.stringify(await storedComponent())).toContain(
        "Made with care"
      );
      expect(JSON.stringify(await storedComponent())).not.toContain(
        "Rewritten by the author"
      );
    });

    it("lets the owner make that same component write", async () => {
      // The control: a write the server cannot take at all would also answer
      // the author with a refusal.
      const answer = await patch(
        ["collections", COMPONENTS_SLUG, "entries", componentId],
        owner,
        { content: redesigned(), _overwrite: true }
      );

      expect(answer.status, answer.text).toBe(200);
      expect(JSON.stringify(await storedComponent())).toContain(
        "Rewritten by the author"
      );
    });
  }
);
