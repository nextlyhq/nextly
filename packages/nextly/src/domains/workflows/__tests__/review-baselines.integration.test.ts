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
import { createDynamicHandlers } from "../../../routeHandler";
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

import {
  bootSteps,
  entry,
  person,
  role,
  saveIn,
  shownVersion,
} from "./helpers/step-harness";

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
async function postWithSharedChange(): Promise<{
  id: string;
  since: number;
  spanish: number;
}> {
  const id = await entry(app(), "posts");
  await saveIn(app(), "posts", id, "en", {
    title: "English one",
    code: "A",
    status: "draft",
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

/**
 * The names of a comparison's content nodes that changed, and whether it holds a node for the
 * translated title at all, changed or not. A column the framework keeps on every document (when
 * it was first published) is a `system` node, which a dialect storing whole seconds can show as
 * changed between a publish and a later save; it is no field of the content type.
 */
function namesOf(diff: {
  fields: { name: string | null; status: string; reason?: string }[];
}) {
  const content = diff.fields.filter(field => field.reason !== "system");
  return {
    changed: content
      .filter(field => field.status !== "unchanged")
      .map(field => field.name),
    title: content.some(field => field.name === "title"),
  };
}

/** A role-based API key owned by `ownerId`, its role holding exactly `read-posts`. */
async function postsReaderKey(ownerId: string): Promise<string> {
  const apiKeys = app().getService("apiKeyService") as unknown as {
    createApiKey: (
      userId: string,
      input: {
        name: string;
        tokenType: string;
        roleId: string;
        expiresIn: string;
      }
    ) => Promise<{ key: string }>;
  };
  const { key } = await apiKeys.createApiKey(ownerId, {
    name: "posts reader key",
    tokenType: "role-based",
    roleId: await role(app(), "posts-key-reader", [["read", "posts"]]),
    expiresIn: "unlimited",
  });
  return key;
}

/** REST's comparison of a post's versions, as `key`, with the query given. */
async function restCompare(
  key: string,
  id: string,
  query: Record<string, string>
): Promise<{ status: number; body: unknown }> {
  const segments = ["collections", "posts", "entries", id, "versions", "diff"];
  const response = await createDynamicHandlers().GET(
    new Request(
      `http://localhost/api/${segments.join("/")}?${new URLSearchParams(query).toString()}`,
      { headers: { authorization: `Bearer ${key}` } }
    ),
    { params: Promise.resolve({ params: segments }) }
  );
  return { status: response.status, body: await response.json() };
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
      const { id, since, spanish } = await postWithSharedChange();
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
        title: false,
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
      ).toEqual({ changed: ["code"], title: false });
    });

    it("compares the shared fields from the last publish in any language", async () => {
      t = await bootSteps(dialect);
      // A super-admin the read gate can look up: role names on a user grant nothing.
      await superAdminUser(t, superAdmin.id);
      // Published in English, then the shared field changed by a Spanish draft and the Spanish
      // title saved again: a Spanish draft leaves the document published.
      const id = await entry(app(), "posts");
      await saveIn(app(), "posts", id, "en", {
        title: "English one",
        code: "A",
        status: "published",
      });
      const since = await shownVersion(app(), "posts", id, "en");
      await saveIn(app(), "posts", id, "es", {
        title: "Español",
        code: "B",
        status: "draft",
      });
      await saveIn(app(), "posts", id, "es", {
        title: "Español dos",
        status: "draft",
      });
      const spanish = await shownVersion(app(), "posts", id, "es");

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
        title: false,
      });
    });

    it("still refuses a pair in two languages without the shared part", async () => {
      t = await bootSteps(dialect);
      // A super-admin the read gate can look up: role names on a user grant nothing.
      await superAdminUser(t, superAdmin.id);
      const { id, since, spanish } = await postWithSharedChange();

      expect(
        await refusalOf(compare(id, { from: since, to: spanish }, "posts"))
      ).toMatchObject({ path: "to", code: "LOCALE_MISMATCH" });
    });

    it("answers a shared comparison through the Direct API as REST answers it", async () => {
      t = await bootSteps(dialect);
      const reader = await person(t, "posts-reader", [["read", "posts"]]);
      const key = await postsReaderKey(reader.userId);
      const { id, since, spanish } = await postWithSharedChange();

      const rest = await restCompare(key, id, {
        from: String(since),
        to: String(spanish),
        part: "shared",
      });
      expect(rest.status, JSON.stringify(rest.body)).toBe(200);
      const direct = await t.nextly.versions.compare({
        collection: "posts",
        id,
        from: since,
        to: spanish,
        part: "shared",
        overrideAccess: false,
        user: { id: reader.userId },
      });
      // One answer through either door: the shared field alone, across languages.
      expect(direct).toEqual(rest.body);
      expect(namesOf(direct)).toEqual({ changed: ["code"], title: false });

      // Without `part`, the Direct API still refuses the pair in two languages.
      expect(
        await refusalOf(
          t.nextly.versions.compare({
            collection: "posts",
            id,
            from: since,
            to: spanish,
            overrideAccess: false,
            user: { id: reader.userId },
          })
        )
      ).toMatchObject({ path: "to", code: "LOCALE_MISMATCH" });
    });
  }
);
