/**
 * The people a workflow names are told, on every configured dialect: an assignee when a part is
 * assigned to them (by an assignment, or as a stage's default reviewer on entering it), and the
 * person accountable for the stage a part left when it is approved or sent back, whether a step or
 * an edit made them accountable and whether or not the workflow has a submit step.
 *
 * Each notice lands in the person's own list in the transaction of the move, once for the part's
 * new review-state revision, with its email job beside it where the site sends email and the
 * trigger's switch in the workflow settings is not off. Work routed to a role, a part no one is
 * accountable for, and a person's own act tell no one. The email is sent through a capturing
 * provider, so what the person would receive is read as the provider was handed it.
 */
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, describe, expect, it } from "vitest";

import { container } from "../../../di/container";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { NOTICES_TABLE } from "../../../schemas/notices/table-name";
import type { CollectionsHandler } from "../../../services/collections-handler";
import { defineEmailProvider } from "../../email/provider-definition";
import type { EmailProviderAdapter } from "../../email/types";
import type { JobRegistry } from "../../jobs/job-registry";
import { runJobsPass } from "../../jobs/jobs-runner";
import type { NoticesService } from "../../notices/notices-service";
import type { SingleEntryService } from "../../singles/services/single-entry-service";
import { resolveSingleDocumentId } from "../../singles/services/single-document-access";
import { workflowDefinitionHash } from "../hash";
import {
  createReviewState,
  type ReviewAssignee,
} from "../review-state-repository";
import {
  assignWorkflowParts,
  takeWorkflowStep,
  type WorkflowCaller,
} from "../steps";
import { WORKFLOW_CHANGES_REQUESTED_NOTICE } from "../workflow-notices";
import {
  writeWorkflowSettings,
  type WorkflowSettings,
} from "../workflow-settings-repository";

import {
  AT,
  bootSteps,
  entry,
  partOf,
  person,
  role,
  saveIn,
  seedState,
  stateDb,
  stateOf,
  versionOf,
} from "./helpers/step-harness";
import { editorial } from "./helpers/step-workflows";

const EDITORIAL = workflowDefinitionHash(editorial);
const EMAIL_JOB = "workflows:notice-email";

const sent: Array<Parameters<EmailProviderAdapter["send"]>[0]> = [];
let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
  sent.length = 0;
});

const capturing = defineEmailProvider<Record<string, never>>({
  type: "capturing-workflow-notices",
  label: "Capturing",
  configFields: [],
  parseConfig: () => ({}),
  createAdapter: () => ({
    send: async options => {
      sent.push(options);
      return { success: true, messageId: "captured" };
    },
  }),
});

/** The step install, with email set up unless told not to. */
async function boot(dialect: TestDialect, withEmail = true) {
  const n = await bootSteps(
    dialect,
    [
      definePlugin({
        name: "mailer",
        version: "1.0.0",
        nextly: ">=0.0.0",
        contributes: { emailProviders: [capturing] },
      } as never),
    ],
    // A table prefix of this file's own, so its tables are never another file's.
    { tablePrefix: "wn_" }
  );
  t = n;
  if (withEmail) {
    await n.nextly.emailProviders.create({
      data: {
        name: "Capturing",
        type: "capturing-workflow-notices",
        fromEmail: "provider@example.com",
        configuration: {},
        isDefault: true,
      },
    });
  }
  return n;
}

const app = (): TestNextly => {
  if (!t) throw new Error("not booted");
  return t;
};

/** A stored JSON value, as each dialect hands it back. */
const parsed = (value: unknown): unknown =>
  typeof value === "string" ? JSON.parse(value) : value;

interface StoredNoticeRow {
  id: string;
  userId: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  data: unknown;
}

/** Every workflow notice, oldest first, with its snapshot parsed. */
async function workflowNotices(): Promise<StoredNoticeRow[]> {
  const rows = await app().adapter.select<StoredNoticeRow>(NOTICES_TABLE, {
    columns: ["id", "userId", "kind", "subjectType", "subjectId", "data"],
    orderBy: [{ column: "id", direction: "asc" }],
  });
  return rows
    .filter(row => row.kind.startsWith("workflows."))
    .map(row => ({ ...row, data: parsed(row.data) }));
}

/** The notice id each workflow notice email job was given. */
async function emailJobNotices(): Promise<string[]> {
  const rows = await app().adapter.select<{ input: unknown }>("nextly_jobs", {
    columns: ["input"],
    where: { and: [{ column: "slug", op: "=", value: EMAIL_JOB }] },
  });
  return rows.map(row => (parsed(row.input) as { noticeId: string }).noticeId);
}

/** Takes `name` on `parts`, as a caller that just read each of them. */
async function take(
  slug: string,
  entryId: string,
  parts: (string | null)[],
  name: string,
  caller: WorkflowCaller,
  comment?: string
) {
  const seen = [];
  for (const part of parts) {
    const state = await stateOf(app(), partOf(slug, entryId, part));
    seen.push({
      part,
      revision: state?.revision ?? 0,
      version: await versionOf(app(), slug, entryId, part),
    });
  }
  return takeWorkflowStep(app().adapter, {
    document: { scopeKind: "collection", scopeSlug: slug, entryId },
    step: name,
    parts,
    seen,
    comment,
    caller,
  });
}

/** Assigns one part to `assignee`, as a caller that just read it. */
async function assign(
  slug: string,
  entryId: string,
  part: string | null,
  assignee: ReviewAssignee,
  caller: WorkflowCaller
) {
  const state = await stateOf(app(), partOf(slug, entryId, part));
  return assignWorkflowParts(app().adapter, {
    assignments: [
      {
        document: { scopeKind: "collection", scopeSlug: slug, entryId },
        part,
        revision: state?.revision ?? 0,
        assignee,
      },
    ],
    caller,
  });
}

const settle = (workflow: string, settings: WorkflowSettings) =>
  writeWorkflowSettings(stateDb(app()), workflow, settings, null, null);

/** A Posts document whose English part alice brought into Legal check. */
async function postInLegal(): Promise<string> {
  const post = await entry(app(), "posts");
  await seedState(app(), partOf("posts", post, "en"), "legal", {
    enteredBy: "alice",
    definitionHash: EDITORIAL,
  });
  return post;
}

describe.each(getConfiguredTestDialects())(
  "workflow notices to named people (%s)",
  dialect => {
    it("tells a person again when a part enters review again after its draft was discarded", async () => {
      await boot(dialect);
      const dave = await person(app(), "dave", [
        ["read", "posts"],
        ["update", "posts"],
      ]);
      await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      const post = await entry(app(), "posts");
      await saveIn(app(), "posts", post, "en", { status: "published" });
      const draftInReviewFor = async (title: string) => {
        await saveIn(app(), "posts", post, "en", { title });
        await seedState(app(), partOf("posts", post, "en"), "legal", {
          enteredBy: "alice",
          definitionHash: EDITORIAL,
        });
        await assign("posts", post, "en", { kind: "user", id: "bob" }, dave);
      };
      await draftInReviewFor("Pending");

      // The draft discarded: its review closes, and the next draft's review starts afresh.
      const handler = app().getService(
        "collectionsHandler"
      ) as CollectionsHandler;
      expect(
        await handler.discardWorkingDraftCounted({
          collectionName: "posts",
          entryId: post,
          locale: "en",
          // A discard names the version it read or says it overwrites; this one read none.
          version: { _overwrite: true },
        })
      ).toBe(1);
      expect(await stateOf(app(), partOf("posts", post, "en"))).toBeNull();
      await draftInReviewFor("Pending again");

      // Each cycle's assignment is its own: the second is told, though its revision repeats.
      expect(
        (await workflowNotices()).filter(
          notice =>
            notice.userId === "bob" && notice.kind === "workflows.assigned"
        )
      ).toHaveLength(2);
    });

    it("tells a person a part was assigned to them, with its email, and the email names the document", async () => {
      await boot(dialect);
      const dave = await person(app(), "dave", [
        ["read", "posts"],
        ["update", "posts"],
      ]);
      await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      const post = await postInLegal();

      await assign("posts", post, "en", { kind: "user", id: "bob" }, dave);

      const notices = await workflowNotices();
      expect(notices).toEqual([
        expect.objectContaining({
          userId: "bob",
          kind: "workflows.assigned",
          subjectType: "document",
          data: {
            // The registry's singular label: "Posts" for a collection that names none.
            collection: "Posts",
            title: "Hello",
            // The field the title came from, for each reader to be judged on.
            titleField: "title",
            part: "en",
            localized: true,
            step: "Clear",
            actor: "dave",
          },
        }),
      ]);
      expect(await emailJobNotices()).toEqual([notices[0]?.id]);

      await runJobsPass(
        app().adapter,
        container.get<JobRegistry>("jobRegistry"),
        {
          retentionMs: null,
        }
      );
      expect(sent).toHaveLength(1);
      expect(sent[0]).toMatchObject({
        to: "bob@example.test",
        subject: "“Hello” was assigned to you",
      });
    });

    it("tells a stage's default reviewer, a person, on entering it", async () => {
      await boot(dialect);
      const alice = await person(app(), "alice", [
        ["read", "posts"],
        ["update", "posts"],
      ]);
      await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      await settle("editorial", {
        defaultReviewers: { legal: { kind: "user", id: "bob" } },
      });
      const post = await entry(app(), "posts");

      await take("posts", post, ["en"], "send", alice);

      const notices = await workflowNotices();
      expect(notices).toEqual([
        expect.objectContaining({
          userId: "bob",
          kind: "workflows.assigned",
          data: expect.objectContaining({ step: "Clear", actor: "alice" }),
        }),
      ]);
      expect(await emailJobNotices()).toEqual([notices[0]?.id]);
    });

    it("tells the person accountable for the stage an approval leaves, with its email", async () => {
      await boot(dialect);
      await person(app(), "alice", [
        ["read", "posts"],
        ["update", "posts"],
      ]);
      const bob = await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      const post = await postInLegal();

      await take("posts", post, ["en"], "clear", bob);

      const notices = await workflowNotices();
      expect(notices).toEqual([
        expect.objectContaining({
          userId: "alice",
          kind: "workflows.approved",
          data: expect.objectContaining({
            title: "Hello",
            part: "en",
            step: "Clear",
            actor: "bob",
          }),
        }),
      ]);
      // Only a request for changes keeps the step's comment.
      expect(notices[0]?.data).not.toHaveProperty("comment");
      expect(await emailJobNotices()).toEqual([notices[0]?.id]);
    });

    it("tells the person accountable for the stage when changes are requested, with the comment in the notice and its email", async () => {
      await boot(dialect);
      await person(app(), "alice", [
        ["read", "posts"],
        ["update", "posts"],
      ]);
      const bob = await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      const post = await postInLegal();
      // Markup in the comment, so the email shows it escaped in HTML and as written in text.
      const comment = "Fix <b>the</b> intro & the outro";

      await take("posts", post, ["en"], "bounce", bob, comment);

      const notices = await workflowNotices();
      expect(notices).toEqual([
        expect.objectContaining({
          userId: "alice",
          kind: "workflows.changes-requested",
          data: expect.objectContaining({
            step: "Bounce",
            actor: "bob",
            comment,
          }),
        }),
      ]);
      expect(await emailJobNotices()).toEqual([notices[0]?.id]);

      // The notice as alice's list renders it: the move, then the comment.
      const service = container.get<NoticesService>("noticesService");
      const [shown] = (await service.find({ userId: "alice" })).rows;
      expect(shown?.body).toMatch(/^bob asked for changes to .*\n\nComment: /);
      expect(shown?.body).toContain(comment);

      await runJobsPass(
        app().adapter,
        container.get<JobRegistry>("jobRegistry"),
        { retentionMs: null }
      );
      expect(sent).toHaveLength(1);
      expect(sent[0]?.text).toContain(`Comment: ${comment}`);
      expect(sent[0]?.html).toContain(
        "<p>Comment: Fix &lt;b&gt;the&lt;/b&gt; intro &amp; the outro</p>"
      );
      expect(sent[0]?.html).not.toContain("<b>the</b>");
    });

    it("tells no one of work assigned to a role, or of a stage no one is accountable for", async () => {
      await boot(dialect);
      const dave = await person(app(), "dave", [
        ["read", "posts"],
        ["update", "posts"],
      ]);
      const bob = await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      const legal = await role(app(), "legal-team", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      // A person whose id is the role's: a role told as though a person would reach them.
      await person(app(), legal, []);
      const post = await postInLegal();
      // A part brought into review by trusted code: no person is accountable for it.
      const unowned = await entry(app(), "posts");
      await createReviewState(stateDb(app()), partOf("posts", unowned, "en"), {
        stage: "legal",
        enteredAt: AT,
        enteredBy: null,
        definitionHash: EDITORIAL,
      });

      await assign("posts", post, "en", { kind: "role", id: legal }, dave);
      await take("posts", unowned, ["en"], "clear", bob);

      expect(await workflowNotices()).toEqual([]);
      expect(await emailJobNotices()).toEqual([]);
    });

    it("takes the step and tells no one where the accountable person's account is gone", async () => {
      await boot(dialect);
      const bob = await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      // Alice brought the part into review, and has no account here.
      const post = await postInLegal();

      await take("posts", post, ["en"], "clear", bob);

      expect(await stateOf(app(), partOf("posts", post, "en"))).toMatchObject({
        stage: "cleared",
      });
      expect(await workflowNotices()).toEqual([]);
    });

    it("tells whoever a move made accountable, on a workflow with no submit step", async () => {
      await boot(dialect);
      const carol = await person(app(), "carol", [
        ["read", "memos"],
        ["update", "memos"],
      ]);
      const bob = await person(app(), "bob", [
        ["read", "memos"],
        ["sign-off", "memos"],
      ]);
      const memo = await entry(app(), "memos");

      await take("memos", memo, [null], "handOver", carol);
      await take("memos", memo, [null], "signOff", bob);

      expect(await workflowNotices()).toEqual([
        expect.objectContaining({
          userId: "carol",
          kind: "workflows.approved",
          data: expect.objectContaining({ part: null, step: "Sign off" }),
        }),
      ]);
    });

    it("tells whoever an edit made accountable when the part it returned to review is sent back", async () => {
      await boot(dialect);
      await person(app(), "alice", [
        ["read", "posts"],
        ["update", "posts"],
      ]);
      await person(app(), "dave", [
        ["read", "posts"],
        ["update", "posts"],
      ]);
      const bob = await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      const post = await postInLegal();
      await take("posts", post, ["en"], "clear", bob);
      // Dave's edit withdraws the approval and makes him accountable for Legal check.
      const handler = app().getService(
        "collectionsHandler"
      ) as CollectionsHandler;
      // An update names its version or says it overwrites; this one read none.
      const edited = await handler.updateEntry(
        {
          collectionName: "posts",
          entryId: post,
          overrideAccess: true,
          locale: "en",
          user: { id: "dave" },
        },
        { title: "Edited", _overwrite: true }
      );
      expect(edited.success, JSON.stringify(edited)).toBe(true);
      expect(
        (await stateOf(app(), partOf("posts", post, "en")))?.enteredBy
      ).toBe("dave");

      await take("posts", post, ["en"], "bounce", bob, "Not yet");

      const told = (await workflowNotices()).filter(
        notice => notice.kind === "workflows.changes-requested"
      );
      expect(told).toEqual([
        expect.objectContaining({
          userId: "dave",
          data: expect.objectContaining({ title: "Edited" }),
        }),
      ]);
    });

    it("records the notice but queues no email where that trigger's email is switched off", async () => {
      await boot(dialect);
      await person(app(), "alice", [
        ["read", "posts"],
        ["update", "posts"],
      ]);
      const bob = await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      await settle("editorial", { emails: { approved: false } });
      const post = await postInLegal();
      const other = await postInLegal();

      await take("posts", post, ["en"], "clear", bob);
      // The switch is per trigger: a request for changes still sends its email.
      await take("posts", other, ["en"], "bounce", bob, "Fix it");

      const notices = await workflowNotices();
      expect(notices.map(notice => notice.kind)).toEqual([
        "workflows.approved",
        "workflows.changes-requested",
      ]);
      expect(await emailJobNotices()).toEqual([notices[1]?.id]);
    });

    it("records the notice alone where the site sends no email", async () => {
      await boot(dialect, false);
      await person(app(), "alice", [
        ["read", "posts"],
        ["update", "posts"],
      ]);
      const bob = await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      const post = await postInLegal();

      await take("posts", post, ["en"], "clear", bob);

      expect(await workflowNotices()).toHaveLength(1);
      expect(await emailJobNotices()).toEqual([]);
    });

    it("tells no one of their own act", async () => {
      await boot(dialect);
      const alice = await person(app(), "alice", [
        ["update", "posts"],
        ["sign-off", "posts"],
      ]);
      const post = await postInLegal();

      await assign("posts", post, "en", { kind: "user", id: "alice" }, alice);
      // Bounce allows sending back one's own submission.
      await take("posts", post, ["en"], "bounce", alice, "Second thoughts");

      expect(await workflowNotices()).toEqual([]);
      expect(await emailJobNotices()).toEqual([]);
    });

    it("tells a person once for each part moved, nothing for a refused step, and nothing more on its retry", async () => {
      await boot(dialect);
      await person(app(), "alice", [
        ["read", "posts"],
        ["update", "posts"],
      ]);
      const bob = await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      const post = await postInLegal();
      // A Spanish version to approve, then Spanish in Legal check as alice's too.
      await saveIn(app(), "posts", post, "es", { title: "Hola" });
      await seedState(app(), partOf("posts", post, "es"), "legal", {
        enteredBy: "alice",
        definitionHash: EDITORIAL,
      });
      const document = {
        scopeKind: "collection" as const,
        scopeSlug: "posts",
        entryId: post,
      };
      const seen = async (esRevision: number) => [
        {
          part: "en",
          revision: 1,
          version: await versionOf(app(), "posts", post, "en"),
        },
        {
          part: "es",
          revision: esRevision,
          version: await versionOf(app(), "posts", post, "es"),
        },
      ];

      // Spanish was seen at a revision it does not hold: the step is refused, telling no one.
      await expect(
        takeWorkflowStep(app().adapter, {
          document,
          step: "clear",
          parts: ["en", "es"],
          seen: await seen(7),
          caller: bob,
        })
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await workflowNotices()).toEqual([]);

      const step = {
        document,
        step: "clear",
        parts: ["en", "es"],
        seen: await seen(1),
        caller: bob,
      };
      await takeWorkflowStep(app().adapter, step);
      // The same step again, as a retry of a call that did commit: refused as stale.
      await expect(takeWorkflowStep(app().adapter, step)).rejects.toMatchObject(
        { code: "CONFLICT" }
      );

      const notices = await workflowNotices();
      expect(
        notices.map(notice => (notice.data as { part: string }).part)
      ).toEqual(["en", "es"]);
      expect(new Set(await emailJobNotices())).toEqual(
        new Set(notices.map(notice => notice.id))
      );
    });

    it("withholds a notice's title, comment and link from a recipient who may not read the document, in the list and by email", async () => {
      await boot(dialect);
      // Alice may edit Posts but not read them, so she may not be told what one says.
      await person(app(), "alice", [["update", "posts"]]);
      const bob = await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      const post = await postInLegal();
      const comment = "Rework the intro";

      await take("posts", post, ["en"], "bounce", bob, comment);
      const [notice] = await workflowNotices();
      expect(notice).toMatchObject({ userId: "alice" });

      const service = container.get<NoticesService>("noticesService");
      const page = await service.find({ userId: "alice" });
      // Still listed, so her count and her list agree, but with nothing of the document.
      expect(page.total).toBe(1);
      const [shown] = page.rows;
      expect(shown?.title).toBe("This notice can no longer be shown.");
      expect(shown).not.toHaveProperty("body");
      expect(shown?.subject).toMatchObject({ link: null });
      expect(JSON.stringify(shown)).not.toContain("Hello");
      expect(JSON.stringify(shown)).not.toContain(comment);

      // The email the notice queued is not sent.
      expect(await emailJobNotices()).toEqual([notice?.id]);
      await runJobsPass(
        app().adapter,
        container.get<JobRegistry>("jobRegistry"),
        { retentionMs: null }
      );
      expect(sent).toEqual([]);
    });

    it("withholds a notice's title from a recipient a field read rule hides the title from", async () => {
      await boot(dialect);
      await person(app(), "alice", [
        ["read", "dossiers"],
        ["update", "dossiers"],
      ]);
      const bob = await person(app(), "bob", [
        ["read", "dossiers"],
        ["sign-off", "dossiers"],
      ]);
      const dossier = await entry(app(), "dossiers");
      await seedState(app(), partOf("dossiers", dossier, null), "legal", {
        enteredBy: "alice",
        definitionHash: EDITORIAL,
      });
      const comment = "Rework the summary";

      await take("dossiers", dossier, [null], "bounce", bob, comment);

      // The snapshot keeps where its title came from, for each reader to be judged on.
      const [stored] = await workflowNotices();
      expect(stored?.data).toMatchObject({
        title: "Hello",
        titleField: "title",
      });
      const service = container.get<NoticesService>("noticesService");
      const [shown] = (await service.find({ userId: "alice" })).rows;
      // She may read the document, so she is told of the request, its comment and its page,
      // but not the title the rule hides from her.
      expect(JSON.stringify(shown)).not.toContain("Hello");
      expect(shown?.title).toContain("Dossiers");
      expect(shown?.body).toContain(comment);
      expect(shown?.subject.link).toBe(
        `/admin/collections/dossiers/${dossier}`
      );

      // Nor does her email name it.
      await runJobsPass(
        app().adapter,
        container.get<JobRegistry>("jobRegistry"),
        { retentionMs: null }
      );
      expect(sent).toHaveLength(1);
      expect(JSON.stringify(sent[0])).not.toContain("Hello");
    });

    it("judges each notice in its own part's language, and a Single as a Single", async () => {
      await boot(dialect);
      // Letters may be read in every language but Spanish; Carol may read neither entity.
      await person(app(), "alice", [
        ["read", "letters"],
        ["read", "banner"],
      ]);
      await person(app(), "carol", []);
      const letter = await entry(app(), "letters");
      const singles = app().getService(
        "singleEntryService"
      ) as SingleEntryService;
      await singles.update(
        "banner",
        { title: "Banner", _overwrite: true },
        { overrideAccess: true }
      );
      const banner = await resolveSingleDocumentId("banner");
      if (banner === null) throw new Error("no banner");
      const service = container.get<NoticesService>("noticesService");
      // Notices as a request for changes writes them, one per part.
      const told = (
        userId: string,
        subjectId: string,
        part: string | null,
        title: string
      ) =>
        service.record({
          kind: WORKFLOW_CHANGES_REQUESTED_NOTICE,
          userId,
          subjectId,
          occurrence: JSON.stringify([part, title]),
          data: {
            collection: "Letters",
            title,
            part,
            localized: part !== null,
            step: "Bounce",
            actor: "bob",
            comment: "Rework it",
          },
        });
      await told("alice", `collection:letters:${letter}`, "en", "Hello");
      await told("alice", `collection:letters:${letter}`, "es", "Hola");
      await told("alice", `single:banner:${banner}`, null, "Banner");
      await told("carol", `single:banner:${banner}`, null, "Banner");

      const shown = (await service.find({ userId: "alice" })).rows.map(row => ({
        title: row.title,
        link: row.subject.link,
        gone: row.subject.gone,
      }));
      expect(shown).toEqual(
        expect.arrayContaining([
          {
            title: "Changes were requested on “Hello”",
            link: `/admin/collections/letters/${letter}`,
            gone: false,
          },
          // The Spanish part, refused in Spanish: nothing of what it says.
          {
            title: "This notice can no longer be shown.",
            link: null,
            gone: false,
          },
          // A Single that exists is linked, not read as deleted.
          {
            title: "Changes were requested on “Banner”",
            link: "/admin/singles/banner",
            gone: false,
          },
        ])
      );
      expect(shown).toHaveLength(3);
      expect(JSON.stringify(shown)).not.toContain("Hola");

      // Carol may not read the Single: nothing of it.
      const [carols] = (await service.find({ userId: "carol" })).rows;
      expect(carols?.title).toBe("This notice can no longer be shown.");
      expect(carols?.subject.link).toBeNull();
    });

    it("links each notice to the document's edit page, and says so once the document is deleted", async () => {
      await boot(dialect);
      await person(app(), "alice", [
        ["read", "posts"],
        ["update", "posts"],
      ]);
      const bob = await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      const post = await postInLegal();
      await take("posts", post, ["en"], "clear", bob);
      const service = container.get<NoticesService>("noticesService");

      const [linked] = (await service.find({ userId: "alice" })).rows;
      expect(linked?.subject).toMatchObject({
        link: `/admin/collections/posts/${post}`,
        gone: false,
      });
      expect(linked?.title).toBe("“Hello” was approved");

      const handler = app().getService(
        "collectionsHandler"
      ) as CollectionsHandler;
      await handler.deleteEntry({
        collectionName: "posts",
        entryId: post,
        overrideAccess: true,
      });
      // Gone, it can no longer be judged, so even its reader is told only that it was deleted.
      const [gone] = (await service.find({ userId: "alice" })).rows;
      expect(gone?.subject).toMatchObject({ link: null, gone: true });
      expect(gone?.title).toBe("This notice can no longer be shown.");
      expect(gone?.body).toBe("The document has since been deleted.");
      expect(JSON.stringify(gone)).not.toContain("Hello");
    });

    it("tells a recipient who may not read the document nothing of it once it is deleted", async () => {
      await boot(dialect);
      // Alice may edit Posts but not read them.
      await person(app(), "alice", [["update", "posts"]]);
      const bob = await person(app(), "bob", [
        ["read", "posts"],
        ["sign-off", "posts"],
      ]);
      const post = await postInLegal();
      const comment = "Rework the intro";
      await take("posts", post, ["en"], "bounce", bob, comment);

      const handler = app().getService(
        "collectionsHandler"
      ) as CollectionsHandler;
      await handler.deleteEntry({
        collectionName: "posts",
        entryId: post,
        overrideAccess: true,
      });
      const service = container.get<NoticesService>("noticesService");
      const [shown] = (await service.find({ userId: "alice" })).rows;
      expect(shown?.title).toBe("This notice can no longer be shown.");
      expect(shown?.subject).toMatchObject({ link: null, gone: true });
      expect(JSON.stringify(shown)).not.toContain("Hello");
      expect(JSON.stringify(shown)).not.toContain(comment);
    });
  }
);
