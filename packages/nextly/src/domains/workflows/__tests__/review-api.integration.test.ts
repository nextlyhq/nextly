/**
 * Developers read and move review state through REST and the Direct API, with the admin's rules,
 * on every configured dialect. Each case runs through both doors against the same assertions.
 *
 * - A document's review state is read part by part, each where it stands, with the revision and
 *   version a step says it saw.
 * - Every operation needs the right to read the document: a caller who holds a step but may not
 *   read the collection is answered as though the document did not exist, and nothing waits for
 *   them there.
 * - A step keeps its own rules through both doors: an API key's approval is refused, and a step on
 *   a part that moved since the caller saw it is refused.
 * - A move over several documents moves each it may and names each refusal with its reason; an
 *   approval over several is refused before anything moves.
 * - What waits for a caller is what is assigned to them in a stage whose step they may take, a page
 *   at a time, counted.
 * - Each part names who it waits for: its assignee, else its stage's default reviewer where they may
 *   take the stage's primary step, else the roles that may; no one in a stage with no step out.
 * - Each part names its last move: the latest workflow event that involved it, not the document's
 *   latest and not its first.
 * - Each step out of a part's stage says whether the caller may take it, judged as the step itself
 *   judges its caller (its permission, a person for an approval, no self-approval where refused),
 *   and whether it is the stage's primary step.
 * - A document of a collection with no workflow reads as no workflow and no parts; a missing
 *   document, or one the caller may not read, is not found either way.
 *
 * The plausible broken surfaces: one that checks only the step's permission (and so shows review
 * state the caller may not read), one that moves every document of a bulk request or none, one
 * that lets a bulk approval through, one that tells every caller they may take every step, one that
 * answers "no workflow" before asking whether the caller may read the document, and a REST route
 * and a Direct API call that disagree.
 */

// Set before the harness boots (env validation reads it once), so a session can be signed.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import { apiKeyScope } from "../../../auth/authenticated-scope";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { statementsOf } from "../../../database/__tests__/integration/helpers/count-statements";
import { permissionSlug } from "../../../schemas/_zod/rbac";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { defineCollection, text } from "../../../config";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services/index";
import { listRoleSlugsForUserOrRefuse } from "../../../services/lib/permissions";
import type { ApiKeyService } from "../../auth/services/api-key-service";
import { defineWorkflow } from "../define-workflow";
import { workflowDefinitionHash } from "../hash";
import { REVIEW_API_ERROR_CODES } from "../review-api";
import { writeWorkflowSettings } from "../workflow-settings-repository";

import {
  bootSteps,
  entry,
  partOf,
  giveRole,
  person,
  role,
  seedState,
  stateDb,
  stateOf,
  superAdminRole,
  versionOf,
  type Grant,
} from "./helpers/step-harness";
import { editorial } from "./helpers/step-workflows";

const HASH = workflowDefinitionHash(editorial);
const PAGES = "pages";
const POSTS = "posts";

/** Draft → Done, and no step out of Done: a part there waits for no one. */
const straight = defineWorkflow({
  slug: "straight",
  label: "Straight",
  stages: [
    { name: "draft", label: "Draft" },
    { name: "done", label: "Done", allowsPublish: true },
  ],
  steps: [
    {
      name: "finish",
      label: "Finish",
      kind: "approve",
      from: "draft",
      to: "done",
    },
  ],
});
const BRIEFS = "briefs";
const briefs = defineCollection({
  slug: BRIEFS,
  status: true,
  versions: { drafts: true },
  workflow: straight,
  fields: [text({ name: "title" })],
});

/** Under the editorial workflow, with a read rule that shows its readers the public rows only. */
const CIRCULARS = "circulars";
const circulars = defineCollection({
  slug: CIRCULARS,
  status: true,
  versions: { drafts: true },
  workflow: editorial,
  access: {
    read: () => ({ team: { equals: "public" } }) as unknown as boolean,
  },
  fields: [text({ name: "title" }), text({ name: "team" })],
});

/** No workflow attached. */
const PLAIN = "plain";
const plain = defineCollection({
  slug: PLAIN,
  status: true,
  versions: { drafts: true },
  fields: [text({ name: "title" })],
});

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

/** A refusal as both doors report it: the HTTP status and the error's code. */
interface Refusal {
  status: number;
  code: string;
}

/**
 * Who a call is made for: a person, or an API key a person made, holding `grants` (which its
 * owner holds too, since a REST key here is a full-access one).
 */
type Who =
  | { kind: "person"; id: string }
  | {
      kind: "key";
      owner: string;
      grants: readonly Grant[];
      /** A key scoped to this one role of its owner's, by id; absent, a full-access key. */
      role?: string;
      /** That role's slug, which a scope names it by. */
      roleSlug?: string;
    };

/** One door: each operation, made for `who`, answering or throwing a {@link Refusal}. */
interface Door {
  name: string;
  reviewState(who: Who, document: Doc): Promise<Doc>;
  takeStep(who: Who, input: Doc): Promise<Doc>;
  stepMany(who: Who, input: Doc): Promise<{ moved: string[]; refused: Doc[] }>;
  assignMany(
    who: Who,
    input: Doc
  ): Promise<{ assigned: string[]; refused: Doc[] }>;
  waiting(
    who: Who,
    query: { page: number; limit: number }
  ): Promise<{
    items: Doc[];
    meta: Doc;
  }>;
}

async function headersFor(who: Who): Promise<Record<string, string>> {
  if (who.kind === "person") {
    const token = await signAccessToken(
      buildClaims({
        userId: who.id,
        email: `${who.id}@example.test`,
        name: who.id,
        image: null,
        roleIds: [],
        sessionEpoch: 0,
      }),
      process.env.NEXTLY_SECRET!
    );
    return { cookie: `nextly_session=${token}` };
  }
  // A full-access key, which holds what its owner holds: the grants named are the owner's. Or,
  // given a role, a key scoped to that one role, which holds what the role holds.
  const keys = app().getService("apiKeyService") as unknown as ApiKeyService;
  const { key } = await keys.createApiKey(who.owner, {
    name: `key of ${who.owner}`,
    ...(who.role === undefined
      ? { tokenType: "full-access" as const }
      : { tokenType: "role-based" as const, roleId: who.role }),
    expiresIn: "unlimited",
  });
  return { authorization: `Bearer ${key}` };
}

async function rest(
  method: "GET" | "POST",
  path: string[],
  who: Who,
  body?: unknown,
  query = ""
): Promise<Doc> {
  const handlers = createDynamicHandlers();
  const request = new Request(
    `http://localhost/api/${path.join("/")}${query}`,
    {
      method,
      headers: {
        ...(await headersFor(who)),
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
      : await handlers.POST(request, context);
  const json = (await response.json()) as Doc;
  if (response.status >= 400) {
    const refusal: Refusal = {
      status: response.status,
      code: String((json.error as Doc | undefined)?.code),
    };
    throw refusal;
  }
  return json;
}

const REST: Door = {
  name: "REST",
  async reviewState(who, document) {
    const query =
      "single" in document
        ? `?single=${String(document.single)}`
        : `?collection=${String(document.collection)}&id=${String(document.id)}`;
    return rest("GET", ["workflows", "review-state"], who, undefined, query);
  },
  async takeStep(who, input) {
    return (await rest("POST", ["workflows", "steps"], who, input)).item as Doc;
  },
  async stepMany(who, input) {
    const answer = await rest(
      "POST",
      ["workflows", "steps", "bulk"],
      who,
      input
    );
    return {
      moved: (answer.items as Doc[]).map(item => String(item.id)),
      refused: answer.errors as Doc[],
    };
  },
  async assignMany(who, input) {
    const answer = await rest(
      "POST",
      ["workflows", "assignments", "bulk"],
      who,
      input
    );
    return {
      assigned: (answer.items as Doc[]).map(item => String(item.id)),
      refused: answer.errors as Doc[],
    };
  },
  async waiting(who, { page, limit }) {
    const answer = await rest(
      "GET",
      ["workflows", "waiting"],
      who,
      undefined,
      `?page=${page}&limit=${limit}`
    );
    return { items: answer.items as Doc[], meta: answer.meta as Doc };
  },
};

/** A Direct API call made for `who`, its refusal reported as REST reports it. */
async function direct<T>(
  call: (args: Doc) => Promise<T>,
  who: Who
): Promise<T> {
  const args: Doc =
    who.kind === "person"
      ? { overrideAccess: false, user: { id: who.id } }
      : {
          overrideAccess: false,
          user: { id: who.owner },
          actor: apiKeyScope(
            who.grants.map(([action, resource]) => ({
              slug: permissionSlug(action, resource),
              action,
              resource,
            })),
            // A scope names its roles by slug, as authentication resolves a key: a key scoped to
            // a role names that role, a full-access key its owner's roles.
            who.role === undefined
              ? await listRoleSlugsForUserOrRefuse(who.owner)
              : [who.roleSlug ?? who.role]
          ),
          apiKeyId: "key-1",
        };
  try {
    return await call(args);
  } catch (error) {
    const failed = error as { statusCode?: number; code?: string };
    if (typeof failed.statusCode !== "number") throw error;
    const refusal: Refusal = {
      status: failed.statusCode,
      code: String(failed.code),
    };
    throw refusal;
  }
}

const DIRECT: Door = {
  name: "Direct API",
  reviewState: (who, document) =>
    direct(
      args =>
        app().nextly.workflows.reviewState({
          ...args,
          document,
        } as never) as unknown as Promise<Doc>,
      who
    ),
  takeStep: (who, input) =>
    direct(
      args =>
        app().nextly.workflows.takeStep({
          ...args,
          ...input,
        } as never) as unknown as Promise<Doc>,
      who
    ),
  stepMany: async (who, input) => {
    const answer = await direct(
      args => app().nextly.workflows.stepMany({ ...args, ...input } as never),
      who
    );
    return {
      moved: answer.moved.map(each => each.document.entryId),
      // The document as the refusal names it: an entry's id, or a Single's slug.
      refused: answer.refused.map(each => ({
        ...(each.document as unknown as Doc),
        code: each.code,
        message: each.message,
      })),
    };
  },
  assignMany: async (who, input) => {
    const answer = await direct(
      args => app().nextly.workflows.assignMany({ ...args, ...input } as never),
      who
    );
    return {
      assigned: answer.assigned.map(each => each.entryId),
      refused: answer.refused.map(each => ({
        ...(each.document as unknown as Doc),
        code: each.code,
        message: each.message,
      })),
    };
  },
  waiting: (who, { page, limit }) =>
    direct(
      args =>
        app().nextly.workflows.waiting({
          ...args,
          page,
          limit,
        } as never) as unknown as Promise<{ items: Doc[]; meta: Doc }>,
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

/** The step input a caller who just read the Page's shared part sends. */
async function seenPage(id: string, step: string, revision = 0): Promise<Doc> {
  return {
    document: { collection: PAGES, id },
    step,
    parts: [null],
    seen: [
      {
        part: null,
        revision,
        version: await versionOf(app(), PAGES, id, null),
      },
    ],
  };
}

const ALICE: Who = { kind: "person", id: "alice" };
const BOB: Who = { kind: "person", id: "bob" };

/** The parts of a document's review state, as either door answers them. */
const partsOf = (state: Doc): Doc[] => state.parts as Doc[];

/** The one part of a document that has only the shared part, as `who` reads it. */
async function onlyPart(
  door: Door,
  id: string,
  who: Who = ALICE
): Promise<Doc> {
  const parts = partsOf(await door.reviewState(who, { collection: PAGES, id }));
  expect(parts).toHaveLength(1);
  return parts[0];
}

/** A role as a part waiting for it names it: its id and name, read from the roles. */
async function roleNamed(id: string): Promise<Doc> {
  const roles = new ServiceContainer(app().adapter).roles;
  return { id, name: (await roles.getRoleById(id)).name };
}

/** A part's steps out of its stage, by name. */
const stepsByName = (part: Doc): Record<string, Doc> =>
  Object.fromEntries(
    (part.steps as Doc[]).map(step => [String(step.name), step])
  );

const byId = (roles: Doc[]) =>
  [...roles].sort((a, b) => String(a.id).localeCompare(String(b.id)));

/** Sets the editorial workflow's default reviewer of `stage`. */
async function defaultReviewer(stage: string, id: string): Promise<void> {
  await writeWorkflowSettings(
    stateDb(app()),
    "editorial",
    { defaultReviewers: { [stage]: { kind: "user", id } } },
    null,
    null
  );
}

/** Alice may read and edit Pages; Bob holds the sign-off step on Pages and may not read them. */
async function people() {
  await person(app(), "alice", [
    ["read", PAGES],
    ["update", PAGES],
  ]);
  await person(app(), "bob", [["sign-off", PAGES]]);
}

describe.each(getConfiguredTestDialects())(
  "review state through the APIs (%s)",
  dialect => {
    describe.each([REST, DIRECT])("through $name", door => {
      it("reads a document's review state, where each part stands", async () => {
        current = await bootSteps(dialect);
        await people();
        const id = await entry(app(), PAGES);

        const state = await door.reviewState(ALICE, { collection: PAGES, id });

        expect(state.workflow).toEqual({
          slug: "editorial",
          label: "Editorial",
        });
        expect(state.parts).toEqual([
          expect.objectContaining({
            part: null,
            stage: "writing",
            publishable: false,
            revision: 0,
            version: await versionOf(app(), PAGES, id, null),
            steps: [expect.objectContaining({ name: "send", kind: "submit" })],
          }),
        ]);
      });

      it("tells the caller which steps out of a part's stage they may take, by each step's permission", async () => {
        current = await bootSteps(dialect);
        await people();
        const RITA: Who = { kind: "person", id: "rita" };
        await person(app(), "rita", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
        });

        const forRita = stepsByName(await onlyPart(door, id, RITA));
        const forAlice = stepsByName(await onlyPart(door, id, ALICE));

        // Clear names sign-off: Rita holds it, Alice does not.
        expect(forRita.clear.mayTake).toBe(true);
        expect(forAlice.clear.mayTake).toBe(false);
        // Park names none, so it needs the right to edit: Alice holds it, Rita does not.
        expect(forAlice.park.mayTake).toBe(true);
        expect(forRita.park.mayTake).toBe(false);
      });

      it("tells a writer they may send a draft on, and one who may not edit that they may not", async () => {
        current = await bootSteps(dialect);
        await people();
        const RITA: Who = { kind: "person", id: "rita" };
        await person(app(), "rita", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        const id = await entry(app(), PAGES);

        expect(stepsByName(await onlyPart(door, id, ALICE)).send).toMatchObject(
          { kind: "submit", mayTake: true }
        );
        expect(stepsByName(await onlyPart(door, id, RITA)).send).toMatchObject({
          kind: "submit",
          mayTake: false,
        });
      });

      it("tells an API key it may take no approval, whatever it holds", async () => {
        current = await bootSteps(dialect);
        await people();
        const KIM: Who = { kind: "person", id: "kim" };
        await person(app(), "kim", [
          ["read", PAGES],
          ["update", PAGES],
          ["sign-off", PAGES],
        ]);
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
        });
        const key: Who = {
          kind: "key",
          owner: "kim",
          grants: [
            ["read", PAGES],
            ["update", PAGES],
            ["sign-off", PAGES],
          ],
        };

        const forKey = stepsByName(await onlyPart(door, id, key));
        const forKim = stepsByName(await onlyPart(door, id, KIM));

        expect(forKey.clear.mayTake).toBe(false);
        expect(forKey.bounce.mayTake).toBe(false);
        // A move it holds the permission for, it may take.
        expect(forKey.park.mayTake).toBe(true);
        // Its owner, a person holding the same, may approve.
        expect(forKim.clear.mayTake).toBe(true);
      });

      it("tells the person who brought a part into its stage they may not take a step that refuses it", async () => {
        current = await bootSteps(dialect);
        await people();
        const RITA: Who = { kind: "person", id: "rita" };
        await person(app(), "rita", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
          enteredBy: "rita",
        });

        const steps = stepsByName(await onlyPart(door, id, RITA));

        // Clear refuses self-approval; Bounce, which needs the same permission, does not.
        expect(steps.clear.mayTake).toBe(false);
        expect(steps.bounce.mayTake).toBe(true);
      });

      it("marks the stage's primary step, and only it", async () => {
        current = await bootSteps(dialect);
        await people();
        const inLegal = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, inLegal, null), "legal", {
          definitionHash: HASH,
        });
        const inWriting = await entry(app(), PAGES);

        const legal = (await onlyPart(door, inLegal)).steps as Doc[];
        const writing = (await onlyPart(door, inWriting)).steps as Doc[];

        // Three steps out of Legal check, Clear marked primary.
        expect(legal.map(step => [step.name, step.primary])).toEqual([
          ["clear", true],
          ["bounce", false],
          ["park", false],
        ]);
        // A stage's only step out is its primary one.
        expect(writing.map(step => [step.name, step.primary])).toEqual([
          ["send", true],
        ]);
      });

      it("answers a document of a collection with no workflow as no workflow and no parts", async () => {
        current = await bootSteps(dialect, undefined, {
          collections: [plain],
        });
        await person(app(), "alice", [
          ["read", PLAIN],
          ["update", PLAIN],
        ]);
        const id = await entry(app(), PLAIN);

        const state = await door.reviewState(ALICE, { collection: PLAIN, id });
        // A step on it is still refused, as having no workflow.
        const step = await refusalOf(() =>
          door.takeStep(ALICE, {
            document: { collection: PLAIN, id },
            step: "send",
            parts: [null],
            seen: [],
          })
        );

        expect(state).toEqual({ workflow: null, parts: [] });
        expect(step).toEqual({ status: 400, code: "VALIDATION_ERROR" });
      });

      it("answers a missing document, or one the caller may not read, as not found, with a workflow or none", async () => {
        current = await bootSteps(dialect, undefined, {
          collections: [plain],
        });
        await person(app(), "alice", [
          ["read", PLAIN],
          ["read", PAGES],
        ]);
        // Bob holds a step on Pages and nothing at all of the plain collection.
        await person(app(), "bob", [["sign-off", PAGES]]);
        const id = await entry(app(), PLAIN);
        const missing = "00000000-0000-4000-8000-000000000000";

        const missingPlain = await refusalOf(() =>
          door.reviewState(ALICE, { collection: PLAIN, id: missing })
        );
        const missingPage = await refusalOf(() =>
          door.reviewState(ALICE, { collection: PAGES, id: missing })
        );
        const unreadable = await refusalOf(() =>
          door.reviewState(BOB, { collection: PLAIN, id })
        );

        expect(missingPlain).toEqual({ status: 404, code: "NOT_FOUND" });
        expect(missingPage).toEqual({ status: 404, code: "NOT_FOUND" });
        expect(unreadable).toEqual({ status: 404, code: "NOT_FOUND" });
      });

      describe("a move touching a language its caller may not read the document in", () => {
        const LENA: Who = { kind: "person", id: "lena" };

        /** A Letter whose English, Spanish and shared parts are in Legal check; Lena may not read Spanish. */
        async function letterInLegal(): Promise<string> {
          current = await bootSteps(dialect);
          // Letters are read in every language but Spanish.
          await person(app(), "lena", [
            ["read", "letters"],
            ["update", "letters"],
            ["sign-off", "letters"],
          ]);
          const id = await entry(app(), "letters");
          for (const part of ["en", "es", null]) {
            await seedState(app(), partOf("letters", id, part), "legal", {
              definitionHash: HASH,
            });
          }
          return id;
        }

        /** Parking `parts` of the Letter, as a caller who read each of `seen` sends it. */
        async function parking(
          id: string,
          parts: "all" | (string | null)[],
          seen: (string | null)[]
        ): Promise<Doc> {
          return {
            document: { collection: "letters", id },
            step: "park",
            parts,
            comment: "Waiting on the client",
            seen: await Promise.all(
              seen.map(async part => ({
                part,
                revision: 1,
                version: await versionOf(app(), "letters", id, part),
              }))
            ),
          };
        }

        const stageOf = async (id: string, part: string | null) =>
          (await stateOf(app(), partOf("letters", id, part)))?.stage;

        it("refuses a step on every part, and moves none", async () => {
          const id = await letterInLegal();

          const input = await parking(id, "all", ["en", "es", null]);
          const refusal = await refusalOf(() => door.takeStep(LENA, input));

          expect(refusal).toEqual({ status: 404, code: "NOT_FOUND" });
          expect(await stageOf(id, "es")).toBe("legal");
          expect(await stageOf(id, "en")).toBe("legal");
          expect(await stageOf(id, null)).toBe("legal");
        });

        it("refuses a step naming that language among others, and moves none", async () => {
          const id = await letterInLegal();

          const input = await parking(id, ["en", "es"], ["en", "es"]);
          const refusal = await refusalOf(() => door.takeStep(LENA, input));

          expect(refusal).toEqual({ status: 404, code: "NOT_FOUND" });
          expect(await stageOf(id, "es")).toBe("legal");
          expect(await stageOf(id, "en")).toBe("legal");
        });

        it("refuses a step on every part over several documents, naming the document", async () => {
          const id = await letterInLegal();
          const one = await parking(id, "all", ["en", "es", null]);

          const answer = await door.stepMany(LENA, {
            step: one.step,
            comment: one.comment,
            documents: [
              { document: one.document, parts: one.parts, seen: one.seen },
            ],
          });

          expect(answer.moved).toEqual([]);
          expect(answer.refused).toEqual([
            expect.objectContaining({ id, code: "NOT_FOUND" }),
          ]);
          expect(await stageOf(id, "es")).toBe("legal");
          expect(await stageOf(id, "en")).toBe("legal");
        });

        it("refuses an assignment of that language's part over several documents", async () => {
          const id = await letterInLegal();

          const answer = await door.assignMany(LENA, {
            assignments: [
              {
                document: { collection: "letters", id },
                part: "es",
                revision: 1,
                assignee: { kind: "user", id: "lena" },
              },
            ],
          });

          expect(answer.assigned).toEqual([]);
          expect(answer.refused).toEqual([
            expect.objectContaining({ id, code: "NOT_FOUND" }),
          ]);
          expect(
            (await stateOf(app(), partOf("letters", id, "es")))?.assignee ??
              null
          ).toBeNull();
        });

        it("still moves and assigns the languages it may read, which is the control", async () => {
          const id = await letterInLegal();

          await door.takeStep(LENA, await parking(id, ["en"], ["en"]));
          const assigned = await door.assignMany(LENA, {
            assignments: [
              {
                document: { collection: "letters", id },
                part: null,
                revision: 1,
                assignee: { kind: "user", id: "lena" },
              },
            ],
          });

          expect(await stageOf(id, "en")).toBe("hold");
          expect(await stageOf(id, "es")).toBe("legal");
          expect(assigned.assigned).toEqual([id]);
        });
      });

      it("leaves out the parts in a language its reader may not read the document in", async () => {
        current = await bootSteps(dialect);
        // Letters are read in every language but Spanish.
        await person(app(), "lena", [
          ["read", "letters"],
          ["update", "letters"],
          ["sign-off", "letters"],
        ]);
        const LENA: Who = { kind: "person", id: "lena" };
        const id = await entry(app(), "letters");
        await seedState(app(), partOf("letters", id, "es"), "legal", {
          definitionHash: HASH,
          assignee: { kind: "user", id: "lena" },
        });
        await seedState(app(), partOf("letters", id, "en"), "legal", {
          definitionHash: HASH,
          assignee: { kind: "user", id: "lena" },
        });

        const state = await door.reviewState(LENA, {
          collection: "letters",
          id,
        });

        const parts = (state.parts as { part: string | null }[]).map(
          each => each.part
        );
        expect(parts).toContain("en");
        expect(parts).not.toContain("es");
        // Nor is the Spanish part listed among what waits for her, though it is assigned to her.
        const waiting = await door.waiting(LENA, { page: 1, limit: 10 });
        const listed = (waiting.items as { part: string | null }[]).map(
          each => each.part
        );
        expect(listed).toContain("en");
        expect(listed).not.toContain("es");
      });

      it("answers a caller who holds a step but may not read the document as though it did not exist", async () => {
        current = await bootSteps(dialect);
        await people();
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
          assignee: { kind: "user", id: "bob" },
        });

        const read = await refusalOf(() =>
          door.reviewState(BOB, { collection: PAGES, id })
        );
        const step = await refusalOf(async () =>
          door.takeStep(BOB, await seenPage(id, "clear", 1))
        );
        const waiting = await door.waiting(BOB, { page: 1, limit: 10 });

        expect(read).toEqual({ status: 404, code: "NOT_FOUND" });
        expect(step).toEqual({ status: 404, code: "NOT_FOUND" });
        expect(waiting.items).toEqual([]);
        // Nothing moved.
        expect((await stateOf(app(), partOf(PAGES, id, null)))?.stage).toBe(
          "legal"
        );
      });

      it("refuses an API key's approval, whatever the key holds", async () => {
        current = await bootSteps(dialect);
        await people();
        await person(app(), "kim", [
          ["read", PAGES],
          ["update", PAGES],
          ["sign-off", PAGES],
        ]);
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
        });
        const key: Who = {
          kind: "key",
          owner: "kim",
          grants: [
            ["read", PAGES],
            ["update", PAGES],
            ["sign-off", PAGES],
          ],
        };

        const refusal = await refusalOf(async () =>
          door.takeStep(key, await seenPage(id, "clear", 1))
        );

        expect(refusal.status).toBe(403);
        expect((await stateOf(app(), partOf(PAGES, id, null)))?.stage).toBe(
          "legal"
        );
      });

      it("refuses a step on a part that moved since the caller saw it", async () => {
        current = await bootSteps(dialect);
        await people();
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "writing", {
          definitionHash: HASH,
        });

        // Seen at revision 0, as though the part had no review state yet.
        const refusal = await refusalOf(async () =>
          door.takeStep(ALICE, await seenPage(id, "send", 0))
        );

        expect(refusal).toEqual({ status: 409, code: "CONFLICT" });
      });

      it("moves each document it may over several, and names each refusal", async () => {
        current = await bootSteps(dialect);
        await people();
        const first = await entry(app(), PAGES);
        const second = await entry(app(), PAGES);
        const sent = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, sent, null), "legal", {
          definitionHash: HASH,
        });
        const documents = [];
        for (const [id, revision] of [
          [first, 0],
          [second, 0],
          [sent, 1],
        ] as const) {
          const { step: _step, ...seen } = await seenPage(id, "send", revision);
          documents.push(seen);
        }

        const answer = await door.stepMany(ALICE, { step: "send", documents });

        expect(answer.moved.sort()).toEqual([first, second].sort());
        expect(answer.refused).toEqual([
          expect.objectContaining({ id: sent, code: "CONFLICT" }),
        ]);
      });

      it("refuses an approval over several documents before anything moves", async () => {
        current = await bootSteps(dialect);
        await people();
        await person(app(), "rita", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
          enteredBy: "alice",
        });
        const { step: _step, ...seen } = await seenPage(id, "clear", 1);

        const refusal = await refusalOf(() =>
          door.stepMany(
            { kind: "person", id: "rita" },
            {
              step: "clear",
              documents: [seen],
            }
          )
        );

        expect(refusal).toEqual({ status: 400, code: "VALIDATION_ERROR" });
        expect((await stateOf(app(), partOf(PAGES, id, null)))?.stage).toBe(
          "legal"
        );
      });

      it("refuses an approval over a document its caller may not read as not found, never telling its workflow", async () => {
        current = await bootSteps(dialect);
        // Bob holds the sign-off on Pages and may not read them.
        await people();
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
          enteredBy: "alice",
        });
        const { step: _step, ...seen } = await seenPage(id, "clear", 1);

        const answer = await door.stepMany(BOB, {
          step: "clear",
          documents: [seen],
        });

        expect(answer.moved).toEqual([]);
        expect(answer.refused).toEqual([
          expect.objectContaining({ id, code: "NOT_FOUND" }),
        ]);
        expect(JSON.stringify(answer)).not.toContain(
          REVIEW_API_ERROR_CODES.bulkApproval
        );
        expect(JSON.stringify(answer)).not.toContain("editorial");
        expect((await stateOf(app(), partOf(PAGES, id, null)))?.stage).toBe(
          "legal"
        );
      });

      it("lists what waits for the caller, a page at a time", async () => {
        current = await bootSteps(dialect);
        await people();
        const ids = [await entry(app(), PAGES), await entry(app(), PAGES)];
        for (const id of ids) {
          await seedState(app(), partOf(PAGES, id, null), "writing", {
            definitionHash: HASH,
            assignee: { kind: "user", id: "alice" },
          });
        }
        // Assigned to someone else who may take the step: not Alice's. (Work assigned to someone
        // who may not would wait for everyone who may, Alice included.)
        await person(app(), "wes", [
          ["read", PAGES],
          ["update", PAGES],
        ]);
        const other = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, other, null), "writing", {
          definitionHash: HASH,
          assignee: { kind: "user", id: "wes" },
        });

        const first = await door.waiting(ALICE, { page: 1, limit: 1 });
        const second = await door.waiting(ALICE, { page: 2, limit: 1 });

        expect(first.meta).toMatchObject({ total: 2, page: 1, hasNext: true });
        expect(
          [...first.items, ...second.items]
            .map(item => (item.document as Doc).entryId)
            .sort()
        ).toEqual([...ids].sort());
      });

      it("names a part's assignee as who it waits for, before its stage's default reviewer", async () => {
        current = await bootSteps(dialect);
        await people();
        await person(app(), "rita", [["sign-off", PAGES]]);
        await defaultReviewer("legal", "rita");
        const desk = await role(app(), "legal-desk", [["sign-off", PAGES]]);
        const toBob = await entry(app(), PAGES);
        const toDesk = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, toBob, null), "legal", {
          definitionHash: HASH,
          assignee: { kind: "user", id: "bob" },
        });
        await seedState(app(), partOf(PAGES, toDesk, null), "legal", {
          definitionHash: HASH,
          assignee: { kind: "role", id: desk },
        });

        expect((await onlyPart(door, toBob)).waitingFor).toEqual({
          kind: "user",
          id: "bob",
          name: "bob",
        });
        expect((await onlyPart(door, toDesk)).waitingFor).toEqual({
          kind: "roles",
          roles: [{ id: desk, name: "legal-desk" }],
        });
      });

      it("names an unassigned part's stage's default reviewer as who it waits for", async () => {
        current = await bootSteps(dialect);
        await people();
        await person(app(), "rita", [["sign-off", PAGES]]);
        await defaultReviewer("legal", "rita");
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
        });

        expect((await onlyPart(door, id)).waitingFor).toEqual({
          kind: "user",
          id: "rita",
          name: "rita",
        });
      });

      it("names the roles holding the stage's primary step where no one is assigned or set", async () => {
        current = await bootSteps(dialect);
        await people();
        const superAdmin = await superAdminRole(app());
        const desk = await role(app(), "legal-desk", [["sign-off", PAGES]]);
        // Holds sign-off only through the role it inherits; a role with one child names a
        // permission of its own.
        const chief = await role(app(), "chief", [["read", PAGES]], [desk]);
        // Holds a step out of Legal check, but not its primary one.
        await role(app(), "parker", [["update", PAGES]]);
        const holdsBob = (
          await new ServiceContainer(app().adapter).roles.findRoleIdBySlug(
            "holds-bob"
          )
        )?.id;
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
        });

        const waiting = (await onlyPart(door, id)).waitingFor as Doc;

        expect(waiting.kind).toBe("roles");
        expect(byId(waiting.roles as Doc[])).toEqual(
          byId([
            await roleNamed(desk),
            await roleNamed(chief),
            await roleNamed(String(holdsBob)),
            await roleNamed(superAdmin),
          ])
        );
      });

      it("passes over a default reviewer who may not take the stage's primary step", async () => {
        current = await bootSteps(dialect);
        await people();
        await person(app(), "dora", [["sign-off", PAGES]], { active: false });
        await defaultReviewer("legal", "dora");
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
        });

        const waiting = (await onlyPart(door, id)).waitingFor as Doc;

        expect(waiting.kind).toBe("roles");
        expect(waiting.roles).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "holds-bob" }),
          ])
        );
      });

      it("names the holders of the step when the assignee no longer holds it", async () => {
        // Work assigned to someone who has since lost the step waits for everyone who may take it,
        // never for the assignee alone: they can no longer move it.
        current = await bootSteps(dialect);
        await people();
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
          assignee: { kind: "user", id: "alice" },
        });

        const waiting = (await onlyPart(door, id)).waitingFor as Doc;

        expect(waiting.kind).toBe("roles");
        expect(waiting.roles).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ name: "holds-bob" }),
          ])
        );
      });

      it("lists work whose assignee no longer holds the step for everyone who does", async () => {
        current = await bootSteps(dialect);
        await people();
        // A reviewer who may sign off and read the pages.
        await person(app(), "sam", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        const SAM: Who = { kind: "person", id: "sam" };
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
          assignee: { kind: "user", id: "alice" },
        });

        const forSam = await door.waiting(SAM, { page: 1, limit: 10 });
        expect(
          forSam.items.map(item => (item.document as Doc).entryId)
        ).toEqual([id]);
        expect(forSam.meta).toMatchObject({ total: 1 });
      });

      it("lists unassigned work for every holder, or for the stage's default reviewer alone", async () => {
        current = await bootSteps(dialect);
        await people();
        const open = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, open, null), "legal", {
          definitionHash: HASH,
        });
        const ids = async (who: Who) =>
          (await door.waiting(who, { page: 1, limit: 10 })).items
            .map(item => (item.document as Doc).entryId)
            .sort();
        // No one is set for Legal check: it waits for everyone who may sign off.
        await person(app(), "sam", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        const SAM: Who = { kind: "person", id: "sam" };
        expect(await ids(SAM)).toEqual([open]);

        // Once Rita is its default reviewer, it waits for her alone.
        await person(app(), "rita", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        await defaultReviewer("legal", "rita");
        expect(await ids({ kind: "person", id: "rita" })).toEqual([open]);
        expect(await ids(SAM)).toEqual([]);
      });

      it("lists nothing for an API key in a stage whose next step it may never take", async () => {
        // Legal check's next step is an approval, which a key never takes, whatever it holds: the
        // list shows a caller only work it could move, as the read marks each step it may take.
        current = await bootSteps(dialect);
        await people();
        await person(app(), "kim", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
        });
        const key: Who = {
          kind: "key",
          owner: "kim",
          grants: [
            ["read", PAGES],
            ["sign-off", PAGES],
          ],
        };

        const waiting = await door.waiting(key, { page: 1, limit: 10 });
        expect(waiting.items).toEqual([]);
        expect(waiting.meta).toMatchObject({ total: 0 });
        // Its owner, a person, may approve: the same part waits for them.
        const forKim = await door.waiting(
          { kind: "person", id: "kim" },
          { page: 1, limit: 10 }
        );
        expect(
          forKim.items.map(item => (item.document as Doc).entryId)
        ).toEqual([id]);
      });

      it("counts only the work its caller may read", async () => {
        // A row a read rule hides is neither listed nor counted: a count that took it in would tell
        // the caller it exists.
        current = await bootSteps(dialect, undefined, {
          collections: [circulars],
        });
        await person(app(), "bea", [
          ["read", CIRCULARS],
          ["sign-off", CIRCULARS],
        ]);
        const created = async (team: string) =>
          (
            (await app().nextly.create({
              collection: CIRCULARS,
              data: { title: team, team },
            })) as unknown as { item: { id: string } }
          ).item.id;
        const open = await created("public");
        const hidden = await created("private");
        for (const id of [open, hidden]) {
          await seedState(app(), partOf(CIRCULARS, id, null), "legal", {
            definitionHash: HASH,
          });
        }

        const waiting = await door.waiting(
          { kind: "person", id: "bea" },
          { page: 1, limit: 10 }
        );
        expect(
          waiting.items.map(item => (item.document as Doc).entryId)
        ).toEqual([open]);
        expect(waiting.meta).toMatchObject({ total: 1 });
      });

      it("lists nothing for the person who brought a part into a stage whose step refuses that", async () => {
        // Clear refuses self-approval: the one who brought the part into Legal check may not take
        // it, so it does not wait for them, though it waits for every other holder.
        current = await bootSteps(dialect);
        await people();
        for (const id of ["rita", "sam"]) {
          await person(app(), id, [
            ["read", PAGES],
            ["sign-off", PAGES],
          ]);
        }
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
          enteredBy: "rita",
        });
        const ids = async (who: Who) =>
          (await door.waiting(who, { page: 1, limit: 10 })).items.map(
            item => (item.document as Doc).entryId
          );

        expect(await ids({ kind: "person", id: "rita" })).toEqual([]);
        expect(await ids({ kind: "person", id: "sam" })).toEqual([id]);
      });

      it("pages only the work its caller may read", async () => {
        // A hidden row never takes a page slot: two visible parts and one hidden, two to a page,
        // fill one page, and there is no second.
        current = await bootSteps(dialect, undefined, {
          collections: [circulars],
        });
        await person(app(), "bea", [
          ["read", CIRCULARS],
          ["sign-off", CIRCULARS],
        ]);
        const created = async (team: string) =>
          (
            (await app().nextly.create({
              collection: CIRCULARS,
              data: { title: team, team },
            })) as unknown as { item: { id: string } }
          ).item.id;
        const first = await created("public");
        const hidden = await created("private");
        const second = await created("public");
        for (const id of [first, hidden, second]) {
          await seedState(app(), partOf(CIRCULARS, id, null), "legal", {
            definitionHash: HASH,
          });
        }

        const page = await door.waiting(
          { kind: "person", id: "bea" },
          { page: 1, limit: 2 }
        );
        expect(
          page.items.map(item => (item.document as Doc).entryId).sort()
        ).toEqual([first, second].sort());
        expect(page.meta).toMatchObject({ total: 2, hasNext: false });
      });

      it("lists work its assignee brought into a stage whose step refuses that for every other holder", async () => {
        // Rita holds Clear, but brought this part into Legal check, and Clear refuses self-approval:
        // she cannot move it, so it waits for everyone who may, as though she had lost the step.
        current = await bootSteps(dialect);
        await people();
        for (const id of ["rita", "sam"]) {
          await person(app(), id, [
            ["read", PAGES],
            ["sign-off", PAGES],
          ]);
        }
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
          assignee: { kind: "user", id: "rita" },
          enteredBy: "rita",
        });
        const ids = async (who: Who) =>
          (await door.waiting(who, { page: 1, limit: 10 })).items.map(
            item => (item.document as Doc).entryId
          );

        expect(await ids({ kind: "person", id: "sam" })).toEqual([id]);
        expect(await ids({ kind: "person", id: "rita" })).toEqual([]);
        // The read names the same: everyone who may, not Rita.
        const waiting = (await onlyPart(door, id)).waitingFor as Doc;
        expect(waiting.kind).toBe("roles");
      });

      it("pages past work its caller may not move without a short page", async () => {
        // Three parts Sam brought into Legal check come first, and Clear refuses him those. They take
        // no place on a page: the two he may move fill page one, and there is no page two.
        current = await bootSteps(dialect);
        await people();
        await person(app(), "sam", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        const earlier = new Date("2026-11-01T10:00:00.000Z");
        for (let n = 0; n < 3; n += 1) {
          await seedState(
            app(),
            partOf(PAGES, await entry(app(), PAGES), null),
            "legal",
            { definitionHash: HASH, enteredBy: "sam", enteredAt: earlier }
          );
        }
        const movable: string[] = [];
        for (let n = 0; n < 2; n += 1) {
          const id = await entry(app(), PAGES);
          movable.push(id);
          await seedState(app(), partOf(PAGES, id, null), "legal", {
            definitionHash: HASH,
          });
        }

        const page = await door.waiting(
          { kind: "person", id: "sam" },
          { page: 1, limit: 2 }
        );
        expect(
          page.items.map(item => (item.document as Doc).entryId).sort()
        ).toEqual([...movable].sort());
        expect(page.meta).toMatchObject({ total: 2, hasNext: false });
        expect(page.meta.totalCapped).toBeUndefined();
      });

      it("reads review states only a bounded number at a time", async () => {
        // Work assigned to someone who lost the step, to one who brought it in, and to no one: every
        // read of review states the list makes carries a LIMIT, however many rows a stage holds.
        current = await bootSteps(dialect);
        await people();
        await person(app(), "sam", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        await seedState(
          app(),
          partOf(PAGES, await entry(app(), PAGES), null),
          "legal",
          { definitionHash: HASH, assignee: { kind: "user", id: "alice" } }
        );
        await seedState(
          app(),
          partOf(PAGES, await entry(app(), PAGES), null),
          "legal",
          { definitionHash: HASH }
        );
        const SAM: Who = { kind: "person", id: "sam" };

        const reads = (
          await statementsOf(dialect, () =>
            door.waiting(SAM, { page: 1, limit: 10 })
          )
        ).filter(
          statement =>
            /^\s*select/i.test(statement) &&
            statement.includes("nextly_review_states")
        );
        expect(reads.length).toBeGreaterThan(0);
        for (const statement of reads) expect(statement).toMatch(/\blimit\b/i);
      });

      it("asks whether its caller may read the documents in batches, never part by part", async () => {
        // Each part's document is read checked: asked one by one, a long queue is a round trip per
        // part. Asked per collection and language, 15 parts cost what 3 do.
        current = await bootSteps(dialect);
        await people();
        await person(app(), "sam", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        const seed = async (count: number) => {
          for (let n = 0; n < count; n += 1) {
            await seedState(
              app(),
              partOf(PAGES, await entry(app(), PAGES), null),
              "legal",
              { definitionHash: HASH }
            );
          }
        };
        const SAM: Who = { kind: "person", id: "sam" };
        const statements = async () => {
          // Once to warm what a first call caches, then counted.
          await door.waiting(SAM, { page: 1, limit: 50 });
          return (
            await statementsOf(dialect, () =>
              door.waiting(SAM, { page: 1, limit: 50 })
            )
          ).length;
        };

        await seed(3);
        const few = await statements();
        await seed(12);
        const many = await statements();
        expect(
          (await door.waiting(SAM, { page: 1, limit: 50 })).meta
        ).toMatchObject({ total: 15 });
        expect(many).toBe(few);
      });

      it("reads exactly as many parts as it may whole, and cuts nothing it read in full", async () => {
        // Exactly 1,000 parts are Sam's own: that read is whole, not cut short, so the work after it
        // in the rest of the stage (an orphan, entered later) is still his, and the total is exact.
        current = await bootSteps(dialect);
        await people();
        await person(app(), "sam", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        for (let n = 0; n < 1000; n += 1) {
          await seedState(app(), partOf(PAGES, randomUUID(), null), "legal", {
            definitionHash: HASH,
            assignee: { kind: "user", id: "sam" },
          });
        }
        const orphan = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, orphan, null), "legal", {
          definitionHash: HASH,
          assignee: { kind: "user", id: "alice" },
          enteredAt: new Date("2026-11-03T10:00:00.000Z"),
        });

        const page = await door.waiting(
          { kind: "person", id: "sam" },
          { page: 1, limit: 10 }
        );
        expect(page.items.map(item => (item.document as Doc).entryId)).toEqual([
          orphan,
        ]);
        expect(page.meta).toMatchObject({ total: 1 });
        expect(page.meta.totalCapped).toBeUndefined();
      });

      it("marks the total a floor when there is more waiting than it reads", async () => {
        // More parts wait than one list reads: the total counts those read, and says it is a floor.
        // None of these documents exists, so none is readable, and the total read is 0 — yet more
        // may wait past the cap, which `totalCapped` says rather than a bare 0.
        current = await bootSteps(dialect);
        await people();
        await person(app(), "sam", [
          ["read", PAGES],
          ["sign-off", PAGES],
        ]);
        for (let n = 0; n <= 1000; n += 1) {
          await seedState(app(), partOf(PAGES, randomUUID(), null), "legal", {
            definitionHash: HASH,
          });
        }

        const page = await door.waiting(
          { kind: "person", id: "sam" },
          { page: 1, limit: 10 }
        );
        expect(page.items).toEqual([]);
        expect(page.meta).toMatchObject({ total: 0, totalCapped: true });
      });

      it("lists for a key scoped to one role only that role's work", async () => {
        // A key scoped to one of its owner's roles acts as that role alone: work assigned to the
        // owner's other role, or to the owner, is not its to see.
        current = await bootSteps(dialect);
        await people();
        await person(app(), "olga", []);
        const deskA = await role(app(), "desk-a", [
          ["read", PAGES],
          ["update", PAGES],
        ]);
        const deskB = await role(app(), "desk-b", [
          ["read", PAGES],
          ["update", PAGES],
        ]);
        await giveRole(app(), "olga", deskA);
        await giveRole(app(), "olga", deskB);
        const toA = await entry(app(), PAGES);
        const toB = await entry(app(), PAGES);
        const toOlga = await entry(app(), PAGES);
        for (const [id, assignee] of [
          [toA, { kind: "role", id: deskA }],
          [toB, { kind: "role", id: deskB }],
          [toOlga, { kind: "user", id: "olga" }],
        ] as const) {
          await seedState(app(), partOf(PAGES, id, null), "writing", {
            definitionHash: HASH,
            assignee,
          });
        }
        const key: Who = {
          kind: "key",
          owner: "olga",
          role: deskA,
          roleSlug: "desk-a",
          grants: [
            ["read", PAGES],
            ["update", PAGES],
          ],
        };

        const waiting = await door.waiting(key, { page: 1, limit: 10 });
        expect(
          waiting.items.map(item => (item.document as Doc).entryId)
        ).toEqual([toA]);
        expect(waiting.meta).toMatchObject({ total: 1 });
      });

      it("lists for a key its owner's roles' work, never the owner's own", async () => {
        // A key, even a full-access one, stands for its roles and never for its owner in person:
        // work assigned to the owner by name waits for the owner, signed in, not for their key.
        current = await bootSteps(dialect);
        await people();
        await person(app(), "olga", []);
        const desk = await role(app(), "desk-o", [
          ["read", PAGES],
          ["update", PAGES],
        ]);
        await giveRole(app(), "olga", desk);
        const toDesk = await entry(app(), PAGES);
        const toOlga = await entry(app(), PAGES);
        for (const [id, assignee] of [
          [toDesk, { kind: "role", id: desk }],
          [toOlga, { kind: "user", id: "olga" }],
        ] as const) {
          await seedState(app(), partOf(PAGES, id, null), "writing", {
            definitionHash: HASH,
            assignee,
          });
        }
        const ids = async (who: Who) =>
          (await door.waiting(who, { page: 1, limit: 10 })).items
            .map(item => (item.document as Doc).entryId)
            .sort();
        const key: Who = {
          kind: "key",
          owner: "olga",
          grants: [
            ["read", PAGES],
            ["update", PAGES],
          ],
        };

        expect(await ids(key)).toEqual([toDesk]);
        expect(await ids({ kind: "person", id: "olga" })).toEqual(
          [toDesk, toOlga].sort()
        );
      });

      it("names no one for a part in a stage with no step out of it", async () => {
        current = await bootSteps(dialect, undefined, {
          collections: [briefs],
        });
        await person(app(), "alice", [["read", BRIEFS]]);
        const id = await entry(app(), BRIEFS);
        await seedState(app(), partOf(BRIEFS, id, null), "done", {
          definitionHash: workflowDefinitionHash(straight),
        });

        const parts = partsOf(
          await door.reviewState(ALICE, { collection: BRIEFS, id })
        );

        expect(parts).toEqual([
          expect.objectContaining({ stage: "done", waitingFor: null }),
        ]);
      });

      it("names a part's last move: its latest step, by whom, from where to where, with the comment", async () => {
        current = await bootSteps(dialect);
        await people();
        const id = await entry(app(), PAGES);

        await door.takeStep(ALICE, {
          ...(await seenPage(id, "send", 0)),
          comment: "Ready for legal",
        });
        const sent = (await onlyPart(door, id)).lastMove as Doc;
        await door.takeStep(ALICE, {
          ...(await seenPage(id, "park", 1)),
          comment: "Waiting on photos",
        });
        const parked = (await onlyPart(door, id)).lastMove as Doc;

        expect(sent).toEqual({
          kind: "workflow-submit",
          actor: expect.objectContaining({ kind: "person", id: "alice" }),
          at: expect.anything(),
          from: "writing",
          to: "legal",
          comment: "Ready for legal",
        });
        expect(Number.isNaN(new Date(String(sent.at)).getTime())).toBe(false);
        expect(parked).toEqual({
          kind: "workflow-move",
          actor: expect.objectContaining({ kind: "person", id: "alice" }),
          at: expect.anything(),
          from: "legal",
          to: "hold",
          comment: "Waiting on photos",
        });
      });

      it("names a Single it refuses over several documents by the slug the caller named, never its id", async () => {
        current = await bootSteps(dialect);
        await people();
        await app().nextly.updateSingle({
          slug: "banner" as never,
          data: { title: "Hello", _overwrite: true },
        } as never);
        const banner = (await app().nextly.findSingle({
          slug: "banner" as never,
          status: "all",
        } as never)) as Doc;

        // Alice may read Pages, not the Banner.
        const answer = await door.stepMany(ALICE, {
          step: "send",
          documents: [
            {
              document: { single: "banner" },
              parts: [null],
              seen: [{ part: null, revision: 0, version: String(banner._rev) }],
            },
          ],
        });

        expect(answer.moved).toEqual([]);
        expect(answer.refused).toEqual([
          expect.objectContaining({ single: "banner", code: "NOT_FOUND" }),
        ]);
        expect(JSON.stringify(answer.refused)).not.toContain(String(banner.id));
      });

      it("names no last move for a part that never moved, though another part did", async () => {
        current = await bootSteps(dialect);
        await person(app(), "alice", [
          ["read", PAGES],
          ["read", POSTS],
          ["update", POSTS],
        ]);
        const fresh = await entry(app(), PAGES);
        const post = await entry(app(), POSTS);
        await door.takeStep(ALICE, {
          document: { collection: POSTS, id: post },
          step: "send",
          parts: ["en"],
          seen: [
            {
              part: "en",
              revision: 0,
              version: await versionOf(app(), POSTS, post, "en"),
            },
          ],
        });

        const page = partsOf(
          await door.reviewState(ALICE, { collection: PAGES, id: fresh })
        );
        const parts = partsOf(
          await door.reviewState(ALICE, { collection: POSTS, id: post })
        );
        const moveOf = (part: string | null) =>
          parts.find(each => each.part === part)?.lastMove;

        expect(page).toEqual([expect.objectContaining({ lastMove: null })]);
        expect(moveOf("en")).toEqual(
          expect.objectContaining({ kind: "workflow-submit", to: "legal" })
        );
        expect(moveOf("es")).toBeNull();
        expect(moveOf(null)).toBeNull();
      });
    });
    describe("trusted code naming a document or a part that does not exist", () => {
      const MISSING = "00000000-0000-4000-8000-000000000000";
      const sendOf = (
        document: Doc,
        part: string | null,
        version = "1"
      ): Doc => ({
        document,
        step: "send",
        parts: [part],
        seen: [{ part, revision: 0, version }],
      });
      const codeOf = (call: Promise<unknown>) =>
        call.then(
          () => "answered",
          (error: { code?: string }) => error.code
        );

      it("refuses a step on a document that does not exist as not found, and writes nothing", async () => {
        current = await bootSteps(dialect);

        const code = await codeOf(
          app().nextly.workflows.takeStep(
            sendOf({ collection: PAGES, id: MISSING }, null) as never
          )
        );

        expect(code).toBe("NOT_FOUND");
        expect(await stateOf(app(), partOf(PAGES, MISSING, null))).toBeNull();
      });

      it("refuses a step naming a language the site does not have, and writes nothing", async () => {
        current = await bootSteps(dialect);
        const id = await entry(app(), POSTS);

        const code = await codeOf(
          app().nextly.workflows.takeStep(
            sendOf({ collection: POSTS, id }, "xx") as never
          )
        );

        expect(code).toBe("VALIDATION_ERROR");
        expect(await stateOf(app(), partOf(POSTS, id, "xx"))).toBeNull();
      });

      it("refuses a step naming a language on a document kept in none, and writes nothing", async () => {
        current = await bootSteps(dialect);
        const id = await entry(app(), PAGES);

        const code = await codeOf(
          app().nextly.workflows.takeStep(
            sendOf({ collection: PAGES, id }, "en") as never
          )
        );

        expect(code).toBe("VALIDATION_ERROR");
        expect(await stateOf(app(), partOf(PAGES, id, "en"))).toBeNull();
      });

      it("refuses an assignment on a missing document or an unknown part, and writes nothing", async () => {
        current = await bootSteps(dialect);
        await person(app(), "rita", [
          ["sign-off", POSTS],
          ["sign-off", PAGES],
        ]);
        const id = await entry(app(), POSTS);
        const assign = (document: Doc, part: string | null) =>
          codeOf(
            app().nextly.workflows.assign({
              assignments: [
                {
                  document,
                  part,
                  revision: 0,
                  assignee: { kind: "user", id: "rita" },
                },
              ],
            } as never)
          );

        expect(await assign({ collection: PAGES, id: MISSING }, null)).toBe(
          "NOT_FOUND"
        );
        expect(await assign({ collection: POSTS, id }, "xx")).toBe(
          "VALIDATION_ERROR"
        );
        expect(await stateOf(app(), partOf(PAGES, MISSING, null))).toBeNull();
        expect(await stateOf(app(), partOf(POSTS, id, "xx"))).toBeNull();
      });

      it("refuses each such document of a move over several, and writes nothing for it", async () => {
        current = await bootSteps(dialect);
        await person(app(), "rita", [
          ["sign-off", POSTS],
          ["sign-off", PAGES],
        ]);
        const id = await entry(app(), POSTS);

        const stepped = await app().nextly.workflows.stepMany({
          step: "send",
          documents: [
            {
              document: { collection: PAGES, id: MISSING },
              parts: [null],
              seen: [{ part: null, revision: 0, version: "1" }],
            },
            {
              document: { collection: POSTS, id },
              parts: ["xx"],
              seen: [{ part: "xx", revision: 0, version: "1" }],
            },
          ],
        } as never);
        const assigned = await app().nextly.workflows.assignMany({
          assignments: [
            {
              document: { collection: PAGES, id: MISSING },
              part: null,
              revision: 0,
              assignee: { kind: "user", id: "rita" },
            },
            {
              document: { collection: POSTS, id },
              part: "xx",
              revision: 0,
              assignee: { kind: "user", id: "rita" },
            },
          ],
        } as never);

        expect(stepped.moved).toEqual([]);
        expect(stepped.refused.map(each => each.code)).toEqual([
          "NOT_FOUND",
          "VALIDATION_ERROR",
        ]);
        expect(assigned.assigned).toEqual([]);
        expect(assigned.refused.map(each => each.code)).toEqual([
          "NOT_FOUND",
          "VALIDATION_ERROR",
        ]);
        expect(await stateOf(app(), partOf(PAGES, MISSING, null))).toBeNull();
        expect(await stateOf(app(), partOf(POSTS, id, "xx"))).toBeNull();
      });
    });

    it("tells trusted code it may take every step but an approval or a request for changes, as a step refuses those", async () => {
      current = await bootSteps(dialect);
      const id = await entry(app(), PAGES);
      await seedState(app(), partOf(PAGES, id, null), "legal", {
        definitionHash: HASH,
      });
      const document = { collection: PAGES, id };

      const state = (await app().nextly.workflows.reviewState({
        document,
      })) as unknown as Doc;
      const steps = stepsByName(partsOf(state)[0]);
      const clear = await app()
        .nextly.workflows.takeStep({
          document,
          step: "clear",
          parts: [null],
          seen: [
            {
              part: null,
              revision: 1,
              version: await versionOf(app(), PAGES, id, null),
            },
          ],
        })
        .then(
          () => null,
          (error: { code?: string }) => error.code
        );

      expect(steps.park.mayTake).toBe(true);
      expect(steps.clear.mayTake).toBe(false);
      expect(steps.bounce.mayTake).toBe(false);
      // As the step itself answers trusted code.
      expect(clear).toBe("FORBIDDEN");
    });
  }
);
