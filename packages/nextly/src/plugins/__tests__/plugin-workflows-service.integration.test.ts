/**
 * A plugin reads review state and submits for review through `ctx.services.workflows`, as the
 * person or the API key its route serves, on every configured dialect.
 *
 * - The plugin names who it acts for (`{ as: "user", user }`); the key is the one the request
 *   authenticated with, judged by its own scope, never its owner's, and named by its own id.
 * - Every read and every submit needs the right to read the document: a caller who may not read it
 *   is answered as though it did not exist, in every language they may not read it in too.
 * - A workflow's definition is told only to one who may read the collection or Single, with its
 *   stages and steps, never its settings or the other collections it is attached to.
 *
 * Each case calls the service from a real plugin route, through the dispatcher that authenticates
 * the request and pins the key's scope and id, so a key case is the request an agent makes.
 *
 * The plausible broken service: one that runs as the system (and so reads what its caller may not),
 * one that judges a key by its owner, one that answers the definition of any entity named, and one
 * that tells settings an agent has no business reading.
 */

// Set before the harness boots (env validation reads it once), so a session can be signed.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { apiKeyScope } from "../../auth/authenticated-scope";
import { buildClaims } from "../../auth/jwt/claims";
import { signAccessToken } from "../../auth/jwt/sign";
import type { ApiKeyService } from "../../domains/auth/services/api-key-service";
import {
  bootSteps,
  entry,
  partOf,
  person,
  role,
  seedState,
  stateOf,
  versionOf,
  workflowEvents,
  type Grant,
} from "../../domains/workflows/__tests__/helpers/step-harness";
import { editorial } from "../../domains/workflows/__tests__/helpers/step-workflows";
import { workflowDefinitionHash } from "../../domains/workflows/hash";
import { NextlyError } from "../../errors";
import { createDynamicHandlers } from "../../routeHandler";
import { definePlugin, type PluginContext } from "../plugin-context";
import type { ServiceOpts } from "../service-opts";
import { getConfiguredTestDialects, type TestNextly } from "../test-nextly";

const HASH = workflowDefinitionHash(editorial);
const PLUGIN = "@test/wf-agent";
const PAGES = "pages";
const LETTERS = "letters";

type Doc = Record<string, unknown>;

/** What the plugin's route is asked to call, by the service's method name. */
type Op = "definitionOf" | "reviewState" | "waiting" | "submit";

/** The service a plugin is handed, as the route calls it. */
type Workflows = PluginContext["services"]["workflows"];

/** One call of the service, by name, with what the request sent. */
function call(
  workflows: Workflows,
  op: Op,
  input: unknown,
  opts: ServiceOpts | undefined
): Promise<unknown> {
  switch (op) {
    case "definitionOf":
      return workflows.definitionOf(
        input as Parameters<Workflows["definitionOf"]>[0],
        opts
      );
    case "reviewState":
      return workflows.reviewState(
        input as Parameters<Workflows["reviewState"]>[0],
        opts
      );
    case "waiting":
      return workflows.waiting(
        input as Parameters<Workflows["waiting"]>[0],
        opts
      );
    case "submit":
      return workflows.submit(
        input as Parameters<Workflows["submit"]>[0],
        opts
      );
  }
}

/** A refusal as the route answers it: the error's status, code and public data. */
function refusalOf(error: unknown): Response {
  if (!NextlyError.is(error)) throw error;
  return Response.json(
    {
      error: {
        status: error.statusCode,
        code: error.code,
        data: error.publicData ?? null,
      },
    },
    { status: error.statusCode }
  );
}

/**
 * The agent's plugin: one route that checks access itself, calling the service as the request's
 * user, exactly as an agent's tool does.
 */
const agentPlugin = definePlugin({
  name: PLUGIN,
  version: "1.0.0",
  nextly: ">=0.0.0",
  contributes: {
    routes: [
      {
        method: "POST",
        path: "/run",
        checksAccess: true,
        handler: async (request, ctx) => {
          const { op, input } = (await request.json()) as {
            op: Op;
            input: unknown;
          };
          try {
            const result = await call(ctx.services.workflows, op, input, {
              as: "user",
              user: ctx.user ?? undefined,
            });
            return Response.json({ result });
          } catch (error) {
            return refusalOf(error);
          }
        },
      },
    ],
  },
});

/** A plugin that keeps the context its `init` is handed, so a case can call as the plugin. */
const CAPTURE = "@test/wf-capture";
const captured = new Map<string, PluginContext>();
const capturing = definePlugin({
  name: CAPTURE,
  version: "1.0.0",
  nextly: ">=0.0.0",
  init(ctx) {
    captured.set(CAPTURE, ctx);
  },
});

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
  captured.clear();
});

const app = (): TestNextly => {
  if (!current) throw new Error("not booted");
  return current;
};

/** Who a request is: a person signed in, or an API key, by its secret. */
type Who = { person: string } | { key: string };

async function headersFor(who: Who): Promise<Record<string, string>> {
  if ("key" in who) return { authorization: `Bearer ${who.key}` };
  const token = await signAccessToken(
    buildClaims({
      userId: who.person,
      email: `${who.person}@example.test`,
      name: who.person,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  return { cookie: `nextly_session=${token}` };
}

/** The route's answer: the status, and the result or the refusal. */
interface Answer {
  status: number;
  result?: unknown;
  error?: { status: number; code: string; data: Doc | null };
}

/** One call of the service, made through the plugin's route for `who`. */
async function run(who: Who, op: Op, input: unknown): Promise<Answer> {
  const handlers = createDynamicHandlers();
  const params = ["plugins", ...PLUGIN.split("/"), "run"];
  const response = await handlers.POST(
    new Request(`http://localhost/api/${params.join("/")}`, {
      method: "POST",
      headers: {
        ...(await headersFor(who)),
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify({ op, input }),
    }),
    { params: Promise.resolve({ params }) }
  );
  const body = (await response.json()) as Omit<Answer, "status">;
  return { status: response.status, ...body };
}

/** The result of a call that must succeed, named with the refusal when it did not. */
function resultOf(answer: Answer): Doc {
  expect(answer.error, JSON.stringify(answer.error)).toBeUndefined();
  expect(answer.status).toBe(200);
  return answer.result as Doc;
}

/** Kim holds everything the keys below are scoped to, so each key is narrower than its owner. */
const KIM = "kim";
const KIM_GRANTS: Grant[] = [
  PAGES,
  "posts",
  LETTERS,
  "banner",
  "memos",
].flatMap(
  slug =>
    [
      ["read", slug],
      ["update", slug],
      ["sign-off", slug],
    ] as Grant[]
);

/**
 * A role-based key Kim mints, holding exactly `grants`: the key an agent is handed. Returns the
 * secret it authenticates with and its id, as the history of its moves names it.
 */
async function keyOf(
  label: string,
  grants: readonly Grant[]
): Promise<{ key: string; id: string }> {
  const roleId = await role(app(), `key-${label}`, grants);
  const keys = app().getService("apiKeyService") as unknown as ApiKeyService;
  const { key, meta } = await keys.createApiKey(KIM, {
    name: `agent ${label}`,
    tokenType: "role-based",
    roleId,
    expiresIn: "unlimited",
  });
  return { key, id: meta.id };
}

/** The install, with Kim. */
async function boot(dialect: Parameters<typeof bootSteps>[0]) {
  current = await bootSteps(dialect, [agentPlugin, capturing], {
    tablePrefix: "pws_",
  });
  await person(app(), KIM, KIM_GRANTS);
}

/** One part of a review state, by its part. */
function partNamed(review: Doc, part: string | null): Doc | undefined {
  return (review.parts as Doc[]).find(each => each.part === part);
}

/** One step out of a part's stage, by its name. */
function stepNamed(part: Doc | undefined, name: string): Doc | undefined {
  return (part?.steps as Doc[] | undefined)?.find(each => each.name === name);
}

describe.each(getConfiguredTestDialects())(
  "ctx.services.workflows (%s)",
  dialect => {
    describe("reviewState", () => {
      it("reads a document's review state for a key", async () => {
        await boot(dialect);
        const id = await entry(app(), PAGES);
        const { key } = await keyOf("reader", [["read", PAGES]]);

        const review = resultOf(
          await run({ key }, "reviewState", {
            document: { collection: PAGES, id },
          })
        );

        expect(review.workflow).toEqual({
          slug: "editorial",
          label: "Editorial",
        });
        expect(review.parts).toHaveLength(1);
        expect(partNamed(review, null)).toMatchObject({
          part: null,
          stage: "writing",
          revision: 0,
          version: await versionOf(app(), PAGES, id, null),
        });
      });

      it("marks the steps the key may take, by the key's own scope", async () => {
        await boot(dialect);
        const id = await entry(app(), PAGES);
        const writer = await keyOf("writer", [
          ["read", PAGES],
          ["update", PAGES],
        ]);
        const reader = await keyOf("reader", [["read", PAGES]]);
        const document = { document: { collection: PAGES, id } };

        const asWriter = resultOf(
          await run({ key: writer.key }, "reviewState", document)
        );
        const asReader = resultOf(
          await run({ key: reader.key }, "reviewState", document)
        );

        expect(stepNamed(partNamed(asWriter, null), "send")).toMatchObject({
          mayTake: true,
          primary: true,
        });
        // Kim may send; the reader's key may not, whoever minted it.
        expect(stepNamed(partNamed(asReader, null), "send")).toMatchObject({
          mayTake: false,
          primary: true,
        });
      });

      it("answers a document the key may not read as not found", async () => {
        await boot(dialect);
        const id = await entry(app(), PAGES);
        await app().nextly.updateSingle({
          slug: "banner" as never,
          data: { title: "Hello", _overwrite: true },
        } as never);
        // Updates Pages without reading them, and reads Pages but not the Banner.
        const updater = await keyOf("updater", [["update", PAGES]]);
        const reader = await keyOf("reader", [["read", PAGES]]);

        const page = await run({ key: updater.key }, "reviewState", {
          document: { collection: PAGES, id },
        });
        const banner = await run({ key: reader.key }, "reviewState", {
          document: { single: "banner" },
        });

        expect(page.error).toMatchObject({ status: 404, code: "NOT_FOUND" });
        expect(banner.error).toMatchObject({ status: 404, code: "NOT_FOUND" });
        // The control: the same reader is told the Banner's neighbour.
        expect(
          resultOf(
            await run({ key: reader.key }, "reviewState", {
              document: { collection: PAGES, id },
            })
          ).workflow
        ).toMatchObject({ slug: "editorial" });
      });

      it("leaves out a part in a language the key may not read", async () => {
        await boot(dialect);
        const id = await entry(app(), LETTERS);
        for (const part of ["en", "es"]) {
          await seedState(app(), partOf(LETTERS, id, part), "legal", {
            definitionHash: HASH,
          });
        }
        const { key } = await keyOf("letters", [
          ["read", LETTERS],
          ["update", LETTERS],
          ["sign-off", LETTERS],
        ]);

        const review = resultOf(
          await run({ key }, "reviewState", {
            document: { collection: LETTERS, id },
          })
        );

        expect(partNamed(review, "en")).toMatchObject({ stage: "legal" });
        expect(partNamed(review, "es")).toBeUndefined();
      });
    });

    describe("definitionOf", () => {
      it("tells the definition of a collection the key may read, and none of its settings", async () => {
        await boot(dialect);
        const { key } = await keyOf("reader", [["read", PAGES]]);

        const answer = resultOf(
          await run({ key }, "definitionOf", { collection: PAGES })
        );
        const workflow = answer.workflow as Doc;

        expect(workflow).toMatchObject({
          slug: "editorial",
          label: "Editorial",
        });
        expect((workflow.stages as Doc[]).map(stage => stage.name)).toEqual([
          "writing",
          "legal",
          "hold",
          "cleared",
        ]);
        expect(
          (workflow.steps as Doc[]).find(step => step.name === "clear")
        ).toEqual({
          name: "clear",
          label: "Clear",
          kind: "approve",
          from: ["legal"],
          to: "cleared",
          primary: true,
        });
        // What the workflow is attached to elsewhere, who holds its steps, and its settings are
        // not the definition.
        for (const kept of [
          "collections",
          "singles",
          "grants",
          "grantable",
          "defaultReviewers",
          "emails",
          "revision",
        ]) {
          expect(JSON.stringify(answer)).not.toContain(`"${kept}"`);
        }
      });

      it("answers a collection the key may not read, and one that does not exist, alike: not found", async () => {
        await boot(dialect);
        const { key } = await keyOf("reader", [["read", PAGES]]);

        const posts = await run({ key }, "definitionOf", {
          collection: "posts",
        });
        const missing = await run({ key }, "definitionOf", {
          collection: "nope",
        });

        expect(posts.error).toMatchObject({ status: 404, code: "NOT_FOUND" });
        expect(missing.error).toEqual(posts.error);
      });
    });

    describe("waiting", () => {
      it("lists what waits for the key, only where the key may read and take the step", async () => {
        await boot(dialect);
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "writing", {
          definitionHash: HASH,
          assignee: { kind: "user", id: KIM },
        });
        const writer = await keyOf("writer", [
          ["read", PAGES],
          ["update", PAGES],
        ]);
        const reader = await keyOf("reader", [["read", PAGES]]);
        const updater = await keyOf("updater", [["update", PAGES]]);

        const forWriter = resultOf(
          await run({ key: writer.key }, "waiting", { page: 1, limit: 20 })
        );
        const forReader = resultOf(
          await run({ key: reader.key }, "waiting", {})
        );
        const forUpdater = resultOf(
          await run({ key: updater.key }, "waiting", {})
        );

        expect(forWriter.items).toEqual([
          expect.objectContaining({
            document: expect.objectContaining({
              scopeSlug: PAGES,
              entryId: id,
            }),
            part: null,
            stage: "writing",
          }),
        ]);
        expect(forWriter.meta).toMatchObject({ page: 1, limit: 20 });
        // Assigned to Kim, but the reader's key cannot take the stage's step, and the updater's
        // cannot read the document.
        expect(forReader.items).toEqual([]);
        expect(forUpdater.items).toEqual([]);
      });
    });

    describe("submit", () => {
      /** A page's shared part as a reader holds it now: what a submit says it saw. */
      async function seenPage(id: string, revision = 0) {
        return [
          {
            part: null,
            revision,
            version: await versionOf(app(), PAGES, id, null),
          },
        ];
      }

      it("submits for review as the key, the step taken from the part's stage", async () => {
        await boot(dialect);
        const id = await entry(app(), PAGES);
        const writer = await keyOf("writer", [
          ["read", PAGES],
          ["update", PAGES],
        ]);

        const result = resultOf(
          await run({ key: writer.key }, "submit", {
            document: { collection: PAGES, id },
            parts: [null],
            seen: await seenPage(id),
            comment: "  Ready for legal  ",
          })
        );

        expect(result).toMatchObject({
          step: "send",
          moved: [{ part: null, from: "writing", to: "legal" }],
        });
        expect((await stateOf(app(), partOf(PAGES, id, null)))?.stage).toBe(
          "legal"
        );
        const events = await workflowEvents(app(), PAGES, id);
        expect(events.at(-1)).toMatchObject({
          kind: "workflow-submit",
          actorKind: "apiKey",
          actorId: writer.id,
          note: "Ready for legal",
          payload: expect.objectContaining({ step: "send", ownerId: KIM }),
        });
        // A submit approves nothing: the part is not publishable where it went.
        const review = resultOf(
          await run({ key: writer.key }, "reviewState", {
            document: { collection: PAGES, id },
          })
        );
        expect(partNamed(review, null)).toMatchObject({
          stage: "legal",
          publishable: false,
          approval: null,
        });
      });

      it("submits with the submit step named", async () => {
        await boot(dialect);
        const id = await entry(app(), PAGES);
        const writer = await keyOf("writer", [
          ["read", PAGES],
          ["update", PAGES],
        ]);

        const result = resultOf(
          await run({ key: writer.key }, "submit", {
            document: { collection: PAGES, id },
            parts: [null],
            seen: await seenPage(id),
            comment: "Ready for legal",
            step: "send",
          })
        );

        expect(result).toMatchObject({
          step: "send",
          moved: [{ part: null, to: "legal" }],
        });
      });

      it("refuses a step that does not submit, an approval and a move alike, moving nothing", async () => {
        await boot(dialect);
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
        });
        const memo = await entry(app(), "memos");
        // A key that holds every step out of Legal check, so only the kind of step can refuse.
        const holder = await keyOf("holder", [
          ["read", PAGES],
          ["update", PAGES],
          ["sign-off", PAGES],
          ["read", "memos"],
          ["update", "memos"],
        ]);
        const before = await stateOf(app(), partOf(PAGES, id, null));
        const eventsBefore = (await workflowEvents(app(), PAGES, id)).length;

        const asSubmit = (document: Doc, step: string, seen: Doc[]) =>
          run({ key: holder.key }, "submit", {
            document,
            parts: [null],
            seen,
            comment: "Moving it on",
            step,
          });
        const page = { collection: PAGES, id };
        // `clear` approves, which a key may not do anyway; `park` is a move the key may take, so
        // it is refused only because it is not a submit.
        const clear = await asSubmit(page, "clear", await seenPage(id, 1));
        const park = await asSubmit(page, "park", await seenPage(id, 1));
        const handOver = await asSubmit(
          { collection: "memos", id: memo },
          "handOver",
          [
            {
              part: null,
              revision: 0,
              version: await versionOf(app(), "memos", memo, null),
            },
          ]
        );

        for (const refused of [clear, park, handOver]) {
          expect(refused.error).toMatchObject({
            status: 400,
            code: "WORKFLOW_STEP_NOT_SUBMIT",
          });
        }
        expect(park.error?.data).toEqual({ step: "park" });
        const after = await stateOf(app(), partOf(PAGES, id, null));
        expect(after?.stage).toBe("legal");
        expect(after?.revision).toBe(before?.revision);
        expect(await workflowEvents(app(), PAGES, id)).toHaveLength(
          eventsBefore
        );
        expect(
          (await stateOf(app(), partOf("memos", memo, null)))?.stage ?? "draft"
        ).toBe("draft");
      });

      it("refuses a submit with no step named from a stage no submit step leaves", async () => {
        await boot(dialect);
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "legal", {
          definitionHash: HASH,
        });
        const memo = await entry(app(), "memos");
        const holder = await keyOf("holder", [
          ["read", PAGES],
          ["update", PAGES],
          ["read", "memos"],
          ["update", "memos"],
        ]);

        const page = await run({ key: holder.key }, "submit", {
          document: { collection: PAGES, id },
          parts: [null],
          seen: await seenPage(id, 1),
          comment: "Again",
        });
        const memoAnswer = await run({ key: holder.key }, "submit", {
          document: { collection: "memos", id: memo },
          parts: [null],
          seen: [
            {
              part: null,
              revision: 0,
              version: await versionOf(app(), "memos", memo, null),
            },
          ],
          comment: "Over to you",
        });

        expect(page.error).toMatchObject({
          status: 409,
          code: "WORKFLOW_NO_SUBMIT_STEP",
          data: { part: null, stage: "legal" },
        });
        expect(memoAnswer.error).toMatchObject({
          status: 409,
          code: "WORKFLOW_NO_SUBMIT_STEP",
          data: { part: null, stage: "draft" },
        });
        expect((await stateOf(app(), partOf(PAGES, id, null)))?.revision).toBe(
          1
        );
      });

      it("holds a key to its own scope, not its owner's", async () => {
        await boot(dialect);
        const id = await entry(app(), PAGES);
        // Kim may update Pages; the key she minted may only read them.
        const reader = await keyOf("reader", [["read", PAGES]]);
        const input = {
          document: { collection: PAGES, id },
          parts: [null],
          seen: await seenPage(id),
          comment: "Ready for legal",
        };

        const refused = await run({ key: reader.key }, "submit", input);

        expect(refused.error).toEqual({
          status: 403,
          code: "FORBIDDEN",
          data: { reason: "no-permission", permission: "update-pages" },
        });
        expect(await stateOf(app(), partOf(PAGES, id, null))).toBeNull();
        expect(await workflowEvents(app(), PAGES, id)).toEqual([]);
        // The control: Kim, signed in, may submit the very same page.
        expect(
          resultOf(await run({ person: KIM }, "submit", input))
        ).toMatchObject({ step: "send" });
      });

      it("refuses a submit over a part that moved since it was seen", async () => {
        await boot(dialect);
        const id = await entry(app(), PAGES);
        await seedState(app(), partOf(PAGES, id, null), "writing", {
          definitionHash: HASH,
        });
        const writer = await keyOf("writer", [
          ["read", PAGES],
          ["update", PAGES],
        ]);

        const stale = await run({ key: writer.key }, "submit", {
          document: { collection: PAGES, id },
          parts: [null],
          seen: await seenPage(id, 0),
          comment: "Ready for legal",
        });

        expect(stale.error).toMatchObject({
          status: 409,
          code: "CONFLICT",
          data: expect.objectContaining({ reason: "stale" }),
        });
        expect(await stateOf(app(), partOf(PAGES, id, null))).toMatchObject({
          stage: "writing",
          revision: 1,
        });
      });

      it("answers a submit on a document the key may not read as not found, whatever the step", async () => {
        await boot(dialect);
        const id = await entry(app(), PAGES);
        const blind = await keyOf("blind", [
          ["update", PAGES],
          ["sign-off", PAGES],
        ]);

        const answers = [];
        for (const step of ["send", "clear", undefined]) {
          answers.push(
            await run({ key: blind.key }, "submit", {
              document: { collection: PAGES, id },
              parts: [null],
              seen: await seenPage(id),
              comment: "Ready for legal",
              ...(step === undefined ? {} : { step }),
            })
          );
        }

        // Never the refusal of a step that is not a submit: that would confirm the page exists.
        for (const answer of answers) {
          expect(answer.error).toMatchObject({
            status: 404,
            code: "NOT_FOUND",
          });
        }
        expect(await stateOf(app(), partOf(PAGES, id, null))).toBeNull();
      });

      it("submits a language only where the key may read the document in it", async () => {
        await boot(dialect);
        const id = await entry(app(), LETTERS);
        const writer = await keyOf("letters", [
          ["read", LETTERS],
          ["update", LETTERS],
        ]);
        const submit = async (part: string) =>
          run({ key: writer.key }, "submit", {
            document: { collection: LETTERS, id },
            parts: [part],
            seen: [
              {
                part,
                revision: 0,
                version: await versionOf(app(), LETTERS, id, part),
              },
            ],
            comment: "Ready for legal",
          });

        const spanish = await submit("es");
        const english = await submit("en");

        expect(spanish.error).toMatchObject({ status: 404, code: "NOT_FOUND" });
        expect(await stateOf(app(), partOf(LETTERS, id, "es"))).toBeNull();
        expect(resultOf(english)).toMatchObject({
          step: "send",
          moved: [{ part: "en", to: "legal" }],
        });
      });
    });
  }
);

/**
 * Calls a plugin makes outside a request, from the context it was handed: refusals that read no
 * dialect-specific SQL, so SQLite alone.
 */
describe("ctx.services.workflows outside a request (sqlite)", () => {
  /** Kim, as a plugin names a user it acts for. */
  const kim = { id: KIM } as NonNullable<ServiceOpts["user"]>;

  /** The plugin's own context, as its `init` received it. */
  const workflows = (): Workflows => {
    const ctx = captured.get(CAPTURE);
    if (!ctx) throw new Error("the capturing plugin was not initialised");
    return ctx.services.workflows;
  };

  /** What a call threw, or a failure naming what it answered instead. */
  async function thrown(call: () => Promise<unknown>): Promise<NextlyError> {
    try {
      const answered = await call();
      throw new Error(`answered instead: ${JSON.stringify(answered)}`);
    } catch (error) {
      if (NextlyError.is(error)) return error;
      throw error;
    }
  }

  /** A page, and a submit of its shared part as a reader holds it now. */
  async function pageAndSubmit() {
    const id = await entry(app(), PAGES);
    const input = {
      document: { collection: PAGES, id },
      parts: [null],
      seen: [
        {
          part: null,
          revision: 0,
          version: await versionOf(app(), PAGES, id, null),
        },
      ],
      comment: "Ready for legal",
    };
    return { id, input };
  }

  const actingAsItself: [string, ServiceOpts | undefined][] = [
    ["no options", undefined],
    ["the system", { as: "system" }],
    ["the system for Kim", { as: "system", user: kim }],
    ["the public", { as: "public" }],
  ];

  it.each(actingAsItself)(
    "refuses the plugin acting as %s, moving nothing",
    async (_who, opts) => {
      await boot("sqlite");
      const { id, input } = await pageAndSubmit();

      const refusals = [
        await thrown(() =>
          workflows().definitionOf({ collection: PAGES }, opts)
        ),
        await thrown(() =>
          workflows().reviewState({ document: { collection: PAGES, id } }, opts)
        ),
        await thrown(() => workflows().waiting({}, opts)),
        await thrown(() => workflows().submit(input, opts)),
      ];

      for (const refusal of refusals) {
        expect(refusal.code).toBe("AUTH_REQUIRED");
      }
      expect(await stateOf(app(), partOf(PAGES, id, null))).toBeNull();
    }
  );

  it("never takes a key from the plugin: a key's scope with no request behind it is refused", async () => {
    await boot("sqlite");
    const { id, input } = await pageAndSubmit();
    const opts: ServiceOpts = {
      as: "user",
      user: kim,
      authenticatedScope: apiKeyScope([
        { slug: "read-pages", action: "read", resource: PAGES },
        { slug: "update-pages", action: "update", resource: PAGES },
      ]),
    };

    const refused = await thrown(() => workflows().submit(input, opts));
    // Nor can the input name one.
    const named = await thrown(() =>
      workflows().submit(
        { ...input, apiKeyId: "some-key" } as Parameters<
          Workflows["submit"]
        >[0],
        { as: "user", user: kim }
      )
    );

    expect(refused.code).toBe("VALIDATION_ERROR");
    expect(JSON.stringify(refused.publicData)).toContain("API_KEY_ID_REQUIRED");
    expect(named.code).toBe("VALIDATION_ERROR");
    expect(await stateOf(app(), partOf(PAGES, id, null))).toBeNull();
  });

  it("acts for a person it names outside a request, as that person", async () => {
    await boot("sqlite");
    const { id, input } = await pageAndSubmit();

    const result = await workflows().submit(input, {
      as: "user",
      user: kim,
    });

    expect(result).toMatchObject({ step: "send" });
    expect((await workflowEvents(app(), PAGES, id)).at(-1)).toMatchObject({
      actorKind: "person",
      actorId: KIM,
    });
  });

  it.each([
    ["every part at once", { parts: "all" }],
    ["no part", { parts: [] }],
    ["nothing seen", { seen: [] }],
    ["a blank comment", { comment: "   " }],
    ["no comment", { comment: undefined }],
    ["a way past review", { withoutReview: { reason: "agent" } }],
    ["trust", { overrideAccess: true }],
  ])(
    "refuses a submit naming %s, moving nothing",
    async (_what, change: Doc) => {
      await boot("sqlite");
      const { id, input } = await pageAndSubmit();
      const changed = Object.fromEntries(
        Object.entries({ ...input, ...change }).filter(
          ([, value]) => value !== undefined
        )
      );

      // Malformed on purpose: what a plugin's untyped caller could hand the service, which
      // the service's own parse must refuse, so it goes in past the compile-time shape.
      const refused = await thrown(() =>
        workflows().submit(
          changed as unknown as Parameters<Workflows["submit"]>[0],
          {
            as: "user",
            user: kim,
          }
        )
      );

      expect(refused.code).toBe("VALIDATION_ERROR");
      expect(await stateOf(app(), partOf(PAGES, id, null))).toBeNull();
    }
  );

  it("offers reads and a submit, and no other way to move review state", async () => {
    await boot("sqlite");

    expect(Object.keys(workflows()).sort()).toEqual([
      "definitionOf",
      "reviewState",
      "submit",
      "waiting",
    ]);
  });
});
