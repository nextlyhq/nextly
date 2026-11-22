/**
 * The fields a version holds that the content type no longer has are read
 * from a comparison: against its predecessor, and for a version with none,
 * against the newest in its language, so the first version kept still shows
 * them, disabled, in its restore.
 */
import { describe, expect, it, vi } from "vitest";

import { renderHook } from "@admin/__tests__/utils";

import type { ViewedVersion } from "../document-history-context";

const { useVersionDiff } = vi.hoisted(() => ({
  useVersionDiff: vi.fn((_options: unknown) => ({ data: undefined })),
}));
vi.mock("@admin/hooks/queries/useVersions", async importOriginal => ({
  ...(await importOriginal<object>()),
  useVersionDiff,
}));

import { useViewedRemovedFields } from "../viewed-version-host";

const scope = { kind: "collection", slug: "posts", entryId: "e1" } as const;

function viewing(extra: Partial<ViewedVersion>): ViewedVersion {
  return {
    versionNo: 3,
    snapshot: {},
    locale: null,
    withheld: [],
    isLoading: false,
    error: null,
    scope,
    comparedWith: { kind: "first" },
    about: null,
    ...extra,
  };
}

const asked = () =>
  useVersionDiff.mock.calls.at(-1)?.[0] as {
    from: number | null;
    to: number | null;
    enabled: boolean;
  };

describe("useViewedRemovedFields", () => {
  it("reads a version's removed fields against its predecessor", () => {
    renderHook(() =>
      useViewedRemovedFields(
        scope,
        viewing({ comparedWith: { kind: "version", versionNo: 2 } })
      )
    );

    expect(asked()).toMatchObject({ from: 2, to: 3, enabled: true });
  });

  it("reads the first version's removed fields against the newest in its language", () => {
    renderHook(() =>
      useViewedRemovedFields(scope, viewing({ newestInLocale: 7 }))
    );

    expect(asked()).toMatchObject({ from: 3, to: 7, enabled: true });
  });

  it("asks for nothing for a version that is the only one in its language", () => {
    renderHook(() =>
      useViewedRemovedFields(scope, viewing({ newestInLocale: null }))
    );

    expect(asked()).toMatchObject({ enabled: false });
  });
});
