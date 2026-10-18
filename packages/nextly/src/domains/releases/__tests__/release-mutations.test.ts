/**
 * When a release action would change nothing, and so may be left out.
 *
 * A document already where the action leaves it is settled only while it holds
 * no working draft: the publish write promotes a held draft, so a document
 * whose stored status already reads published still has its pending edit to
 * put live. Leaving that write out would mark the release published with the
 * edit never shown.
 *
 * @module domains/releases/__tests__/release-mutations.test
 */
import { describe, expect, it, vi } from "vitest";

import type { JobContentSource } from "../../jobs/job-content-api";
import { createReleaseMutations } from "../release-mutations";
import type { DocumentRef } from "../releases-repository";

const USER = { id: "author" };

const POST: DocumentRef = {
  scopeKind: "collection",
  scopeSlug: "posts",
  entryId: "e1",
  locale: null,
};

function mutations(status: string, heldDrafts: (string | null)[]) {
  const listWorkingDraftLocales = vi.fn(async () => heldDrafts);
  const contentApi = {
    findByID: async () => ({ id: "e1", status }),
    findSingle: async () => ({ id: "s1", status }),
  } as unknown as JobContentSource;
  return {
    m: createReleaseMutations({
      contentApi,
      drafts: { listWorkingDraftLocales },
    }),
    listWorkingDraftLocales,
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

  it("is NOT settled when the stored status is not the target, and reads no drafts", async () => {
    const { m, listWorkingDraftLocales } = mutations("draft", []);
    expect(await m.settled({ ref: POST, effect: "publish", user: USER })).toBe(
      false
    );
    expect(listWorkingDraftLocales).not.toHaveBeenCalled();
  });

  it("judges a withdrawal by the withdrawn status, and asks about the whole document", async () => {
    const { m, listWorkingDraftLocales } = mutations("draft", []);
    expect(
      await m.settled({ ref: POST, effect: "unpublish", user: USER })
    ).toBe(true);
    expect(listWorkingDraftLocales).toHaveBeenCalledWith({
      scopeKind: "collection",
      scopeSlug: "posts",
      entryId: "e1",
    });
  });
});
