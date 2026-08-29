/**
 * How a release performs its members' writes.
 *
 * The cases worth exercising are the two the ordinary update path gets wrong on
 * a localized collection: which languages a DOCUMENT-WIDE member reaches, and
 * what happens when the write is refused.
 *
 * @module domains/releases/__tests__/release-mutations.test
 */
import { describe, expect, it, vi } from "vitest";

import { createReleaseMutations } from "../release-mutations";
import type { AllLocalesLifecyclePort } from "../release-mutations";
import type { DocumentRef } from "../releases-repository";

const USER = { id: "u1" } as never;

function ref(over: Partial<DocumentRef> = {}): DocumentRef {
  return {
    scopeKind: "collection",
    scopeSlug: "pages",
    entryId: "e1",
    locale: null,
    ...over,
  } as DocumentRef;
}

/** The Direct API, which reaches ONE language and is the fallback path. */
function contentApi() {
  return {
    update: vi.fn(async () => ({})),
    updateSingle: vi.fn(async () => ({})),
    findByID: vi.fn(async () => ({ status: "published" })),
    findSingle: vi.fn(async () => ({ status: "published" })),
  } as never;
}

function allLocales(
  over: Partial<AllLocalesLifecyclePort> = {}
): AllLocalesLifecyclePort {
  return {
    publishAllLocales: vi.fn(async () => ({ success: true })),
    unpublishAllLocales: vi.fn(async () => ({ success: true })),
    ...over,
  };
}

describe("a document-wide member", () => {
  it("withdraws through the ALL-LANGUAGES operation, not an ordinary update", async () => {
    // The defect this closes. An ordinary update carrying no locale reaches the
    // default language only, so other translations stay published while the read
    // seam hides the whole entry — and one reappears when the projection goes.
    const api = contentApi();
    const port = allLocales();
    const mutations = createReleaseMutations({
      contentApi: api,
      allLocales: port,
    });

    await mutations.unpublish({ ref: ref(), user: USER });

    expect(port.unpublishAllLocales).toHaveBeenCalledWith({
      collectionName: "pages",
      entryId: "e1",
      user: USER,
    });
    expect(
      (api as unknown as { update: ReturnType<typeof vi.fn> }).update
    ).not.toHaveBeenCalled();
  });

  it("publishes through it too — the control", async () => {
    // A wiring that routed only withdrawals would satisfy the case above while
    // leaving every scheduled PUBLISH reaching one language.
    const port = allLocales();
    const mutations = createReleaseMutations({
      contentApi: contentApi(),
      allLocales: port,
    });

    await mutations.publish({ ref: ref(), user: USER });

    expect(port.publishAllLocales).toHaveBeenCalledTimes(1);
    expect(port.unpublishAllLocales).not.toHaveBeenCalled();
  });

  it("THROWS when the all-languages write is refused", async () => {
    // The property the applier depends on, asserted here because nothing else
    // states it. The handler answers with an envelope rather than throwing; a
    // refusal passed back as a value would be read as success, the release would
    // be marked published, its read-time projection removed, and the takedown
    // lost permanently while every translation stayed readable.
    const port = allLocales({
      unpublishAllLocales: vi.fn(async () => ({
        success: false,
        message: "Run `nextly migrate` to add the column",
      })),
    });
    const mutations = createReleaseMutations({
      contentApi: contentApi(),
      allLocales: port,
    });

    await expect(
      mutations.unpublish({ ref: ref(), user: USER })
    ).rejects.toThrow(/nextly migrate/);
  });

  it("falls back to the ordinary update when no port is wired", async () => {
    // A runtime that has not wired the port keeps working rather than failing to
    // construct. It has the localized defect — which is why every real wiring
    // site supplies one — but it is not made WORSE by this change.
    const api = contentApi();
    const mutations = createReleaseMutations({ contentApi: api });

    await mutations.unpublish({ ref: ref(), user: USER });

    expect(
      (api as unknown as { update: ReturnType<typeof vi.fn> }).update
    ).toHaveBeenCalledTimes(1);
  });
});

describe("a locale-scoped member", () => {
  it("does NOT use the all-languages operation", async () => {
    // Per-locale members are refused upstream by the applier, but if one ever
    // reaches here it must not be widened into a document-wide write: that would
    // take down languages the member never named.
    const api = contentApi();
    const port = allLocales();
    const mutations = createReleaseMutations({
      contentApi: api,
      allLocales: port,
    });

    await mutations.unpublish({ ref: ref({ locale: "de" }), user: USER });

    expect(port.unpublishAllLocales).not.toHaveBeenCalled();
    expect(
      (api as unknown as { update: ReturnType<typeof vi.fn> }).update
    ).toHaveBeenCalledTimes(1);
  });
});
