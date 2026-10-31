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
 *
 * Beside the reads: the card on a site that renamed the submissions
 * collection, the update a row sends when it is opened, sent through core's
 * handler as the reader, and the indexes the card's read is served by.
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

import { markReadRequest } from "./mark-read";
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
  collection: string;
}

/** The submissions collection's slug, as the plugin declares it. */
const DECLARED_SUBMISSIONS = "form-submissions";

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
    /** The submissions collection's slug on the instance booted last. */
    let submissions = DECLARED_SUBMISSIONS;

    /** Boots with the plugin, its submissions renamed to `renamedTo` when one is named. */
    async function boot(withPlugin: boolean, renamedTo?: string) {
      const fb = installed();
      const rename = fb.plugin.rename;
      if (renamedTo !== undefined && rename === undefined) {
        throw new Error("the plugin cannot be renamed");
      }
      const plugin =
        renamedTo === undefined || rename === undefined
          ? fb.plugin
          : rename({ [DECLARED_SUBMISSIONS]: renamedTo });
      submissions = renamedTo ?? DECLARED_SUBMISSIONS;
      current = await createTestNextly({
        dialect,
        plugins: withPlugin ? [plugin] : [],
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

    /** How many roles `grant` has made, numbering the next. */
    let roles = 0;

    /** Gives `userId` a role holding exactly the permissions named. */
    async function grant(t: TestNextly, userId: string, slugs: string[]) {
      const permissions = await t.nextly.permissions.find({ limit: 500 });
      const ids = slugs.map(slug => {
        const found = permissions.items.find(item => item.slug === slug);
        if (found === undefined) throw new Error(`${slug} is not seeded`);
        return found.id;
      });
      // Numbered rather than named after the permissions: a role's name and
      // slug are short columns, which three permission names overflow.
      roles += 1;
      const role = await t.nextly.roles.create({
        data: {
          name: `Role ${roles}`,
          slug: `r-${roles}`,
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
        collection: submissions,
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

    /** One of core's routes, through its handler, with a session. */
    async function call(
      method: "GET" | "PUT" | "PATCH",
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
      return handlers[method](request, context);
    }

    /**
     * Sends what opening a row sends (`markReadRequest`), as `cookie`'s
     * reader, through core's handler at the path the admin's API serves.
     */
    async function open(cookie: string, id: string): Promise<Response> {
      const { url, init } = markReadRequest(submissions, id);
      const path = url.replace(/^\/admin\/api\//, "").split("/");
      return call(
        "PATCH",
        path,
        cookie,
        JSON.parse(String(init.body)) as unknown
      );
    }

    /** A submission's status, read as the system. */
    async function statusOf(t: TestNextly, id: string): Promise<unknown> {
      const found = (await t.nextly.findByID({
        collection: submissions,
        id,
      })) as { status?: unknown } | null;
      return found?.status;
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

      // Answered as data rather than judged empty here: the card draws its
      // own empty state, with its link to every submission.
      expect(answer).toEqual({
        state: "ready",
        data: {
          items: [],
          total: 0,
          allHref: "/admin/collections/form-submissions",
          collection: "form-submissions",
        },
      });
    });

    it("links to the submissions as the site renamed them, for a reader holding the renamed permission", async () => {
      const { t, fb, owner } = await boot(true, "leads");
      const ids = await seed(t);
      const editor = await person(t, "editor");
      // The permission as the site's collection is named: there is no
      // `read-form-submissions` once it is `leads`.
      await grant(t, editor, ["read-forms", "read-leads"]);

      const card = cardOf(fb.plugin);
      const asEditor = await runWidgetLoad(t, card, {
        as: { id: editor },
        size: TALL,
      });
      expect(asEditor.state).toBe("ready");
      const data = (asEditor as { data: CardData }).data;
      expect(data.allHref).toBe("/admin/collections/leads");
      expect(data.collection).toBe("leads");
      expect(data.items.map(row => row.href)).toContain(
        `/admin/collections/leads/${ids.contact}`
      );

      // Nothing new: the card's empty state links to the same collection.
      for (const id of [ids.contact, ids.hiring, ids.survey]) {
        await t.nextly.update({
          collection: "leads",
          where: { id: { equals: id } },
          data: { status: "read" },
        });
      }
      const empty = await runWidgetLoad(t, card, { as: { id: owner } });
      expect(empty).toEqual({
        state: "ready",
        data: {
          items: [],
          total: 0,
          allHref: "/admin/collections/leads",
          collection: "leads",
        },
      });
    });

    it("marks a submission read when it is opened, as a reader who may update it, and only while it is new", async () => {
      const { t, fb } = await boot(true);
      const ids = await seed(t);
      const archived = await submit(
        t,
        await form(t, "other", "Other", [
          { type: "text", name: "comment", label: "Comment" },
        ]),
        { comment: "Old" },
        "2026-01-05T09:00:00.000Z",
        "archived"
      );
      const editor = await person(t, "editor");
      await grant(t, editor, [
        "read-forms",
        "read-form-submissions",
        "update-form-submissions",
      ]);
      const cookie = await sessionOf(t, editor);

      const opened = await open(cookie, ids.contact);
      expect(opened.status, await opened.clone().text()).toBe(200);
      expect(await statusOf(t, ids.contact)).toBe("read");
      // Opened again, or opened after someone archived it: nothing changes.
      expect((await open(cookie, ids.contact)).status).toBe(200);
      expect(await statusOf(t, ids.contact)).toBe("read");
      await open(cookie, archived);
      expect(await statusOf(t, archived)).toBe("archived");

      // The card no longer lists it, and counts one fewer.
      const card = await runWidgetLoad(t, cardOf(fb.plugin), {
        as: { id: editor },
        size: TALL,
      });
      const data = (card as { data: CardData }).data;
      expect(data.items.map(row => row.id)).not.toContain(ids.contact);
      expect(data.total).toBe(2);
    });

    it("leaves a submission new when its reader may not update submissions", async () => {
      const { t } = await boot(true);
      const ids = await seed(t);
      const reader = await person(t, "reader");
      await grant(t, reader, ["read-forms", "read-form-submissions"]);

      const refused = await open(await sessionOf(t, reader), ids.contact);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect(await statusOf(t, ids.contact)).toBe("new");
    });

    it("indexes the submissions by status and by when they were submitted", async () => {
      const { t } = await boot(true);
      // Core stores a collection in `dc_<dbName>`.
      const columns = await indexedColumns(t, "dc_form_submissions");
      expect(columns).toContainEqual(["status"]);
      expect(columns).toContainEqual(["submitted_at"]);
      // The control: an unindexed column is not reported as one.
      expect(columns).not.toContainEqual(["notes"]);
    });

    /** The columns of each index on `table`, in order, as this dialect holds them. */
    async function indexedColumns(
      t: TestNextly,
      table: string
    ): Promise<string[][]> {
      const rows = (await t.adapter.executeQuery(indexListQuery(table))) as {
        index_name: string;
        column_name: string;
        position: number;
      }[];
      const byIndex = new Map<string, { column: string; at: number }[]>();
      for (const row of rows) {
        const columns = byIndex.get(row.index_name) ?? [];
        columns.push({ column: row.column_name, at: Number(row.position) });
        byIndex.set(row.index_name, columns);
      }
      return [...byIndex.values()].map(columns =>
        columns.sort((a, b) => a.at - b.at).map(entry => entry.column)
      );
    }

    /** Each index's columns on `table`, one row per column, from the dialect's catalog. */
    function indexListQuery(table: string): string {
      if (dialect === "postgresql") {
        return `SELECT i.relname AS index_name, a.attname AS column_name, k.ord AS position
          FROM pg_index x
          JOIN pg_class c ON c.oid = x.indrelid
          JOIN pg_class i ON i.oid = x.indexrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          CROSS JOIN LATERAL unnest(x.indkey) WITH ORDINALITY AS k(attnum, ord)
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
          WHERE c.relname = '${table}' AND n.nspname = current_schema()`;
      }
      if (dialect === "mysql") {
        return `SELECT INDEX_NAME AS index_name, COLUMN_NAME AS column_name, SEQ_IN_INDEX AS position
          FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`;
      }
      return `SELECT il.name AS index_name, ii.name AS column_name, ii.seqno AS position
        FROM pragma_index_list('${table}') AS il, pragma_index_info(il.name) AS ii`;
    }

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
