/**
 * `changesSinceStartedFrom` judges the parts a starting version covers, as a
 * save from it would be judged: the document's own row always, and the
 * copy's language only where the version names it and its table is there.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { registry, ready, changesSince } = vi.hoisted(() => ({
  registry: vi.fn(),
  ready: vi.fn(),
  changesSince: vi.fn(),
}));

vi.mock("../../../di", () => ({
  getService: () => ({
    getCollectionBySlug: registry,
    getSingleBySlug: registry,
  }),
}));
vi.mock("../../i18n/runtime/companion-readiness", () => ({
  isCompanionReady: ready,
}));
vi.mock("../stale-version", async importOriginal => ({
  ...(await importOriginal<typeof import("../stale-version")>()),
  changesSinceVersion: changesSince,
}));

import { changesSinceStartedFrom } from "../recovery-point-changes";

const adapter = { dialect: "sqlite" } as never;
const reader = { user: { id: "u1" } as never, trusted: false };
const CHANGED = { currentVersion: "8.en:3" };

beforeEach(() => {
  vi.clearAllMocks();
  registry.mockResolvedValue({ tableName: "dc_posts", localized: true });
  ready.mockResolvedValue(true);
  changesSince.mockResolvedValue(CHANGED);
});

const since = (given: { main: number; languages: Record<string, number> }) =>
  changesSinceStartedFrom(adapter, {
    scopeKind: "collection",
    slug: "posts",
    entryId: "e1",
    given,
    locale: "en",
    reader,
  });

describe("changesSinceStartedFrom", () => {
  it("judges the copy's language beside the document's own row when the version names it", async () => {
    await expect(since({ main: 7, languages: { en: 2 } })).resolves.toEqual(
      CHANGED
    );
    expect(changesSince).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: "e1",
        at: {
          table: "dc_posts",
          languages: { table: "dc_posts_locales", locales: ["en"] },
        },
      })
    );
  });

  it("judges the document's own row alone when the version names no language", async () => {
    await since({ main: 7, languages: {} });
    expect(changesSince).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        at: { table: "dc_posts", languages: undefined },
      })
    );
  });

  it("answers nothing when nothing moved, or the document is gone", async () => {
    changesSince.mockResolvedValueOnce(null);
    await expect(since({ main: 7, languages: { en: 2 } })).resolves.toBe(
      undefined
    );
    changesSince.mockResolvedValueOnce("gone");
    await expect(since({ main: 7, languages: { en: 2 } })).resolves.toBe(
      undefined
    );
  });
});
