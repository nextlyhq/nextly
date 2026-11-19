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
 *   and recorded. Nothing is hidden from the reader: a role holding it on some attachments only is
 *   named, and so are the steps that share one permission.
 * - Grants and default reviewers written together are judged together: a reviewer who holds the
 *   step only through the grants being written is accepted, and a refused reviewer leaves the
 *   grants unwritten.
 * - The change is filed with the other settings changes, so a reader of settings sees it in the
 *   dashboard's activity feed and a reader of content alone does not.
 * - Reading and writing ask the settings permissions; changing grants also asks to update roles.
 * - The list says what the diagram draws: where each workflow is registered, relative to the
 *   project root; each step's permission (its own, or the collection's update or publish), whether
 *   it asks for a comment; each stage's primary step and whether it is a review stage; and where an
 *   edit to approved content and the next draft after a publish go. It also says how many documents
 *   are recorded in each stage, a document with several parts in one stage once, and a part whose
 *   stage the workflow no longer has in the first stage, as every step reads it.
 * - The settings say, for each stage's default reviewer, whether they still hold the stage's
 *   primary step on every attachment, a person as well as a role.
 * - The settings list, for each review stage, the roles holding its primary step on every
 *   attachment, whom its default reviewer is chosen from: those granted it, those inheriting it,
 *   and the super-admin role, never one holding it on some attachments only.
 *
 * The plausible broken surfaces: an eligibility check on the first attached collection only, a
 * write that stores a definition key or ignores it, a write that skips the revision, grants set on
 * one collection, a read that shows only the roles holding a step everywhere, eligibility judged
 * before the grants written with it, and a REST route and a Direct API call that disagree.
 */

// Set before the harness boots (env validation reads it once), so a session can be signed.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { dirname, join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createDynamicHandlers } from "../../../routeHandler";
import { RolePermissionService } from "../../auth/services/role-permission-service";
import { workflowDefinitionHash } from "../hash";
import { holderAnswer } from "../holders";
import { publishedWorkflows, publishWorkflows } from "../registry";
import { createReviewState } from "../review-state-repository";
import { updateWorkflowSettings } from "../workflow-settings-api";
import { readWorkflowSettings } from "../workflow-settings-repository";

import {
  AT,
  bootSteps,
  giveRole,
  person,
  role,
  stateDb,
  superAdminRole,
} from "./helpers/step-harness";
import { editorial, handover } from "./helpers/step-workflows";

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
  body?: unknown,
  query = ""
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
  const request = new Request(
    `http://localhost/api/${path.join("/")}${query}`,
    {
      method,
      headers: {
        cookie: `nextly_session=${token}`,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }
  );
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

/** The activity-log entry a workflow's settings changes are filed under, beside a plugin's. */
const ENTRY = "workflow:editorial";

async function workflowActivity(): Promise<ActivityRow[]> {
  return app().adapter.select<ActivityRow>("activity_log", {
    where: {
      and: [
        { column: "collection", op: "=", value: "settings" },
        { column: "entryId", op: "=", value: ENTRY },
      ],
    },
  });
}

/** The dashboard's activity feed, as `who` reads it. */
async function feed(who: string): Promise<Doc[]> {
  const answer = await rest(
    "GET",
    ["dashboard", "activity"],
    who,
    undefined,
    "?limit=50"
  );
  return answer.activities as Doc[];
}

/** The details of each grantable step a settings read gives, by step. */
const stepsOf = (settings: Doc) =>
  settings.grantableSteps as Record<
    string,
    {
      permission: string;
      partialRoles: { id: string; name: string | null }[];
      sharesPermissionWith: string[];
    }
  >;

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
          row => row.entryId === ENTRY
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

      it("answers a label that reads like a date exactly as it was saved, which is configuration", async () => {
        current = await bootSteps(dialect);
        await admin();
        // A date with no offset: a date rewritten for the reader comes back as UTC, with one.
        const label = "2026-11-17T09:00:00";

        const saved = await door.update(SAM, "editorial", {
          revision: 0,
          labels: { legal: { label } },
        });
        const read = await door.read(SAM, "editorial");

        expect(saved.labels).toEqual({ legal: { label } });
        expect(read.labels).toEqual({ legal: { label } });
      });

      it("says where each workflow is registered, relative to the project root, and none outside it", async () => {
        current = await bootSteps(dialect);
        await admin();
        const root = process.cwd();
        // Registered as a boot registers a configuration found at these paths.
        publishWorkflows(
          new Map(
            [...publishedWorkflows()].map(([slug, entry]) => [
              slug,
              {
                ...entry,
                configPath:
                  slug === "editorial"
                    ? join(root, "config", "nextly.config.ts")
                    : join(dirname(root), "elsewhere", "nextly.config.ts"),
              },
            ])
          )
        );

        const listed = await door.list(SAM);

        expect(listed.find(each => each.slug === "editorial")).toMatchObject({
          configPath: join("config", "nextly.config.ts"),
        });
        expect(listed.find(each => each.slug === "handover")).toMatchObject({
          configPath: null,
        });
      });

      it("lists what the diagram draws: each step's permission and comment rule, each stage's primary step, and where edits and publishes lead", async () => {
        current = await bootSteps(dialect);
        await admin();

        const listed = await door.list(SAM);
        const desk = listed.find(each => each.slug === "editorial");

        expect(desk?.steps).toEqual([
          expect.objectContaining({
            name: "send",
            permission: "update",
            commentRequired: false,
          }),
          expect.objectContaining({
            name: "clear",
            permission: "sign-off",
            commentRequired: false,
          }),
          expect.objectContaining({
            name: "bounce",
            permission: "sign-off",
            commentRequired: true,
          }),
          expect.objectContaining({
            name: "park",
            permission: "update",
            commentRequired: true,
          }),
          expect.objectContaining({
            name: "resume",
            permission: "update",
            commentRequired: false,
          }),
          // Into a stage that allows publishing, naming no permission: the collection's publish.
          expect.objectContaining({
            name: "fastTrack",
            permission: "publish",
            commentRequired: false,
          }),
        ]);
        expect(desk?.stages).toEqual([
          expect.objectContaining({
            name: "writing",
            primaryStep: "send",
            review: false,
          }),
          expect.objectContaining({
            name: "legal",
            primaryStep: "clear",
            review: true,
          }),
          expect.objectContaining({
            name: "hold",
            primaryStep: "resume",
            review: true,
          }),
          // Its only step out is its primary step, though the code marks none.
          expect.objectContaining({
            name: "cleared",
            primaryStep: "bounce",
            review: false,
          }),
        ]);
        expect(desk).toMatchObject({
          onEdit: { to: "legal", exemptFields: [] },
          afterPublish: "writing",
        });
      });

      it("counts the documents recorded in each stage, each once, a part in a stage the workflow lacks in the first", async () => {
        current = await bootSteps(dialect);
        await admin();
        const desk = workflowDefinitionHash(editorial);
        const seed = (
          scopeKind: "collection" | "single",
          scopeSlug: string,
          entryId: string,
          part: string | null,
          stage: string,
          definitionHash = desk
        ) =>
          createReviewState(
            stateDb(app()),
            { scopeKind, scopeSlug, entryId, part },
            { stage, enteredAt: AT, enteredBy: "seeder", definitionHash }
          );
        // Two parts of one post in the legal check: one document.
        await seed("collection", "posts", "a", "en", "legal");
        await seed("collection", "posts", "a", "es", "legal");
        await seed("collection", "pages", "b", null, "legal");
        await seed("collection", "posts", "c", "en", "hold");
        // A stage the workflow no longer has reads as the first, as a step reads it; with another
        // part already writing, the document is still one.
        await seed("collection", "pages", "d", null, "retired");
        await seed("collection", "posts", "e", "en", "writing");
        await seed("collection", "posts", "e", "es", "retired");
        await seed("single", "banner", "f", null, "cleared");
        // Another workflow's document, which the editorial counts never include.
        await seed(
          "collection",
          "memos",
          "g",
          null,
          "review",
          workflowDefinitionHash(handover)
        );

        const listed = await door.list(SAM);

        expect(
          listed.find(each => each.slug === "editorial")?.stageCounts
        ).toEqual({ writing: 2, legal: 2, hold: 1, cleared: 1 });
        expect(
          listed.find(each => each.slug === "handover")?.stageCounts
        ).toEqual({
          draft: 0,
          review: 1,
          ok: 0,
        });
      });

      it("says whether each default reviewer still holds the stage's primary step, a person or a role", async () => {
        current = await bootSteps(dialect);
        await admin();
        await person(app(), "rita", everywhere("sign-off"));
        // A role needs a permission to exist; reading posts gives it nothing a review needs.
        const desk = await role(app(), "legal-desk", [["read", "posts"]]);

        await door.update(SAM, "editorial", {
          revision: 0,
          defaultReviewers: { legal: { kind: "user", id: "rita" } },
        });
        expect(
          (await door.read(SAM, "editorial")).defaultReviewerHolds
        ).toEqual({
          legal: "holds",
        });

        // Deactivated since she was chosen.
        await app().adapter.update(
          "users",
          { isActive: false },
          { and: [{ column: "id", op: "=", value: "rita" }] }
        );
        expect(
          (await door.read(SAM, "editorial")).defaultReviewerHolds
        ).toEqual({
          legal: "deactivated",
        });

        // A role chosen with the grants that let it review, and the grants then taken away.
        await door.update(SAM, "editorial", {
          revision: 1,
          grants: { clear: [desk], bounce: [desk] },
          defaultReviewers: { legal: { kind: "role", id: desk } },
        });
        expect(
          (await door.read(SAM, "editorial")).defaultReviewerHolds
        ).toEqual({
          legal: "holds",
        });
        await door.update(SAM, "editorial", {
          revision: 2,
          grants: { clear: [], bounce: [] },
        });
        expect(
          (await door.read(SAM, "editorial")).defaultReviewerHolds
        ).toEqual({
          legal: "lacks",
        });
      });

      it("lists whom each review stage's default reviewer may be chosen from: roles holding its primary step everywhere, granted, inherited or super-admin", async () => {
        current = await bootSteps(dialect);
        await admin();
        const approvers = await role(
          app(),
          "approvers",
          everywhere("sign-off")
        );
        // Granted nothing a review needs; holds sign-off only by inheriting Approvers.
        const seniors = await role(
          app(),
          "seniors",
          [["read", "posts"]],
          [approvers]
        );
        // Holds sign-off on Posts alone.
        const partial = await role(app(), "posts-desk", [
          ["sign-off", "posts"],
        ]);
        // Holds the collections' own update, which Resume (On hold's primary step) needs.
        const editors = await role(app(), "editors", everywhere("update"));
        const admins = await superAdminRole(app());

        const { reviewerRoles } = (await door.read(SAM, "editorial")) as {
          reviewerRoles: Record<string, string[]>;
        };

        // The review stages alone: those with an approval out of them.
        expect(Object.keys(reviewerRoles).sort()).toEqual(["hold", "legal"]);
        expect(reviewerRoles.legal).toEqual(
          [approvers, seniors, admins].sort()
        );
        expect(reviewerRoles.hold).toEqual(
          expect.arrayContaining([editors, admins])
        );
        expect(reviewerRoles.hold).not.toContain(approvers);
        expect(reviewerRoles.hold).not.toContain(partial);
        // Each role listed is one a save accepts as the stage's default reviewer.
        await door.update(SAM, "editorial", {
          revision: 0,
          defaultReviewers: { legal: { kind: "role", id: seniors } },
        });
        expect(
          (await door.read(SAM, "editorial")).defaultReviewerHolds
        ).toEqual({ legal: "holds" });
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

        // Held on one attachment of eight: not among the grants, and not hidden either.
        const before = await door.read(SAM, "editorial");
        expect(before.grants).toMatchObject({ clear: [], bounce: [] });
        expect(stepsOf(before).clear.partialRoles).toEqual([
          { id: old, name: "old-desk" },
        ]);
        expect(stepsOf(before).bounce.partialRoles).toEqual([
          { id: old, name: "old-desk" },
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
        // Both steps needing sign-off read the roles that hold it, and none holds it in part.
        expect(saved.grants).toMatchObject({ clear: [desk], bounce: [desk] });
        expect(stepsOf(saved).clear.partialRoles).toEqual([]);
        expect(saved.revision).toBe(1);
        expect((await door.read(SAM, "editorial")).grants).toEqual(
          saved.grants
        );

        const [row] = await workflowActivity();
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

      it("says which steps share a permission, and refuses them different roles", async () => {
        current = await bootSteps(dialect);
        await admin();
        const desk = await role(app(), "legal-desk", [["read", "pages"]]);
        const other = await role(app(), "other-desk", [["read", "pages"]]);

        const settings = await door.read(SAM, "editorial");
        const conflicting = await refusalOf(() =>
          door.update(SAM, "editorial", {
            revision: 0,
            grants: { clear: [desk], bounce: [other] },
          })
        );

        expect(stepsOf(settings)).toEqual({
          clear: {
            permission: "sign-off",
            partialRoles: [],
            sharesPermissionWith: ["bounce"],
          },
          bounce: {
            permission: "sign-off",
            partialRoles: [],
            sharesPermissionWith: ["clear"],
          },
        });
        expect(conflicting).toMatchObject({ status: 400 });
        expect(codesOf(conflicting)).toEqual(["WORKFLOW_CONFLICTING_GRANTS"]);
        expect((await roleHoldsOn(desk, "sign-off")).pages).toBe("lacks");
      });

      it("accepts a default reviewer who holds the stage's step through the grants written with it", async () => {
        current = await bootSteps(dialect);
        await admin();
        const desk = await role(app(), "legal-desk", [["read", "pages"]]);
        // Nina's one role is the desk, which holds no sign-off until this write.
        await person(app(), "nina", []);
        await giveRole(app(), "nina", desk);

        const saved = await door.update(SAM, "editorial", {
          revision: 0,
          grants: { clear: [desk] },
          defaultReviewers: {
            legal: { kind: "user", id: "nina" },
            cleared: { kind: "role", id: desk },
          },
        });

        expect(saved).toMatchObject({
          revision: 1,
          grants: { clear: [desk] },
          defaultReviewers: {
            legal: { kind: "user", id: "nina" },
            cleared: { kind: "role", id: desk },
          },
        });
        expect(await roleHoldsOn(desk, "sign-off")).toEqual(holdingEverywhere);
        expect(metadataOf((await workflowActivity())[0])).toMatchObject({
          changedFields: expect.arrayContaining([
            "grants.clear",
            "defaultReviewers.legal",
            "defaultReviewers.cleared",
          ]),
        });
      });

      it("writes no grant when the default reviewer written with it is refused", async () => {
        current = await bootSteps(dialect);
        await admin();
        const desk = await role(app(), "legal-desk", [["read", "pages"]]);
        // Holds sign-off on Pages alone, through a role the grants leave out.
        await person(app(), "kim", [["sign-off", "pages"]]);

        const refusal = await refusalOf(() =>
          door.update(SAM, "editorial", {
            revision: 0,
            grants: { clear: [desk] },
            defaultReviewers: { legal: { kind: "user", id: "kim" } },
          })
        );

        expect(refusal).toMatchObject({
          status: 400,
          code: "VALIDATION_ERROR",
        });
        expect(codesOf(refusal)).toEqual(["WORKFLOW_INELIGIBLE_REVIEWER"]);
        // Nothing of the write landed: the desk gained nothing, Kim's role kept its grant.
        expect((await roleHoldsOn(desk, "sign-off")).pages).toBe("lacks");
        expect(
          await holderAnswer(
            app().adapter,
            { kind: "user", id: "kim" },
            "sign-off",
            "pages"
          )
        ).toBe("holds");
        expect(await door.read(SAM, "editorial")).toMatchObject({
          revision: 0,
          defaultReviewers: {},
          grants: { clear: [] },
        });
        expect(await workflowActivity()).toEqual([]);
      });

      it("files the change with the settings changes, which a reader of settings sees in the activity feed", async () => {
        current = await bootSteps(dialect);
        await admin();
        await person(app(), "rhea", [["read", "settings"]]);
        await person(app(), "alice", [
          ["read", "pages"],
          ["update", "pages"],
        ]);

        await door.update(SAM, "editorial", {
          revision: 0,
          emails: { approved: false },
        });

        const isTheChange = (row: Doc) =>
          row.collection === "settings" && row.entryId === ENTRY;
        expect((await feed("rhea")).filter(isTheChange)).toEqual([
          expect.objectContaining({ action: "update", userId: SAM }),
        ]);
        expect((await feed("alice")).filter(isTheChange)).toEqual([]);
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

    it("keeps both of two workflows' grants made to one role at the same time", async () => {
      current = await bootSteps(dialect);
      const desk = await role(app(), "desk", [["read", "pages"]]);
      // The first update is held after it has read the role's grants and before it writes them,
      // while the second runs: an update that read the grants before locking the role writes back
      // what it read, without the second's grant.
      let release!: () => void;
      const released = new Promise<void>(resolve => (release = resolve));
      let reached!: () => void;
      const holding = new Promise<void>(resolve => (reached = resolve));
      const replace = RolePermissionService.prototype.replaceRolePermissionsOn;
      let first = true;
      const spy = vi
        .spyOn(RolePermissionService.prototype, "replaceRolePermissionsOn")
        .mockImplementation(async function (
          this: RolePermissionService,
          ...args: Parameters<typeof replace>
        ) {
          if (first) {
            first = false;
            reached();
            await released;
          }
          return replace.apply(this, args);
        });
      try {
        const editorialGrant = updateWorkflowSettings(
          app().adapter,
          "editorial",
          { revision: 0, grants: { clear: [desk] } },
          null
        );
        await holding;
        const handoverGrant = updateWorkflowSettings(
          app().adapter,
          "handover",
          { revision: 0, grants: { signOff: [desk] } },
          null
        );
        // The second finishes while the first is held, or waits on the role the first locked.
        await Promise.race([
          handoverGrant.catch(() => undefined),
          new Promise(resolve => setTimeout(resolve, 3000)),
        ]);
        release();
        await Promise.all([editorialGrant, handoverGrant]);
      } finally {
        release();
        spy.mockRestore();
      }

      expect(await roleHoldsOn(desk, "sign-off")).toEqual(holdingEverywhere);
      expect(
        await holderAnswer(
          app().adapter,
          { kind: "role", id: desk },
          "sign-off",
          "memos"
        )
      ).toBe("holds");
    });
  }
);
