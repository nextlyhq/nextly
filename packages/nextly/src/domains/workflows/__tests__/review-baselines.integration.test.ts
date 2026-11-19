/**
 * The comparisons a review shows, "since submitted" and "since approved", resolved from the
 * versions workflows pinned for the part (`entered-review:<part>`, `approved:<part>`), through
 * the same function REST's diff route calls, on every configured dialect. A part with no such pin
 * is refused with its reason, as core's baselines are. The shared part (`part: "shared"`) is compared
 * across languages, over its shared fields alone, from its own approval or its last publish.
 */
import { afterEach, describe, expect, it } from "vitest";

import { superAdminUser } from "../../../__tests__/fixtures/permission-holders";
import { getVersionDiffForDocument } from "../../../dispatcher/handlers/versions-methods";
import { NextlyError } from "../../../errors";
import type { CollectionsHandler } from "../../../services/collections-handler";
import {
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import {
  approvedSlot,
  enteredReviewSlot,
  workflowPins,
} from "../workflow-pins";

import { bootSteps, entry, saveIn, shownVersion } from "./helpers/step-harness";

let t: TestNextly | undefined;

afterEach(async () => {
  await t?.destroy();
  t = undefined;
});

const app = (): TestNextly => {
  if (!t) throw new Error("not booted");
  return t;
};

const superAdmin = { id: "tester", roles: ["super-admin"] };

/** A page saved three times after its create, and the version each save recorded. */
async function pageWithSaves(): Promise<{ id: string; saves: number[] }> {
  const id = await entry(app(), "pages");
  const saves: number[] = [];
  for (const title of ["First", "Second", "Third"]) {
    // An update names its version or says it overwrites; this one read none.
    const saved = await (
      app().getService("collectionsHandler") as CollectionsHandler
    ).updateEntry(
      { collectionName: "pages", entryId: id, overrideAccess: true },
      { title, _overwrite: true }
    );
    expect(saved.success, JSON.stringify(saved)).toBe(true);
    saves.push(await shownVersion(app(), "pages", id, null));
  }
  return { id, saves };
}

/** Points the workflows slot `slot` of the page at `versionNo`, as a step does. */
async function pin(id: string, slot: string, versionNo: number) {
  await app().adapter.transaction(tx =>
    workflowPins.pin(tx, {
      ref: { scopeKind: "collection", scopeSlug: "pages", entryId: id },
      slot,
      versionNo,
    })
  );
}

function compare(
  id: string,
  args: {
    to: number;
    from?: number;
    baseline?: string;
    part?: "shared";
  },
  slug = "pages"
) {
  return getVersionDiffForDocument({
    scopeKind: "collection",
    slug,
    entryId: id,
    user: superAdmin,
    ...args,
  });
}

/** Points the workflows slot `slot` of the post at `versionNo`, as a step does. */
async function pinPost(id: string, slot: string, versionNo: number) {
  await app().adapter.transaction(tx =>
    workflowPins.pin(tx, {
      ref: { scopeKind: "collection", scopeSlug: "posts", entryId: id },
      slot,
      versionNo,
    })
  );
}

/**
 * A post whose shared field (`code`) changed in English after `since`, then saved in Spanish
 * with only its own title changed: `since` the English version the shared part is compared
 * from, `spanish` the Spanish version that carries the shared change.
 */
async function postWithSharedChange(
  sinceStatus: "draft" | "published"
): Promise<{ id: string; since: number; spanish: number }> {
  const id = await entry(app(), "posts");
  await saveIn(app(), "posts", id, "en", {
    title: "English one",
    code: "A",
    status: sinceStatus,
  });
  const since = await shownVersion(app(), "posts", id, "en");
  await saveIn(app(), "posts", id, "en", {
    title: "English two",
    code: "B",
    status: "draft",
  });
  await saveIn(app(), "posts", id, "es", {
    title: "Español",
    status: "draft",
  });
  const spanish = await shownVersion(app(), "posts", id, "es");
  return { id, since, spanish };
}

/** The names of a comparison's nodes that changed, and of every node it holds. */
function namesOf(diff: { fields: { name: string | null; status: string }[] }) {
  return {
    changed: diff.fields
      .filter(field => field.status !== "unchanged")
      .map(field => field.name),
    all: diff.fields.map(field => field.name),
  };
}

/** The refusal `promise` ends in: its code and message, as a reader is told them. */
async function refusalOf(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (err: unknown) => err
  );
  expect(NextlyError.is(error)).toBe(true);
  const errors = (error as NextlyError).publicData as {
    errors?: Array<{ code: string; message: string }>;
  };
  return errors.errors?.[0];
}

describe.each(getConfiguredTestDialects())(
  "the review baselines (integration, %s)",
  dialect => {
    it("compares with the version the part entered review at, and the one last approved", async () => {
      t = await bootSteps(dialect);
      // A super-admin the read gate can look up: role names on a user grant nothing.
      await superAdminUser(t, superAdmin.id);
      const { id, saves } = await pageWithSaves();
      const [submitted, approved, latest] = saves;
      await pin(id, enteredReviewSlot(null), submitted);
      await pin(id, approvedSlot(null), approved);

      expect(
        await compare(id, { to: latest, baseline: "since-submitted" })
      ).toMatchObject({
        from: submitted,
        to: latest,
        baseline: { name: "since-submitted", versionNo: submitted },
      });
      expect(
        await compare(id, { to: latest, baseline: "since-approved" })
      ).toMatchObject({
        from: approved,
        to: latest,
        baseline: { name: "since-approved", versionNo: approved },
      });
    });

    it("refuses a part never submitted or approved, and the pinned version itself, with why", async () => {
      t = await bootSteps(dialect);
      // A super-admin the read gate can look up: role names on a user grant nothing.
      await superAdminUser(t, superAdmin.id);
      const { id, saves } = await pageWithSaves();
      const latest = saves[2];

      expect(
        await refusalOf(
          compare(id, { to: latest, baseline: "since-submitted" })
        )
      ).toEqual({
        path: "baseline",
        code: "NO_BASELINE",
        message:
          "This part has not been submitted for review since it was last published, so there is no version to compare with.",
      });
      expect(
        await refusalOf(compare(id, { to: latest, baseline: "since-approved" }))
      ).toEqual({
        path: "baseline",
        code: "NO_BASELINE",
        message:
          "This part has not been approved since it was last published, so there is no approved version to compare with.",
      });

      await pin(id, approvedSlot(null), latest);
      expect(
        await refusalOf(compare(id, { to: latest, baseline: "since-approved" }))
      ).toMatchObject({
        code: "NO_BASELINE",
        message: "This is the version approved, so nothing has changed since.",
      });
    });

    it("compares the shared fields alone across languages, from the shared approval", async () => {
      t = await bootSteps(dialect);
      // A super-admin the read gate can look up: role names on a user grant nothing.
      await superAdminUser(t, superAdmin.id);
      const { id, since, spanish } = await postWithSharedChange("draft");
      await pinPost(id, approvedSlot(null), since);

      const fromApproval = await compare(
        id,
        { to: spanish, baseline: "since-approved", part: "shared" },
        "posts"
      );
      expect(fromApproval).toMatchObject({
        from: since,
        to: spanish,
        hasChanges: true,
        baseline: { name: "since-approved", versionNo: since },
      });
      // Exactly the shared change: the shared field, and no translated title in either
      // language, though both languages' titles differ between the two versions.
      expect(namesOf(fromApproval)).toEqual({
        changed: ["code"],
        all: ["code"],
      });

      // The same pair named outright compares the same fields.
      expect(
        namesOf(
          await compare(
            id,
            { from: since, to: spanish, part: "shared" },
            "posts"
          )
        )
      ).toEqual({ changed: ["code"], all: ["code"] });
    });

    it("compares the shared fields from the last publish in any language", async () => {
      t = await bootSteps(dialect);
      // A super-admin the read gate can look up: role names on a user grant nothing.
      await superAdminUser(t, superAdmin.id);
      const { id, since, spanish } = await postWithSharedChange("published");

      const fromPublish = await compare(
        id,
        { to: spanish, baseline: "published", part: "shared" },
        "posts"
      );
      expect(fromPublish).toMatchObject({
        from: since,
        to: spanish,
        baseline: { name: "published", versionNo: since },
      });
      expect(namesOf(fromPublish)).toEqual({
        changed: ["code"],
        all: ["code"],
      });
    });

    it("still refuses a pair in two languages without the shared part", async () => {
      t = await bootSteps(dialect);
      // A super-admin the read gate can look up: role names on a user grant nothing.
      await superAdminUser(t, superAdmin.id);
      const { id, since, spanish } = await postWithSharedChange("draft");

      expect(
        await refusalOf(compare(id, { from: since, to: spanish }, "posts"))
      ).toMatchObject({ path: "to", code: "LOCALE_MISMATCH" });
    });
  }
);
