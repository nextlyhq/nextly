/**
 * Autosave obeys the entity's stored versioning policy, on the SERVER.
 *
 * The admin is not the only caller. Any REST or plugin client holding update
 * access reaches this endpoint directly, so a check that lives in an editor is
 * a suggestion rather than a rule -- and what it would fail to prevent is
 * storing unpublished content for an entity whose owner switched autosave off,
 * or which records no versions at all.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

const policySpy = vi.fn();
const autosaveSpy = vi.fn();

vi.mock("../../../api/versions-access", () => ({
  assertVersionDocumentReadable: vi.fn(),
  assertVersionDocumentUpdatable: vi.fn(),
  resolveVersionsPolicy: (...a: unknown[]) => policySpy(...a),
  tryResolveCurrentFields: vi.fn(async () => []),
  redactSnapshotForUser: vi.fn(),
  resolveSingleDocumentId: vi.fn(),
  assertDiffVersionPair: vi.fn(),
  diffDocumentVersions: vi.fn(),
  hydrateVersionSnapshot: vi.fn(),
  resolveCurrentFields: vi.fn(async () => []),
}));

vi.mock("../../../auth/entity-read-access", () => ({
  canReadEntity: vi.fn(async () => true),
}));

vi.mock("../../../di", () => ({
  getService: () => ({ autosave: (...a: unknown[]) => autosaveSpy(...a) }),
}));

import { autosaveForDocument } from "../versions-methods";

const ARGS = {
  scopeKind: "collection" as const,
  slug: "posts",
  entryId: "e1",
  user: { id: "user-1" },
  params: { _authenticatedUserId: "user-1" },
  snapshot: { title: "typed" },
};

const ON = { drafts: { autosave: { enabled: true, intervalMs: 2000 } } };

beforeEach(() => {
  vi.clearAllMocks();
  autosaveSpy.mockResolvedValue({ updatedAt: new Date(), locale: null });
});

describe("autosave policy is enforced server-side", () => {
  it("stores a recovery point when the entity enables autosave", async () => {
    // The positive control. Without it, an implementation that refused every
    // request would satisfy each refusal test below and look correct.
    policySpy.mockResolvedValue(ON);

    await autosaveForDocument(ARGS);

    expect(autosaveSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses when the owner switched autosave off", async () => {
    policySpy.mockResolvedValue({
      drafts: { autosave: { enabled: false, intervalMs: 2000 } },
    });

    await expect(autosaveForDocument(ARGS)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(autosaveSpy).not.toHaveBeenCalled();
  });

  it("refuses for an entity that records no versions at all", async () => {
    // `null` is the registry's definite "unversioned", not missing
    // information, so there is nothing for a recovery point to belong to.
    policySpy.mockResolvedValue(null);

    await expect(autosaveForDocument(ARGS)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(autosaveSpy).not.toHaveBeenCalled();
  });

  it("refuses for history-only versioning, where autosave is absent", async () => {
    // `versions: { drafts: false }` resolves with no autosave branch. Reading
    // a missing branch as permission would enable the feature for every
    // history-only entity, which is the opposite of what its config says.
    policySpy.mockResolvedValue({ drafts: { enabled: false } });

    await expect(autosaveForDocument(ARGS)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(autosaveSpy).not.toHaveBeenCalled();
  });

  it("does not fall through to storage when the policy lookup fails", async () => {
    // Could-not-read and permitted must not be the same answer on a path that
    // decides whether to persist unpublished content.
    policySpy.mockRejectedValue(new Error("registry unavailable"));

    await expect(autosaveForDocument(ARGS)).rejects.toThrow();
    expect(autosaveSpy).not.toHaveBeenCalled();
  });
});
