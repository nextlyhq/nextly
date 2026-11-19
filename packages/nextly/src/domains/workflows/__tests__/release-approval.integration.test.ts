/**
 * A release waits for approval, and stops when approval is withdrawn.
 *
 * Workflows' "Not approved" check judges each member going live by the publish gate's own
 * per-part decision, the one a publish meets. The cases cover what a release does with that answer:
 * its readiness, the events that stop it before its moment, its run asking again, Publish now,
 * what a reader is shown while it is due, and what the check reads.
 *
 * The deploys that withdraw an approval or attach a workflow are in
 * `release-approval-boot.integration.test.ts`.
 */
import { randomUUID } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { grantTo } from "../../../__tests__/fixtures/permission-holders";
import {
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { REVIEW_STATES_TABLE } from "../../../schemas/review-states";
import { VERSIONS_TABLE } from "../../../schemas/versions/types";
import type { CollectionRegistryService } from "../../collections/services/collection-registry-service";
import { seedPlainAuthor } from "../../releases/__tests__/helpers/live-author";
import { lockServerOf } from "../../releases/__tests__/helpers/release-writes";
import { applyDueReleases } from "../../releases/apply-due-releases";
import { planReleaseMaterialisation } from "../../releases/plan-release-materialisation";
import type {
  ReleaseCheckContext,
  ReleaseCheckReads,
} from "../../releases/readiness/check-sources";
import { releaseCheckSources } from "../../releases/readiness/check-sources";
import { createReleaseMutations } from "../../releases/release-mutations";
import { RELEASE_MEMBERS_TABLE } from "../../releases/release-tables";
import {
  IDS_PER_LOOKUP,
  ReleasesRepository,
} from "../../releases/releases-repository";
import { ReleasesService } from "../../releases/services/releases-service";
import { updateReviewState } from "../review-state-repository";
import { writeWorkflowSettings } from "../workflow-settings-repository";

import {
  approve,
  approveBanner,
  arrange,
  bannerPart,
  bootApprovals,
  doc,
  handlerOf,
  hardCodes,
  HASH,
  LATER,
  PAST,
  publishPage,
  recordBannerVersionIn,
  releaseState,
  saveBanner,
  storedPageStatus,
  stoppedNotices,
  takeStep,
  visibleBannerTitle,
  visiblePages,
} from "./helpers/release-approval-harness";
import {
  partOf,
  role,
  saveIn,
  seedState,
  stateDb,
  stateOf,
} from "./helpers/step-harness";

let current: TestNextly | undefined;

afterEach(async () => {
  vi.restoreAllMocks();
  await current?.destroy();
  current = undefined;
});

async function boot(
  dialect: TestDialect,
  options: { perLanguageStorage?: boolean } = {}
): Promise<TestNextly> {
  current = await bootApprovals(dialect, options);
  return current;
}

/** The documents a due pass would reach, in the order it reaches them, planned as the pass plans. */
async function plannedOrder(t: TestNextly): Promise<string[]> {
  const repository = new ReleasesRepository(t.adapter);
  const at = new Date();
  const releases = await repository.findDueReleases(at);
  const plan = planReleaseMaterialisation({
    releases: releases.map(release => ({
      id: release.id,
      scheduledAt: release.scheduledAt ?? at,
      revision: release.revision,
    })),
    members: await repository.listMembersOf(
      releases.map(release => release.id)
    ),
    now: at,
  });
  return plan.actions.map(action => action.ref.entryId);
}

/** The parts each "Not approved" finding of the release names, as its readiness answers them. */
async function notApprovedParts(
  t: TestNextly,
  releaseId: string
): Promise<unknown[]> {
  const readiness = await t.nextly.releases.readiness({ releaseId });
  return readiness.hard
    .filter(finding => finding.source === "workflows.approval")
    .map(finding => (finding.detail as { parts?: unknown }).parts);
}

/** The drain's pass, run once, as the runner's sweep runs it. */
function runDuePass(t: TestNextly) {
  return applyDueReleases({
    repository: new ReleasesRepository(t.adapter),
    mutations: createReleaseMutations({
      contentApi: t.nextly,
      lockServer: lockServerOf(t),
    }),
    runAs: {
      findUser: id => Promise.resolve({ id, isActive: true }),
      listRoleSlugs: () => Promise.resolve([]),
    },
  });
}

/** Takes a part's approval away by writing its review row, as nothing that signals would. */
async function withdrawSilently(
  t: TestNextly,
  slug: string,
  entryId: string
): Promise<void> {
  const part = partOf(slug, entryId, null);
  const state = await stateOf(t, part);
  if (!state) throw new Error("no review state to withdraw");
  const written = await updateReviewState(stateDb(t), part, state.revision, {
    stage: "writing",
    approval: null,
  });
  if (!written) throw new Error("the review state moved meanwhile");
}

describe.each(getConfiguredTestDialects())(
  "a release waits for approval (%s)",
  dialect => {
    it("reports each unapproved member going live, with its stage and whom it waits for, and never one coming down", async () => {
      const t = await boot(dialect);
      // An approved page; one in legal assigned to carol; one never put in review, whose first
      // stage has a default reviewer; one in legal with no one assigned and no default reviewer,
      // which waits for the roles that may sign it off; and a published page in review coming
      // down.
      const editors = await role(t, "editors", [["update", "pages"]]);
      const signers = await role(t, "signers", [["sign-off", "pages"]]);
      const approved = await doc(t, "pages");
      await approve(t, "pages", approved);
      const assigned = await doc(t, "pages");
      await seedState(t, partOf("pages", assigned, null), "legal", {
        enteredBy: "alice",
        definitionHash: HASH,
        assignee: { kind: "user", id: "carol" },
      });
      const fresh = await doc(t, "pages");
      await writeWorkflowSettings(
        t.adapter,
        "editorial",
        { defaultReviewers: { writing: { kind: "role", id: editors } } },
        null,
        null
      );
      const unassigned = await doc(t, "pages");
      await seedState(t, partOf("pages", unassigned, null), "legal", {
        enteredBy: "alice",
        definitionHash: HASH,
      });
      const coming = await doc(t, "pages", "published");
      await seedState(t, partOf("pages", coming, null), "writing", {
        definitionHash: HASH,
      });
      const { releaseId } = await arrange(
        t,
        [
          publishPage(approved),
          publishPage(assigned),
          publishPage(fresh),
          publishPage(unassigned),
          { ...publishPage(coming), action: "unpublish" },
        ],
        null
      );

      const readiness = await t.nextly.releases.readiness({ releaseId });
      const held = readiness.hard
        .filter(finding => finding.source === "workflows.approval")
        .map(({ entryId, code, detail }) => ({ entryId, code, detail }));
      expect(held).toHaveLength(3);
      expect(held).toEqual(
        expect.arrayContaining([
          {
            entryId: assigned,
            code: "NOT_APPROVED",
            detail: {
              parts: ["shared"],
              stages: ["legal"],
              waitsFor: ["user:carol"],
            },
          },
          {
            entryId: fresh,
            code: "NOT_APPROVED",
            detail: {
              parts: ["shared"],
              stages: ["writing"],
              waitsFor: [`roles:${editors}`],
            },
          },
          {
            entryId: unassigned,
            code: "NOT_APPROVED",
            detail: {
              parts: ["shared"],
              stages: ["legal"],
              waitsFor: [
                expect.stringMatching(new RegExp(`^roles:.*${signers}`)),
              ],
            },
          },
        ])
      );
    });

    it("names only the parts of a translated document it would publish that are not approved", async () => {
      const t = await boot(dialect);
      const post = await doc(t, "posts");
      await saveIn(t, "posts", post, "es", { title: "Hola" });
      await approve(t, "posts", post, "en");
      await approve(t, "posts", post, null);
      const { releaseId } = await arrange(
        t,
        [
          {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: post,
            action: "publish",
          },
        ],
        null
      );

      const readiness = await t.nextly.releases.readiness({ releaseId });
      expect(
        readiness.hard
          .filter(finding => finding.source === "workflows.approval")
          .map(({ code, detail }) => ({ code, detail }))
      ).toEqual([
        {
          code: "NOT_APPROVED",
          detail: {
            parts: ["es"],
            stages: ["writing"],
            waitsFor: [expect.stringMatching(/^roles:./)],
          },
        },
      ]);
    });

    it("holds a live translated document by its pending language alone where drafts are kept by part", async () => {
      // Kept by part, a language's draft holds that language only, so the shared part has nothing
      // pending and goes live unchanged: the publish gate asks it nothing, and nor may the release.
      const t = await boot(dialect, { perLanguageStorage: true });
      const post = await doc(t, "posts", "published");
      await saveIn(t, "posts", post, "es", { title: "Hola" });
      const { releaseId } = await arrange(
        t,
        [
          {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: post,
            action: "publish",
          },
        ],
        null
      );

      expect(await notApprovedParts(t, releaseId)).toEqual([["es"]]);
      await approve(t, "posts", post, "es");
      expect(await notApprovedParts(t, releaseId)).toEqual([]);
    });

    it("compares a Single with its newest version, even one recorded in a language the site no longer offers", async () => {
      const t = await boot(dialect);
      const banner = await saveBanner(t, "Approved");
      await approveBanner(t, banner);
      const arranged = await arrange(
        t,
        [
          {
            scopeKind: "single",
            scopeSlug: "banner",
            entryId: banner,
            action: "publish",
          },
        ],
        LATER
      );
      expect(await hardCodes(t, arranged.releaseId)).toEqual([]);

      await recordBannerVersionIn(t, banner, "fr", "Changed in French");

      // The publish it leads to compares the newest version of any language, so this one does.
      expect(await hardCodes(t, arranged.releaseId)).toEqual(["NOT_APPROVED"]);
    });

    it("refuses a whole release up front when one member it would publish is held, so none of it goes live", async () => {
      const t = await boot(dialect);
      const pages = [
        await doc(t, "pages"),
        await doc(t, "pages"),
        await doc(t, "pages"),
      ];
      for (const page of pages) await approve(t, "pages", page);
      const arranged = await arrange(t, pages.map(publishPage), PAST);
      expect(await hardCodes(t, arranged.releaseId)).toEqual([]);
      // The member the run reaches last, so a run asking member by member writes the others first.
      const order = await plannedOrder(t);
      expect([...order].sort()).toEqual([...pages].sort());
      await withdrawSilently(t, "pages", order[order.length - 1]);

      const pass = await runDuePass(t);

      expect(pass.outcomes.map(outcome => outcome.failure)).toEqual([
        "NOT_APPROVED",
        "NOT_APPROVED",
        "NOT_APPROVED",
      ]);
      expect(pass).toMatchObject({ applied: 0, blocked: 1, published: 0 });
      expect(await releaseState(t, arranged.releaseId)).toBe("blocked");
      for (const page of pages) {
        expect(await storedPageStatus(t, page)).toBe("draft");
      }
    });

    describe("stops the release before its moment when approval is withdrawn", () => {
      it("by an edit to an approved page", async () => {
        const t = await boot(dialect);
        const page = await doc(t, "pages");
        await approve(t, "pages", page);
        const arranged = await arrange(t, [publishPage(page)], LATER);
        expect(await hardCodes(t, arranged.releaseId)).toEqual([]);

        await handlerOf(t).updateEntry(
          { collectionName: "pages", entryId: page, overrideAccess: true },
          { title: "Changed", _overwrite: true }
        );

        expect(await releaseState(t, arranged.releaseId)).toBe("blocked");
        expect(await stoppedNotices(t, arranged)).toBe(1);
        expect(await hardCodes(t, arranged.releaseId)).toEqual([
          "NOT_APPROVED",
        ]);
        expect(await visiblePages(t)).not.toContain(page);
      });

      it("by a bulk update of an approved page", async () => {
        const t = await boot(dialect);
        const page = await doc(t, "pages");
        await approve(t, "pages", page);
        const arranged = await arrange(t, [publishPage(page)], LATER);
        expect(await hardCodes(t, arranged.releaseId)).toEqual([]);

        const written = await handlerOf(t)
          .getEntryService()
          .updateEntries({ collectionName: "pages", overrideAccess: true }, [
            { id: page, data: { title: "Changed", _overwrite: true } },
          ]);
        expect(written.successful).toBe(1);

        expect(await releaseState(t, arranged.releaseId)).toBe("blocked");
        expect(await stoppedNotices(t, arranged)).toBe(1);
      });

      it("by an edit to an approved Single, whose save leaves its approval in place", async () => {
        const t = await boot(dialect);
        const banner = await saveBanner(t, "Approved");
        await approveBanner(t, banner);
        const arranged = await arrange(
          t,
          [
            {
              scopeKind: "single",
              scopeSlug: "banner",
              entryId: banner,
              action: "publish",
            },
          ],
          LATER
        );
        expect(await hardCodes(t, arranged.releaseId)).toEqual([]);

        const approval = (await stateOf(t, bannerPart(banner)))?.approval;
        expect(approval).toEqual(expect.objectContaining({ by: "bob" }));

        await saveBanner(t, "Changed after approval");

        // The save withdrew nothing: the stop comes from the content moving off the approval.
        expect((await stateOf(t, bannerPart(banner)))?.approval).toEqual(
          approval
        );
        expect(await releaseState(t, arranged.releaseId)).toBe("blocked");
        expect(await stoppedNotices(t, arranged)).toBe(1);
        expect(await visibleBannerTitle(t)).toBeNull();
      });

      it("by a step back that changes no content", async () => {
        const t = await boot(dialect);
        const page = await doc(t, "pages");
        await approve(t, "pages", page);
        const arranged = await arrange(t, [publishPage(page)], LATER);
        expect(await hardCodes(t, arranged.releaseId)).toEqual([]);

        await takeStep(t, "pages", page, null, "bounce", "Not yet.");

        expect(await releaseState(t, arranged.releaseId)).toBe("blocked");
        expect(await stoppedNotices(t, arranged)).toBe(1);
      });

      it("and leaves it scheduled for a save that changes nothing approved", async () => {
        // The control: the save rechecks the release as any save does, and the approval stands.
        const t = await boot(dialect);
        const page = await doc(t, "pages");
        await approve(t, "pages", page);
        const arranged = await arrange(t, [publishPage(page)], LATER);

        await handlerOf(t).updateEntry(
          { collectionName: "pages", entryId: page, overrideAccess: true },
          { title: "Hello", _overwrite: true }
        );

        expect(await releaseState(t, arranged.releaseId)).toBe("scheduled");
        expect(await stoppedNotices(t, arranged)).toBe(0);
      });
    });

    it("asks again as it runs: a member whose approval went without a signal is refused, and the release stops with nothing of it live", async () => {
      const t = await boot(dialect);
      const page = await doc(t, "pages");
      await approve(t, "pages", page);
      const arranged = await arrange(t, [publishPage(page)], PAST);
      expect(await hardCodes(t, arranged.releaseId)).toEqual([]);
      await withdrawSilently(t, "pages", page);
      expect(await releaseState(t, arranged.releaseId)).toBe("scheduled");

      const pass = await runDuePass(t);

      expect(pass.outcomes).toEqual([
        expect.objectContaining({ failure: "NOT_APPROVED" }),
      ]);
      expect(pass).toMatchObject({ applied: 0, blocked: 1, published: 0 });
      expect(await releaseState(t, arranged.releaseId)).toBe("blocked");
      expect(await stoppedNotices(t, arranged)).toBe(1);
      expect(await storedPageStatus(t, page)).toBe("draft");
      expect(await visiblePages(t)).not.toContain(page);
    });

    it("never shows a reader a due member whose approval went without a signal, and the run then refuses it", async () => {
      const t = await boot(dialect);
      const page = await doc(t, "pages");
      await approve(t, "pages", page);
      const arranged = await arrange(t, [publishPage(page)], PAST);
      // Due and approved: the read shows it before the run writes it.
      expect(await visiblePages(t)).toContain(page);

      await withdrawSilently(t, "pages", page);

      expect(await visiblePages(t)).not.toContain(page);
      const pass = await runDuePass(t);
      expect(pass.outcomes.map(outcome => outcome.failure)).toEqual([
        "NOT_APPROVED",
      ]);
      expect(await releaseState(t, arranged.releaseId)).toBe("blocked");
      expect(await visiblePages(t)).not.toContain(page);
    });

    it("shows a reader none of a due release one of whose members is held, as its run writes none of it", async () => {
      const t = await boot(dialect);
      const kept = await doc(t, "pages");
      const withdrawn = await doc(t, "pages");
      await approve(t, "pages", kept);
      await approve(t, "pages", withdrawn);
      await arrange(t, [publishPage(kept), publishPage(withdrawn)], PAST);
      // Due and approved: the read shows both before the run writes them.
      expect(await visiblePages(t)).toEqual(
        expect.arrayContaining([kept, withdrawn])
      );

      await withdrawSilently(t, "pages", withdrawn);

      const visible = await visiblePages(t);
      expect(visible).not.toContain(withdrawn);
      expect(visible).not.toContain(kept);
    });

    it("shows a reader none of a due release joined to a held publish through a document outside the read", async () => {
      // The first release holds the page read here and the Banner; the second holds the Banner and
      // an unapproved post. The read decides the page alone, yet the run plans both releases as
      // one component through the Banner and refuses all of it over the post.
      const t = await boot(dialect);
      const page = await doc(t, "pages");
      await approve(t, "pages", page);
      const banner = await saveBanner(t, "Approved");
      await approveBanner(t, banner);
      const bannerGoesLive = {
        scopeKind: "single",
        scopeSlug: "banner",
        entryId: banner,
        action: "publish",
      } as const;
      await arrange(t, [publishPage(page), bannerGoesLive], PAST);
      // Due and approved, the first release alone: the read shows the page.
      expect(await visiblePages(t)).toContain(page);

      const post = await doc(t, "posts");
      const joined = await arrange(
        t,
        [
          bannerGoesLive,
          {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: post,
            action: "publish",
          },
        ],
        PAST
      );
      expect(await hardCodes(t, joined.releaseId)).toContain("NOT_APPROVED");

      expect(await visiblePages(t)).not.toContain(page);
      // The run agrees: it writes none of the component.
      const pass = await runDuePass(t);
      expect(pass).toMatchObject({ applied: 0, published: 0 });
      expect(await storedPageStatus(t, page)).toBe("draft");
    });

    it("leaves a due release a pass began scheduled when a step withdraws a later member's approval", async () => {
      // Stopped, the page the cut-off pass wrote would stay live and the other never follow.
      const t = await boot(dialect);
      const written = await doc(t, "pages");
      const waiting = await doc(t, "pages");
      await approve(t, "pages", written);
      await approve(t, "pages", waiting);
      const arranged = await arrange(
        t,
        [publishPage(written), publishPage(waiting)],
        PAST
      );
      const repo = new ReleasesRepository(t.adapter);
      const [release] = await repo.findReleases({ ids: [arranged.releaseId] });
      if (!release) throw new Error("the arranged release was not found");
      const receipted = (await repo.listMembers(arranged.releaseId)).find(
        member => member.entryId === written
      );
      if (!receipted) throw new Error("no member for the written page");
      // The receipt the cut-off pass left on the member it wrote.
      await t.adapter.update(
        RELEASE_MEMBERS_TABLE,
        { appliedRevision: release.revision },
        { and: [{ column: "id", op: "=", value: receipted.id }] }
      );

      await takeStep(t, "pages", waiting, null, "bounce", "Not yet.");

      expect(await releaseState(t, arranged.releaseId)).toBe("scheduled");
      expect(await stoppedNotices(t, arranged)).toBe(0);
    });

    it("leaves a due release scheduled when a pass writes one of its members after the stop judged it", async () => {
      // The run writes its receipt between the early stop's reading and its stop; the stop asks
      // again inside its own transaction, so the component a pass began stays scheduled.
      const t = await boot(dialect);
      const written = await doc(t, "pages");
      const waiting = await doc(t, "pages");
      await approve(t, "pages", written);
      await approve(t, "pages", waiting);
      const arranged = await arrange(
        t,
        [publishPage(written), publishPage(waiting)],
        PAST
      );
      const repo = new ReleasesRepository(t.adapter);
      const [release] = await repo.findReleases({ ids: [arranged.releaseId] });
      const receipted = (await repo.listMembers(arranged.releaseId)).find(
        member => member.entryId === written
      );
      if (!release || !receipted) throw new Error("no release or member");
      const block = ReleasesRepository.prototype.blockReleases;
      vi.spyOn(
        ReleasesRepository.prototype,
        "blockReleases"
      ).mockImplementation(async function (this: ReleasesRepository, ...args) {
        await t.adapter.update(
          RELEASE_MEMBERS_TABLE,
          { appliedRevision: release.revision },
          { and: [{ column: "id", op: "=", value: receipted.id }] }
        );
        return block.apply(this, args);
      });

      await takeStep(t, "pages", waiting, null, "bounce", "Not yet.");

      expect(await releaseState(t, arranged.releaseId)).toBe("scheduled");
      expect(await stoppedNotices(t, arranged)).toBe(0);
    });

    it("never stops due releases over a publish their plan loses to a later takedown", async () => {
      // The later release takes the page down and wins it, so the earlier publish is never made
      // and its approval holds nothing back.
      const t = await boot(dialect);
      const page = await doc(t, "pages");
      await approve(t, "pages", page);
      const publishing = await arrange(t, [publishPage(page)], PAST);
      const takingDown = await arrange(
        t,
        [{ ...publishPage(page), action: "unpublish" }],
        new Date(PAST.getTime() + 24 * 60 * 60 * 1000)
      );

      await takeStep(t, "pages", page, null, "bounce", "Not yet.");

      expect(await releaseState(t, publishing.releaseId)).toBe("scheduled");
      expect(await releaseState(t, takingDown.releaseId)).toBe("scheduled");
      expect(await stoppedNotices(t, publishing)).toBe(0);
    });

    it("reads no other due release when a recheck finds nothing wrong with a due one", async () => {
      // A save is rechecked against every release holding its document; only a due release with
      // a problem pays for the drain's plan of everything due.
      const t = await boot(dialect);
      const page = await doc(t, "pages");
      await approve(t, "pages", page);
      const arranged = await arrange(t, [publishPage(page)], PAST);
      const planned = vi.spyOn(ReleasesRepository.prototype, "findDueReleases");

      await handlerOf(t).updateEntry(
        { collectionName: "pages", entryId: page, overrideAccess: true },
        { title: "Hello", _overwrite: true }
      );

      expect(await releaseState(t, arranged.releaseId)).toBe("scheduled");
      expect(planned).not.toHaveBeenCalled();
    });

    it("plans only the component of the due release it stops, never every due release", async () => {
      // The stopped release shares a page with a second, so both form one component; a third due
      // release shares nothing and is no part of the stop's question.
      const t = await boot(dialect);
      const page = await doc(t, "pages");
      const shared = await doc(t, "pages");
      const apart = await doc(t, "pages");
      for (const id of [page, shared, apart]) await approve(t, "pages", id);
      const stopping = await arrange(
        t,
        [publishPage(page), publishPage(shared)],
        PAST
      );
      const beside = await arrange(t, [publishPage(shared)], PAST);
      const unrelated = await arrange(t, [publishPage(apart)], PAST);
      const dueRead = vi.spyOn(ReleasesRepository.prototype, "findDueReleases");
      const membersRead = vi.spyOn(
        ReleasesRepository.prototype,
        "listMembersOf"
      );
      // Only the stop's own reads: the step's read of the page walks the components of every page
      // a due release decides, as any reader's does.
      const readByStop: string[] = [];
      const stop = ReleasesService.prototype.stopOnHardProblems;
      vi.spyOn(
        ReleasesService.prototype,
        "stopOnHardProblems"
      ).mockImplementation(async function (this: ReleasesService, ...args) {
        const from = membersRead.mock.calls.length;
        try {
          return await stop.apply(this, args);
        } finally {
          readByStop.push(
            ...membersRead.mock.calls.slice(from).flatMap(([ids]) => ids)
          );
        }
      });

      await takeStep(t, "pages", page, null, "bounce", "Not yet.");

      expect(new Set(readByStop)).toEqual(
        new Set([stopping.releaseId, beside.releaseId])
      );
      expect(dueRead).not.toHaveBeenCalled();
      expect(await releaseState(t, stopping.releaseId)).toBe("blocked");
      expect(await releaseState(t, beside.releaseId)).toBe("blocked");
      expect(await releaseState(t, unrelated.releaseId)).toBe("scheduled");
    });

    it("binds no more ids in one statement than every dialect accepts, however many documents it judges", async () => {
      const t = await boot(dialect);
      const page = await doc(t, "pages");
      const { releaseId } = await arrange(t, [publishPage(page)], null);
      const repo = new ReleasesRepository(t.adapter);
      const [release] = await repo.findReleases({ ids: [releaseId] });
      const [real] = await repo.listMembers(releaseId);
      const source = releaseCheckSources().find(
        candidate => candidate.key === "workflows.approval"
      );
      if (!source || !release || !real) {
        throw new Error("no approval source, release or member to judge");
      }
      // More documents of one scope than one run binds: an unbatched read binds them all in one
      // statement, which past SQLite's limit fails, as a component of several releases can reach.
      const members = Array.from({ length: IDS_PER_LOOKUP + 1 }, (_, i) => ({
        ...real,
        id: `${real.id}-${i}`,
        entryId: i === 0 ? page : randomUUID(),
      }));
      const reads = new Proxy({} as ReleaseCheckReads, {
        get: (_target, name) => {
          throw new Error(`the approval check asked ${String(name)}`);
        },
      });
      const select = vi.spyOn(t.adapter, "select");

      await source.check(members, { release, now: new Date(), reads });

      const bound = select.mock.calls.map(([, options]) =>
        Math.max(
          0,
          ...(
            (
              options as {
                where?: { and?: { op?: string; value?: unknown }[] };
              }
            )?.where?.and ?? []
          )
            .filter(condition => condition.op === "IN")
            .map(condition =>
              Array.isArray(condition.value) ? condition.value.length : 0
            )
        )
      );
      expect(Math.max(...bound)).toBeLessThanOrEqual(IDS_PER_LOOKUP);
      // Each document's review state is still read on its own, so a server dialect needs longer.
    }, 120_000);

    it("refuses Publish now for an unapproved member, even to a person who may publish without review", async () => {
      const t = await boot(dialect);
      const page = await doc(t, "pages");
      const author = await seedPlainAuthor(t);
      // What the run meets on the page, Publish now on the release, and publishing past review.
      await grantTo(t, author, "publish-without-review", ["pages"]);
      for (const action of ["read", "update", "publish"]) {
        await grantTo(t, author, action, ["pages", "content-releases"]);
      }
      await grantTo(t, author, "unpublish", ["pages"]);
      const { releaseId } = await arrange(t, [publishPage(page)], null, {
        author,
        owner: author,
      });

      await expect(
        t.nextly.releases.publishNow({
          id: releaseId,
          userId: author,
          overrideAccess: false,
        })
      ).rejects.toMatchObject({
        code: "CONFLICT",
        publicData: {
          problems: [expect.objectContaining({ code: "NOT_APPROVED" })],
        },
      });
      expect(await releaseState(t, releaseId)).toBe("draft");
      expect(await storedPageStatus(t, page)).toBe("draft");
    });

    it("reads each member's review state once, and a scope's liveness and drafts once per batch", async () => {
      const t = await boot(dialect);
      const pages: string[] = [];
      for (let i = 0; i < 20; i += 1) pages.push(await doc(t, "pages"));
      const { releaseId } = await arrange(t, pages.map(publishPage), null);
      const repo = new ReleasesRepository(t.adapter);
      const [release] = await repo.findReleases({ ids: [releaseId] });
      const members = await repo.listMembers(releaseId);
      const source = releaseCheckSources().find(
        candidate => candidate.key === "workflows.approval"
      );
      if (!source) throw new Error("no workflows.approval check source");
      if (!release) throw new Error("the arranged release was not found");
      const pagesTable = (
        await (
          t.getService("collectionRegistryService") as CollectionRegistryService
        ).getCollectionBySlug("pages")
      )?.tableName;
      // The source asks nothing of the release reads: what it reads, it reads here.
      const reads = new Proxy({} as ReleaseCheckReads, {
        get: (_target, name) => {
          throw new Error(`the approval check asked ${String(name)}`);
        },
      });
      const ctx: ReleaseCheckContext = { release, now: new Date(), reads };
      const select = vi.spyOn(t.adapter, "select");

      const findings = await source.check(members, ctx);

      const tables = select.mock.calls.map(([table]) => table);
      const count = (table: string | undefined) =>
        tables.filter(name => name === table).length;
      expect(findings).toHaveLength(20);
      expect(count(REVIEW_STATES_TABLE)).toBe(20);
      expect(count(VERSIONS_TABLE)).toBe(1);
      expect(count(pagesTable)).toBe(1);
      // Each member's review state read once, and the batch reads naming every member.
      const readsOf = (table: string | undefined) =>
        select.mock.calls
          .filter(([name]) => name === table)
          .map(([, options]) => JSON.stringify(options ?? {}));
      const reviewReads = readsOf(REVIEW_STATES_TABLE);
      expect(
        pages.map(
          page => reviewReads.filter(read => read.includes(`"${page}"`)).length
        )
      ).toEqual(pages.map(() => 1));
      for (const page of pages) {
        expect(readsOf(VERSIONS_TABLE)[0]).toContain(`"${page}"`);
        expect(readsOf(pagesTable)[0]).toContain(`"${page}"`);
      }
    });
  }
);
