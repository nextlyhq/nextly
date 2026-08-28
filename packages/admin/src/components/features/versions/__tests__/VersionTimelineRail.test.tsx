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

import { render, screen, within } from "@admin/__tests__/utils";
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

function renderRail(
  versions: VersionMeta[],
  extra: { hasNextPage?: boolean } = {}
) {
  return render(
    <VersionTimelineRail
      scope={scope}
      versions={versions}
      selected={null}
      onSelect={vi.fn()}
      hasNextPage={extra.hasNextPage}
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

    // The premise: the row rendered at all, so an absent badge below would be
    // a missing locale rather than a rail that drew nothing.
    expect(screen.getByText("Version 5")).toBeInTheDocument();
    // The CODE shows and the human label is its tooltip — the presentation the
    // history sheet's rows already use, through the same component.
    const badge = screen.getByText("fr");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("title", "French");
  });

  it("falls back to the locale CODE when it has no label", () => {
    // An unlabelled locale is still an answer, and a blank space is not.
    useLocalization.mockReturnValue({
      enabled: true,
      getLocale: () => null,
    });

    renderRail([version({ locale: "de" })]);

    const badge = screen.getByText("de");
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveAttribute("title", "de");
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
    expect(screen.queryByText("fr")).not.toBeInTheDocument();
  });

  it("says nothing when a localized document's version has no locale", () => {
    // The other control: enabled is not on its own a reason to print a badge.
    useLocalization.mockReturnValue({
      enabled: true,
      getLocale: () => ({ code: "fr", label: "French" }),
    });

    renderRail([version({ locale: null })]);

    expect(screen.getByText("Version 5")).toBeInTheDocument();
    expect(screen.queryByText("fr")).not.toBeInTheDocument();
  });
});

describe("VersionTimelineRail — a row that cannot be compared says so", () => {
  beforeEach(() => {
    useLocalization.mockReset();
    useLocalization.mockReturnValue({ enabled: false, getLocale: () => null });
  });

  /**
   * Choosing a row compares it against the version before it. A row with no
   * predecessor to compare against used to stay enabled and silently discard
   * the click — the button reported success by changing nothing, which reads
   * as a page that has stopped responding.
   */
  it("disables the oldest version, whose predecessor does not exist", () => {
    // A complete history: nothing before v1, and no further pages.
    renderRail([
      version({ id: "v2", versionNo: 2 }),
      version({ versionNo: 1 }),
    ]);

    const rows = screen.getAllByRole("button", { name: /Version/ });
    const oldest = rows.find(r => r.textContent?.includes("Version 1"));
    expect(oldest).toBeDefined();
    expect(oldest).toBeDisabled();
    // Visible text, not a tooltip: a disabled button is not focusable, so a
    // keyboard user reaches no tooltip, and a touch user has no hover.
    expect(
      screen.getByText("Nothing before this version to compare it against")
    ).toBeInTheDocument();
  });

  /**
   * The other reason, and it must NOT read the same. A version whose
   * predecessor lies beyond the loaded pages becomes comparable as soon as
   * more history is fetched, so telling the reader the history ends here would
   * be untrue.
   */
  it("distinguishes a predecessor that is merely not loaded yet", () => {
    renderRail([version({ versionNo: 4 })], { hasNextPage: true });

    const row = screen.getByRole("button", { name: /Version 4/ });
    expect(row).toBeDisabled();
    expect(
      screen.getByText("Load more history to compare this version")
    ).toBeInTheDocument();
  });

  /**
   * The control. Every row would otherwise be disabled and the assertions
   * above would pass on a rail nobody can use at all.
   */
  it("leaves a row with a loaded predecessor selectable", () => {
    renderRail([
      version({ id: "v2", versionNo: 2 }),
      version({ versionNo: 1 }),
    ]);

    const row = screen.getByRole("button", { name: /Version 2/ });
    expect(row).toBeEnabled();
    // Scoped to THIS row: the oldest row in the same rail legitimately carries
    // a reason, so an unscoped query would find it and report this row as
    // unavailable when it is not.
    expect(
      within(row).queryByText(/Load more history|Nothing before this version/)
    ).not.toBeInTheDocument();
  });
});
