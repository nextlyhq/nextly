/**
 * Assigning parts of documents to a person or a role through the steps service, on every
 * configured dialect: who may assign (the right to edit, or the stage's primary step), who may be
 * assigned (a person or role holding the stage's primary step, read through the roles in force, a
 * role's inheritance and super-admin), each refused assignee named with why, singly and in bulk,
 * nothing assigned unless everything is, a due date, the compare-and-set on the revision, the
 * assignment's event, and a role as a stage's default reviewer.
 *
 * In Legal check the primary step is Clear (`sign-off-posts`); in Writing it is Send, which names
 * no action (`update-posts`), so one assignee can be eligible in one stage and not the other.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { workflowDefinitionHash } from "../hash";
import type { ReviewAssignee } from "../review-state-repository";
import {
  assignWorkflowParts,
  takeWorkflowStep,
  type Assignment,
  type WorkflowCaller,
} from "../steps";
import { writeWorkflowSettings } from "../workflow-settings-repository";

import {
  bootSteps,
  entry,
  giveRole,
  partOf,
  person,
  role,
  seedState,
  stateDb,
  stateOf,
  superAdminRole,
  versionOf,
  workflowEvents,
} from "./helpers/step-harness";
import { editorial } from "./helpers/step-workflows";

const HASH = workflowDefinitionHash(editorial);
const DUE = new Date("2026-11-20T17:00:00.000Z");

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

/** An assignment of one Posts part. */
const of = (
  entryId: string,
  part: string | null,
  revision: number,
  assignee: ReviewAssignee | null,
  dueAt?: Date
): Assignment => ({
  document: { scopeKind: "collection", scopeSlug: "posts", entryId },
  part,
  revision,
  assignee,
  ...(dueAt ? { dueAt } : {}),
});

const user = (id: string): ReviewAssignee => ({ kind: "user", id });
const roleAssignee = (id: string): ReviewAssignee => ({ kind: "role", id });

function assign(caller: WorkflowCaller, assignments: Assignment[]) {
  if (!t) throw new Error("not booted");
  return assignWorkflowParts(t.adapter, { assignments, caller });
}

/** A Posts document whose English part is in Legal check at revision 1. */
async function postInLegal(target: TestNextly): Promise<string> {
  const post = await entry(target, "posts");
  await seedState(target, partOf("posts", post, "en"), "legal", {
    enteredBy: "alice",
    definitionHash: HASH,
  });
  return post;
}

describe.each(getConfiguredTestDialects())(
  "assigning parts for review (%s)",
  dialect => {
    it("assigns a part to a person holding the stage's primary step, with a due date, and records it", async () => {
      t = await bootSteps(dialect);
      const dave = await person(t, "dave", [["update", "posts"]]);
      await person(t, "bob", [["sign-off", "posts"]]);
      const post = await postInLegal(t);

      const result = await assign(dave, [of(post, "en", 1, user("bob"), DUE)]);

      expect(result.assigned).toEqual([
        {
          document: {
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: post,
          },
          part: "en",
          revision: 2,
        },
      ]);
      const state = await stateOf(t, partOf("posts", post, "en"));
      expect(state).toMatchObject({
        stage: "legal",
        assignee: user("bob"),
        revision: 2,
      });
      expect(state?.dueAt?.getTime()).toBe(DUE.getTime());
      const events = await workflowEvents(t, "posts", post);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        kind: "workflow-assign",
        parts: ["en"],
        actorKind: "person",
        actorId: "dave",
        payload: expect.objectContaining({ assignee: user("bob") }),
      });
    });

    it("assigns a part with no review state at the first stage, by that stage's primary step", async () => {
      t = await bootSteps(dialect);
      const dave = await person(t, "dave", [["update", "posts"]]);
      const post = await entry(t, "posts");

      // Writing's primary step, Send, names no action: editing is what it needs.
      await assign(dave, [of(post, "es", 0, user("dave"))]);

      expect(await stateOf(t, partOf("posts", post, "es"))).toMatchObject({
        stage: "writing",
        assignee: user("dave"),
        dueAt: null,
        revision: 1,
      });
    });

    it("lets a holder of the stage's primary step assign without the right to edit", async () => {
      t = await bootSteps(dialect);
      const frank = await person(t, "frank", [["sign-off", "posts"]]);
      await person(t, "bob", [["sign-off", "posts"]]);
      const post = await postInLegal(t);

      await assign(frank, [of(post, "en", 1, user("bob"))]);

      expect((await stateOf(t, partOf("posts", post, "en")))?.assignee).toEqual(
        user("bob")
      );
    });

    it("refuses a caller who may neither edit nor take the primary step, singly and in bulk, assigning nothing", async () => {
      t = await bootSteps(dialect);
      const gina = await person(t, "gina", [["read", "posts"]]);
      const frank = await person(t, "frank", [["sign-off", "posts"]]);
      await person(t, "bob", [["sign-off", "posts"]]);
      const post = await postInLegal(t);

      await expect(
        assign(gina, [of(post, "en", 1, user("bob"))])
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        publicData: {
          reason: "no-permission",
          refused: [{ index: 0, anyOf: ["update-posts", "sign-off-posts"] }],
        },
      });

      // Frank may assign in Legal check but not in Writing, where Spanish is: the bulk call is
      // refused for Spanish, and English, which he could assign, is not assigned either.
      await expect(
        assign(frank, [
          of(post, "en", 1, user("bob")),
          of(post, "es", 0, user("bob")),
        ])
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        publicData: {
          reason: "no-permission",
          refused: [{ index: 1, anyOf: ["update-posts"] }],
        },
      });
      expect(await stateOf(t, partOf("posts", post, "en"))).toMatchObject({
        assignee: null,
        revision: 1,
      });
      expect(await stateOf(t, partOf("posts", post, "es"))).toBeNull();
      expect(await workflowEvents(t, "posts", post)).toEqual([]);
    });

    it("refuses an assigner whose right to edit the collection's update rule refuses, though they hold update", async () => {
      t = await bootSteps(dialect);
      const dave = await person(t, "dave", [["update", "locked"]]);
      const doc = await entry(t, "locked");

      await expect(
        assign(dave, [
          {
            document: {
              scopeKind: "collection",
              scopeSlug: "locked",
              entryId: doc,
            },
            part: null,
            revision: 0,
            assignee: user("dave"),
          },
        ])
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        publicData: {
          reason: "no-permission",
          refused: [{ index: 0, anyOf: ["update-locked"] }],
        },
      });
      expect(await stateOf(t, partOf("locked", doc, null))).toBeNull();
      expect(await workflowEvents(t, "locked", doc)).toEqual([]);
    });

    it("judges an assigner's right to edit in the part's own language: Spanish, which the rule allows, and not English", async () => {
      t = await bootSteps(dialect);
      const dave = await person(t, "dave", [["update", "translations"]]);
      const doc = await entry(t, "translations");
      const part = (language: string): Assignment => ({
        document: {
          scopeKind: "collection",
          scopeSlug: "translations",
          entryId: doc,
        },
        part: language,
        revision: 0,
        assignee: user("dave"),
      });

      await assign(dave, [part("es")]);
      expect(
        (await stateOf(t, partOf("translations", doc, "es")))?.assignee
      ).toEqual(user("dave"));

      await expect(assign(dave, [part("en")])).rejects.toMatchObject({
        code: "FORBIDDEN",
        publicData: {
          reason: "no-permission",
          refused: [{ index: 0, anyOf: ["update-translations"] }],
        },
      });
      expect(await stateOf(t, partOf("translations", doc, "en"))).toBeNull();
    });

    it("refuses each ineligible person, naming them and why, singly and in bulk, assigning nothing", async () => {
      t = await bootSteps(dialect);
      const dave = await person(t, "dave", [
        ["update", "posts"],
        ["sign-off", "posts"],
      ]);
      await person(t, "bob", [["sign-off", "posts"]]);
      // May edit, but not clear.
      await person(t, "carol", [["update", "posts"]]);
      // Holds the step, but is deactivated.
      await person(t, "hank", [["sign-off", "posts"]], { active: false });
      // Held the step through a role assignment that has lapsed.
      await person(t, "ivy", []);
      await giveRole(
        t,
        "ivy",
        await role(t, "lapsed-approvers", [["sign-off", "posts"]]),
        new Date("2020-01-01T00:00:00.000Z")
      );
      const posts = [
        await postInLegal(t),
        await postInLegal(t),
        await postInLegal(t),
        await postInLegal(t),
        await postInLegal(t),
      ] as const;

      await expect(
        assign(dave, [of(posts[0], "en", 1, user("carol"))])
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "assignments[0].assignee",
              code: "WORKFLOW_ASSIGNEE_LACKS_STEP",
            }),
          ],
        },
      });

      const bulk = [
        of(posts[0], "en", 1, user("bob")),
        of(posts[1], "en", 1, user("carol")),
        of(posts[2], "en", 1, user("hank")),
        of(posts[3], "en", 1, user("ivy")),
        of(posts[4], "en", 1, user("nobody")),
      ];
      await expect(assign(dave, bulk)).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "assignments[1].assignee",
              code: "WORKFLOW_ASSIGNEE_LACKS_STEP",
            }),
            expect.objectContaining({
              path: "assignments[2].assignee",
              code: "WORKFLOW_ASSIGNEE_DEACTIVATED",
            }),
            expect.objectContaining({
              path: "assignments[3].assignee",
              code: "WORKFLOW_ASSIGNEE_LACKS_STEP",
            }),
            expect.objectContaining({
              path: "assignments[4].assignee",
              code: "WORKFLOW_ASSIGNEE_NOT_FOUND",
            }),
          ],
        },
      });
      // Bob was eligible, but nothing is assigned unless everything is.
      for (const post of posts) {
        expect(await stateOf(t, partOf("posts", post, "en"))).toMatchObject({
          assignee: null,
          revision: 1,
        });
      }
    });

    it("accepts a role holding the step itself, through a role it inherits, or as super-admin, and refuses one that does not", async () => {
      t = await bootSteps(dialect);
      const dave = await person(t, "dave", [
        ["update", "posts"],
        ["sign-off", "posts"],
      ]);
      const readers = await role(t, "readers", [["read", "posts"]]);
      // Approvers hold the step and inherit Readers: Readers gain nothing from it.
      const approvers = await role(
        t,
        "approvers",
        [["sign-off", "posts"]],
        [readers]
      );
      // Seniors hold the step only by inheriting Approvers. (A role inheriting just one other
      // must hold a permission of its own, so they read posts.)
      const seniors = await role(
        t,
        "seniors",
        [["read", "posts"]],
        [approvers]
      );
      const writers = await role(t, "writers", [["update", "posts"]]);
      const admins = await superAdminRole(t);
      const eligible = [approvers, seniors, admins];
      const posts: string[] = [];
      for (let i = 0; i < 6; i += 1) posts.push(await postInLegal(t));

      await expect(
        assign(dave, [
          of(posts[0] ?? "", "en", 1, roleAssignee(readers)),
          of(posts[1] ?? "", "en", 1, roleAssignee(writers)),
          of(posts[2] ?? "", "en", 1, roleAssignee("no-such-role")),
        ])
      ).rejects.toMatchObject({
        code: "VALIDATION_ERROR",
        publicData: {
          errors: [
            expect.objectContaining({
              path: "assignments[0].assignee",
              code: "WORKFLOW_ASSIGNEE_LACKS_STEP",
            }),
            expect.objectContaining({
              path: "assignments[1].assignee",
              code: "WORKFLOW_ASSIGNEE_LACKS_STEP",
            }),
            expect.objectContaining({
              path: "assignments[2].assignee",
              code: "WORKFLOW_ASSIGNEE_NOT_FOUND",
            }),
          ],
        },
      });

      await assign(
        dave,
        eligible.map((id, i) =>
          of(posts[3 + i] ?? "", "en", 1, roleAssignee(id))
        )
      );
      for (const [i, id] of eligible.entries()) {
        expect(
          (await stateOf(t, partOf("posts", posts[3 + i] ?? "", "en")))
            ?.assignee
        ).toEqual(roleAssignee(id));
      }
    });

    it("refuses an assignment over a revision that moved since it was seen", async () => {
      t = await bootSteps(dialect);
      const dave = await person(t, "dave", [["update", "posts"]]);
      await person(t, "bob", [["sign-off", "posts"]]);
      const post = await postInLegal(t);

      await assign(dave, [of(post, "en", 1, user("bob"))]);
      await expect(
        assign(dave, [of(post, "en", 1, null)])
      ).rejects.toMatchObject({
        code: "CONFLICT",
        publicData: { reason: "stale" },
      });
      expect(await stateOf(t, partOf("posts", post, "en"))).toMatchObject({
        assignee: user("bob"),
        revision: 2,
      });
    });

    it("assigns a role named as the stage's default reviewer to a part entering it", async () => {
      t = await bootSteps(dialect);
      const dave = await person(t, "dave", [["update", "posts"]]);
      const approvers = await role(t, "approvers", [["sign-off", "posts"]]);
      await writeWorkflowSettings(
        stateDb(t),
        "editorial",
        { defaultReviewers: { legal: roleAssignee(approvers) } },
        null,
        "admin"
      );
      const post = await entry(t, "posts");

      const sent = await takeWorkflowStep(t.adapter, {
        document: {
          scopeKind: "collection",
          scopeSlug: "posts",
          entryId: post,
        },
        step: "send",
        parts: ["en"],
        seen: [
          {
            part: "en",
            revision: 0,
            version: await versionOf(t, "posts", post, "en"),
          },
        ],
        caller: dave,
      });

      expect(sent.reviewer).toEqual(roleAssignee(approvers));
      expect((await stateOf(t, partOf("posts", post, "en")))?.assignee).toEqual(
        roleAssignee(approvers)
      );
    });
  }
);
