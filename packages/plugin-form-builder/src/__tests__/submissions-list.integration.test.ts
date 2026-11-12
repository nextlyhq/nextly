/**
 * The submissions list against a real instance, on every dialect configured:
 * its date filter, its export (of what a filter matches, and of ticked rows
 * alone), and who may act on ticked rows.
 *
 * Reads and writes go the way the admin sends them: the list's filter is
 * built by `listWhere`, the export through the plugin's route with a session,
 * and each change to ticked rows is the request the selection bar sends
 * (`bulkRequest`), through core's handler as the person.
 */

// Set before the harness boots: the routes verify the session with it.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import {
  createTestNextly,
  describeAbortedTransactions,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { ServiceContainer } from "nextly";
import { buildClaims, signAccessToken } from "nextly/auth";
import { createDynamicHandlers } from "nextly/runtime";
import { afterEach, describe, expect, it } from "vitest";

import {
  type BulkChange,
  bulkRequest,
} from "../admin/components/submissions/bulk-actions";
import {
  exportAddress,
  LIST_SORT,
  listWhere,
  type SubmissionListScope,
} from "../admin/components/submissions/submission-list-scope";
import type { SubmissionRow } from "../admin/components/submissions/submission-row";
import { formBuilder } from "../plugin";

const SUBMISSIONS = "form-submissions";

let current: TestNextly | undefined;

afterEach(async () => {
  const aborted = describeAbortedTransactions();
  await current?.destroy();
  current = undefined;
  if (aborted) expect.fail(aborted);
});

/** The job application: a select whose stored values differ from its labels. */
const JOB_FIELDS = [
  { type: "text", name: "full_name", label: "Full name", required: true },
  { type: "email", name: "email", label: "Email" },
  {
    type: "select",
    name: "role",
    label: "Role",
    options: [
      { value: "backend-engineer", label: "Backend engineer" },
      { value: "designer", label: "Product designer" },
    ],
  },
];

/** Who sent what, when, and in which status: the job form's rows. */
const SENT = [
  { name: "Old Ana", at: "2026-10-01T09:00:00.000Z", status: "new" },
  { name: "Edge Bilal", at: "2026-11-01T00:00:00.000Z", status: "new" },
  { name: "Mid Chen", at: "2026-11-03T12:00:00.000Z", status: "read" },
  { name: "Mid Spam", at: "2026-11-03T13:00:00.000Z", status: "spam" },
  { name: "Late Dana", at: "2026-11-05T23:59:59.000Z", status: "archived" },
  { name: "Out Eve", at: "2026-11-06T00:00:00.000Z", status: "new" },
] as const;

/** 1 to 5 November 2026, in UTC: the upper bound leaves the 6th out. */
const NOVEMBER_1_TO_5 = {
  from: "2026-11-01T00:00:00.000Z",
  to: "2026-11-06T00:00:00.000Z",
};

async function boot(dialect: TestDialect) {
  const { plugin } = formBuilder();
  current = await createTestNextly({ dialect, plugins: [plugin] });
  const t = current;
  // The harness runs none of boot's seeding, so the plugin's own permissions
  // (export) are written here from its declaration, under the slug the seeder
  // composes, `<action>-<resource>`.
  for (const declared of plugin.contributes?.permissions ?? []) {
    await t.nextly.permissions.create({
      data: {
        name: declared.label ?? `${declared.action} ${declared.resource}`,
        slug: `${declared.action}-${declared.resource}`,
        action: declared.action,
        resource: declared.resource,
      },
    });
  }
  // The instance's first user is its super admin.
  const owner = await person(t, "owner");
  const form = async (slug: string, fields: Record<string, unknown>[]) =>
    String(
      (
        await t.nextly.create({
          collection: "forms",
          data: { name: slug, slug, status: "published", fields },
        })
      ).item.id
    );
  const job = await form("jobs", JOB_FIELDS);
  const contact = await form("contact", [
    { type: "text", name: "full_name", label: "Your name" },
  ]);
  const ids: Record<string, string> = {};
  for (const [index, sent] of SENT.entries()) {
    ids[sent.name] = await submit(t, job, {
      data: {
        full_name: sent.name,
        email: `${sent.name.split(" ")[1]!.toLowerCase()}@example.com`,
        role: index % 2 === 0 ? "backend-engineer" : "designer",
      },
      submittedAt: sent.at,
      status: sent.status,
    });
  }
  // Another form's row in the same dates, which no job export may hold.
  ids["Other Form"] = await submit(t, contact, {
    data: { full_name: "Other Form" },
    submittedAt: "2026-11-02T10:00:00.000Z",
    status: "new",
  });
  return { t, owner, job, contact, ids };
}

async function submit(
  t: TestNextly,
  formId: string,
  row: { data: Record<string, unknown>; submittedAt: string; status: string }
): Promise<string> {
  const created = await t.nextly.create({
    collection: SUBMISSIONS,
    data: {
      form: formId,
      data: row.data,
      status: row.status,
      submittedAt: new Date(row.submittedAt),
    },
  });
  return String(created.item.id);
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
  roles += 1;
  const role = await t.nextly.roles.create({
    data: { name: `Role ${roles}`, slug: `r-${roles}`, permissionIds: ids },
  });
  const assigned = await new ServiceContainer(
    t.adapter
  ).userRoles.assignRoleToUser(userId, role.item.id);
  expect(assigned.success).toBe(true);
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

/** An admin API address, sent through core's handler as `cookie`'s person. */
async function send(
  address: string,
  cookie: string,
  init: RequestInit = {}
): Promise<Response> {
  const url = new URL(address, "http://localhost");
  const path = url.pathname.replace(/^\/admin\/api\//, "").split("/");
  const method = (init.method ?? "GET") as "GET" | "POST";
  const request = new Request(
    `http://localhost/api/${path.join("/")}${url.search}`,
    {
      ...init,
      method,
      headers: {
        cookie,
        origin: "http://localhost",
        "content-type": "application/json",
      },
    }
  );
  return createDynamicHandlers()[method](request, {
    params: Promise.resolve({ params: path }),
  });
}

/** The full names a CSV export holds, by its "Full name" column. */
function namesInCsv(csv: string): string[] {
  const [header, ...lines] = csv.replace(/^﻿/, "").split("\r\n");
  const column = header!.split(",").indexOf("Full name");
  expect(column).toBeGreaterThanOrEqual(0);
  return lines.map(line => line.split(",")[column]!).sort();
}

/** The rows `ids` names, read as the system, as the list holds them. */
async function rowsOf(
  t: TestNextly,
  ids: readonly string[]
): Promise<SubmissionRow[]> {
  const found = (await t.nextly.find({
    collection: SUBMISSIONS,
    where: { id: { in: [...ids] } },
    limit: 100,
  })) as { items: SubmissionRow[] };
  return found.items;
}

describe.each(getConfiguredTestDialects())(
  "the submissions list (%s)",
  dialect => {
    it("filters by date: the first moment in, the end moment out", async () => {
      const { t, job } = await boot(dialect);
      const read = async (scope: SubmissionListScope) =>
        (
          (await t.nextly.find({
            collection: SUBMISSIONS,
            where: listWhere(scope),
            sort: LIST_SORT,
            limit: 100,
          })) as { items: Array<{ data: { full_name: string } }> }
        ).items.map(row => row.data.full_name);

      // All excludes spam; the 1st's midnight is in, the 6th's is out.
      expect(
        await read({ form: job, status: "all", ...NOVEMBER_1_TO_5 })
      ).toEqual(["Late Dana", "Mid Chen", "Edge Bilal"]);
      // One bound alone.
      expect(
        await read({ form: job, status: "all", from: NOVEMBER_1_TO_5.to })
      ).toEqual(["Out Eve"]);
      expect(
        await read({ form: job, status: "all", to: NOVEMBER_1_TO_5.from })
      ).toEqual(["Old Ana"]);
      // With a status tab.
      expect(
        await read({ form: job, status: "spam", ...NOVEMBER_1_TO_5 })
      ).toEqual(["Mid Spam"]);
      // Across every form.
      expect(await read({ status: "new", ...NOVEMBER_1_TO_5 })).toEqual([
        "Other Form",
        "Edge Bilal",
      ]);
    });

    it("exports what a filter matches, as CSV with labels or as JSON", async () => {
      const { t, owner, job, ids } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      const scope: SubmissionListScope = {
        form: job,
        status: "all",
        ...NOVEMBER_1_TO_5,
      };

      const csv = await send(exportAddress(scope, "csv"), cookie);
      expect(csv.status).toBe(200);
      const text = await csv.text();
      expect(text.replace(/^﻿/, "").split("\r\n")[0]).toMatch(
        /^Full name,Email,Role,/
      );
      expect(namesInCsv(text)).toEqual(["Edge Bilal", "Late Dana", "Mid Chen"]);
      // A choice reads by its option's label, not its stored value.
      expect(text).toContain("Backend engineer");
      expect(text).not.toContain("backend-engineer");

      const json = await send(exportAddress(scope, "json"), cookie);
      expect(json.status).toBe(200);
      const { items } = (await json.json()) as { items: Array<{ id: string }> };
      expect(items.map(item => item.id).sort()).toEqual(
        [ids["Edge Bilal"], ids["Late Dana"], ids["Mid Chen"]].sort()
      );
    });

    it("exports the ticked rows and no other", async () => {
      const { t, owner, job, contact, ids } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      // Two ticked on the Spam-free list, one of them read, and a spam row
      // ticked on its own tab: every one exported, whatever its status.
      const ticked = [ids["Edge Bilal"]!, ids["Mid Chen"]!, ids["Mid Spam"]!];
      const scope: SubmissionListScope = { form: job, status: "all" };

      const csv = await send(exportAddress(scope, "csv", ticked), cookie);
      expect(csv.status).toBe(200);
      expect(namesInCsv(await csv.text())).toEqual([
        "Edge Bilal",
        "Mid Chen",
        "Mid Spam",
      ]);

      // Another form's row named among them is left out of this form's CSV.
      const mixed = await send(
        exportAddress(scope, "json", [...ticked, ids["Other Form"]!]),
        cookie
      );
      const { items } = (await mixed.json()) as {
        items: Array<{ id: string }>;
      };
      expect(items.map(item => item.id).sort()).toEqual([...ticked].sort());

      // Across every form, a JSON of ticked rows holds exactly those.
      const across = await send(
        exportAddress({ status: "all" }, "json", [
          ids["Old Ana"]!,
          ids["Other Form"]!,
        ]),
        cookie
      );
      const acrossItems = (
        (await across.json()) as { items: Array<{ id: string }> }
      ).items.map(item => item.id);
      expect(acrossItems.sort()).toEqual(
        [ids["Old Ana"], ids["Other Form"]].sort()
      );
      expect(contact).not.toBe(job);
    });

    it("refuses an export that names no submissions properly", async () => {
      const { t, owner, job } = await boot(dialect);
      const cookie = await sessionOf(t, owner);
      const empty = await send(
        `${exportAddress({ form: job, status: "all" }, "json")}&ids=`,
        cookie
      );
      expect(empty.status).toBe(400);
    });

    it("lets each action through only on the right it needs", async () => {
      const { t, job, ids } = await boot(dialect);
      // A reader: may read submissions and forms, and nothing else.
      const reader = await person(t, "reader");
      await grant(t, reader, ["read-forms", "read-form-submissions"]);
      // An editor: may also update, delete and export them.
      const editor = await person(t, "editor");
      await grant(t, editor, [
        "read-forms",
        "read-form-submissions",
        "update-form-submissions",
        "delete-form-submissions",
        "export-submissions",
      ]);
      const asReader = await sessionOf(t, reader);
      const asEditor = await sessionOf(t, editor);
      const target = [ids["Edge Bilal"]!, ids["Out Eve"]!];
      const statuses = async () =>
        (await rowsOf(t, target)).map(row => row.status).sort();

      /** Sends the bar's request for `change` to the target rows. */
      const act = async (change: BulkChange, cookie: string) => {
        const { url, init } = bulkRequest(
          SUBMISSIONS,
          change,
          await rowsOf(t, target)
        );
        return send(url, cookie, init);
      };
      /** Whether a bulk answer changed any row. */
      const changedAny = async (response: Response) =>
        response.ok &&
        (((await response.json()) as { items?: unknown[] }).items ?? [])
          .length > 0;

      for (const [change, status] of [
        ["read", "read"],
        ["archived", "archived"],
        ["spam", "spam"],
      ] as const) {
        expect(await changedAny(await act(change, asReader))).toBe(false);
        expect(await statuses()).toEqual(["new", "new"]);
        expect(await changedAny(await act(change, asEditor))).toBe(true);
        expect(await statuses()).toEqual([status, status]);
        // Back to New for the next action.
        expect(await changedAny(await act("notSpam", asEditor))).toBe(true);
      }

      const exportTicked = exportAddress(
        { form: job, status: "all" },
        "csv",
        target
      );
      expect((await send(exportTicked, asReader)).status).toBe(403);
      expect((await send(exportTicked, asEditor)).status).toBe(200);

      expect(await changedAny(await act("delete", asReader))).toBe(false);
      expect(await rowsOf(t, target)).toHaveLength(2);
      expect(await changedAny(await act("delete", asEditor))).toBe(true);
      expect(await rowsOf(t, target)).toHaveLength(0);
    });
  }
);
