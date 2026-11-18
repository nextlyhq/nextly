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

import { afterEach, describe, expect, it } from "vitest";

import { apiKeyScope } from "../../../auth/authenticated-scope";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { permissionSlug } from "../../../schemas/_zod/rbac";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { defineCollection, text } from "../../../config";
import { createDynamicHandlers } from "../../../routeHandler";
import { ServiceContainer } from "../../../services/index";
import type { ApiKeyService } from "../../auth/services/api-key-service";
import { defineWorkflow } from "../define-workflow";
import { workflowDefinitionHash } from "../hash";
import { writeWorkflowSettings } from "../workflow-settings-repository";

import {
  bootSteps,
  entry,
  partOf,
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
  | { kind: "key"; owner: string; grants: readonly Grant[] };

/** One door: each operation, made for `who`, answering or throwing a {@link Refusal}. */
interface Door {
  name: string;
  reviewState(who: Who, document: Doc): Promise<Doc>;
  takeStep(who: Who, input: Doc): Promise<Doc>;
  stepMany(who: Who, input: Doc): Promise<{ moved: string[]; refused: Doc[] }>;
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
  // A full-access key, which holds what its owner holds: the grants named are the owner's.
  const keys = app().getService("apiKeyService") as unknown as ApiKeyService;
  const { key } = await keys.createApiKey(who.owner, {
    name: `key of ${who.owner}`,
    tokenType: "full-access",
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
            }))
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
      refused: answer.refused.map(each => ({
        id: each.document.entryId,
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
        // Assigned to someone else: not Alice's.
        const other = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, other, null), "writing", {
          definitionHash: HASH,
          assignee: { kind: "user", id: "bob" },
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
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
          assignee: { kind: "user", id: "alice" },
        });

        const forBob = await door.waiting(BOB, { page: 1, limit: 10 });
        expect(
          forBob.items.map(item => (item.document as Doc).entryId)
        ).toEqual([id]);
        expect(forBob.meta).toMatchObject({ total: 1 });
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
        expect(await ids(BOB)).toEqual([open]);

        // Once Rita is its default reviewer, it waits for her alone.
        await person(app(), "rita", [["sign-off", PAGES]]);
        await defaultReviewer("legal", "rita");
        expect(await ids({ kind: "person", id: "rita" })).toEqual([open]);
        expect(await ids(BOB)).toEqual([]);
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
