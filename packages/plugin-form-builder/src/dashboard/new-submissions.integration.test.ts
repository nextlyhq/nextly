/**
 * New form submissions against a real instance, on every dialect configured:
 * the card answered through the dashboard's own query route for each reader
 * (`runWidgetLoad`), the header's part through `GET /api/dashboard/summary`,
 * and the card placed through `PUT /api/dashboard/layout`, as the admin does.
 *
 * Three readers: the instance's first user, its super admin, who reads every
 * form; an editor holding `read-forms` and `read-form-submissions`, whom the
 * forms collection's read rule keeps from the "hiring" form; and an outsider
 * holding `read-form-submissions` alone. Each boot is a database of its own.
 */

// Set before the harness boots: the dashboard routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  describeAbortedTransactions,
  getConfiguredTestDialects,
  runWidgetLoad,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { formBuilder } from "../plugin";

import { NEW_SUBMISSIONS_WIDGET_ID } from "./new-submissions";

/** Users the forms collection's read rule keeps from the hiring form. */
const keptFromHiring = new Set<string>();

/** The plugin, with a forms read rule that narrows one reader by a filter. */
function installed() {
  return formBuilder({
    formOverrides: {
      access: {
        read: ({ user }) =>
          keptFromHiring.has(user?.id ?? "")
            ? { slug: { not_equals: "hiring" } }
            : true,
      },
    },
  });
}

/** The card as the plugin contributes it. */
function cardOf(plugin: ReturnType<typeof installed>["plugin"]) {
  const widget = plugin.contributes?.dashboard?.widgets?.find(
    candidate => candidate.id === NEW_SUBMISSIONS_WIDGET_ID
  );
  if (widget === undefined) throw new Error("the plugin contributes no card");
  return widget;
}

/** A card tall enough to draw every row these cases make. */
const TALL = { w: 6, h: 8, tier: "medium" } as const;

interface CardRow {
  id: string;
  title: string;
  form?: string;
  excerpt?: string;
  at?: string;
  href: string;
}
interface CardData {
  items: CardRow[];
  total: number;
  allHref: string;
}

let current: TestNextly | undefined;

afterEach(async () => {
  const aborted = describeAbortedTransactions();
  await current?.destroy();
  current = undefined;
  keptFromHiring.clear();
  if (aborted) expect.fail(aborted);
});

describe.each(getConfiguredTestDialects())(
  "New form submissions (%s)",
  dialect => {
    async function boot(withPlugin: boolean) {
      const fb = installed();
      current = await createTestNextly({
        dialect,
        plugins: withPlugin ? [fb.plugin] : [],
      });
      const t = current;
      const owner = await person(t, "owner");
      return { t, fb, owner };
    }

    async function person(t: TestNextly, name: string): Promise<string> {
      const created = await t.nextly.users.create({
        email: `${name}@example.com`,
        password: "Password123!",
        data: { name, isActive: true },
      });
      return created.item.id;
    }

    /** Gives `userId` a role holding exactly the permissions named. */
    async function grant(t: TestNextly, userId: string, slugs: string[]) {
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const ids = slugs.map(slug => {
        const found = permissions.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      const role = await t.nextly.roles.create({
        data: {
          name: `Role ${slugs.join(" ")}`,
          slug: `r-${slugs.join("-")}`,
          permissionIds: ids,
        },
      });
      const assigned = await new ServiceContainer(
        t.adapter
      ).userRoles.assignRoleToUser(userId, role.item.id);
      expect(assigned.success).toBe(true);
    }

    async function form(
      t: TestNextly,
      slug: string,
      name: string,
      fields: Record<string, unknown>[]
    ): Promise<string> {
      const created = await t.nextly.create({
        collection: "forms",
        data: { name, slug, fields, status: "published" },
      });
      return (created as { item: { id: string } }).item.id;
    }

    async function submit(
      t: TestNextly,
      formId: string,
      data: Record<string, unknown>,
      submittedAt: string,
      status = "new"
    ): Promise<string> {
      const created = await t.nextly.create({
        collection: "form-submissions",
        data: {
          form: formId,
          data,
          status,
          submittedAt: new Date(submittedAt),
        },
      });
      return (created as { item: { id: string } }).item.id;
    }

    /** Three forms, three new submissions and one already read. */
    async function seed(t: TestNextly) {
      const contact = await form(t, "contact", "Contact", [
        { type: "text", name: "name", label: "Name", required: true },
        { type: "email", name: "email", label: "Email" },
        { type: "textarea", name: "message", label: "Message" },
      ]);
      const hiring = await form(t, "hiring", "Hiring", [
        { type: "text", name: "name", label: "Name", required: true },
        { type: "textarea", name: "letter", label: "Cover letter" },
      ]);
      const survey = await form(t, "survey", "Survey", [
        { type: "text", name: "comment", label: "Comment" },
      ]);
      return {
        contact: await submit(
          t,
          contact,
          {
            name: "Ana Ruiz",
            email: "ana@example.com",
            message: "Price list, please",
          },
          "2026-01-01T09:00:00.000Z"
        ),
        read: await submit(
          t,
          contact,
          { name: "Old News" },
          "2026-01-04T09:00:00.000Z",
          "read"
        ),
        hiring: await submit(
          t,
          hiring,
          { name: "Secret Candidate", letter: "Confidential letter" },
          "2026-01-03T09:00:00.000Z"
        ),
        survey: await submit(
          t,
          survey,
          { comment: "Lovely" },
          "2026-01-02T09:00:00.000Z"
        ),
      };
    }

    async function sessionOf(t: TestNextly, userId: string): Promise<string> {
      const user = await t.nextly.users.findByID({ id: userId });
      if (user === null) throw new Error(`no user ${userId}`);
      const token = await signAccessToken(
        buildClaims({
          userId,
          email: user.email,
          name: user.name ?? "",
          image: null,
          roleIds: [],
          sessionEpoch: 0,
        }),
        process.env.NEXTLY_SECRET ?? ""
      );
      return `nextly_session=${token}`;
    }

    /** One of the dashboard's routes, through core's handler, with a session. */
    async function call(
      method: "GET" | "PUT",
      path: string[],
      cookie: string,
      body?: unknown
    ): Promise<Response> {
      const handlers = createDynamicHandlers();
      const request = new Request(`http://localhost/api/${path.join("/")}`, {
        method,
        headers: { cookie, "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const context = { params: Promise.resolve({ params: path }) };
      return method === "GET"
        ? handlers.GET(request, context)
        : handlers.PUT(request, context);
    }

    /** The reader's layout as the admin reads it. */
    async function layoutOf(cookie: string) {
      const response = await call("GET", ["dashboard", "layout"], cookie);
      expect(response.status).toBe(200);
      return (await response.json()) as {
        placements: { id: string; widgetId: string }[];
        widgets: Record<string, unknown>;
        available: string[];
        version: number;
        scope: string;
      };
    }

    /** Saves the reader's dashboard with the card placed, as the admin does. */
    async function place(cookie: string): Promise<Response> {
      const layout = await layoutOf(cookie);
      return call("PUT", ["dashboard", "layout"], cookie, {
        placements: [
          ...layout.placements,
          {
            id: "submissions-card",
            widgetId: NEW_SUBMISSIONS_WIDGET_ID,
            w: 6,
            h: 3,
            removed: false,
          },
        ],
        version: layout.version,
        scope: layout.scope,
      });
    }

    /** The header's part for the card, or `undefined` when it has none. */
    async function headerPart(cookie: string) {
      const response = await call("GET", ["dashboard", "summary"], cookie);
      expect(response.status).toBe(200);
      const { parts } = (await response.json()) as {
        parts: {
          kind: string;
          widget?: string;
          count: number;
          label: string;
        }[];
      };
      return parts.find(
        part =>
          part.kind === "widget" && part.widget === NEW_SUBMISSIONS_WIDGET_ID
      );
    }

    it("lists the new submissions newest first, each with who sent it, its form, its first line and its link", async () => {
      const { t, fb, owner } = await boot(true);
      const ids = await seed(t);

      const answer = await runWidgetLoad(t, cardOf(fb.plugin), {
        as: { id: owner },
        size: TALL,
      });

      expect(answer.state).toBe("ready");
      const data = (answer as { data: CardData }).data;
      expect(data.total).toBe(3);
      expect(data.items.map(row => row.id)).toEqual([
        ids.hiring,
        ids.survey,
        ids.contact,
      ]);
      const all = "/admin/collections/form-submissions";
      expect(data.allHref).toBe(all);
      expect(data.items[2]).toEqual({
        id: ids.contact,
        title: "Ana Ruiz",
        form: "Contact",
        excerpt: "Price list, please",
        at: "2026-01-01T09:00:00.000Z",
        href: `${all}/${ids.contact}`,
      });
      expect(data.items[1]).toMatchObject({
        title: "Submission",
        form: "Survey",
        excerpt: "Lovely",
      });
      // Only what a row draws: never the submitter's address or the notes.
      for (const row of data.items) {
        expect(Object.keys(row).sort()).toEqual(
          ["at", "excerpt", "form", "href", "id", "title"].filter(
            key => key in row
          )
        );
        expect(JSON.stringify(row)).not.toMatch(/ipAddress|userAgent|notes/);
      }
    });

    it("answers empty, not hidden, while forms exist and nothing is new", async () => {
      const { t, fb, owner } = await boot(true);
      const contact = await form(t, "contact", "Contact", [
        { type: "text", name: "name", label: "Name" },
      ]);
      await submit(
        t,
        contact,
        { name: "Read" },
        "2026-01-01T09:00:00.000Z",
        "read"
      );

      const answer = await runWidgetLoad(t, cardOf(fb.plugin), {
        as: { id: owner },
      });

      expect(answer).toEqual({
        state: "empty",
        data: {
          items: [],
          total: 0,
          allHref: "/admin/collections/form-submissions",
        },
      });
    });

    it("never shows, counts or names a submission of a form the reader may not read", async () => {
      const { t, fb, owner } = await boot(true);
      const ids = await seed(t);
      const editor = await person(t, "editor");
      await grant(t, editor, ["read-forms", "read-form-submissions"]);
      keptFromHiring.add(editor);
      const outsider = await person(t, "outsider");
      await grant(t, outsider, ["read-form-submissions"]);

      const card = cardOf(fb.plugin);
      const asOwner = await runWidgetLoad(t, card, {
        as: { id: owner },
        size: TALL,
      });
      const asEditor = await runWidgetLoad(t, card, {
        as: { id: editor },
        size: TALL,
      });

      // The control: the owner is shown the hiring submission the editor is not.
      expect(JSON.stringify(asOwner)).toContain("Secret Candidate");
      expect(asEditor.state).toBe("ready");
      const data = (asEditor as { data: CardData }).data;
      expect(data.total).toBe(2);
      expect(data.items.map(row => row.id)).toEqual([ids.survey, ids.contact]);
      expect(JSON.stringify(asEditor)).not.toMatch(
        /Hiring|Secret Candidate|Confidential/
      );

      // Submissions without forms: no form is theirs to read, so no card.
      const asOutsider = await runWidgetLoad(t, card, { as: { id: outsider } });
      expect(["unavailable", "not-shown"]).toContain(asOutsider.state);
    });

    it("puts the card's own count in the header, for each reader", async () => {
      const { t, fb, owner } = await boot(true);
      await seed(t);
      const editor = await person(t, "editor");
      await grant(t, editor, ["read-forms", "read-form-submissions"]);
      keptFromHiring.add(editor);

      for (const [id, expected] of [
        [owner, 3],
        [editor, 2],
      ] as const) {
        const cookie = await sessionOf(t, id);
        const placed = await place(cookie);
        expect(placed.status, await placed.clone().text()).toBe(200);
        const card = await runWidgetLoad(t, cardOf(fb.plugin), { as: { id } });
        expect((card as { data: CardData }).data.total).toBe(expected);
        expect(await headerPart(cookie)).toEqual({
          kind: "widget",
          widget: NEW_SUBMISSIONS_WIDGET_ID,
          card: "submissions-card",
          label: "new submissions",
          count: expected,
        });
      }
    });

    it("is gone with the plugin: no card to place, and no part in the header", async () => {
      const { owner } = await boot(false);
      const cookie = await sessionOf(current!, owner);

      const layout = await layoutOf(cookie);
      expect(Object.keys(layout.widgets)).not.toContain(
        NEW_SUBMISSIONS_WIDGET_ID
      );
      expect(layout.available).not.toContain(NEW_SUBMISSIONS_WIDGET_ID);
      expect((await place(cookie)).status).toBeGreaterThanOrEqual(400);
      expect(await headerPart(cookie)).toBeUndefined();
    });

    it("is offered with the plugin, the control for the case above", async () => {
      const { owner } = await boot(true);
      const cookie = await sessionOf(current!, owner);
      await seed(current!);

      const layout = await layoutOf(cookie);
      expect(Object.keys(layout.widgets)).toContain(NEW_SUBMISSIONS_WIDGET_ID);
      expect(layout.available).toContain(NEW_SUBMISSIONS_WIDGET_ID);
      expect((await place(cookie)).status).toBe(200);
      expect(await headerPart(cookie)).toMatchObject({ count: 3 });
    });
  }
);
