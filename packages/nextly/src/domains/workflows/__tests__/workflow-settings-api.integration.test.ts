/**
 * Developers read and change a workflow's settings through REST and the Direct API, on every
 * configured dialect. Each case runs through both doors against the same assertions.
 *
 * - The registered workflows are listed with the collections and Singles each is attached to.
 * - Each setting written (a stage's default reviewer, label and colour, which notifications also
 *   email) reads back as written, and the change is in the activity log, as the person who made it.
 * - A default reviewer must hold the stage's primary step on EVERY collection and Single the
 *   workflow is attached to: one who holds it on one and not another is refused, naming the stage.
 * - The definition is the code's: a write naming any part of it is refused, and nothing is stored.
 * - A write is made over the revision the caller read: one over a stale revision is refused.
 * - Which roles hold a step's permission is set on every attached collection and Single at once,
 *   and recorded.
 * - Reading and writing ask the settings permissions; changing grants also asks to update roles.
 *
 * The plausible broken surfaces: an eligibility check on the first attached collection only, a
 * write that stores a definition key or ignores it, a write that skips the revision, grants set on
 * one collection, and a REST route and a Direct API call that disagree.
 */

// Set before the harness boots (env validation reads it once), so a session can be signed.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { holderAnswer } from "../holders";
import { readWorkflowSettings } from "../workflow-settings-repository";

import { bootSteps, person, role, stateDb } from "./helpers/step-harness";

type Doc = Record<string, unknown>;

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

const app = (): TestNextly => {
  if (!current) throw new Error("not booted");
  return current;
};

/** Every collection and Single the editorial workflow is attached to in the harness. */
const EDITORIAL = [
  "posts",
  "pages",
  "locked",
  "translations",
  "letters",
  "dossiers",
  "dockets",
  "banner",
] as const;

/**
 * A refusal as both doors report it: the HTTP status, the error's code, and, for a validation
 * error, each problem's own code and message.
 */
interface Refusal {
  status: number;
  code: string;
  problems: { path: string; code: string; message: string }[];
}

const problemsOf = (data: unknown): Refusal["problems"] =>
  ((data as { errors?: Refusal["problems"] } | undefined)?.errors ?? []).map(
    ({ path, code, message }) => ({ path, code, message })
  );

/** One door: each settings operation, made for the person `who`, answering or throwing a {@link Refusal}. */
interface Door {
  name: string;
  list(who: string): Promise<Doc[]>;
  read(who: string, slug: string): Promise<Doc>;
  update(who: string, slug: string, body: Doc): Promise<Doc>;
}

async function rest(
  method: "GET" | "PATCH",
  path: string[],
  who: string,
  body?: unknown
): Promise<Doc> {
  const token = await signAccessToken(
    buildClaims({
      userId: who,
      email: `${who}@example.test`,
      name: who,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  const handlers = createDynamicHandlers();
  const request = new Request(`http://localhost/api/${path.join("/")}`, {
    method,
    headers: {
      cookie: `nextly_session=${token}`,
      origin: "http://localhost",
      "content-type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const context = { params: Promise.resolve({ params: path }) };
  const response =
    method === "GET"
      ? await handlers.GET(request, context)
      : await handlers.PATCH(request, context);
  const json = (await response.json()) as Doc;
  if (response.status >= 400) {
    const error = json.error as Doc | undefined;
    const refusal: Refusal = {
      status: response.status,
      code: String(error?.code),
      problems: problemsOf(error?.data),
    };
    throw refusal;
  }
  return json;
}

const REST: Door = {
  name: "REST",
  async list(who) {
    return (await rest("GET", ["workflows"], who)).items as Doc[];
  },
  async read(who, slug) {
    return rest("GET", ["workflows", slug, "settings"], who);
  },
  async update(who, slug, body) {
    return (await rest("PATCH", ["workflows", slug, "settings"], who, body))
      .item as Doc;
  },
};

/** A Direct API call made for the person `who`, its refusal reported as REST reports it. */
async function direct<T>(
  call: (args: Doc) => Promise<T>,
  who: string
): Promise<T> {
  try {
    return await call({ overrideAccess: false, user: { id: who } });
  } catch (error) {
    const failed = error as {
      statusCode?: number;
      code?: string;
      publicData?: unknown;
    };
    if (typeof failed.statusCode !== "number") throw error;
    const refusal: Refusal = {
      status: failed.statusCode,
      code: String(failed.code),
      problems: problemsOf(failed.publicData),
    };
    throw refusal;
  }
}

/** The Direct API's workflows namespace, as this file calls it whatever its declared shape. */
const workflowsApi = () =>
  app().nextly.workflows as unknown as {
    list(args: Doc): Promise<{ items: Doc[] }>;
    settings: {
      read(args: Doc): Promise<Doc>;
      update(args: Doc): Promise<Doc>;
    };
  };

const DIRECT: Door = {
  name: "Direct API",
  list: async who =>
    (await direct(args => workflowsApi().list(args), who)).items,
  read: (who, slug) =>
    direct(args => workflowsApi().settings.read({ ...args, slug }), who),
  update: (who, slug, body) =>
    direct(
      args => workflowsApi().settings.update({ ...args, ...body, slug }),
      who
    ),
};

/** What a call refuses with, or a failure when it answers. */
async function refusalOf(call: () => Promise<unknown>): Promise<Refusal> {
  try {
    await call();
  } catch (error) {
    const refusal = error as Partial<Refusal>;
    if (typeof refusal.status === "number") return refusal as Refusal;
    throw error;
  }
  throw new Error("expected a refusal, and the call answered");
}

/** The problem codes a refusal names. */
const codesOf = (refusal: Refusal) => refusal.problems.map(each => each.code);

/** `action` on every collection and Single the editorial workflow is attached to. */
const everywhere = (action: string) =>
  EDITORIAL.map(slug => [action, slug] as const);

/** Sam administers settings and roles; nothing else. */
const SAM = "sam";

async function admin(): Promise<void> {
  await person(app(), SAM, [
    ["read", "settings"],
    ["update", "settings"],
    ["update", "roles"],
  ]);
}

interface ActivityRow {
  actorType: string | null;
  userId: string;
  action: string;
  collection: string;
  entryId: string | null;
  metadata: string | Record<string, unknown> | null;
}

async function workflowActivity(): Promise<ActivityRow[]> {
  return app().adapter.select<ActivityRow>("activity_log", {
    where: { and: [{ column: "collection", op: "=", value: "workflows" }] },
  });
}

function metadataOf(row: ActivityRow): Record<string, unknown> {
  if (row.metadata === null) return {};
  return typeof row.metadata === "string"
    ? (JSON.parse(row.metadata) as Record<string, unknown>)
    : row.metadata;
}

/** Whether the role holds `action` on each editorial collection and Single, by slug. */
async function roleHoldsOn(roleId: string, action: string) {
  const answers: Record<string, string> = {};
  for (const slug of EDITORIAL) {
    answers[slug] = await holderAnswer(
      app().adapter,
      { kind: "role", id: roleId },
      action,
      slug
    );
  }
  return answers;
}

const holdingEverywhere = Object.fromEntries(
  EDITORIAL.map(slug => [slug, "holds"])
);

describe.each(getConfiguredTestDialects())(
  "workflow settings through the APIs (%s)",
  dialect => {
    describe.each([REST, DIRECT])("through $name", door => {
      it("lists the registered workflows with the collections and Singles each is attached to", async () => {
        current = await bootSteps(dialect);
        await admin();

        const listed = await door.list(SAM);
        const editorial = listed.find(each => each.slug === "editorial");
        const handover = listed.find(each => each.slug === "handover");

        expect(editorial).toMatchObject({
          slug: "editorial",
          label: "Editorial",
        });
        expect([...(editorial?.collections as string[])].sort()).toEqual(
          EDITORIAL.filter(slug => slug !== "banner").sort()
        );
        expect(editorial?.singles).toEqual(["banner"]);
        expect(editorial?.stages).toEqual([
          expect.objectContaining({ name: "writing", label: "Writing" }),
          expect.objectContaining({ name: "legal", label: "Legal check" }),
          expect.objectContaining({ name: "hold", label: "On hold" }),
          expect.objectContaining({ name: "cleared", allowsPublish: true }),
        ]);
        expect(handover).toMatchObject({ collections: ["memos"], singles: [] });
      });

      it("reads back each setting it saves, and records the change in the activity log", async () => {
        current = await bootSteps(dialect);
        await admin();
        await person(app(), "rita", everywhere("sign-off"));

        const before = await door.read(SAM, "editorial");
        const saved = await door.update(SAM, "editorial", {
          revision: before.revision,
          defaultReviewers: { legal: { kind: "user", id: "rita" } },
          labels: { legal: { label: "Lawyers", colour: "#aa3300" } },
          emails: { approved: false },
        });
        const after = await door.read(SAM, "editorial");

        expect(before).toMatchObject({
          workflow: "editorial",
          revision: 0,
          defaultReviewers: {},
          labels: {},
          emails: { assigned: true, approved: true, changesRequested: true },
        });
        expect(saved).toEqual(after);
        expect(after).toMatchObject({
          workflow: "editorial",
          revision: 1,
          defaultReviewers: { legal: { kind: "user", id: "rita" } },
          labels: { legal: { label: "Lawyers", colour: "#aa3300" } },
          emails: { assigned: true, approved: false, changesRequested: true },
        });
        // Stored where steps and notices read them.
        expect(
          (await readWorkflowSettings(stateDb(app()), "editorial"))?.settings
        ).toEqual({
          defaultReviewers: { legal: { kind: "user", id: "rita" } },
          stages: { legal: { label: "Lawyers", colour: "#aa3300" } },
          emails: { approved: false },
        });

        // A second write clears the label and changes one email, keeping the rest.
        await door.update(SAM, "editorial", {
          revision: 1,
          labels: { legal: null },
          emails: { assigned: false },
        });
        expect(await door.read(SAM, "editorial")).toMatchObject({
          revision: 2,
          defaultReviewers: { legal: { kind: "user", id: "rita" } },
          labels: {},
          emails: { assigned: false, approved: false, changesRequested: true },
        });

        const rows = (await workflowActivity()).filter(
          row => row.entryId === "editorial"
        );
        expect(rows).toHaveLength(2);
        expect(rows[0]).toMatchObject({
          action: "update",
          actorType: "user",
          userId: SAM,
        });
        const changed = rows.map(row =>
          [...(metadataOf(row).changedFields as string[])].sort()
        );
        expect(changed).toEqual(
          expect.arrayContaining([
            ["defaultReviewers.legal", "emails.approved", "labels.legal"],
            ["emails.assigned", "labels.legal"],
          ])
        );
      });

      it("refuses a default reviewer who cannot take the stage's primary step on every attached collection and Single", async () => {
        current = await bootSteps(dialect);
        await admin();
        // Holds the legal check's primary step (sign-off) on Pages, and on nothing else.
        await person(app(), "kim", [["sign-off", "pages"]]);
        // Holds it on every attached collection, but not on the Single.
        await person(
          app(),
          "cole",
          everywhere("sign-off").filter(([, slug]) => slug !== "banner")
        );
        // A role holding it on Posts alone.
        const desk = await role(app(), "posts-desk", [["sign-off", "posts"]]);

        const refusals = [];
        for (const reviewer of [
          { kind: "user", id: "kim" },
          { kind: "user", id: "cole" },
          { kind: "role", id: desk },
        ]) {
          refusals.push(
            await refusalOf(() =>
              door.update(SAM, "editorial", {
                revision: 0,
                defaultReviewers: { legal: reviewer },
              })
            )
          );
        }

        for (const refusal of refusals) {
          expect(refusal).toMatchObject({
            status: 400,
            code: "VALIDATION_ERROR",
          });
          expect(refusal.problems).toEqual([
            expect.objectContaining({
              path: "defaultReviewers.legal",
              code: "WORKFLOW_INELIGIBLE_REVIEWER",
              message: expect.stringContaining("Legal check"),
            }),
          ]);
        }
        expect(await door.read(SAM, "editorial")).toMatchObject({
          revision: 0,
          defaultReviewers: {},
        });
        expect(await workflowActivity()).toEqual([]);
      });

      it("refuses a change to the definition, whatever part it names", async () => {
        current = await bootSteps(dialect);
        await admin();

        const writes: Doc[] = [
          { stages: [{ name: "writing", label: "Writing" }] },
          { steps: [] },
          { from: "writing" },
          { to: "legal" },
          { kind: "approve" },
          { permission: "sign-off" },
          { allowsPublish: true },
          { afterPublish: "writing" },
          { onEdit: { to: "writing" } },
          // Beside a setting, and inside one.
          { emails: { approved: false }, steps: [] },
          { labels: { legal: { label: "Lawyers", allowsPublish: true } } },
        ];
        const refusals = [];
        for (const write of writes) {
          refusals.push(
            await refusalOf(() =>
              door.update(SAM, "editorial", { revision: 0, ...write })
            )
          );
        }

        for (const refusal of refusals) {
          expect(refusal).toMatchObject({
            status: 400,
            code: "VALIDATION_ERROR",
          });
          expect(codesOf(refusal)).toContain("WORKFLOW_DEFINITION_READ_ONLY");
        }
        expect(await door.read(SAM, "editorial")).toMatchObject({
          revision: 0,
          labels: {},
          emails: { approved: true },
        });
      });

      it("refuses a write over a revision that is no longer the stored one", async () => {
        current = await bootSteps(dialect);
        await admin();
        await door.update(SAM, "editorial", {
          revision: 0,
          emails: { approved: false },
        });

        const stale = await refusalOf(() =>
          door.update(SAM, "editorial", {
            revision: 0,
            emails: { assigned: false },
          })
        );

        expect(stale).toMatchObject({ status: 409, code: "CONFLICT" });
        expect(await door.read(SAM, "editorial")).toMatchObject({
          revision: 1,
          emails: { assigned: true, approved: false },
        });
      });

      it("sets which roles hold a step's permission on every attached collection and Single, and records it", async () => {
        current = await bootSteps(dialect);
        await admin();
        const desk = await role(app(), "legal-desk", [["read", "pages"]]);
        // Holds sign-off directly on Pages: not named, so it is taken away.
        const old = await role(app(), "old-desk", [
          ["sign-off", "pages"],
          ["read", "pages"],
        ]);

        const saved = await door.update(SAM, "editorial", {
          revision: 0,
          grants: { clear: [desk] },
        });

        expect(await roleHoldsOn(desk, "sign-off")).toEqual(holdingEverywhere);
        expect((await roleHoldsOn(old, "sign-off")).pages).toBe("lacks");
        // What else each role holds is left as it was.
        expect(
          await holderAnswer(
            app().adapter,
            { kind: "role", id: old },
            "read",
            "pages"
          )
        ).toBe("holds");
        // Both steps needing sign-off read the roles that hold it.
        expect(saved.grants).toMatchObject({ clear: [desk], bounce: [desk] });
        expect(saved.revision).toBe(1);
        expect((await door.read(SAM, "editorial")).grants).toEqual(
          saved.grants
        );

        const [row] = (await workflowActivity()).filter(
          each => each.entryId === "editorial"
        );
        expect(row).toMatchObject({ actorType: "user", userId: SAM });
        expect(metadataOf(row)).toMatchObject({
          changedFields: ["grants.clear"],
          grants: { clear: { granted: [desk], revoked: [old] } },
        });

        // A step that needs only the collection's own permissions has none of its own to grant.
        const builtIn = await refusalOf(() =>
          door.update(SAM, "editorial", {
            revision: 1,
            grants: { send: [desk] },
          })
        );
        expect(builtIn).toMatchObject({ status: 400 });
        expect(codesOf(builtIn)).toEqual(["WORKFLOW_STEP_NOT_GRANTABLE"]);
      });

      it("refuses a caller without the settings permissions, and grants to one who may not update roles", async () => {
        current = await bootSteps(dialect);
        await person(app(), "alice", [
          ["read", "pages"],
          ["update", "pages"],
        ]);
        await person(app(), "ned", [
          ["read", "settings"],
          ["update", "settings"],
        ]);
        // A role holds at least one permission; this one has nothing to do with the workflow.
        const desk = await role(app(), "legal-desk", [["read", "pages"]]);

        const list = await refusalOf(() => door.list("alice"));
        const read = await refusalOf(() => door.read("alice", "editorial"));
        const write = await refusalOf(() =>
          door.update("alice", "editorial", {
            revision: 0,
            emails: { approved: false },
          })
        );
        const grant = await refusalOf(() =>
          door.update("ned", "editorial", {
            revision: 0,
            grants: { clear: [desk] },
          })
        );

        for (const refusal of [list, read, write, grant]) {
          expect(refusal).toMatchObject({ status: 403, code: "FORBIDDEN" });
        }
        expect(await door.read("ned", "editorial")).toMatchObject({
          revision: 0,
          emails: { approved: true },
        });
        expect((await roleHoldsOn(desk, "sign-off")).pages).toBe("lacks");
      });

      it("answers a workflow no one registered as not found", async () => {
        current = await bootSteps(dialect);
        await admin();

        expect(await refusalOf(() => door.read(SAM, "nope"))).toMatchObject({
          status: 404,
          code: "NOT_FOUND",
        });
      });
    });
  }
);
