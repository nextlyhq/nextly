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
  versionOf,
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

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
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
const KIM_GRANTS: Grant[] = [PAGES, "posts", LETTERS, "banner"].flatMap(
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
  current = await bootSteps(dialect, [agentPlugin], { tablePrefix: "pws_" });
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
  }
);
