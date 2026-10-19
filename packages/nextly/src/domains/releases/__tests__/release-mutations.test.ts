/**
 * When a release action would change nothing, and so may be left out.
 *
 * A document already where the action leaves it is settled only while it holds
 * no working draft: the publish write promotes a held draft, so a document
 * whose stored status already reads published still has its pending edit to
 * put live. Leaving that write out would mark the release published with the
 * edit never shown.
 *
 * A document-wide action moves every language, so it is settled only while
 * every stored translation already has the status the action leaves: the
 * default language's alone says nothing about a German translation still in
 * draft.
 *
 * @module domains/releases/__tests__/release-mutations.test
 */
import { describe, expect, it, vi } from "vitest";

import type { JobContentSource } from "../../jobs/job-content-api";
import { createReleaseMutations } from "../release-mutations";
import type { DocumentRef } from "../releases-repository";
import type { ValidationIssue } from "../../../shared/lib/entry-validation";

const USER = { id: "author" };

const POST: DocumentRef = {
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "e1",
  locale: null,
};

type Languages = ReadonlyMap<string, string | null> | null;

/**
 * Mutations over a document stored with `status`, `languages` and held
 * `heldDrafts`, read as one snapshot, whose document read reports
 * `readStatus` (a read hook may say otherwise than the row), for an author the
 * write's gate and field rules do or do not let act.
 */
function mutations(
  status: string,
  heldDrafts: (string | null)[],
  languages: Languages = new Map(),
  over: {
    readStatus?: string;
    mayPerform?: boolean;
    problems?: ValidationIssue[];
  } = {}
) {
  const readStatus = over.readStatus ?? status;
  const contentApi = {
    findByID: async () => ({ id: "e1", status: readStatus }),
    findSingle: async () => ({ id: "s1", status: readStatus }),
  } as unknown as JobContentSource;
  const storedLifecycle = vi.fn(async () =>
    languages === null ? null : { status, languages, drafts: heldDrafts }
  );
  const mayPerform = vi.fn(async () => over.mayPerform ?? true);
  const publishProblems = vi.fn(
    async (_scope: unknown, entryIds: readonly string[]) =>
      new Map(entryIds.map(id => [id, over.problems ?? []]))
  );
  const m = createReleaseMutations({
    contentApi,
    settlement: { storedLifecycle, mayPerform, publishProblems },
  });
  const settled = m.settled;
  if (settled === undefined) throw new Error("settled not offered");
  return {
    m: { settled, applied: m.applied },
    storedLifecycle,
    mayPerform,
    publishProblems,
  };
}

describe("a release action that would change nothing", () => {
  it("is settled when the document is already published and holds no draft", async () => {
    const { m } = mutations("published", []);
    expect(await m.settled({ ref: POST, effect: "publish", user: USER })).toBe(
      true
    );
  });

  it("is NOT settled while a working draft is held, in any language", async () => {
    for (const held of [[null], ["de"]]) {
      const { m } = mutations("published", held);
      expect(
        await m.settled({ ref: POST, effect: "publish", user: USER })
      ).toBe(false);
    }
  });

  it("is NOT settled when the stored status is not the target", async () => {
    const { m } = mutations("draft", []);
    expect(await m.settled({ ref: POST, effect: "publish", user: USER })).toBe(
      false
    );
  });

  it("judges a withdrawal by the withdrawn status, and asks about the whole document", async () => {
    const { m, storedLifecycle } = mutations("draft", []);
    expect(
      await m.settled({ ref: POST, effect: "unpublish", user: USER })
    ).toBe(true);
    expect(storedLifecycle).toHaveBeenCalledWith(POST);
  });

  it("is NOT settled while another language is still where it was", async () => {
    // The default language is published and reads as the document's status;
    // German is still a draft, and the publish is what moves it.
    const { m } = mutations(
      "published",
      [],
      new Map([
        ["en", "published"],
        ["de", "draft"],
      ])
    );
    expect(await m.settled({ ref: POST, effect: "publish", user: USER })).toBe(
      false
    );
  });

  it("is NOT settled while a takedown would still pull a translation", async () => {
    const { m } = mutations(
      "draft",
      [],
      new Map([
        ["en", "draft"],
        ["de", "published"],
      ])
    );
    expect(
      await m.settled({ ref: POST, effect: "unpublish", user: USER })
    ).toBe(false);
  });

  it("is settled when every stored language is already where the action leaves it", async () => {
    const { m } = mutations(
      "published",
      [],
      new Map([
        ["en", "published"],
        ["de", "published"],
      ])
    );
    expect(await m.settled({ ref: POST, effect: "publish", user: USER })).toBe(
      true
    );
  });

  it("is NOT settled when the languages cannot be read", async () => {
    const { m } = mutations("published", [], null);
    expect(await m.settled({ ref: POST, effect: "publish", user: USER })).toBe(
      false
    );
  });

  it("is NOT settled for a stored draft that the document read reports as published", async () => {
    // A read hook can rewrite what a read returns; the stored row cannot lie.
    const { m } = mutations("draft", [], new Map(), {
      readStatus: "published",
    });
    expect(await m.settled({ ref: POST, effect: "publish", user: USER })).toBe(
      false
    );
  });

  it("is NOT settled for an author the write's gate refuses", async () => {
    // The document already stands, but the write would refuse this author.
    const { m, mayPerform } = mutations("published", [], new Map(), {
      mayPerform: false,
    });
    expect(await m.settled({ ref: POST, effect: "publish", user: USER })).toBe(
      false
    );
    expect(mayPerform).toHaveBeenCalledWith(USER, POST, "publish");
  });

  it("is NOT settled for an author whose field rules refuse the status the write sets", async () => {
    // The gate lets them act, but the write's field rules strip its status.
    const { m, publishProblems } = mutations("published", [], new Map(), {
      problems: [{ path: "status", code: "FORBIDDEN", message: "no" }],
    });
    expect(await m.settled({ ref: POST, effect: "publish", user: USER })).toBe(
      false
    );
    expect(publishProblems).toHaveBeenCalledWith(POST, ["e1"], USER, "publish");
  });

  it("confirms a committed write from storage alone, not from the author's present authority", async () => {
    // A role revoked after the write committed (by a hook, or a race) says
    // nothing about what committed.
    const { m, mayPerform } = mutations("published", [], new Map(), {
      mayPerform: false,
    });
    expect(await m.applied({ ref: POST, effect: "publish", user: USER })).toBe(
      true
    );
    expect(mayPerform).not.toHaveBeenCalled();
  });

  it("does not confirm a write the storage read cannot vouch for", async () => {
    const { m } = mutations("published", [], null);
    expect(await m.applied({ ref: POST, effect: "publish", user: USER })).toBe(
      false
    );
  });

  it("offers no settlement without the stored lifecycle and the write's judgements", () => {
    const m = createReleaseMutations({ contentApi: {} as JobContentSource });
    expect(m.settled).toBeUndefined();
  });
});
