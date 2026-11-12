/**
 * Every move of a part's stage, and every approval withdrawn, writes one `workflow.stage_changed`
 * event to the webhooks outbox in the move's own transaction, and the drain delivers it to a
 * subscribed endpoint after commit, on every configured dialect:
 * - a step;
 * - an edit that withdraws an approval, including one that leaves the part where it was;
 * - a boot with a changed definition;
 * - a deploy that renames a stage, one that redirects a removed stage, and one that detaches;
 * - a discard of a working draft;
 * - the recovery command that moves stranded parts.
 *
 * Each is observed on the outbox row (its type, its payload with the definition hash, its actor)
 * and on what the drain sends to the endpoint. A move that rolls back records nothing.
 */
import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import { clearServices } from "../../../di/register";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { webhookTables } from "../../../schemas/webhooks";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { DeliverTransport } from "../../webhooks/deliver";
import { runWebhookDrain } from "../../webhooks/drain-runner";
import { WebhookEndpointRegistry } from "../../webhooks/endpoint-registry";
import { refreshEndpointPresence } from "../../webhooks/recording-activation";
import { defineWorkflow } from "../define-workflow";
import { workflowDefinitionHash } from "../hash";
import { recordStageChanged } from "../stage-changed";
import { takeWorkflowStep, type WorkflowCaller } from "../steps";
import { moveStrandedReviewStates } from "../stranded-stages";
import type { Workflow } from "../types";

import {
  entry,
  partOf,
  person,
  seedState,
  shownVersion,
  stateOf,
  versionOf,
} from "./helpers/step-harness";

/** Draft → Review → OK, with a stage to park in (Hold) and one to shelve in (Archive). */
const desk = defineWorkflow({
  slug: "desk",
  label: "Desk",
  stages: [
    { name: "draft", label: "Draft" },
    { name: "review", label: "Review" },
    { name: "hold", label: "On hold" },
    { name: "archive", label: "Archive" },
    { name: "ok", label: "OK", allowsPublish: true },
  ],
  steps: [
    {
      name: "submit",
      label: "Submit",
      kind: "submit",
      from: "draft",
      to: "review",
      primary: true,
    },
    { name: "park", label: "Park", kind: "move", from: "review", to: "hold" },
    {
      name: "resume",
      label: "Resume",
      kind: "move",
      from: "hold",
      to: "review",
    },
    {
      name: "shelve",
      label: "Shelve",
      kind: "move",
      from: "review",
      to: "archive",
    },
    {
      name: "unshelve",
      label: "Unshelve",
      kind: "move",
      from: "archive",
      to: "draft",
    },
    {
      name: "approve",
      label: "Approve",
      kind: "approve",
      from: "review",
      to: "ok",
      primary: true,
    },
    {
      name: "sendBack",
      label: "Send back",
      kind: "request-changes",
      from: ["review", "ok"],
      to: "draft",
    },
  ],
});

/** The desk with On hold renamed to Paused, and nothing else changed. */
const deskRenamed = defineWorkflow({
  slug: "desk",
  label: "Desk",
  stages: desk.stages.map(stage =>
    stage.name === "hold"
      ? { ...stage, name: "paused", label: "Paused", renamedFrom: "hold" }
      : stage
  ),
  steps: desk.steps.map(step => ({
    ...step,
    permission: step.permission ?? undefined,
    from: step.from.map(stage => (stage === "hold" ? "paused" : stage)),
    to: step.to === "hold" ? "paused" : step.to,
  })),
});

/** The desk redrawn: On hold removed with its parts sent to Draft, Archive removed unmapped. */
const deskRedrawn = defineWorkflow({
  slug: "desk",
  label: "Desk",
  stages: [
    { name: "draft", label: "Draft" },
    { name: "review", label: "Review" },
    { name: "ok", label: "OK", allowsPublish: true },
  ],
  steps: [
    {
      name: "submit",
      label: "Submit",
      kind: "submit",
      from: "draft",
      to: "review",
    },
    {
      name: "approve",
      label: "Approve",
      kind: "approve",
      from: "review",
      to: "ok",
      primary: true,
    },
    {
      name: "sendBack",
      label: "Send back",
      kind: "request-changes",
      from: ["review", "ok"],
      to: "draft",
    },
  ],
  removedStages: { hold: "draft" },
});

const DESK = workflowDefinitionHash(desk);
const drafts = { status: true, versions: { drafts: true } } as const;
const STAGE_CHANGED = "workflow.stage_changed";

let t: TestNextly | undefined;
/** What the endpoint has been sent so far in the case, across drains. */
let sentSoFar: Record<string, unknown>[] = [];

afterEach(async () => {
  await t?.destroy();
  t = undefined;
  sentSoFar = [];
});

const app = (): TestNextly => {
  if (!t) throw new Error("not booted");
  return t;
};

/**
 * Boots Posts (translated, English and Spanish) and Pages, each on the workflow given (none
 * detaches it), on `adapter` when given, as a deploy over the same database does.
 */
async function boot(
  dialect: TestDialect,
  options: {
    posts?: Workflow | null;
    pages?: Workflow | null;
    adapter?: TestNextly["adapter"];
  } = {}
): Promise<TestNextly> {
  const posts = options.posts === undefined ? desk : options.posts;
  const pages = options.pages === undefined ? desk : options.pages;
  t = await createTestNextly({
    ...(options.adapter ? { adapter: options.adapter } : { dialect }),
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        ...drafts,
        ...(posts ? { workflow: posts } : {}),
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "code", localized: false }),
        ],
      }),
      defineCollection({
        slug: "pages",
        ...drafts,
        ...(pages ? { workflow: pages } : {}),
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return t;
}

/** Boots again on the same database, as a deploy does. */
async function redeploy(
  dialect: TestDialect,
  options: { posts?: Workflow | null; pages?: Workflow | null }
): Promise<TestNextly> {
  const adapter = app().adapter;
  clearServices();
  return boot(dialect, { ...options, adapter });
}

/**
 * An enabled endpoint subscribed to `workflow.stage_changed` alone, stored as the endpoint
 * service stores one, with the recording gate told an endpoint now exists.
 */
async function subscribe(): Promise<void> {
  const { nextlyWebhooks } = webhookTables(app().adapter.dialect);
  const db = app().adapter.getDrizzle() as unknown as {
    insert(table: unknown): { values(row: unknown): Promise<unknown> };
  };
  const now = new Date();
  await db.insert(nextlyWebhooks).values({
    id: "wh-moves",
    name: "Moves",
    url: "https://example.test/moves",
    enabled: true,
    eventTypes: [STAGE_CHANGED],
    filter: null,
    headers: null,
    secretHash: [`whsec_${Buffer.from("moves").toString("base64")}`],
    secretPrefix: "whsec_",
    fieldAllowlist: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  });
  await refreshEndpointPresence();
}

/** An outbox envelope, read from a driver that answers JSON as text or as an object. */
function envelopeOf(payload: unknown): Record<string, unknown> {
  return typeof payload === "string"
    ? (JSON.parse(payload) as Record<string, unknown>)
    : (payload as Record<string, unknown>);
}

/** The `workflow.stage_changed` rows in the outbox: their actor columns and envelopes. */
async function outbox() {
  const rows = await app().adapter.select<{ type: string; payload: unknown }>(
    "nextly_events"
  );
  return rows
    .filter(row => row.type === STAGE_CHANGED)
    .map(row => envelopeOf(row.payload));
}

/** Drains the outbox once, answering what the endpoint was sent. */
async function delivered(): Promise<Record<string, unknown>[]> {
  const bodies: Record<string, unknown>[] = [];
  const transport: DeliverTransport = (_url, options) => {
    bodies.push(JSON.parse(options.body) as Record<string, unknown>);
    return Promise.resolve(new Response("ok", { status: 200 }));
  };
  await runWebhookDrain(
    app().adapter,
    new WebhookEndpointRegistry(app().adapter),
    { transport, decryptSecret: ciphertext => ciphertext }
  );
  return bodies.filter(body => body.type === STAGE_CHANGED);
}

/**
 * Asserts the outbox holds exactly `expected`, each as one `workflow.stage_changed` event, and
 * that a drain after commit delivers each event once: those not delivered by an earlier drain.
 */
async function expectStageChanged(
  expected: Array<{
    resource: Record<string, unknown>;
    data: Record<string, unknown>;
    actor?: Record<string, unknown>;
  }>
): Promise<void> {
  const recorded = await outbox();
  expect(recorded).toEqual(
    expected.map(each =>
      expect.objectContaining({ type: STAGE_CHANGED, ...each })
    )
  );
  sentSoFar = [...sentSoFar, ...(await delivered())];
  expect(sentSoFar.map(body => body.id).sort()).toEqual(
    recorded.map(envelope => envelope.id).sort()
  );
  expect(sentSoFar).toEqual(
    expect.arrayContaining(
      expected.map(each => expect.objectContaining({ data: each.data }))
    )
  );
}

const handlerOf = (n: TestNextly) =>
  n.getService("collectionsHandler") as CollectionsHandler;

/** Saves `data` as trusted code's ordinary save. */
async function save(
  slug: string,
  entryId: string,
  data: Record<string, unknown>,
  locale?: string
): Promise<void> {
  const result = await handlerOf(app()).updateEntry(
    {
      collectionName: slug,
      entryId,
      overrideAccess: true,
      ...(locale ? { locale } : {}),
    },
    // An update names its version or says it overwrites; this one read none.
    { ...data, _overwrite: true }
  );
  // A refused save fails the test rather than leaving the document as it was.
  if (!result.success) {
    throw new Error(`save refused: ${result.statusCode} ${result.message}`);
  }
}

/**
 * Takes `name` on `parts` with a comment (a request for changes needs one), as a caller that read
 * each part `seenAs` (default: as it is now).
 */
async function take(
  slug: string,
  entryId: string,
  parts: (string | null)[],
  name: string,
  caller: WorkflowCaller,
  seenAs: (part: string | null) => Promise<string> = part =>
    versionOf(app(), slug, entryId, part)
) {
  const seen = [];
  for (const part of parts) {
    const state = await stateOf(app(), partOf(slug, entryId, part));
    seen.push({
      part,
      revision: state?.revision ?? 0,
      version: await seenAs(part),
    });
  }
  return takeWorkflowStep(app().adapter, {
    document: { scopeKind: "collection", scopeSlug: slug, entryId },
    step: name,
    parts,
    seen,
    comment: "Checked",
    caller,
  });
}

/** An approval of the part's newest recorded version, whose digest no content matches. */
async function approvalOf(slug: string, entryId: string, part: string | null) {
  return {
    versionNo: await shownVersion(app(), slug, entryId, part),
    digest: "seeded",
    by: "bob",
    at: new Date("2026-11-02T10:00:00.000Z"),
  };
}

const document = (slug: string, id: string) => ({
  kind: "collection",
  slug,
  id,
});

describe.each(getConfiguredTestDialects())(
  "every workflow move reaches the webhooks outbox (%s)",
  dialect => {
    it("a step records one event per part moved, as the person who took it", async () => {
      await boot(dialect);
      await subscribe();
      const dave = await person(app(), "dave", [["update", "posts"]]);
      const post = await entry(app(), "posts");

      await take("posts", post, ["en"], "submit", dave);

      await expectStageChanged([
        {
          resource: {
            kind: "entry",
            collection: "posts",
            id: post,
            locale: "en",
          },
          data: {
            document: document("posts", post),
            part: "en",
            from: "draft",
            to: "review",
            cause: "step",
            approvalWithdrawn: false,
            definitionHash: DESK,
          },
          actor: { type: "user", id: "dave" },
        },
      ]);
    });

    it("a step out of a stage that allows publishing records the approval it withdraws", async () => {
      await boot(dialect);
      await subscribe();
      const dave = await person(app(), "dave", [["update", "pages"]]);
      const page = await entry(app(), "pages");
      await seedState(app(), partOf("pages", page, null), "ok", {
        definitionHash: DESK,
        approval: await approvalOf("pages", page, null),
      });

      await take("pages", page, [null], "sendBack", dave);

      await expectStageChanged([
        {
          resource: { kind: "entry", collection: "pages", id: page },
          data: {
            document: document("pages", page),
            part: null,
            from: "ok",
            to: "draft",
            cause: "step",
            approvalWithdrawn: true,
            definitionHash: DESK,
          },
          actor: { type: "user", id: "dave" },
        },
      ]);
    });

    it("a step that rolls back records nothing", async () => {
      await boot(dialect);
      await subscribe();
      const dave = await person(app(), "dave", [["update", "posts"]]);
      const post = await entry(app(), "posts");

      // Spanish was seen at a version it no longer has, so the step moves English first, then
      // refuses, and the whole move rolls back.
      await expect(
        take("posts", post, ["en", "es"], "submit", dave, async part =>
          part === "es" ? "stale" : versionOf(app(), "posts", post, part)
        )
      ).rejects.toThrow();

      expect(await stateOf(app(), partOf("posts", post, "en"))).toBeNull();
      expect(await outbox()).toEqual([]);
    });

    it("an event written in a transaction that rolls back is not kept", async () => {
      await boot(dialect);
      await subscribe();
      const change = {
        document: {
          scopeKind: "collection" as const,
          scopeSlug: "pages",
          entryId: "p-1",
        },
        part: null,
        from: "review",
        to: "draft",
        cause: "step" as const,
        approvalWithdrawn: false,
        definitionHash: DESK,
        actor: { type: "system" as const },
      };

      await expect(
        app().adapter.transaction(async tx => {
          await recordStageChanged(tx, change);
          throw new Error("rolled back after the event");
        })
      ).rejects.toThrow("rolled back after the event");
      expect(await outbox()).toEqual([]);

      // The same write in a transaction that commits is kept: the event is the transaction's.
      await app().adapter.transaction(tx => recordStageChanged(tx, change));
      expect(await outbox()).toHaveLength(1);
    });

    it("an edit that withdraws an approval records it, also where the part stays in its stage", async () => {
      await boot(dialect);
      await subscribe();
      const post = await entry(app(), "posts");
      const page = await entry(app(), "pages");
      await seedState(app(), partOf("posts", post, "en"), "ok", {
        definitionHash: DESK,
        approval: await approvalOf("posts", post, "en"),
      });
      // An approval held in the stage an edit returns a part to: withdrawn with no move.
      await seedState(app(), partOf("pages", page, null), "review", {
        definitionHash: DESK,
        approval: await approvalOf("pages", page, null),
      });

      await save("posts", post, { title: "Edited" }, "en");
      await save("pages", page, { title: "Edited" });

      await expectStageChanged([
        {
          resource: {
            kind: "entry",
            collection: "posts",
            id: post,
            locale: "en",
          },
          data: {
            document: document("posts", post),
            part: "en",
            from: "ok",
            to: "review",
            cause: "edit",
            approvalWithdrawn: true,
            definitionHash: DESK,
          },
        },
        {
          resource: { kind: "entry", collection: "pages", id: page },
          data: {
            document: document("pages", page),
            part: null,
            from: "review",
            to: "review",
            cause: "edit",
            approvalWithdrawn: true,
            definitionHash: DESK,
          },
        },
      ]);
    });

    // SQLite only: a deploy boots again on the same database, and the test harness releases a
    // server-backed database when the next instance boots, so the second boot would find it gone.
    // What a deploy records goes through the same outbox writer on every dialect.
    it.skipIf(dialect !== "sqlite")(
      "a boot with a changed definition records each approval it withdraws, as the system",
      async () => {
        await boot(dialect);
        await subscribe();
        const page = await entry(app(), "pages");
        await seedState(app(), partOf("pages", page, null), "ok", {
          definitionHash: "an-earlier-definition",
          approval: await approvalOf("pages", page, null),
        });

        await redeploy(dialect, {});

        await expectStageChanged([
          {
            resource: { kind: "entry", collection: "pages", id: page },
            data: {
              document: document("pages", page),
              part: null,
              from: "ok",
              to: "draft",
              cause: "definition",
              approvalWithdrawn: true,
              definitionHash: DESK,
            },
            actor: { type: "system" },
          },
        ]);
      }
    );

    it.skipIf(dialect !== "sqlite")(
      "a deploy that renames a stage records each part it follows, keeping its approval",
      async () => {
        await boot(dialect);
        await subscribe();
        const page = await entry(app(), "pages");
        await seedState(app(), partOf("pages", page, null), "hold", {
          definitionHash: DESK,
        });

        await redeploy(dialect, { posts: deskRenamed, pages: deskRenamed });

        await expectStageChanged([
          {
            resource: { kind: "entry", collection: "pages", id: page },
            data: {
              document: document("pages", page),
              part: null,
              from: "hold",
              to: "paused",
              cause: "rename",
              approvalWithdrawn: false,
              definitionHash: workflowDefinitionHash(deskRenamed),
            },
            actor: { type: "system" },
          },
        ]);
      }
    );

    it.skipIf(dialect !== "sqlite")(
      "a deploy that redirects a removed stage, and the recovery command, record each part moved",
      async () => {
        await boot(dialect);
        await subscribe();
        const held = await entry(app(), "pages");
        const shelved = await entry(app(), "pages");
        await seedState(app(), partOf("pages", held, null), "hold", {
          definitionHash: DESK,
          approval: await approvalOf("pages", held, null),
        });
        await seedState(app(), partOf("pages", shelved, null), "archive", {
          definitionHash: DESK,
        });
        const now = workflowDefinitionHash(deskRedrawn);

        await redeploy(dialect, { posts: deskRedrawn, pages: deskRedrawn });

        const redirected = {
          resource: { kind: "entry", collection: "pages", id: held },
          data: {
            document: document("pages", held),
            part: null,
            from: "hold",
            to: "draft",
            cause: "redirect",
            approvalWithdrawn: true,
            definitionHash: now,
          },
          actor: { type: "system" },
        };
        await expectStageChanged([redirected]);

        await person(app(), "ops", []);
        await moveStrandedReviewStates(app().adapter, {
          to: "draft",
          as: "ops@example.test",
          comment: "Back to work",
        });

        await expectStageChanged([
          redirected,
          {
            resource: { kind: "entry", collection: "pages", id: shelved },
            data: {
              document: document("pages", shelved),
              part: null,
              from: "archive",
              to: "draft",
              cause: "recovery",
              approvalWithdrawn: false,
              definitionHash: now,
            },
            actor: { type: "user", id: "ops" },
          },
        ]);
      }
    );

    it.skipIf(dialect !== "sqlite")(
      "a deploy that detaches a workflow records each part whose review state it removes",
      async () => {
        await boot(dialect);
        await subscribe();
        const page = await entry(app(), "pages");
        await seedState(app(), partOf("pages", page, null), "ok", {
          definitionHash: DESK,
          approval: await approvalOf("pages", page, null),
        });

        await redeploy(dialect, { pages: null });

        await expectStageChanged([
          {
            resource: { kind: "entry", collection: "pages", id: page },
            data: {
              document: document("pages", page),
              part: null,
              from: "ok",
              to: null,
              cause: "detach",
              approvalWithdrawn: true,
              definitionHash: DESK,
            },
            actor: { type: "system" },
          },
        ]);
      }
    );

    it("a discard records each part whose review it closes, as the person who discarded", async () => {
      await boot(dialect);
      await subscribe();
      const page = await entry(app(), "pages");
      await save("pages", page, { status: "published" });
      await save("pages", page, { title: "Pending" });
      await seedState(app(), partOf("pages", page, null), "review", {
        definitionHash: DESK,
      });

      await handlerOf(app()).discardWorkingDraftCounted({
        collectionName: "pages",
        // A discard names the version it read or says it overwrites; this one read none.
        version: { _overwrite: true },
        entryId: page,
        actor: { type: "user", id: "dave" },
        user: { id: "dave", name: "Dave" },
      });

      await expectStageChanged([
        {
          resource: { kind: "entry", collection: "pages", id: page },
          data: {
            document: document("pages", page),
            part: null,
            from: "review",
            to: null,
            cause: "discard",
            approvalWithdrawn: false,
            definitionHash: DESK,
          },
          actor: { type: "user", id: "dave" },
        },
      ]);
    });
  }
);
