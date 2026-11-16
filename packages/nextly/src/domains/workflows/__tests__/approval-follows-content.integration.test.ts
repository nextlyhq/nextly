/**
 * An approval follows the content it approved, on every configured dialect: a save that changes
 * an approved part withdraws its approval and returns it to the stage `onEdit` names, in the
 * save's own transaction, naming who edited it (a person, an API key with its owner accountable,
 * or the system); a save that changes nothing, or only an exempt field, keeps it; a step out of a
 * publishable stage withdraws it without any edit; a deploy that changes the definition withdraws
 * approvals given under the earlier one unless it keeps them; an approval is refused where a
 * changed field is hidden from the reviewer; and the last approved version and the version that
 * entered review are pinned against retention until a publish.
 *
 * Each withdrawal is observed on the review state, the record of content events and the
 * history's pins, as a reader of each would see them.
 */
import { createHash } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  fieldGroup,
  text,
} from "../../../config";
import { clearServices } from "../../../di/register";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { CollectionsHandler } from "../../../services/collections-handler";
import type { VersionsDbApi } from "../../versions/db-api";
import { VersionsRepository } from "../../versions/versions-repository";
import { canonicalJson } from "../../../shared/lib/canonical-json";
import { approvalDigest } from "../approval-digest";
import { defineWorkflow } from "../define-workflow";
import { workflowDefinitionHash } from "../hash";
import { takeWorkflowStep, type WorkflowCaller } from "../steps";
import { workflowPins } from "../workflow-pins";

import {
  entry,
  partOf,
  person,
  seedState,
  shownVersion,
  snapshotOf,
  stateOf,
  versionOf,
  workflowEvents,
} from "./helpers/step-harness";
import { editorial, handover } from "./helpers/step-workflows";

/** Briefs' workflow: a summary may change without withdrawing an approval. */
const checked = defineWorkflow({
  slug: "checked",
  label: "Checked",
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
  onEdit: { exemptFields: ["summary"] },
});

/** The editorial workflow with a stage added before every other: a change of definition. */
function editorialWithIntake(keepApprovals: boolean) {
  return defineWorkflow({
    slug: "editorial",
    label: "Editorial",
    stages: [{ name: "intake", label: "Intake" }, ...editorial.stages],
    steps: [
      {
        name: "start",
        label: "Start",
        kind: "move",
        from: "intake",
        to: "writing",
      },
      ...editorial.steps.map(step => ({
        ...step,
        permission: step.permission ?? undefined,
      })),
    ],
    keepApprovals,
  });
}

const HASH = workflowDefinitionHash(editorial);
/** Few enough that a handful of saves goes past it. */
const KEEP = 3;
const drafts = { status: true, versions: { drafts: true } } as const;
const kept = {
  status: true,
  versions: { drafts: true, maxPerDoc: KEEP },
} as const;

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

const app = (): TestNextly => {
  if (!t) throw new Error("not booted");
  return t;
};

/**
 * Boots Posts (translated, with a shared `code`, a shared `legalNote` only rita may not read, and a
 * translated `regional` a read in Spanish withholds)
 * on `postsWorkflow`, Briefs on `checked` with a secret only bob may not read, and Memos on
 * `handover`; Briefs and Memos keep few versions.
 */
async function boot(
  dialect: TestDialect,
  options: {
    postsWorkflow?: ReturnType<typeof defineWorkflow>;
    adapter?: TestNextly["adapter"];
    /** Keep every translatable field per language, and a held edit's drafts by part. */
    perLanguageStorage?: boolean;
  } = {}
): Promise<TestNextly> {
  t = await createTestNextly({
    ...(options.adapter ? { adapter: options.adapter } : { dialect }),
    perLanguageStorage: options.perLanguageStorage === true,
    localization: { locales: ["en", "es"], defaultLocale: "en" },
    // A field group whose own field has a read rule, which only the field-group pass of a read
    // applies: the collection's pass does not reach inside a field group.
    fieldGroups: [
      defineFieldGroup({
        slug: "aside",
        fields: [
          text({ name: "heading" }),
          text({
            name: "confidential",
            access: { read: ({ user }) => user?.id !== "gina" },
          }),
        ],
      }),
    ],
    collections: [
      defineCollection({
        slug: "posts",
        localized: true,
        ...drafts,
        workflow: options.postsWorkflow ?? editorial,
        fields: [
          text({ name: "title", localized: true }),
          text({ name: "code", localized: false }),
          text({
            name: "legalNote",
            localized: false,
            access: { read: ({ user }) => user?.id !== "rita" },
          }),
          // Withheld by the language a read is in, not by who reads it.
          text({
            name: "regional",
            localized: true,
            access: { read: ({ locale }) => locale !== "es" },
          }),
        ],
      }),
      defineCollection({
        slug: "briefs",
        ...kept,
        workflow: checked,
        fields: [
          text({ name: "title" }),
          text({ name: "summary" }),
          text({
            name: "secret",
            access: { read: ({ user }) => user?.id !== "bob" },
          }),
          // Hidden by who the reader is beyond their id: their email, as a document read sees it.
          text({
            name: "dossier",
            access: {
              read: ({ user }) => user?.email !== "frank@example.test",
            },
          }),
          fieldGroup({ name: "aside", component: "aside" }),
        ],
      }),
      defineCollection({
        slug: "memos",
        ...kept,
        workflow: handover,
        fields: [text({ name: "title" })],
      }),
    ],
  });
  return t;
}

const handlerOf = (n: TestNextly) =>
  n.getService("collectionsHandler") as CollectionsHandler;

/**
 * Saves `data` as an editor's ordinary save: as `userId` when given, else trusted code. It says it
 * replaces whatever is stored (`_overwrite`), as a save that read no version must, and a refused
 * save fails the test rather than leaving the document as it was.
 */
async function save(
  slug: string,
  entryId: string,
  data: Record<string, unknown>,
  options: {
    locale?: string;
    userId?: string;
    keyId?: string;
  } = {}
): Promise<void> {
  const result = await handlerOf(app()).updateEntry(
    {
      collectionName: slug,
      entryId,
      overrideAccess: true,
      ...(options.locale ? { locale: options.locale } : {}),
      ...(options.userId ? { user: { id: options.userId } } : {}),
      ...(options.keyId
        ? { actor: { type: "apiKey" as const, id: options.keyId } }
        : {}),
    },
    { ...data, _overwrite: true }
  );
  if (!result.success) {
    throw new Error(`save refused: ${result.statusCode} ${result.message}`);
  }
}

/** Takes `name` on one part, as a caller that just read it. */
async function take(
  slug: string,
  entryId: string,
  part: string | null,
  name: string,
  caller: WorkflowCaller,
  comment?: string
) {
  const state = await stateOf(app(), partOf(slug, entryId, part));
  return takeWorkflowStep(app().adapter, {
    document: { scopeKind: "collection", scopeSlug: slug, entryId },
    step: name,
    parts: [part],
    seen: [
      {
        part,
        revision: state?.revision ?? 0,
        version: await versionOf(app(), slug, entryId, part),
      },
    ],
    comment,
    caller,
  });
}

/** The workflows holder's slots on a document, by slot. */
async function pinsOf(slug: string, entryId: string) {
  const slots = await workflowPins.list(
    app().adapter as unknown as VersionsDbApi,
    { scopeKind: "collection", scopeSlug: slug, entryId }
  );
  return Object.fromEntries(slots.map(pin => [pin.slot, pin.versionNo]));
}

/** Whether the history still keeps version `versionNo`. */
async function keeps(slug: string, entryId: string, versionNo: number) {
  const row = await new VersionsRepository(
    app().adapter as unknown as VersionsDbApi
  ).findByVersionNo(
    { scopeKind: "collection", scopeSlug: slug, entryId },
    versionNo
  );
  return row !== undefined;
}

const withdrawals = async (slug: string, entryId: string) =>
  (await workflowEvents(app(), slug, entryId)).filter(event =>
    event.kind.startsWith("workflow-approval-withdrawn")
  );

/** A post whose English part bob approved, after alice sent it. */
async function approvedPost() {
  const n = app();
  const bob = await person(n, "bob", [["sign-off", "posts"]]);
  const post = await entry(n, "posts");
  await seedState(n, partOf("posts", post, "en"), "legal", {
    enteredBy: "alice",
    definitionHash: HASH,
  });
  await take("posts", post, "en", "clear", bob);
  const approved = await stateOf(n, partOf("posts", post, "en"));
  if (!approved?.approval) throw new Error("not approved");
  return { bob, post, approved };
}

describe.each(getConfiguredTestDialects())(
  "an approval follows the content it approved (%s)",
  dialect => {
    describe("an edit to approved content", () => {
      it("withdraws on a save that changes the part, returning it to review with the editor accountable", async () => {
        await boot(dialect);
        await person(app(), "dave", [["update", "posts"]]);
        const { post, approved } = await approvedPost();

        await save(
          "posts",
          post,
          { title: "Edited" },
          {
            locale: "en",
            userId: "dave",
          }
        );

        const edited = await shownVersion(app(), "posts", post, "en");
        expect(edited).toBeGreaterThan(approved.approval?.versionNo ?? 0);
        expect(await stateOf(app(), partOf("posts", post, "en"))).toMatchObject(
          {
            stage: "legal",
            approval: null,
            enteredBy: "dave",
            revision: approved.revision + 1,
          }
        );
        const [withdrawn, ...more] = await withdrawals("posts", post);
        expect(more).toEqual([]);
        expect(withdrawn).toMatchObject({
          kind: "workflow-approval-withdrawn",
          actorKind: "person",
          actorId: "dave",
          fromState: "cleared",
          toState: "legal",
          versionNo: edited,
          parts: ["en"],
          definitionHash: HASH,
        });
      });

      it("keeps the approval on a save that changes nothing", async () => {
        await boot(dialect);
        const { post, approved } = await approvedPost();

        await save("posts", post, { title: "Hello" }, { locale: "en" });

        expect(await stateOf(app(), partOf("posts", post, "en"))).toEqual(
          approved
        );
        expect(await withdrawals("posts", post)).toEqual([]);
      });

      it("keeps one language's approval through another language's held edit, whatever second its first publish stored", async () => {
        await boot(dialect);
        const bob = await person(app(), "bob", [["sign-off", "posts"]]);
        const post = await entry(app(), "posts");
        // English published first, then Spanish: the document's first-published time is written
        // to the millisecond in English's version and read back, on SQLite and MySQL, to the
        // second in Spanish's.
        // A first publish at a time with milliseconds, which SQLite and MySQL read back without them.
        vi.useFakeTimers({ toFake: ["Date"] });
        vi.setSystemTime(new Date("2026-11-12T10:00:00.123Z"));
        try {
          await save("posts", post, { status: "published" }, { locale: "en" });
        } finally {
          vi.useRealTimers();
        }
        await save(
          "posts",
          post,
          { title: "Hola", status: "published" },
          { locale: "es" }
        );
        for (const part of ["en", "es"]) {
          await seedState(app(), partOf("posts", post, part), "legal", {
            enteredBy: "alice",
            definitionHash: HASH,
          });
          await take("posts", post, part, "clear", bob);
        }
        const english = await stateOf(app(), partOf("posts", post, "en"));

        // A held edit of the Spanish translation, touching nothing English shows.
        await save("posts", post, { title: "Adiós" }, { locale: "es" });

        expect(await stateOf(app(), partOf("posts", post, "en"))).toEqual(
          english
        );
      });

      it("keeps an approval given before an upgrade through a save that leaves its content alone, and withdraws it on a change", async () => {
        await boot(dialect);
        const post = await entry(app(), "posts");
        await save("posts", post, { status: "published" }, { locale: "en" });
        const versionNo = await shownVersion(app(), "posts", post, "en");
        // The digest an earlier release gave the approval: every top-level key but the ones it left
        // out, the first-published time among those it kept.
        const snapshot = (await snapshotOf(
          app(),
          "posts",
          post,
          versionNo
        )) as Record<string, unknown>;
        // The keys those releases left out of a collection's digest, as they listed them: spelled
        // out, so a later change to the system keys cannot move this fixture with the code.
        const kept = new Set([
          "id",
          "createdAt",
          "updatedAt",
          "status",
          "_rev",
          "_revision",
          "_changed_by_kind",
          "_changed_by_id",
          "_changed_by_principal_kind",
          "_changed_at",
          "createdBy",
        ]);
        const legacy = createHash("sha256")
          .update(
            canonicalJson(
              Object.fromEntries(
                Object.entries(snapshot).filter(
                  ([key, held]) =>
                    !kept.has(key) && held !== null && held !== undefined
                )
              )
            ) ?? "",
            "utf8"
          )
          .digest("hex");
        expect(legacy).not.toBe(approvalDigest(snapshot, "collection"));
        await seedState(app(), partOf("posts", post, "en"), "cleared", {
          enteredBy: "alice",
          definitionHash: HASH,
          approval: {
            versionNo,
            digest: legacy,
            by: "bob",
            at: new Date("2026-11-02T10:00:00.000Z"),
          },
        });

        // A held edit of the Spanish translation records a version, so every approved part is
        // judged again, and English's content is what it was.
        await save("posts", post, { title: "Hola" }, { locale: "es" });
        expect(
          (await stateOf(app(), partOf("posts", post, "en")))?.approval
        ).toMatchObject({ digest: legacy });

        await save("posts", post, { title: "Changed" }, { locale: "en" });
        expect(await stateOf(app(), partOf("posts", post, "en"))).toMatchObject(
          { approval: null }
        );
      });

      it("keeps the approval on an edit to an exempt field, and withdraws it on another field's", async () => {
        await boot(dialect);
        const carol = await person(app(), "carol", [["sign-off", "briefs"]]);
        const brief = await entry(app(), "briefs");
        await save("briefs", brief, { summary: "First" });
        await seedState(app(), partOf("briefs", brief, null), "review", {
          enteredBy: "alice",
          definitionHash: workflowDefinitionHash(checked),
        });
        await take("briefs", brief, null, "approve", carol);
        const approved = await stateOf(app(), partOf("briefs", brief, null));
        // The digest leaves the exempt field out, so a later summary is still what was approved.
        expect(approved?.approval?.digest).toBe(
          approvalDigest(
            await snapshotOf(
              app(),
              "briefs",
              brief,
              approved?.approval?.versionNo ?? 0
            ),
            "collection",
            ["summary"]
          )
        );

        await save("briefs", brief, { summary: "Second" });
        expect(await stateOf(app(), partOf("briefs", brief, null))).toEqual(
          approved
        );
        expect(await withdrawals("briefs", brief)).toEqual([]);

        await save("briefs", brief, { title: "Retitled" });
        expect(
          await stateOf(app(), partOf("briefs", brief, null))
        ).toMatchObject({ stage: "review", approval: null });
        expect(await withdrawals("briefs", brief)).toHaveLength(1);
      });

      it("records an API key's edit as the key's, with its owner accountable", async () => {
        await boot(dialect);
        const { post } = await approvedPost();
        const now = new Date();
        await app().adapter.insert("users", {
          id: "kim",
          email: "kim@example.test",
          name: "Kim",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });
        await app().adapter.insert("api_keys", {
          id: "key-kim",
          name: "Kim's key",
          keyHash: "a".repeat(64),
          keyPrefix: "nx_test",
          tokenType: "full-access",
          userId: "kim",
          isActive: true,
          createdAt: now,
          updatedAt: now,
        });

        await save(
          "posts",
          post,
          { title: "By key" },
          {
            locale: "en",
            keyId: "key-kim",
          }
        );

        expect(await stateOf(app(), partOf("posts", post, "en"))).toMatchObject(
          { stage: "legal", approval: null, enteredBy: "kim" }
        );
        const [withdrawn] = await withdrawals("posts", post);
        expect(withdrawn).toMatchObject({
          actorKind: "apiKey",
          actorId: "key-kim",
          actorName: "Kim's key",
          payload: { ownerId: "kim" },
        });
      });

      it("records trusted server code's edit as the system's, keeping the accountable person", async () => {
        await boot(dialect);
        const { post } = await approvedPost();

        await save("posts", post, { title: "By code" }, { locale: "en" });

        expect(await stateOf(app(), partOf("posts", post, "en"))).toMatchObject(
          { stage: "legal", approval: null, enteredBy: "bob" }
        );
        const [withdrawn] = await withdrawals("posts", post);
        expect(withdrawn).toMatchObject({
          actorKind: "system",
          actorId: null,
        });
      });

      it("withdraws every language's approval for a shared field, and only the edited language's for a translation", async () => {
        await boot(dialect);
        const bob = await person(app(), "bob", [["sign-off", "posts"]]);
        const post = await entry(app(), "posts");
        // Spanish needs a saved version of its own to be approved.
        await save("posts", post, { title: "Hola" }, { locale: "es" });
        for (const part of ["en", "es"]) {
          await seedState(app(), partOf("posts", post, part), "legal", {
            enteredBy: "alice",
            definitionHash: HASH,
          });
          await take("posts", post, part, "clear", bob);
        }
        const spanish = await stateOf(app(), partOf("posts", post, "es"));

        await save("posts", post, { title: "Only English" }, { locale: "en" });
        expect(
          (await stateOf(app(), partOf("posts", post, "en")))?.approval
        ).toBeNull();
        expect(await stateOf(app(), partOf("posts", post, "es"))).toEqual(
          spanish
        );

        await save("posts", post, { code: "X-1" }, { locale: "en" });
        expect(await stateOf(app(), partOf("posts", post, "es"))).toMatchObject(
          { stage: "legal", approval: null }
        );
      });

      it("withdraws on an edit held as the working draft of a published document", async () => {
        await boot(dialect);
        const bob = await person(app(), "bob", [["sign-off", "posts"]]);
        const post = await entry(app(), "posts");
        await save("posts", post, { status: "published" }, { locale: "en" });
        await seedState(app(), partOf("posts", post, "en"), "legal", {
          enteredBy: "alice",
          definitionHash: HASH,
        });
        await take("posts", post, "en", "clear", bob);

        // No status: held as the working draft, the live document untouched.
        await save("posts", post, { title: "Pending" }, { locale: "en" });

        expect(await stateOf(app(), partOf("posts", post, "en"))).toMatchObject(
          { stage: "legal", approval: null }
        );
        expect(await withdrawals("posts", post)).toHaveLength(1);
      });

      it("withdraws on a field rewrite that changes the approved part", async () => {
        await boot(dialect);
        const { post } = await approvedPost();
        const read = await handlerOf(app()).getEntry({
          collectionName: "posts",
          entryId: post,
          overrideAccess: true,
          locale: "en",
          fallbackLocale: false,
        });
        await app().nextly.rewriteField({
          collection: "posts",
          id: post,
          field: "title",
          locale: "en",
          expectedVersion: (read.data as { _rev: string })._rev,
          set: { value: "Rewritten" },
          reason: "Renamed across the site",
        });

        expect(await stateOf(app(), partOf("posts", post, "en"))).toMatchObject(
          { stage: "legal", approval: null }
        );
        expect(await withdrawals("posts", post)).toHaveLength(1);
      });

      it("withdraws a language's approval on a field rewrite of a live shared field", async () => {
        await boot(dialect);
        const { post } = await approvedPost();
        const read = await handlerOf(app()).getEntry({
          collectionName: "posts",
          entryId: post,
          overrideAccess: true,
          locale: "en",
          fallbackLocale: false,
        });
        // `code` is shared: English shows it, so English's approval no
        // longer holds over what it shows.
        await app().nextly.rewriteField({
          collection: "posts",
          id: post,
          field: "code",
          expectedVersion: (read.data as { _rev: string })._rev,
          set: { value: "renumbered" },
          reason: "Codes renumbered",
        });

        expect(await stateOf(app(), partOf("posts", post, "en"))).toMatchObject(
          { stage: "legal", approval: null }
        );
        expect(await withdrawals("posts", post)).toHaveLength(1);
      });

      it("withdraws on a field rewrite that reaches an approved part's held draft", async () => {
        await boot(dialect);
        const bob = await person(app(), "bob", [["sign-off", "posts"]]);
        const post = await entry(app(), "posts");
        await save("posts", post, { status: "published" }, { locale: "en" });
        await save("posts", post, { code: "draft-code" }, { locale: "en" });
        await seedState(app(), partOf("posts", post, "en"), "legal", {
          enteredBy: "alice",
          definitionHash: HASH,
        });
        await take("posts", post, "en", "clear", bob);
        const read = await handlerOf(app()).getEntry({
          collectionName: "posts",
          entryId: post,
          overrideAccess: true,
          locale: "en",
          fallbackLocale: false,
        });
        // The shared `code` changes only in the held draft: the live copy
        // keeps its own value.
        await app().nextly.rewriteField({
          collection: "posts",
          id: post,
          field: "code",
          expectedVersion: (read.data as { _rev: string })._rev,
          set: {
            from: (current, copy) =>
              copy.form === "draft" ? "rewritten-code" : current,
          },
          reason: "Codes renumbered",
        });

        expect(await stateOf(app(), partOf("posts", post, "en"))).toMatchObject(
          { stage: "legal", approval: null }
        );
        expect(await withdrawals("posts", post)).toHaveLength(1);
      });
    });

    describe("a shared field held as a draft by part", () => {
      /**
       * A post published in Spanish and then English, each part approved by bob, under
       * per-language storage. English is published last, so its approval names its own newest
       * version, with no other language's shared values laid over it.
       */
      async function approvedInBoth(): Promise<string> {
        await boot(dialect, { perLanguageStorage: true });
        const bob = await person(app(), "bob", [["sign-off", "posts"]]);
        const post = await entry(app(), "posts");
        await save(
          "posts",
          post,
          { title: "Hola", status: "published" },
          { locale: "es" }
        );
        await save("posts", post, { status: "published" }, { locale: "en" });
        for (const part of ["en", "es"]) {
          await seedState(app(), partOf("posts", post, part), "legal", {
            enteredBy: "alice",
            definitionHash: HASH,
          });
          await take("posts", post, part, "clear", bob);
        }
        for (const part of ["en", "es"]) {
          expect(
            (await stateOf(app(), partOf("posts", post, part)))?.approval,
            part
          ).not.toBeNull();
        }
        return post;
      }

      // A held edit to a shared field goes to the document's one shared
      // draft, which any language's publish puts live: so it withdraws every
      // language's approval, not only the one it was made in.
      it("withdraws every language's approval for a held edit to a shared field", async () => {
        const post = await approvedInBoth();

        // No status: held, in the shared draft, made through Spanish.
        await save("posts", post, { code: "X-2" }, { locale: "es" });

        for (const part of ["en", "es"]) {
          expect(
            await stateOf(app(), partOf("posts", post, part)),
            part
          ).toMatchObject({ stage: "legal", approval: null });
        }
      });

      // A held edit to one language's own text reaches no other language.
      it("keeps another language's approval for a held edit to a translation", async () => {
        const post = await approvedInBoth();
        const english = await stateOf(app(), partOf("posts", post, "en"));

        await save("posts", post, { title: "Adiós" }, { locale: "es" });

        expect(
          (await stateOf(app(), partOf("posts", post, "es")))?.approval
        ).toBeNull();
        expect(await stateOf(app(), partOf("posts", post, "en"))).toEqual(
          english
        );
      });
    });

    describe("a shared field edited through another language", () => {
      /**
       * A post whose English and Spanish parts uma approved, then a shared field rita may not read
       * edited through English, which returns both parts to review.
       */
      async function sharedNoteEdited() {
        const n = app();
        const uma = await person(n, "uma", [["sign-off", "posts"]]);
        const rita = await person(n, "rita", [["sign-off", "posts"]]);
        await person(n, "dave", [["update", "posts"]]);
        const post = await entry(n, "posts");
        await save("posts", post, { title: "Hola" }, { locale: "es" });
        for (const part of ["en", "es"]) {
          await seedState(n, partOf("posts", post, part), "legal", {
            enteredBy: "alice",
            definitionHash: HASH,
          });
          await take("posts", post, part, "clear", uma);
        }
        await save(
          "posts",
          post,
          { legalNote: "N1" },
          {
            locale: "en",
            userId: "dave",
          }
        );
        expect(await stateOf(app(), partOf("posts", post, "es"))).toMatchObject(
          { stage: "legal", approval: null }
        );
        return { uma, rita, post };
      }

      it("refuses another language's approval to a reviewer who cannot read the shared field, and lets one who can approve it", async () => {
        await boot(dialect);
        const { uma, rita, post } = await sharedNoteEdited();

        // Spanish shows the note English wrote, though its own version predates it.
        await expect(
          take("posts", post, "es", "clear", rita)
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: { reason: "field-hidden", fields: ["legalNote"] },
        });
        expect(await stateOf(app(), partOf("posts", post, "es"))).toMatchObject(
          { stage: "legal", approval: null }
        );

        await take("posts", post, "es", "clear", uma);
        expect(
          (await stateOf(app(), partOf("posts", post, "es")))?.approval
        ).toMatchObject({ by: "uma" });
      });

      it("keeps that approval through a save that changes nothing and a translation saved in another language", async () => {
        await boot(dialect);
        const { uma, post } = await sharedNoteEdited();
        await take("posts", post, "es", "clear", uma);
        const approved = await stateOf(app(), partOf("posts", post, "es"));

        await save("posts", post, { title: "Hola" }, { locale: "es" });
        expect(await stateOf(app(), partOf("posts", post, "es"))).toEqual(
          approved
        );

        // English's own text: Spanish still shows exactly what uma approved.
        await save("posts", post, { title: "Only English" }, { locale: "en" });
        expect(await stateOf(app(), partOf("posts", post, "es"))).toEqual(
          approved
        );
      });
    });

    describe("a translated field a read rule withholds in one language", () => {
      it("judges a language's changes as a read in that language does, refusing what a Spanish read withholds", async () => {
        await boot(dialect);
        const n = app();
        const uma = await person(n, "uma", [["sign-off", "posts"]]);
        const post = await entry(n, "posts");
        await save("posts", post, { regional: "solo en" }, { locale: "en" });
        await save("posts", post, { regional: "solo es" }, { locale: "es" });
        for (const part of ["en", "es"]) {
          await seedState(n, partOf("posts", post, part), "legal", {
            enteredBy: "alice",
            definitionHash: HASH,
          });
        }

        // A Spanish read withholds `regional` from everyone, so no one may approve Spanish's change.
        await expect(
          take("posts", post, "es", "clear", uma)
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: {
            reason: "field-hidden",
            fields: ["regional"],
            approvers: [],
          },
        });
        expect(await stateOf(app(), partOf("posts", post, "es"))).toMatchObject(
          { stage: "legal", approval: null }
        );

        // An English read shows it, so English's change is hers to approve.
        await take("posts", post, "en", "clear", uma);
        expect(
          (await stateOf(app(), partOf("posts", post, "en")))?.approval
        ).toMatchObject({ by: "uma" });
      });
    });

    describe("a step out of a publishable stage", () => {
      it("withdraws the approval on a step back that changes no content, keeping the approved version pinned", async () => {
        await boot(dialect);
        const { bob, post, approved } = await approvedPost();
        const before = await versionOf(app(), "posts", post, "en");

        await take("posts", post, "en", "bounce", bob, "One more look");

        expect(await versionOf(app(), "posts", post, "en")).toBe(before);
        expect(await stateOf(app(), partOf("posts", post, "en"))).toMatchObject(
          { stage: "writing", approval: null }
        );
        expect((await pinsOf("posts", post))["approved:en"]).toBe(
          approved.approval?.versionNo
        );
      });
    });

    // A deploy is simulated by booting again on the first boot's adapter, and the test harness
    // releases the database a server-backed boot provisioned when the next boot starts: only
    // SQLite keeps one database across the two boots. The sweep these cases cover reads and writes
    // through the adapter, the same on every dialect.
    (dialect === "sqlite" ? describe : describe.skip)(
      "a deploy that changes the definition",
      () => {
        it("withdraws approvals given under the earlier definition and moves the part to the stage named for them, from which it can be approved again", async () => {
          const first = await boot(dialect);
          await person(first, "dave", [["update", "posts"]]);
          const { bob, post } = await approvedPost();
          clearServices();

          const changed = editorialWithIntake(false);
          await boot(dialect, {
            postsWorkflow: changed,
            adapter: first.adapter,
          });

          const newHash = workflowDefinitionHash(changed);
          expect(newHash).not.toBe(HASH);
          expect(
            await stateOf(app(), partOf("posts", post, "en"))
          ).toMatchObject({
            stage: "intake",
            approval: null,
            definitionHash: newHash,
          });
          const [withdrawn] = await withdrawals("posts", post);
          expect(withdrawn).toMatchObject({
            actorKind: "system",
            fromState: "cleared",
            toState: "intake",
            definitionHash: newHash,
          });

          const dave: WorkflowCaller = { kind: "user", userId: "dave" };
          await take("posts", post, "en", "start", dave);
          await take("posts", post, "en", "send", dave);
          await take("posts", post, "en", "clear", bob);
          expect(
            (await stateOf(app(), partOf("posts", post, "en")))?.approval
          ).toMatchObject({ by: "bob" });
        });

        it("keeps approvals given under the earlier definition when the new one keeps them", async () => {
          const first = await boot(dialect);
          const { post, approved } = await approvedPost();
          clearServices();

          await boot(dialect, {
            postsWorkflow: editorialWithIntake(true),
            adapter: first.adapter,
          });

          expect(
            await stateOf(app(), partOf("posts", post, "en"))
          ).toMatchObject({ stage: "cleared", approval: approved.approval });
          expect(await withdrawals("posts", post)).toEqual([]);
        });
      }
    );

    describe("an approval of a field the reviewer cannot read", () => {
      it("is refused while a changed field is hidden from the reviewer, naming who could approve, and allowed once that field is as last approved", async () => {
        await boot(dialect);
        const bob = await person(app(), "bob", [["sign-off", "briefs"]]);
        const carol = await person(app(), "carol", [["sign-off", "briefs"]]);
        await person(app(), "dave", [["update", "briefs"]]);
        const brief = await entry(app(), "briefs");
        await save("briefs", brief, { secret: "s1" });
        await seedState(app(), partOf("briefs", brief, null), "review", {
          enteredBy: "alice",
          definitionHash: workflowDefinitionHash(checked),
        });

        // Never approved or published: all of it is new, the secret included.
        await expect(
          take("briefs", brief, null, "approve", bob)
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: {
            reason: "field-hidden",
            fields: ["secret"],
            approvers: [{ kind: "user", id: "carol", name: "carol" }],
          },
        });
        expect(
          await stateOf(app(), partOf("briefs", brief, null))
        ).toMatchObject({ stage: "review", approval: null, revision: 1 });
        expect(await workflowEvents(app(), "briefs", brief)).toEqual([]);

        // Carol approves; an edit of the title returns it to review.
        await take("briefs", brief, null, "approve", carol);
        await save("briefs", brief, { title: "Retitled" }, { userId: "dave" });

        // Changed since the last approval: the title alone, which bob can read.
        await take("briefs", brief, null, "approve", bob);
        expect(
          (await stateOf(app(), partOf("briefs", brief, null)))?.approval
        ).toMatchObject({ by: "bob" });
      });

      it("lets anyone approve a field the collection no longer has, while a field a read rule hides still refuses", async () => {
        await boot(dialect);
        const bob = await person(app(), "bob", [["sign-off", "briefs"]]);
        const carol = await person(app(), "carol", [["sign-off", "briefs"]]);
        const erin = await person(app(), "erin", [["sign-off", "briefs"]]);
        await person(app(), "dave", [["update", "briefs"]]);
        const brief = await entry(app(), "briefs");
        await seedState(app(), partOf("briefs", brief, null), "review", {
          enteredBy: "alice",
          definitionHash: workflowDefinitionHash(checked),
        });
        await take("briefs", brief, null, "approve", carol);
        const approvedNo =
          (await stateOf(app(), partOf("briefs", brief, null)))?.approval
            ?.versionNo ?? 0;
        // The approved version holds a field the collection has since dropped: a removed field
        // is in the version approved and in no version saved after it.
        const approvedSnapshot = (await snapshotOf(
          app(),
          "briefs",
          brief,
          approvedNo
        )) as Record<string, unknown> | string;
        const withRetired = {
          ...(typeof approvedSnapshot === "string"
            ? (JSON.parse(approvedSnapshot) as Record<string, unknown>)
            : approvedSnapshot),
          retired: "an old value",
        };
        await app().adapter.update(
          "nextly_versions",
          { snapshot: JSON.stringify(withRetired) },
          {
            and: [
              { column: "scopeKind", op: "=", value: "collection" },
              { column: "scopeSlug", op: "=", value: "briefs" },
              { column: "entryId", op: "=", value: brief },
              { column: "versionNo", op: "=", value: approvedNo },
            ],
          }
        );
        await save(
          "briefs",
          brief,
          { title: "Retitled", secret: "s2" },
          { userId: "dave" }
        );

        // The secret changed and bob cannot read it; the retired field is no one's to hide.
        await expect(
          take("briefs", brief, null, "approve", bob)
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: { reason: "field-hidden", fields: ["secret"] },
        });
        // A reviewer who reads every field the collection has may approve the removal too.
        await take("briefs", brief, null, "approve", erin);
        expect(
          (await stateOf(app(), partOf("briefs", brief, null)))?.approval
        ).toMatchObject({ by: "erin" });
      });

      it("judges a changed field by the reviewer as a document read sees them, a rule on their email included", async () => {
        await boot(dialect);
        const carol = await person(app(), "carol", [["sign-off", "briefs"]]);
        const frank = await person(app(), "frank", [["sign-off", "briefs"]]);
        const erin = await person(app(), "erin", [["sign-off", "briefs"]]);
        await person(app(), "dave", [["update", "briefs"]]);
        const brief = await entry(app(), "briefs");
        await seedState(app(), partOf("briefs", brief, null), "review", {
          enteredBy: "alice",
          definitionHash: workflowDefinitionHash(checked),
        });
        await take("briefs", brief, null, "approve", carol);
        await save("briefs", brief, { dossier: "d2" }, { userId: "dave" });

        // A read of the brief withholds the dossier from frank by his email alone.
        await expect(
          take("briefs", brief, null, "approve", frank)
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: { reason: "field-hidden", fields: ["dossier"] },
        });
        await take("briefs", brief, null, "approve", erin);
        expect(
          (await stateOf(app(), partOf("briefs", brief, null)))?.approval
        ).toMatchObject({ by: "erin" });
      });

      it("refuses a changed field group whose own field a read rule hides from the reviewer", async () => {
        await boot(dialect);
        const carol = await person(app(), "carol", [["sign-off", "briefs"]]);
        const gina = await person(app(), "gina", [["sign-off", "briefs"]]);
        const erin = await person(app(), "erin", [["sign-off", "briefs"]]);
        await person(app(), "dave", [["update", "briefs"]]);
        const brief = await entry(app(), "briefs");
        await seedState(app(), partOf("briefs", brief, null), "review", {
          enteredBy: "alice",
          definitionHash: workflowDefinitionHash(checked),
        });
        await take("briefs", brief, null, "approve", carol);
        await save(
          "briefs",
          brief,
          { aside: { heading: "Note", confidential: "c2" } },
          { userId: "dave" }
        );

        // A read of the brief gives gina the aside without its confidential value.
        await expect(
          take("briefs", brief, null, "approve", gina)
        ).rejects.toMatchObject({
          code: "FORBIDDEN",
          publicData: { reason: "field-hidden", fields: ["aside"] },
        });
        await take("briefs", brief, null, "approve", erin);
        expect(
          (await stateOf(app(), partOf("briefs", brief, null)))?.approval
        ).toMatchObject({ by: "erin" });
      });
    });

    describe("pins", () => {
      it("keeps the version a submission brought into review past the retention limit", async () => {
        await boot(dialect);
        const dave = await person(app(), "dave", [["update", "briefs"]]);
        const brief = await entry(app(), "briefs");
        await take("briefs", brief, null, "submit", dave);
        const submitted = await shownVersion(app(), "briefs", brief, null);

        for (let i = 1; i <= KEEP + 2; i++) {
          await save("briefs", brief, { title: `Save ${i}` });
        }

        expect(await pinsOf("briefs", brief)).toEqual({
          "entered-review:*": submitted,
        });
        expect(await keeps("briefs", brief, submitted)).toBe(true);
        // Retention did run: an earlier version nothing pins is gone.
        expect(await keeps("briefs", brief, submitted + 1)).toBe(false);
      });

      it("keeps the version a move brought into review, on a workflow with no submit step", async () => {
        await boot(dialect);
        const dave = await person(app(), "dave", [["update", "memos"]]);
        const memo = await entry(app(), "memos");
        await take("memos", memo, null, "handOver", dave);
        const handed = await shownVersion(app(), "memos", memo, null);

        for (let i = 1; i <= KEEP + 2; i++) {
          await save("memos", memo, { title: `Save ${i}` });
        }

        expect(await pinsOf("memos", memo)).toEqual({
          "entered-review:*": handed,
        });
        expect(await keeps("memos", memo, handed)).toBe(true);
      });

      it("keeps the last approved version after its withdrawal, and the version an edit returned to review, until a publish", async () => {
        await boot(dialect);
        const carol = await person(app(), "carol", [["sign-off", "briefs"]]);
        const brief = await entry(app(), "briefs");
        await seedState(app(), partOf("briefs", brief, null), "review", {
          enteredBy: "alice",
          definitionHash: workflowDefinitionHash(checked),
        });
        await take("briefs", brief, null, "approve", carol);
        const approvedNo =
          (await stateOf(app(), partOf("briefs", brief, null)))?.approval
            ?.versionNo ?? 0;

        // The edit withdraws the approval and returns the part to review.
        await save("briefs", brief, { title: "Edited" });
        const returned = await shownVersion(app(), "briefs", brief, null);
        for (let i = 1; i <= KEEP + 2; i++) {
          await save("briefs", brief, { title: `Save ${i}` });
        }

        expect(await pinsOf("briefs", brief)).toEqual({
          "approved:*": approvedNo,
          "entered-review:*": returned,
        });
        expect(await keeps("briefs", brief, approvedNo)).toBe(true);
        expect(await keeps("briefs", brief, returned)).toBe(true);

        await save("briefs", brief, { status: "published" });
        expect(await pinsOf("briefs", brief)).toEqual({});
      });
    });
  }
);
