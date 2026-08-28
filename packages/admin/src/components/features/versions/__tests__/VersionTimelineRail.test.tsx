/**
 * The rail has to say WHICH version each row is, and on a localized document
 * that includes which language it holds.
 *
 * A localized document captures a version per locale and this list interleaves
 * them, so a row identified only by its number leaves an editor unable to tell
 * whether version 5 is the English or the French one — and the comparison pane
 * beside it names version numbers too, so the ambiguity is not resolved by
 * looking anywhere else on the page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { VersionMeta, VersionScope } from "@admin/services/versionApi";

import { VersionTimelineRail } from "../VersionTimelineRail";

const useLocalization = vi.hoisted(() => vi.fn());
vi.mock("@admin/hooks/useLocalization", () => ({ useLocalization }));

/** Mocked so a row's summary does not pull the network into a layout test. */
vi.mock("../VersionSummaryLine", () => ({
  VersionSummaryLine: () => null,
}));

const scope: VersionScope = {
  kind: "collection",
  slug: "posts",
  entryId: "e1",
};

function version(overrides: Partial<VersionMeta> = {}): VersionMeta {
  return {
    id: "v1",
    versionNo: 5,
    status: "published",
    isAutosave: false,
    label: null,
    locale: null,
    sourceVersionNo: null,
    createdBy: "u1",
    author: { id: "u1", name: "Ada Lovelace" },
    createdAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    updatedAt: new Date("2026-01-01T00:00:00Z").toISOString(),
    ...overrides,
  };
}

function renderRail(versions: VersionMeta[]) {
  return render(
    <VersionTimelineRail
      scope={scope}
      versions={versions}
      selected={null}
      onSelect={vi.fn()}
    />
  );
}

describe("VersionTimelineRail — a row names its language", () => {
  beforeEach(() => {
    useLocalization.mockReset();
  });

  it("shows the locale's human label when the app is localized", () => {
    useLocalization.mockReturnValue({
      enabled: true,
      getLocale: (code: string) =>
        code === "fr" ? { code, label: "French" } : null,
    });

    renderRail([version({ locale: "fr" })]);

    // The premise: the row rendered at all, so an absent label below would be
    // a missing locale rather than a rail that drew nothing.
    expect(screen.getByText("Version 5")).toBeInTheDocument();
    expect(screen.getByText("French")).toBeInTheDocument();
  });

  it("falls back to the locale CODE when it has no label", () => {
    // An unlabelled locale is still an answer, and a blank space is not.
    useLocalization.mockReturnValue({
      enabled: true,
      getLocale: () => null,
    });

    renderRail([version({ locale: "de" })]);

    expect(screen.getByText("de")).toBeInTheDocument();
  });

  it("says nothing about language on a document that is not localized", () => {
    // The control. Every row would otherwise carry a badge that means nothing
    // on a single-language install, and the assertions above would pass on a
    // component that always printed one.
    useLocalization.mockReturnValue({
      enabled: false,
      getLocale: () => ({ code: "fr", label: "French" }),
    });

    renderRail([version({ locale: "fr" })]);

    expect(screen.getByText("Version 5")).toBeInTheDocument();
    expect(screen.queryByText("French")).not.toBeInTheDocument();
  });

  it("says nothing when a localized document's version has no locale", () => {
    // The other control: enabled is not on its own a reason to print a badge.
    useLocalization.mockReturnValue({
      enabled: true,
      getLocale: () => ({ code: "fr", label: "French" }),
    });

    renderRail([version({ locale: null })]);

    expect(screen.getByText("Version 5")).toBeInTheDocument();
    expect(screen.queryByText("French")).not.toBeInTheDocument();
  });
});
