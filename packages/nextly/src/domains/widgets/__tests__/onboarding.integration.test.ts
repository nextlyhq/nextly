/**
 * Onboarding steps against a real instance.
 *
 * The derivation is arithmetic and could be asked without a database; what
 * cannot is whether each step REACHES the thing it claims to detect. A step
 * that never resolves a collection reports "not done" forever, which on a fresh
 * install is also the right answer — so the assertions here move the answer,
 * and a detector that always said the same thing fails one half of every pair.
 *
 * @module domains/widgets/__tests__/onboarding.integration.test
 */

import { afterEach, describe, expect, it } from "vitest";

import { defineCollection, text } from "../../../config";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ReadCaller } from "../../../services/dashboard/readable-resources";
import { refreshCollectionSources } from "../collection-sources";
import { conditionProbe } from "../condition-probe";
import { onboardingIsIncomplete, onboardingSteps } from "../onboarding";

const NOTES = "notes";
/** A collection whose rows the reader under test may NOT read. */
const SECRETS = "secrets";
/** A collection the reader may read, whose create rule the case decides. */
const ARCHIVE = "archive";

/** An admin: the reader onboarding actually meets, and one who may read all. */
const admin: ReadCaller = {
  user: { id: "admin-1", roles: ["admin"] },
};

/**
 * A key stamped to create collections and to read none of them.
 *
 * A key rather than a session, because `callerHoldsPermission` judges a key on
 * its OWN stamped grants and a session through the RBAC tables -- and this
 * instance seeds no role holding `manage-settings`, so a session caller answers
 * "no" to both halves of the composition under test and cannot separate them.
 */
const builder: ReadCaller = {
  user: { id: "builder-1", roles: [] },
  authenticatedScope: {
    actorType: "apiKey",
    permissions: ["manage-settings"],
  },
};

type WriteHandler = {
  createEntry: (
    p: Record<string, unknown>,
    data: Record<string, unknown>
  ) => Promise<{ success: boolean }>;
};

/**
 * Writes a row and REFUSES to continue if the write did not land.
 *
 * Without this a failed insert leaves the install empty, and "nothing written
 * yet" is the state the assertions are trying to move away from -- so a broken
 * fixture would report every step detector working perfectly.
 */
async function write(
  t: TestNextly,
  collection: string,
  data: Record<string, unknown>
): Promise<void> {
  const handler = t.getService("collectionsHandler") as unknown as WriteHandler;
  const result = await handler.createEntry(
    { collectionName: collection, overrideAccess: true },
    data
  );
  expect(result.success).toBe(true);
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

async function boot(): Promise<TestNextly> {
  const t = await createTestNextly({
    collections: [
      defineCollection({
        slug: SECRETS,
        // Readable by nobody. A step must not be ticked by content the reader
        // cannot see, and the only way to know it is not is to have some.
        access: { read: () => false, create: () => true, update: () => true },
        fields: [text({ name: "title" })],
      }),
      defineCollection({
        slug: NOTES,
        status: true,
        access: { read: () => true, create: () => true, update: () => true },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  current = t;
  // The same call `POST /api/dashboard/query` makes before resolving anything:
  // publish the collection sources from the LIVE registry. Boot does not, and
  // the steps read that registry to know which collections exist.
  await refreshCollectionSources();
  return t;
}

/**
 * One collection this reader may READ and may not CREATE in, and nothing else.
 *
 * Its own boot because the shared fixture grants `create` on `notes`: with a
 * creatable collection in reach the reader CAN take the first-entry step, so
 * that fixture cannot tell a per-step predicate from no predicate at all.
 */
async function bootReadOnly(mayCreate: boolean): Promise<TestNextly> {
  const t = await createTestNextly({
    collections: [
      defineCollection({
        slug: ARCHIVE,
        access: {
          read: () => true,
          create: () => mayCreate,
          update: () => true,
        },
        fields: [text({ name: "title" })],
      }),
    ],
  });
  current = t;
  await refreshCollectionSources();
  return t;
}

/** The steps as a map, so a case names the step it is about. */
async function stepsFor(caller: ReadCaller): Promise<Record<string, boolean>> {
  const steps = await onboardingSteps(conditionProbe(caller));
  return Object.fromEntries(steps.map(step => [step.id, step.complete]));
}

describe("onboarding steps against a real instance", () => {
  it("counts the account as done, and it is not a courtesy", async () => {
    // The endowed-progress head start. True by construction rather than
    // granted: reaching the evaluator at all means an authenticated reader.
    await boot();

    expect((await stepsFor(admin)).account).toBe(true);
  });

  it("sees a declared collection, and no content yet", async () => {
    await boot();
    const steps = await stepsFor(admin);

    expect(steps.collection).toBe(true);
    expect(steps.entry).toBe(false);
    expect(await onboardingIsIncomplete(conditionProbe(admin))).toBe(true);
  });

  it("finishes once a row exists", async () => {
    // The must-differ half. Without it a detector that never reached the
    // collection would report every step outstanding forever and satisfy the
    // case above.
    const t = await boot();
    await write(t, NOTES, { title: "the first note" });

    expect((await stepsFor(admin)).entry).toBe(true);
    expect(await onboardingIsIncomplete(conditionProbe(admin))).toBe(false);
  });

  it("counts a DRAFT as content", async () => {
    // Someone who has written one post and not published it has taken the
    // step. Telling them otherwise is the onboarding equivalent of losing
    // their work, and a published-only count would do exactly that.
    const t = await boot();
    await write(t, NOTES, { title: "unpublished", status: "draft" });

    expect((await stepsFor(admin)).entry).toBe(true);
  });

  it("does NOT tick a step from content this reader may not read", async () => {
    // 🔴 The claim these steps make is that they are READER-SCOPED. Every other
    // case here grants the reader everything, so none of them could tell a
    // reader-scoped detector from an unscoped one.
    //
    // The guard this exercises is the ENTITY filter: a collection the reader
    // may not read is dropped before any count is issued. Verified by removing
    // that filter, which fails this case by name.
    //
    // What it does NOT reach is the row-level guard -- `overrideAccess: false`
    // protects rows inside a collection the reader MAY read, and this fixture
    // denies the whole collection, so the rows never get that far. Stated here
    // rather than left to look covered.
    const t = await boot();
    await write(t, SECRETS, { title: "not for you" });

    expect((await stepsFor(admin)).entry).toBe(false);
    expect(await onboardingIsIncomplete(conditionProbe(admin))).toBe(true);
  });

  it("withholds the first-entry step from a reader who may create in nothing", async () => {
    // 🔴 The defect this pair exists for. Derived from what the reader may
    // READ, the step was outstanding for such a reader permanently: they
    // cannot write the row that would complete it, its link lands on a surface
    // that refuses them, and `onboarding:incomplete` therefore stayed true for
    // the life of their account -- pinning the card to their dashboard with an
    // action that always fails.
    //
    // Absent from the list rather than present-and-disabled: a step nobody can
    // take is not a task, and both WooCommerce's task list and SAP's guided
    // setup hide rather than grey out.
    await bootReadOnly(false);
    const steps = await stepsFor(admin);

    expect(steps.entry).toBeUndefined();
    // The aggregate follows from the list, which is the point of deriving it:
    // with no step this reader can act on, there is nothing to offer them.
    expect(await onboardingIsIncomplete(conditionProbe(admin))).toBe(false);
  });

  it("offers it when the same collection admits a create", async () => {
    // The must-differ half, and it has to be the SAME fixture with one rule
    // flipped. A case that merely booted the shared fixture would differ in
    // the collection set too, so a predicate that hid the step for any reason
    // at all -- or one that never ran -- would satisfy the pair.
    await bootReadOnly(true);
    const steps = await stepsFor(admin);

    expect(steps.entry).toBe(false);
    expect(await onboardingIsIncomplete(conditionProbe(admin))).toBe(true);
  });

  it("keeps a FINISHED step a reader could not have taken", async () => {
    // The asymmetry, asserted rather than left to the docblock. A finished
    // step is a fact about the install, not an offer -- so it stays on the
    // list and shows the reader how far the install has come. Only an
    // unfinished step has to be actionable.
    const t = await bootReadOnly(false);
    await write(t, ARCHIVE, { title: "written by someone else" });
    const steps = await stepsFor(admin);

    expect(steps.entry).toBe(true);
    expect(await onboardingIsIncomplete(conditionProbe(admin))).toBe(false);
  });

  it("offers a stamped key NEITHER step, because it could finish neither", async () => {
    // 🔴 Holding the definition grant is not being able to finish the
    // collection step. `seedPermissionsForCollection` assigns a new
    // collection's CRUD permissions to `super_admin` alone, so this caller
    // creates the collection, gains no `read-<slug>` for it, and finds the
    // step still outstanding -- permanently. Offering it moved the defect one
    // action later rather than fixing it.
    //
    // The entry step is withheld for the reason it always was: nothing
    // readable is in reach, and the definition grant is not a substitute.
    //
    // A KEY is the discriminating caller: a session super admin holds the same
    // grant AND would read what it creates, so it is still offered the step --
    // the case below.
    await createTestNextly({
      collections: [
        defineCollection({
          slug: SECRETS,
          access: { read: () => false, create: () => true, update: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
    }).then(t => {
      current = t;
      return refreshCollectionSources();
    });

    const steps = await stepsFor(builder);

    expect(steps.collection).toBeUndefined();
    expect(steps.entry).toBeUndefined();
    // Only the account remains, and it is already done -- so nothing is
    // offered and the card stays off their dashboard entirely.
    expect(Object.keys(steps)).toEqual(["account"]);
    expect(await onboardingIsIncomplete(conditionProbe(builder))).toBe(false);
  });

  it("DOES offer it to a super admin, who would read what they create", async () => {
    // The must-differ half, and without it "offered to nobody" satisfies the
    // case above. The instance's FIRST user is its super admin, so this is the
    // one caller for whom creating a collection also makes it readable -- and
    // it is exactly the reader a fresh install has.
    // NO collections, which is the only way the step is INCOMPLETE for a super
    // admin: they can read every collection that exists, so any fixture with
    // one completes the step and completion short-circuits the predicate --
    // the test would pass without exercising it at all.
    const t = await createTestNextly({ collections: [] });
    current = t;
    await refreshCollectionSources();

    const users = (
      t.nextly as unknown as {
        users: {
          create: (a: { data: Record<string, unknown> }) => Promise<{
            item: { id: string };
          }>;
        };
      }
    ).users;
    const owner = await users.create({
      data: {
        email: "owner@example.com",
        password: "Password123!",
        name: "Owner",
        isActive: true,
      },
    });

    const superAdmin: ReadCaller = {
      user: { id: owner.item.id, roles: [] },
    };
    const steps = await stepsFor(superAdmin);

    expect(steps.collection).toBe(false);
    expect(await onboardingIsIncomplete(conditionProbe(superAdmin))).toBe(true);
  });

  it("offers nothing to a reader with no collection in reach and no way to make one", async () => {
    // 🔴 The empty-list case, which the grant walk cannot answer on its own:
    // with nothing readable there is no `create-<slug>` to find, and reading
    // that absence as a refusal is a different claim from having observed one.
    // So the step follows the next question along -- could this reader make
    // the collection the entry would go in -- and this caller cannot.
    //
    // The must-differ half is `sees a declared collection, and no content yet`,
    // where the same caller IS offered the entry step because a creatable
    // collection is in reach. A predicate answering "no" unconditionally would
    // fail that one.
    await createTestNextly({
      collections: [
        defineCollection({
          slug: SECRETS,
          access: { read: () => false, create: () => true, update: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
    }).then(t => {
      current = t;
      return refreshCollectionSources();
    });

    const steps = await stepsFor(admin);

    expect(steps.collection).toBeUndefined();
    expect(steps.entry).toBeUndefined();
    // Only the account remains, and it is already done -- so there is nothing
    // to offer and the card is not put on their dashboard at all.
    expect(Object.keys(steps)).toEqual(["account"]);
    expect(await onboardingIsIncomplete(conditionProbe(admin))).toBe(false);
  });

  it("withholds the entry step from a KEY the collection's own create rule refuses", async () => {
    // 🔴 The two decisions disagree for exactly this caller. A bare permission
    // check reads the key's stamped `create-<slug>` and stops; the WRITE also
    // evaluates the collection's code-defined `access.create` against that
    // scope. Gated on the bare check, this key is told it may create -- and
    // the step it is offered is refused by the write it links to, which is the
    // defect the predicate exists to prevent.
    await createTestNextly({
      collections: [
        defineCollection({
          slug: ARCHIVE,
          access: {
            read: () => true,
            // Refuses the key, whatever the key is stamped with.
            create: () => false,
            update: () => true,
          },
          fields: [text({ name: "title" })],
        }),
      ],
    }).then(t => {
      current = t;
      return refreshCollectionSources();
    });

    const stamped: ReadCaller = {
      user: { id: "key-1", roles: [] },
      authenticatedScope: {
        actorType: "apiKey",
        permissions: [`read-${ARCHIVE}`, `create-${ARCHIVE}`],
      },
    };

    const steps = await stepsFor(stamped);
    expect(steps.entry).toBeUndefined();
  });

  it("offers it to the same KEY when the rule admits it", async () => {
    // The must-differ half, and it has to be the same fixture with the one
    // rule flipped: a predicate that refused every key -- or never ran --
    // would satisfy the case above on its own.
    await createTestNextly({
      collections: [
        defineCollection({
          slug: ARCHIVE,
          access: { read: () => true, create: () => true, update: () => true },
          fields: [text({ name: "title" })],
        }),
      ],
    }).then(t => {
      current = t;
      return refreshCollectionSources();
    });

    const stamped: ReadCaller = {
      user: { id: "key-1", roles: [] },
      authenticatedScope: {
        actorType: "apiKey",
        permissions: [`read-${ARCHIVE}`, `create-${ARCHIVE}`],
      },
    };

    const steps = await stepsFor(stamped);
    expect(steps.entry).toBe(false);
  });

  // No case asserts that the condition agrees with the steps it reports.
  // `onboardingIsIncomplete` CALLS `onboardingSteps`, so the two cannot
  // disagree and any such test would pass on every implementation, including a
  // broken one -- it would compare one derivation against itself. The agreement
  // is structural rather than observable, which is the reason for deriving the
  // condition instead of computing it beside them; the cases above assert both
  // through the same fixtures, which is what makes the derivation visible.
});
