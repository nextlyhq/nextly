/**
 * Nothing becomes public past the workflow, on every configured dialect.
 *
 * Under a workflow, a part goes live only from a stage that allows publishing with a current
 * approval, whichever door asks: a REST publish of chosen parts, a save carrying a status (one
 * language or every one), publishing every language, creating as published, an update by ids or
 * by query, and the Direct API's publish, update and create, trusted calls included. The same
 * document, approved, goes live through each of those doors. A status the collection does not
 * know is refused where a workflow is attached, and stored but never served elsewhere. A publish
 * closes the part's review cycle, so the next edit starts at the stage named for after publishing.
 * "Publish without review" lets a person who holds it, with a reason, and records the reason; a
 * person without it, a request with no reason, an API key and trusted code with no reason are
 * refused. Taking content down is never held, and a visitor reads only what was published, in
 * every stage.
 *
 * Every caller here may publish the collection: the plausible broken implementation checks only
 * that permission, and each refusal below is one it lets through. Each refusal is observed as a
 * visitor would see it (nothing live, or the earlier live values), not only as an error.
 */

// Set before the harness boots (env validation reads it once), so a session can be signed.
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { apiKeyScope } from "../../../auth/authenticated-scope";
import { buildClaims } from "../../../auth/jwt/claims";
import { signAccessToken } from "../../../auth/jwt/sign";
import { defineCollection, defineSingle, text } from "../../../config";
import { wrapCollectionsForPlugin } from "../../../plugins/service-opts";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { container } from "../../../di/container";
import { createDynamicHandlers } from "../../../routeHandler";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { ContentEventsRepository } from "../../content-events/repository";
import type { ApiKeyService } from "../../auth/services/api-key-service";
import type { CollectionService } from "../../collections/services/collection-service";
import type { PublishGate } from "../../collections/services/publish-gate";
import { WITHOUT_REVIEW_KEY } from "../../collections/services/save-door-gate";
import {
  ANY_EDITABLE_STATE,
  lockServerOf,
  scheduleAsItStands,
} from "../../releases/__tests__/helpers/release-writes";
import { applyDueReleases } from "../../releases/apply-due-releases";
import { createReleaseMutations } from "../../releases/release-mutations";
import { ReleasesRepository } from "../../releases/releases-repository";
import { draftsKeptByPart } from "../../versions/part-drafts";
import { defineWorkflow } from "../define-workflow";
import { workflowDefinitionHash } from "../hash";
import { takeWorkflowStep, type WorkflowCaller } from "../steps";

import {
  partOf,
  person,
  seedState,
  stateOf,
  versionOf,
} from "./helpers/step-harness";

/** Draft → Review → Approved, which allows publishing. The next draft after a publish: Draft. */
const gated = defineWorkflow({
  slug: "gated",
  label: "Gated",
  stages: [
    { name: "draft", label: "Draft" },
    { name: "review", label: "Review" },
    { name: "approved", label: "Approved", allowsPublish: true },
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
    {
      name: "approve",
      label: "Approve",
      kind: "approve",
      from: "review",
      to: "approved",
      permission: "sign-off",
      primary: true,
    },
    {
      name: "sendBack",
      label: "Send back",
      kind: "request-changes",
      from: ["review", "approved"],
      to: "draft",
      permission: "sign-off",
    },
  ],
});

/** Table names of this file's own, so files sharing these slugs never share a table. */
const PAGES = "pw_pages";
const POSTS = "pw_posts";
const LOOSE = "pw_loose";
const BANNER = "pw_banner";
const NOTICE = "pw_notice";
const HOOKED = "pw_hooked";

/** How many times Hooked's hooks ran, so a create the gate holds back can be seen to run none. */
const hookCalls = { count: 0 };
const drafts = { status: true, versions: { drafts: true } } as const;
/** Visitors may read whatever is published, so a visitor's read shows what went live. */
const visitorsRead = { access: { read: () => true } } as const;

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

/**
 * Pages (one shared part) and Posts (English and Spanish, with a shared code) on `gated`, Loose
 * with no workflow, and on `gated` the Banner Single and the Notice Single (English and Spanish,
 * with a shared code).
 */
async function boot(
  dialect: TestDialect,
  options: { perLanguageStorage?: boolean } = {}
): Promise<TestNextly> {
  current = await createTestNextly({
    dialect,
    // Drafts kept by part where a case asks for it; off, as the site default is, otherwise.
    perLanguageStorage: options.perLanguageStorage === true,
    // A visitor's read is judged by the Public role a real boot makes, which reads these
    // collections by their rule.
    seedPublic: true,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    collections: [
      defineCollection({
        slug: PAGES,
        ...drafts,
        ...visitorsRead,
        workflow: gated,
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: POSTS,
        localized: true,
        ...drafts,
        ...visitorsRead,
        workflow: gated,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "code", localized: false }),
        ],
      }),
      defineCollection({
        slug: HOOKED,
        ...drafts,
        ...visitorsRead,
        workflow: gated,
        fields: [text({ name: "title" })],
        hooks: {
          beforeOperation: [
            () => {
              hookCalls.count += 1;
            },
          ],
          beforeChange: [
            () => {
              hookCalls.count += 1;
            },
          ],
        },
      }),
      defineCollection({
        slug: LOOSE,
        ...drafts,
        ...visitorsRead,
        fields: [text({ name: "title" })],
      }),
    ],
    singles: [
      defineSingle({
        slug: BANNER,
        ...drafts,
        ...visitorsRead,
        workflow: gated,
        fields: [text({ name: "title" })],
      }),
      defineSingle({
        slug: NOTICE,
        localized: true,
        ...drafts,
        ...visitorsRead,
        workflow: gated,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "code", localized: false }),
        ],
      }),
    ],
  });
  // A PostgreSQL or MySQL leg that silently booted SQLite would prove nothing about it.
  expect(current.adapter.dialect).toBe(dialect);
  return current;
}

const handlerOf = (t: TestNextly) =>
  t.getService("collectionsHandler") as CollectionsHandler;

/** A never-published document of `slug`, stored as a draft by trusted code. */
async function draftOf(slug: string, data: Doc = { title: "First" }) {
  const created = await handlerOf(app()).createEntry(
    { collectionName: slug, overrideAccess: true },
    data
  );
  const id = (created.data as Doc | undefined)?.id;
  if (typeof id !== "string") throw new Error(`no id from create on ${slug}`);
  return id;
}

/** Saves `data` over a document, trusted, in `locale` when given. */
async function save(slug: string, id: string, data: Doc, locale?: string) {
  const result = await handlerOf(app()).updateEntry(
    {
      collectionName: slug,
      entryId: id,
      overrideAccess: true,
      ...(locale ? { locale } : {}),
    },
    { ...data, _overwrite: true }
  );
  if (!result.success) {
    throw new Error(`save refused: ${result.statusCode} ${result.message}`);
  }
}

/** Takes `step` on one part of a collection's document, as a caller that just read it. */
async function take(
  slug: string,
  id: string,
  part: string | null,
  step: string,
  caller: WorkflowCaller
) {
  const state = await stateOf(app(), partOf(slug, id, part));
  return takeWorkflowStep(app().adapter, {
    document: { scopeKind: "collection", scopeSlug: slug, entryId: id },
    step,
    parts: [part],
    seen: [
      {
        part,
        revision: state?.revision ?? 0,
        version: await versionOf(app(), slug, id, part),
      },
    ],
    caller,
  });
}

/** People are made once per boot; the approver signs off on both collections and both Singles. */
let approver: WorkflowCaller | undefined;
async function approverOf(): Promise<WorkflowCaller> {
  if (approver) return approver;
  const rita = await person(app(), "rita", [
    ["sign-off", PAGES],
    ["sign-off", POSTS],
    ["sign-off", BANNER],
    ["sign-off", NOTICE],
  ]);
  approver = rita;
  return rita;
}

/** Submits and approves each of `parts` (null: the shared part) of a collection's document. */
async function approve(slug: string, id: string, parts: (string | null)[]) {
  const rita = await approverOf();
  for (const part of parts) {
    await take(slug, id, part, "submit", { kind: "system" });
    await take(slug, id, part, "approve", rita);
  }
}

/**
 * The document as a visitor reads it: its live values in `locale`, or null where nothing is live.
 */
async function visitorRead(
  slug: string,
  id: string,
  locale?: string
): Promise<Doc | null> {
  try {
    return (await app().nextly.findByID({
      collection: slug as never,
      id,
      overrideAccess: false,
      ...(locale ? { locale } : {}),
    } as never)) as Doc | null;
  } catch (error) {
    // Nothing live reads as not found. Any other failure is the read breaking, which must not
    // pass for "nothing went live".
    if ((error as { code?: unknown }).code === "NOT_FOUND") return null;
    throw error;
  }
}

/** The status the database holds for a document, as the row stores it. */
async function storedStatus(slug: string, id: string): Promise<unknown> {
  const doc = (await app().nextly.findByID({
    collection: slug as never,
    id,
    overrideAccess: true,
    status: "all",
  } as never)) as Doc | null;
  return doc?.status;
}

/** Everything the document's history records, as one string to search. */
async function historyText(slug: string, id: string): Promise<string> {
  const repo = new ContentEventsRepository(app().adapter, {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  });
  const { items } = await repo.listForSubject(
    { kind: "collection", slug, id },
    { limit: 100 }
  );
  return JSON.stringify(items);
}

/** A signed-in person's session, as a browser sends it. */
async function sessionOf(userId: string): Promise<Record<string, string>> {
  const token = await signAccessToken(
    buildClaims({
      userId,
      email: `${userId}@example.test`,
      name: userId,
      image: null,
      roleIds: [],
      sessionEpoch: 0,
    }),
    process.env.NEXTLY_SECRET!
  );
  return { cookie: `nextly_session=${token}` };
}

interface Answer {
  status: number;
  json: Doc;
}

/** One REST request, through the route handlers an app mounts. */
async function rest(
  method: "POST" | "PATCH",
  path: string[],
  headers: Record<string, string>,
  body: unknown,
  query = ""
): Promise<Answer> {
  const handlers = createDynamicHandlers();
  const request = new Request(
    `http://localhost/api/${path.join("/")}${query}`,
    {
      method,
      headers: {
        ...headers,
        origin: "http://localhost",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }
  );
  const context = { params: Promise.resolve({ params: path }) };
  const response =
    method === "POST"
      ? await handlers.POST(request, context)
      : await handlers.PATCH(request, context);
  const text = await response.text();
  return {
    status: response.status,
    json: text === "" ? {} : (JSON.parse(text) as Doc),
  };
}

/**
 * Someone who may read, edit and publish Pages, Posts and both Singles, and nothing about review:
 * whom a check of the publish permission alone lets through.
 */
async function publisher(id = "paula"): Promise<Record<string, string>> {
  await person(app(), id, [
    ...[PAGES, POSTS, LOOSE, BANNER, NOTICE].flatMap(
      slug =>
        [
          ["read", slug],
          ["update", slug],
          ["create", slug],
          ["publish", slug],
          ["unpublish", slug],
        ] as const
    ),
  ]);
  return sessionOf(id);
}

/** Saves `data` over a Single's document, trusted, in `locale` when given: its id. */
async function saveSingle(
  slug: string,
  data: Doc,
  locale?: string
): Promise<string> {
  await app().nextly.updateSingle({
    slug: slug as never,
    data: { ...data, _overwrite: true },
    ...(locale ? { locale } : {}),
  } as never);
  const doc = (await app().nextly.findSingle({
    slug: slug as never,
    status: "all",
  } as never)) as Doc;
  if (typeof doc.id !== "string") throw new Error(`no id on ${slug}`);
  return doc.id;
}

/** Submits and approves each of `parts` (null: the shared part) of a Single's document. */
async function approveSingle(
  slug: string,
  id: string,
  parts: (string | null)[]
) {
  const rita = await approverOf();
  for (const part of parts) {
    for (const [step, caller] of [
      ["submit", { kind: "system" }],
      ["approve", rita],
    ] as const) {
      const state = await stateOf(app(), {
        scopeKind: "single",
        scopeSlug: slug,
        entryId: id,
        part,
      });
      const doc = (await app().nextly.findSingle({
        slug: slug as never,
        status: "all",
        ...(part !== null ? { locale: part } : {}),
      } as never)) as Doc;
      await takeWorkflowStep(app().adapter, {
        document: { scopeKind: "single", scopeSlug: slug, entryId: id },
        step,
        parts: [part],
        seen: [
          {
            part,
            revision: state?.revision ?? 0,
            version: String(doc._rev),
          },
        ],
        caller,
      });
    }
  }
}

/** A Single as a visitor reads it in `locale`, or null where nothing of it is live. */
const liveSingle = async (slug: string, locale?: string) =>
  (await app()
    .nextly.findSingle({
      slug: slug as never,
      overrideAccess: false,
      ...(locale ? { locale } : {}),
    } as never)
    .catch(() => null)) as Doc | null;

/** Whether a call was refused: a thrown error, or a REST answer outside 2xx. */
async function refusedBy(call: () => Promise<unknown>): Promise<boolean> {
  try {
    const answer = await call();
    if (
      answer !== null &&
      typeof answer === "object" &&
      "status" in answer &&
      typeof (answer as Answer).status === "number"
    ) {
      return (answer as Answer).status >= 400;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * A door that publishes an existing Page, and the language a visitor reads it in. Each takes the
 * document's id and the session of a person who may publish Pages and Posts.
 */
interface Door {
  name: string;
  slug: string;
  /** The parts the door publishes, as `approve` names them. */
  parts: (string | null)[];
  publish(id: string, session: Record<string, string>): Promise<unknown>;
}

const DOORS: Door[] = [
  {
    name: "REST publish of chosen parts",
    slug: PAGES,
    parts: [null],
    publish: (id, session) =>
      rest("POST", ["collections", PAGES, "entries", id, "publish"], session, {
        locales: "all",
        _overwrite: true,
      }),
  },
  {
    name: "REST save carrying a status",
    slug: PAGES,
    parts: [null],
    publish: (id, session) =>
      rest("PATCH", ["collections", PAGES, "entries", id], session, {
        status: "published",
        _overwrite: true,
      }),
  },
  {
    name: "REST save carrying a status in every language",
    slug: POSTS,
    parts: ["en", "es", null],
    publish: (id, session) =>
      rest(
        "PATCH",
        ["collections", POSTS, "entries", id],
        session,
        { status: "published", _overwrite: true },
        "?locale=*"
      ),
  },
  {
    name: "REST publish of every language",
    slug: POSTS,
    parts: ["en", "es", null],
    publish: (id, session) =>
      rest(
        "POST",
        ["collections", POSTS, "entries", id, "publish-all"],
        session,
        { _overwrite: true }
      ),
  },
  {
    name: "REST update by ids",
    slug: PAGES,
    parts: [null],
    publish: async (id, session) => {
      const answer = await rest(
        "POST",
        ["collections", PAGES, "entries", "bulk-update"],
        session,
        { ids: [id], data: { status: "published", _overwrite: true } }
      );
      // A bulk update answers 200 and names each refused row; a refusal is the row named.
      const refusedRows = (answer.json.errors as Doc[] | undefined) ?? [];
      return refusedRows.some(row => row.id === id)
        ? { status: 409, json: answer.json }
        : answer;
    },
  },
  {
    name: "REST update by query",
    slug: PAGES,
    parts: [null],
    publish: async (id, session) => {
      const answer = await rest(
        "PATCH",
        ["collections", PAGES, "entries"],
        session,
        {
          where: { id: { equals: id } },
          data: { status: "published", _overwrite: true },
        }
      );
      const refusedRows = (answer.json.errors as Doc[] | undefined) ?? [];
      return refusedRows.some(row => row.id === id)
        ? { status: 409, json: answer.json }
        : answer;
    },
  },
  {
    name: "Direct API publish, trusted",
    slug: PAGES,
    parts: [null],
    publish: id =>
      app().nextly.publish({
        collection: PAGES as never,
        id,
        locales: "all",
        data: { _overwrite: true },
      }),
  },
  {
    name: "Direct API update carrying a status, trusted",
    slug: PAGES,
    parts: [null],
    publish: id =>
      app().nextly.update({
        collection: PAGES as never,
        id,
        data: { status: "published", _overwrite: true },
      } as never),
  },
  {
    name: "Direct API update in every language, trusted",
    slug: POSTS,
    parts: ["en", "es", null],
    publish: id =>
      app().nextly.update({
        collection: POSTS as never,
        id,
        locale: "*",
        data: { status: "published", _overwrite: true },
      } as never),
  },
  {
    name: "Direct API update by query, trusted",
    slug: PAGES,
    parts: [null],
    publish: id =>
      app().nextly.update({
        collection: PAGES as never,
        where: { id: { equals: id } },
        data: { status: "published", _overwrite: true },
      } as never),
  },
  // The collection service a plugin writes through (`ctx.services.collections`), which runs as
  // trusted code by default: a plugin's write is no way around the workflow.
  {
    name: "a plugin's service update carrying a status",
    slug: PAGES,
    parts: [null],
    publish: id =>
      pluginService().updateEntry(PAGES, id, {
        status: "published",
        _overwrite: true,
      }),
  },
  {
    name: "a plugin's service update inside its transaction",
    slug: PAGES,
    parts: [null],
    publish: id => {
      const collections = pluginService();
      return collections.withTransaction(tx =>
        collections.updateEntryInTransaction(tx, PAGES, id, {
          status: "published",
          _overwrite: true,
        })
      );
    },
  },
  {
    name: "a plugin's service batch update",
    slug: PAGES,
    parts: [null],
    publish: async id => {
      const result = await pluginService().updateMany(PAGES, [
        { id, data: { status: "published", _overwrite: true } },
      ]);
      // A batch names each refused row rather than throwing.
      if (result.failed > 0) throw new Error(JSON.stringify(result));
      return result;
    },
  },
];

/**
 * The collection service a plugin is handed (`ctx.services.collections`), over the install's own:
 * its writes run as trusted code unless a call names a user.
 */
const pluginService = () =>
  wrapCollectionsForPlugin(
    app().getService("collectionService") as unknown as CollectionService
  );

/** A document of the door's collection, with something in every part the door publishes. */
async function documentFor(door: Door): Promise<string> {
  if (door.slug !== POSTS) return draftOf(door.slug);
  const id = await draftOf(POSTS, { title: "Hello", code: "P-1" });
  await save(POSTS, id, { title: "Hola" }, "es");
  return id;
}

describe.each(getConfiguredTestDialects())(
  "nothing becomes public past the workflow (%s)",
  dialect => {
    afterEach(() => {
      approver = undefined;
    });

    describe("every door refuses a part with no current approval", () => {
      it.each(DOORS.map(door => [door.name, door] as const))(
        "%s",
        async (_name, door) => {
          await boot(dialect);
          const session = await publisher();
          const id = await documentFor(door);

          const refused = await refusedBy(() => door.publish(id, session));

          expect(refused).toBe(true);
          expect(await visitorRead(door.slug, id)).toBeNull();
          expect(await storedStatus(door.slug, id)).not.toBe("published");
        }
      );
    });

    describe("every door publishes the same document once approved", () => {
      it.each(DOORS.map(door => [door.name, door] as const))(
        "%s",
        async (_name, door) => {
          await boot(dialect);
          const session = await publisher();
          const id = await documentFor(door);
          await approve(door.slug, id, door.parts);

          // Called directly, so a refusal fails the case with its own reason.
          const answer = await door.publish(id, session);

          // A REST answer carries its HTTP status; a service answer is the entry itself.
          if (
            answer !== null &&
            typeof answer === "object" &&
            typeof (answer as { status?: unknown }).status === "number"
          ) {
            expect(
              (answer as Answer).status,
              JSON.stringify(answer)
            ).toBeLessThan(400);
          }
          expect((await visitorRead(door.slug, id))?.title).toBe(
            door.slug === POSTS ? "Hello" : "First"
          );
        }
      );
    });

    describe("publishing every language", () => {
      const everyLanguage = () =>
        DOORS.find(door => door.name === "REST publish of every language")!;

      it("puts the approved parts live where a configured language holds nothing at all", async () => {
        await boot(dialect);
        const session = await publisher();
        // Saved in English only: Spanish has no translation, no draft and no version.
        const id = await draftOf(POSTS, { title: "Hello", code: "C-1" });
        await approve(POSTS, id, ["en", null]);

        const answer = (await everyLanguage().publish(id, session)) as Answer;

        expect(answer.status, JSON.stringify(answer.json)).toBeLessThan(400);
        expect((await visitorRead(POSTS, id))?.title).toBe("Hello");
      });

      it("asks a publish of chosen parts naming every language only of the languages it moves", async () => {
        await boot(dialect);
        const session = await publisher();
        // Saved in English only: Spanish has no translation, no draft and no version.
        const id = await draftOf(POSTS, { title: "Hello", code: "C-1" });
        await approve(POSTS, id, ["en", null]);

        const answer = await rest(
          "POST",
          ["collections", POSTS, "entries", id, "publish"],
          session,
          { locales: "all", _overwrite: true }
        );

        expect(answer.status, JSON.stringify(answer.json)).toBeLessThan(400);
        expect((await visitorRead(POSTS, id))?.title).toBe("Hello");
      });

      it("puts a changed language live past one already live and unchanged, whatever stage that one is in", async () => {
        await boot(dialect);
        const session = await publisher();
        const id = await draftOf(POSTS, { title: "Hello", code: "C-1" });
        await save(POSTS, id, { title: "Hola" }, "es");
        await approve(POSTS, id, ["en", "es", null]);
        const first = (await everyLanguage().publish(id, session)) as Answer;
        expect(first.status, JSON.stringify(first.json)).toBeLessThan(400);
        // Spanish stays live and unchanged, in a stage that would refuse it were it judged.
        await seedState(app(), partOf(POSTS, id, "es"), "review", {
          definitionHash: workflowDefinitionHash(gated),
        });
        await save(POSTS, id, { title: "Hello again" }, "en");
        await approve(POSTS, id, ["en", null]);

        const answer = (await everyLanguage().publish(id, session)) as Answer;

        expect(answer.status, JSON.stringify(answer.json)).toBeLessThan(400);
        expect((await visitorRead(POSTS, id))?.title).toBe("Hello again");
        expect((await visitorRead(POSTS, id, "es"))?.title).toBe("Hola");
      });

      it("still refuses a language it moves that holds no approval, which is the control", async () => {
        await boot(dialect);
        const session = await publisher();
        const id = await draftOf(POSTS, { title: "Hello", code: "C-1" });
        await save(POSTS, id, { title: "Hola" }, "es");
        await approve(POSTS, id, ["en", null]);

        const answer = (await everyLanguage().publish(id, session)) as Answer;

        expect(answer.status).toBe(400);
        expect(JSON.stringify(answer.json)).toContain("NOT_APPROVED");
        expect(await visitorRead(POSTS, id)).toBeNull();
      });
    });

    describe("saving every language as published", () => {
      const savedInEveryLanguage = () =>
        DOORS.find(
          door => door.name === "REST save carrying a status in every language"
        )!;

      it("puts the approved parts live where a configured language holds nothing at all", async () => {
        await boot(dialect);
        const session = await publisher();
        // Saved in English only: Spanish has no translation, no draft and no version.
        const id = await draftOf(POSTS, { title: "Hello", code: "C-1" });
        await approve(POSTS, id, ["en", null]);

        const answer = (await savedInEveryLanguage().publish(
          id,
          session
        )) as Answer;

        expect(answer.status, JSON.stringify(answer.json)).toBeLessThan(400);
        expect((await visitorRead(POSTS, id))?.title).toBe("Hello");
      });

      it("still refuses a language it moves that holds no approval, which is the control", async () => {
        await boot(dialect);
        const session = await publisher();
        const id = await draftOf(POSTS, { title: "Hello", code: "C-1" });
        await save(POSTS, id, { title: "Hola" }, "es");
        await approve(POSTS, id, ["en", null]);

        const answer = (await savedInEveryLanguage().publish(
          id,
          session
        )) as Answer;

        expect(answer.status).toBe(400);
        expect(JSON.stringify(answer.json)).toContain("NOT_APPROVED");
        expect(await visitorRead(POSTS, id)).toBeNull();
      });
    });

    describe("publishing one language whose draft holds the whole document", () => {
      // Without per-language storage a language's draft holds the whole document, its shared values
      // included, so putting that language live puts its shared edits live too.
      const publishSpanish = (id: string, session: Record<string, string>) =>
        rest(
          "PATCH",
          ["collections", POSTS, "entries", id],
          session,
          { status: "published", _overwrite: true },
          "?locale=es"
        );

      /** A live Post whose Spanish draft edits the shared code, with Spanish approved. */
      async function spanishDraftEditingShared(
        session: Record<string, string>
      ): Promise<string> {
        expect(draftsKeptByPart()).toBe(false);
        const id = await draftOf(POSTS, { title: "Hello", code: "C-1" });
        await save(POSTS, id, { title: "Hola" }, "es");
        await approve(POSTS, id, ["en", "es", null]);
        const first = (await DOORS.find(
          door => door.name === "REST publish of every language"
        )!.publish(id, session)) as Answer;
        expect(first.status, JSON.stringify(first.json)).toBeLessThan(400);
        await save(POSTS, id, { title: "Hola 2", code: "C-2" }, "es");
        await approve(POSTS, id, ["es"]);
        return id;
      }

      it("asks the gate of the shared part too, and refuses it unapproved", async () => {
        await boot(dialect);
        const session = await publisher();
        const id = await spanishDraftEditingShared(session);

        const answer = await publishSpanish(id, session);

        expect(answer.status, JSON.stringify(answer.json)).toBe(400);
        expect(JSON.stringify(answer.json)).toContain("NOT_APPROVED");
        expect(JSON.stringify(answer.json)).toContain('"path":"shared"');
        expect((await visitorRead(POSTS, id, "es"))?.code).toBe("C-1");
      });

      it("publishes once the shared part is approved too, which is the control", async () => {
        await boot(dialect);
        const session = await publisher();
        const id = await spanishDraftEditingShared(session);
        await approve(POSTS, id, [null]);

        const answer = await publishSpanish(id, session);

        expect(answer.status, JSON.stringify(answer.json)).toBeLessThan(400);
        const spanish = await visitorRead(POSTS, id, "es");
        expect(spanish?.title).toBe("Hola 2");
        expect(spanish?.code).toBe("C-2");
      });
    });

    describe("a caller who may not publish", () => {
      /** A person who may read and edit Posts but not publish them. */
      async function editorWhoMayNotPublish(): Promise<Record<string, string>> {
        await person(app(), "edna", [
          ["read", POSTS],
          ["update", POSTS],
          ["create", POSTS],
        ]);
        return sessionOf("edna");
      }

      /** A Post whose Spanish part is under review. */
      async function spanishUnderReview(): Promise<string> {
        const id = await draftOf(POSTS, { title: "Hello", code: "C-1" });
        await save(POSTS, id, { title: "Hola" }, "es");
        await take(POSTS, id, "es", "submit", { kind: "system" });
        return id;
      }

      const publishSpanish = (id: string, session: Record<string, string>) =>
        rest(
          "POST",
          ["collections", POSTS, "entries", id, "publish"],
          session,
          {
            locales: ["es"],
            _overwrite: true,
          }
        );

      it("is told only that it may not publish, never the workflow's state", async () => {
        await boot(dialect);
        const session = await editorWhoMayNotPublish();
        const id = await spanishUnderReview();

        const answer = await publishSpanish(id, session);

        const body = JSON.stringify(answer.json);
        expect(answer.status, body).toBeGreaterThanOrEqual(400);
        expect(body).toContain("FORBIDDEN");
        expect(body).not.toContain("NOT_APPROVED");
        expect(body).not.toContain("Review");
        expect(body).not.toMatch(/approv/i);
        expect(await visitorRead(POSTS, id, "es")).toBeNull();
      });

      it("is told only that when a save also names a status", async () => {
        await boot(dialect);
        const session = await editorWhoMayNotPublish();
        const id = await spanishUnderReview();

        const answer = await rest(
          "PATCH",
          ["collections", POSTS, "entries", id],
          session,
          { title: "Hola 2", status: "published", _overwrite: true },
          "?locale=es"
        );

        const body = JSON.stringify(answer.json);
        expect(answer.status, body).toBeGreaterThanOrEqual(400);
        expect(body).not.toContain("NOT_APPROVED");
        expect(body).not.toContain("Review");
        expect(body).not.toMatch(/approv/i);
        expect(await visitorRead(POSTS, id, "es")).toBeNull();
      });

      it("leaves a caller who may publish told why the workflow holds it, which is the control", async () => {
        await boot(dialect);
        const session = await publisher();
        const id = await spanishUnderReview();

        const answer = await publishSpanish(id, session);

        const body = JSON.stringify(answer.json);
        expect(answer.status, body).toBe(400);
        expect(body).toContain("NOT_APPROVED");
        expect(body).toContain("Review");
        expect(await visitorRead(POSTS, id, "es")).toBeNull();
      });
    });

    describe("creating as published in a batch or on a caller's transaction", () => {
      /** Every Page stored, whatever its status. */
      async function storedPages(): Promise<Doc[]> {
        const listed = await app().nextly.find({
          collection: PAGES as never,
          status: "all",
        } as never);
        return (listed as { items: Doc[] }).items;
      }

      /** A create on a transaction the caller holds, as a plugin makes one; its answer or throw. */
      async function createdOnCallersTransaction(
        data: Doc,
        collectionName: string = PAGES,
        caller: { user?: { id: string } } = {}
      ): Promise<unknown> {
        const entries = handlerOf(app()).getEntryService() as unknown as {
          createEntryInTransaction(
            tx: unknown,
            params: {
              collectionName: string;
              overrideAccess: boolean;
              user?: { id: string };
            },
            body: Doc
          ): Promise<unknown>;
        };
        return app()
          .adapter.transaction(tx =>
            entries.createEntryInTransaction(
              tx,
              {
                collectionName,
                overrideAccess: caller.user === undefined,
                ...caller,
              },
              data
            )
          )
          .then(
            answer => answer,
            (reason: unknown) => reason
          );
      }

      it("is refused in a plugin's batch create, trusted, where nothing was approved", async () => {
        await boot(dialect);

        const result = await pluginService().createMany(PAGES, [
          { title: "Straight out", status: "published" },
        ]);

        expect(result.failed, JSON.stringify(result)).toBe(1);
        // A batch names each refused row by its message: the gate's, for the stage holding it.
        expect(JSON.stringify(result)).toContain("does not allow publishing");
        expect(await storedPages()).toEqual([]);
      });

      it("is refused on a caller's transaction, trusted, where nothing was approved", async () => {
        await boot(dialect);

        const answer = await createdOnCallersTransaction({
          title: "Straight out",
          status: "published",
        });

        expect(JSON.stringify(answer)).toContain("NOT_APPROVED");
        expect(await storedPages()).toEqual([]);
      });

      it("is refused in a batch create before any of its hooks run", async () => {
        await boot(dialect);
        hookCalls.count = 0;

        const result = await pluginService().createMany(HOOKED, [
          { title: "Straight out", status: "published" },
        ]);

        expect(result.failed, JSON.stringify(result)).toBe(1);
        expect(hookCalls.count).toBe(0);
      });

      it("is refused on a caller's transaction before any of its hooks run", async () => {
        await boot(dialect);
        hookCalls.count = 0;

        const answer = await createdOnCallersTransaction(
          { title: "Straight out", status: "published" },
          HOOKED
        );

        expect(JSON.stringify(answer)).toContain("NOT_APPROVED");
        expect(hookCalls.count).toBe(0);
      });

      it("tells a caller who may not publish only that, never what the workflow holds", async () => {
        await boot(dialect);
        // May read and create Pages, but not publish them.
        await person(app(), "cora", [
          ["read", PAGES],
          ["create", PAGES],
        ]);

        const answer = await createdOnCallersTransaction(
          { title: "Straight out", status: "published" },
          PAGES,
          { user: { id: "cora" } }
        );

        const told = JSON.stringify(answer);
        expect(told).toMatch(/403|FORBIDDEN/);
        expect(told).not.toContain("NOT_APPROVED");
        expect(told).not.toContain("does not allow publishing");
        expect(await storedPages()).toEqual([]);
      });

      it("keeps nothing of a batch item whose publish the gate fails to settle, and keeps the rest", async () => {
        await boot(dialect);
        // A gate that lets every create through, and then fails as it settles one.
        container.register<PublishGate>("publishGate", () => ({
          refusals: () => Promise.resolve([]),
          judge: () =>
            Promise.resolve({
              refusals: [],
              settle: () => Promise.reject(new Error("settle failed")),
            }),
        }));

        const result = await pluginService().createMany(PAGES, [
          { title: "Goes live", status: "published" },
          { title: "Stays a draft" },
        ]);

        expect(result.failed, JSON.stringify(result)).toBe(1);
        expect((await storedPages()).map(page => page.title)).toEqual([
          "Stays a draft",
        ]);
      });

      it("runs nothing a batch item held for the commit once its failed settle undoes it, and runs the rest's", async () => {
        await boot(dialect);
        const adapter = app().adapter;
        const ran: string[] = [];
        let judged = 0;
        // A gate that lets every create through, holds an effect for the commit and one for a
        // rollback as it judges each, and fails as it settles the first.
        container.register<PublishGate>("publishGate", () => ({
          refusals: () => Promise.resolve([]),
          judge: async () => {
            judged += 1;
            const item = judged;
            await adapter.afterCommit(() => ran.push(`commit ${String(item)}`));
            await adapter.afterRollback(() =>
              ran.push(`rollback ${String(item)}`)
            );
            return {
              refusals: [],
              settle: () =>
                item === 1
                  ? Promise.reject(new Error("settle failed"))
                  : Promise.resolve(),
            };
          },
        }));

        const result = await pluginService().createMany(PAGES, [
          { title: "Undone", status: "published" },
          { title: "Kept", status: "published" },
        ]);

        expect(result.failed, JSON.stringify(result)).toBe(1);
        expect((await storedPages()).map(page => page.title)).toEqual(["Kept"]);
        // The batch committed: the kept item's effect runs, the undone item's never does, and
        // no rollback effect runs, as for a part of a transaction that rolled back on its own.
        expect(ran).toEqual(["commit 2"]);
      });

      it("creates as published for trusted code that names a reason, which is the control", async () => {
        await boot(dialect);
        const reason = { [WITHOUT_REVIEW_KEY]: { reason: "Nightly import" } };

        const batch = await pluginService().createMany(PAGES, [
          { title: "In a batch", status: "published", ...reason },
        ]);
        const single = await createdOnCallersTransaction({
          title: "On a transaction",
          status: "published",
          ...reason,
        });

        expect(batch.successful, JSON.stringify(batch)).toBe(1);
        expect(JSON.stringify(single)).not.toContain("NOT_APPROVED");
        const live = (await storedPages())
          .filter(page => page.status === "published")
          .map(page => page.title)
          .sort();
        expect(live).toEqual(["In a batch", "On a transaction"]);
      });
    });

    describe("publishing every language, its parts kept apart", () => {
      /**
       * A live Post with every part approved once, then `edit` saved in Spanish and `approved`
       * approved again.
       */
      async function liveThenSpanish(
        session: Record<string, string>,
        edit: Doc,
        approved: (string | null)[]
      ): Promise<string> {
        expect(draftsKeptByPart()).toBe(true);
        const id = await draftOf(POSTS, { title: "Hello", code: "C-1" });
        await save(POSTS, id, { title: "Hola" }, "es");
        await approve(POSTS, id, ["en", "es", null]);
        const first = (await DOORS.find(
          door => door.name === "REST publish of every language"
        )!.publish(id, session)) as Answer;
        expect(first.status, JSON.stringify(first.json)).toBeLessThan(400);
        await save(POSTS, id, edit, "es");
        await approve(POSTS, id, approved);
        return id;
      }

      const publishEveryLanguage = (
        id: string,
        session: Record<string, string>
      ) =>
        DOORS.find(
          door => door.name === "REST publish of every language"
        )!.publish(id, session) as Promise<Answer>;

      it("asks no shared approval where only a language's change is pending", async () => {
        await boot(dialect, { perLanguageStorage: true });
        const session = await publisher();
        const id = await liveThenSpanish(session, { title: "Hola 2" }, ["es"]);

        const answer = await publishEveryLanguage(id, session);

        expect(answer.status, JSON.stringify(answer.json)).toBeLessThan(400);
        expect((await visitorRead(POSTS, id, "es"))?.title).toBe("Hola 2");
      });

      it("still judges the shared part where a shared draft is pending, which is the control", async () => {
        await boot(dialect, { perLanguageStorage: true });
        const session = await publisher();
        // A shared value saved in Spanish is kept in the shared draft, which nothing approved.
        const id = await liveThenSpanish(session, { code: "C-2" }, []);

        const answer = await publishEveryLanguage(id, session);

        expect(answer.status, JSON.stringify(answer.json)).toBe(400);
        expect(JSON.stringify(answer.json)).toContain("NOT_APPROVED");
        expect(JSON.stringify(answer.json)).toContain('"path":"shared"');
        expect((await visitorRead(POSTS, id, "es"))?.code).toBe("C-1");
      });
    });

    describe("creating as published", () => {
      it("is refused through REST, where nothing could have been approved", async () => {
        await boot(dialect);
        const session = await publisher();

        const answer = await rest(
          "POST",
          ["collections", PAGES, "entries"],
          session,
          { title: "Straight out", status: "published" }
        );

        expect(answer.status).toBeGreaterThanOrEqual(400);
        const listed = await app().nextly.find({
          collection: PAGES as never,
          overrideAccess: false,
        } as never);
        expect((listed as { items: Doc[] }).items).toEqual([]);
      });

      it("is refused through the Direct API, trusted", async () => {
        await boot(dialect);

        const refused = await refusedBy(() =>
          app().nextly.create({
            collection: PAGES as never,
            data: { title: "Straight out", status: "published" },
          } as never)
        );

        expect(refused).toBe(true);
        const listed = await app().nextly.find({
          collection: PAGES as never,
          overrideAccess: false,
        } as never);
        expect((listed as { items: Doc[] }).items).toEqual([]);
      });

      it("is refused before any of its hooks run, from the workflow alone, with no entry yet", async () => {
        await boot(dialect);
        hookCalls.count = 0;

        const error = await app()
          .nextly.create({
            collection: HOOKED as never,
            data: { title: "Straight out", status: "published" },
          } as never)
          .then(
            () => null,
            (reason: unknown) => reason
          );

        // Held back by the early answer, which has no entry to read: its first stage does not
        // allow publishing, so nothing ran and nothing was written.
        expect(JSON.stringify(error)).toContain("NOT_APPROVED");
        expect(hookCalls.count).toBe(0);
        const listed = await app().nextly.find({
          collection: HOOKED as never,
          status: "all",
        } as never);
        expect((listed as { items: Doc[] }).items).toEqual([]);
      });

      it("creates as published for trusted code that names a reason, which is the control", async () => {
        await boot(dialect);
        hookCalls.count = 0;

        const { item: created } = (await app().nextly.create({
          collection: HOOKED as never,
          data: {
            title: "Straight out",
            status: "published",
            [WITHOUT_REVIEW_KEY]: { reason: "Nightly import" },
          },
        } as never)) as { item: Doc };

        expect(hookCalls.count).toBeGreaterThan(0);
        expect((await visitorRead(HOOKED, String(created.id)))?.title).toBe(
          "Straight out"
        );
      });
    });

    describe("Singles", () => {
      it("refuses a REST save carrying a status on an unapproved Single", async () => {
        await boot(dialect);
        const session = await publisher();
        await saveSingle(BANNER, { title: "Banner draft" });

        const answer = await rest("PATCH", ["singles", BANNER], session, {
          status: "published",
          _overwrite: true,
        });

        expect(answer.status).toBeGreaterThanOrEqual(400);
        expect((await liveSingle(BANNER))?.title).not.toBe("Banner draft");
      });

      it("refuses a REST publish of every language on an unapproved Single", async () => {
        await boot(dialect);
        const session = await publisher();
        await saveSingle(BANNER, { title: "Banner draft" });

        const answer = await rest(
          "POST",
          ["singles", BANNER, "publish-all"],
          session,
          { _overwrite: true }
        );

        expect(answer.status).toBeGreaterThanOrEqual(400);
        expect((await liveSingle(BANNER))?.title).not.toBe("Banner draft");
      });

      it("refuses the Direct API's update carrying a status on an unapproved Single, trusted", async () => {
        await boot(dialect);

        const refused = await refusedBy(() =>
          app().nextly.updateSingle({
            slug: BANNER as never,
            data: {
              title: "Banner draft",
              status: "published",
              _overwrite: true,
            },
          } as never)
        );

        expect(refused).toBe(true);
        expect((await liveSingle(BANNER))?.title).not.toBe("Banner draft");
      });

      it("publishes an approved untranslated Single through a REST publish of every language", async () => {
        await boot(dialect);
        const session = await publisher();
        const id = await saveSingle(BANNER, { title: "Banner draft" });
        await approveSingle(BANNER, id, [null]);

        const answer = await rest(
          "POST",
          ["singles", BANNER, "publish-all"],
          session,
          { _overwrite: true }
        );

        expect(answer.status, JSON.stringify(answer.json)).toBeLessThan(400);
        expect((await liveSingle(BANNER))?.title).toBe("Banner draft");
      });

      describe("publishing every language of a translated Single", () => {
        const publishAll = (session: Record<string, string>) =>
          rest("POST", ["singles", NOTICE, "publish-all"], session, {
            _overwrite: true,
          });
        const saveEveryLanguage = (session: Record<string, string>) =>
          rest(
            "PATCH",
            ["singles", NOTICE],
            session,
            { status: "published", _overwrite: true },
            "?locale=*"
          );

        it("puts the approved parts live where a configured language holds nothing at all", async () => {
          await boot(dialect);
          const session = await publisher();
          // Saved in English only: Spanish has no translation, no draft and no version.
          const id = await saveSingle(NOTICE, { title: "Hello", code: "N-1" });
          await approveSingle(NOTICE, id, ["en", null]);

          const answer = await publishAll(session);

          expect(answer.status, JSON.stringify(answer.json)).toBeLessThan(400);
          expect((await liveSingle(NOTICE, "en"))?.title).toBe("Hello");
        });

        it("puts them live through a save of every language carrying a status", async () => {
          await boot(dialect);
          const session = await publisher();
          // Saved in English only: Spanish has no translation, no draft and no version.
          const id = await saveSingle(NOTICE, { title: "Hello", code: "N-1" });
          await approveSingle(NOTICE, id, ["en", null]);

          const answer = await saveEveryLanguage(session);

          expect(answer.status, JSON.stringify(answer.json)).toBeLessThan(400);
          expect((await liveSingle(NOTICE, "en"))?.title).toBe("Hello");
        });

        it("still refuses a language it moves that holds no approval, which is the control", async () => {
          await boot(dialect);
          const session = await publisher();
          const id = await saveSingle(NOTICE, { title: "Hello", code: "N-1" });
          await saveSingle(NOTICE, { title: "Hola" }, "es");
          await approveSingle(NOTICE, id, ["en", null]);

          const answer = await publishAll(session);

          expect(answer.status).toBe(400);
          expect(JSON.stringify(answer.json)).toContain("NOT_APPROVED");
          expect((await liveSingle(NOTICE, "en"))?.title).not.toBe("Hello");
        });
      });
    });

    describe("a status the collection does not know", () => {
      it("is refused where a workflow is attached, and nothing is stored", async () => {
        await boot(dialect);
        const id = await draftOf(PAGES);

        const refused = await refusedBy(() =>
          app().nextly.update({
            collection: PAGES as never,
            id,
            data: { status: "archived", _overwrite: true },
          } as never)
        );

        expect(refused).toBe(true);
        expect(await storedStatus(PAGES, id)).toBe("draft");
      });

      it("is stored where no workflow is attached, and never served as published", async () => {
        await boot(dialect);
        const id = await draftOf(LOOSE);

        await app().nextly.update({
          collection: LOOSE as never,
          id,
          data: { status: "archived", _overwrite: true },
        } as never);

        expect(await storedStatus(LOOSE, id)).toBe("archived");
        expect(await visitorRead(LOOSE, id)).toBeNull();
      });
    });

    describe("a publish closes the part's review cycle", () => {
      it("clears the stage and keeps the approval in the history; the next edit starts at Draft", async () => {
        await boot(dialect);
        const id = await draftOf(PAGES);
        await approve(PAGES, id, [null]);
        const before = await historyText(PAGES, id);

        await app().nextly.publish({
          collection: PAGES as never,
          id,
          locales: "all",
          data: { _overwrite: true },
        });

        // The cycle is closed in the publish: no stage, assignment or due date is left.
        expect(await stateOf(app(), partOf(PAGES, id, null))).toBeNull();
        // The approval it went live under is named in what the publish recorded.
        const recorded = (await historyText(PAGES, id)).slice(
          before.length - 1
        );
        expect(recorded).toContain("rita");

        await save(PAGES, id, { title: "Second" });
        const next = await stateOf(app(), partOf(PAGES, id, null));
        expect(next === null || next.stage === "draft").toBe(true);
        expect(next?.approval ?? null).toBeNull();
        expect(next?.assignee ?? null).toBeNull();
      });

      it("closes it for a publish without review too", async () => {
        await boot(dialect);
        await person(app(), "una", [
          ["read", PAGES],
          ["update", PAGES],
          ["publish", PAGES],
          ["publish-without-review", PAGES],
        ]);
        const id = await draftOf(PAGES);
        await take(PAGES, id, null, "submit", { kind: "system" });

        const answer = await rest(
          "POST",
          ["collections", PAGES, "entries", id, "publish"],
          await sessionOf("una"),
          {
            locales: "all",
            _overwrite: true,
            withoutReview: { reason: "Embargo lifted early" },
          }
        );
        expect(answer.status, JSON.stringify(answer.json)).toBe(200);

        expect(await stateOf(app(), partOf(PAGES, id, null))).toBeNull();
        await save(PAGES, id, { title: "Second" });
        const next = await stateOf(app(), partOf(PAGES, id, null));
        expect(next === null || next.stage === "draft").toBe(true);
      });
    });

    describe("publish without review", () => {
      async function una() {
        await person(app(), "una", [
          ["read", PAGES],
          ["update", PAGES],
          ["publish", PAGES],
          ["publish-without-review", PAGES],
          ["read", BANNER],
          ["update", BANNER],
          ["publish", BANNER],
          ["publish-without-review", BANNER],
        ]);
        return sessionOf("una");
      }

      it("publishes for a person who holds it, with a reason, and records the reason", async () => {
        await boot(dialect);
        const session = await una();
        const id = await draftOf(PAGES);

        const answer = await rest(
          "POST",
          ["collections", PAGES, "entries", id, "publish"],
          session,
          {
            locales: "all",
            _overwrite: true,
            withoutReview: { reason: "Embargo lifted early" },
          }
        );

        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        expect((await visitorRead(PAGES, id))?.title).toBe("First");
        expect(await historyText(PAGES, id)).toContain("Embargo lifted early");
      });

      it("is refused without a reason", async () => {
        await boot(dialect);
        const session = await una();
        const id = await draftOf(PAGES);

        const answer = await rest(
          "POST",
          ["collections", PAGES, "entries", id, "publish"],
          session,
          { locales: "all", _overwrite: true, withoutReview: { reason: " " } }
        );

        expect(answer.status).toBeGreaterThanOrEqual(400);
        expect(await visitorRead(PAGES, id)).toBeNull();
      });

      it("is refused to a person who does not hold it", async () => {
        await boot(dialect);
        const session = await publisher();
        const id = await draftOf(PAGES);

        const answer = await rest(
          "POST",
          ["collections", PAGES, "entries", id, "publish"],
          session,
          {
            locales: "all",
            _overwrite: true,
            withoutReview: { reason: "Embargo lifted early" },
          }
        );

        expect(answer.status).toBeGreaterThanOrEqual(400);
        expect(await visitorRead(PAGES, id)).toBeNull();
      });

      it("publishes a Single for a person who holds it, with a reason", async () => {
        await boot(dialect);
        const session = await una();
        await app().nextly.updateSingle({
          slug: BANNER as never,
          data: { title: "Banner draft", _overwrite: true },
        } as never);

        const answer = await rest("PATCH", ["singles", BANNER], session, {
          status: "published",
          _overwrite: true,
          // A save names it beside its values under the system key, so a field of that name works.
          [WITHOUT_REVIEW_KEY]: { reason: "Storm warning" },
        });

        expect(answer.status, JSON.stringify(answer.json)).toBe(200);
        const read = (await app().nextly.findSingle({
          slug: BANNER as never,
          overrideAccess: false,
        } as never)) as Doc | null;
        expect(read?.title).toBe("Banner draft");
      });

      it("is refused to an API key, whatever it holds, through REST", async () => {
        await boot(dialect);
        await una();
        const keys = app().getService(
          "apiKeyService"
        ) as unknown as ApiKeyService;
        // Made by una, who holds "Publish without review": a key never does.
        const { key } = await keys.createApiKey("una", {
          name: "una's key",
          tokenType: "full-access",
          expiresIn: "unlimited",
        });
        const id = await draftOf(PAGES);

        const answer = await rest(
          "POST",
          ["collections", PAGES, "entries", id, "publish"],
          { authorization: `Bearer ${key}` },
          {
            locales: "all",
            _overwrite: true,
            withoutReview: { reason: "Embargo lifted early" },
          }
        );

        expect(answer.status).toBeGreaterThanOrEqual(400);
        expect(await visitorRead(PAGES, id)).toBeNull();
      });

      it("is refused to the Direct API acting for an API key, whatever the key holds", async () => {
        await boot(dialect);
        await una();
        const id = await draftOf(PAGES);
        const grants = [
          "read",
          "update",
          "publish",
          "publish-without-review",
        ].map(action => ({
          slug: `${action}-${PAGES}`,
          action,
          resource: PAGES,
        }));

        const refused = await refusedBy(() =>
          app().nextly.publish({
            collection: PAGES as never,
            id,
            locales: "all",
            data: { _overwrite: true },
            overrideAccess: false,
            user: { id: "una" },
            actor: apiKeyScope(grants),
            withoutReview: { reason: "Embargo lifted early" },
          } as never)
        );

        expect(refused).toBe(true);
        expect(await visitorRead(PAGES, id)).toBeNull();
      });

      it("publishes for trusted code that names a reason, and records it", async () => {
        await boot(dialect);
        const id = await draftOf(PAGES);

        await app().nextly.publish({
          collection: PAGES as never,
          id,
          locales: "all",
          data: { _overwrite: true },
          withoutReview: { reason: "Nightly import" },
        } as never);

        expect((await visitorRead(PAGES, id))?.title).toBe("First");
        expect(await historyText(PAGES, id)).toContain("Nightly import");
      });
    });

    describe("releases", () => {
      /**
       * A release holding these Pages to go live, added by `author` and scheduled at `at` straight
       * through the repository, so no check before the moment has judged it: what is under test is
       * the run's own write.
       */
      async function scheduledRelease(
        author: string,
        pages: string[],
        at: Date
      ): Promise<string> {
        const repo = new ReleasesRepository(app().adapter);
        const release = await repo.createRelease({
          title: "Launch",
          createdBy: author,
        });
        for (const entryId of pages) {
          await repo.addMember(
            {
              releaseId: release.id,
              scopeKind: "collection",
              scopeSlug: PAGES,
              entryId,
              locale: null,
              action: "publish",
              createdBy: author,
            },
            ANY_EDITABLE_STATE
          );
        }
        await scheduleAsItStands(repo, release.id, at, "UTC");
        return release.id;
      }

      const NEXT_WEEK = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const DUE = () => new Date(Date.now() - 60_000);

      /**
       * The release's author: someone who may read, edit and publish Pages, and publish them
       * without review, so only the workflow can hold a member back.
       */
      async function author(): Promise<string> {
        await person(app(), "ada", [
          ["read", PAGES],
          ["update", PAGES],
          ["publish", PAGES],
          ["publish-without-review", PAGES],
        ]);
        return "ada";
      }

      /** One materialisation pass, as the drain job performs it, writing as each member's author. */
      async function materialise(): Promise<void> {
        await applyDueReleases({
          repository: new ReleasesRepository(app().adapter),
          mutations: createReleaseMutations({
            contentApi: app().nextly,
            lockServer: lockServerOf(app()),
          }),
          runAs: {
            findUser: async id => ({ id, isActive: true }),
            listRoleSlugs: async () => [],
          },
        });
      }

      /**
       * The Page's status as its row stores it. Read raw: the read path shows a due release's
       * members as live before the release writes them, so a read would pass against a run that
       * wrote nothing.
       */
      async function rowStatus(id: string): Promise<string | undefined> {
        const row = await app().adapter.selectOne<{ status?: string }>(
          `dc_${PAGES}`,
          { where: { and: [{ column: "id", op: "=", value: id }] } }
        );
        return row?.status;
      }

      it("Publish now does not put an unapproved member live, even for an author who may publish without review", async () => {
        await boot(dialect);
        const ada = await author();
        const unapproved = await draftOf(PAGES);
        const id = await scheduledRelease(ada, [unapproved], NEXT_WEEK());

        await app()
          .nextly.releases.publishNow({ id })
          .catch(() => undefined);

        expect(await rowStatus(unapproved)).toBe("draft");
      });

      it("a run does not put an unapproved member live", async () => {
        await boot(dialect);
        const ada = await author();
        const unapproved = await draftOf(PAGES);
        await scheduledRelease(ada, [unapproved], DUE());

        await materialise();

        expect(await rowStatus(unapproved)).toBe("draft");
      });

      it("a run puts an approved member live", async () => {
        await boot(dialect);
        const ada = await author();
        const approved = await draftOf(PAGES);
        await approve(PAGES, approved, [null]);
        await scheduledRelease(ada, [approved], DUE());

        await materialise();

        expect(await rowStatus(approved)).toBe("published");
      });

      it("a run does not put live a member edited after it was approved and scheduled", async () => {
        await boot(dialect);
        const ada = await author();
        const page = await draftOf(PAGES);
        await approve(PAGES, page, [null]);
        await scheduledRelease(ada, [page], DUE());
        await save(PAGES, page, { title: "Changed after approval" });

        await materialise();

        expect(await rowStatus(page)).toBe("draft");
      });
    });

    describe("taking content down is never held", () => {
      it.each([
        ["Draft", [] as string[]],
        ["Review", ["submit"]],
        ["Approved", ["submit", "approve"]],
      ])(
        "a visitor reads the live values, and unpublishing works, while the next draft is in %s",
        async (_stage, steps) => {
          await boot(dialect);
          const session = await publisher();
          const rita = await approverOf();
          const id = await draftOf(PAGES);
          await approve(PAGES, id, [null]);
          await app().nextly.publish({
            collection: PAGES as never,
            id,
            locales: "all",
            data: { _overwrite: true },
          });
          await save(PAGES, id, { title: "Next draft" });
          for (const step of steps) {
            await take(
              PAGES,
              id,
              null,
              step,
              step === "approve" ? rita : { kind: "system" }
            );
          }

          expect((await visitorRead(PAGES, id))?.title).toBe("First");

          const answer = await rest(
            "POST",
            ["collections", PAGES, "entries", id, "unpublish"],
            session,
            { locales: "all", _overwrite: true }
          );

          expect(answer.status, JSON.stringify(answer.json)).toBe(200);
          expect(await visitorRead(PAGES, id)).toBeNull();
        }
      );
    });
  }
);
