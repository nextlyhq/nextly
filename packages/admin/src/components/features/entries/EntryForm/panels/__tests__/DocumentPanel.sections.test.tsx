/**
 * The document panel's sections: Status, Publishing, Language, Details, in
 * that order, each drawn only where it applies. Status says where the document
 * stands in the language being edited, as the bar's pill does; Publishing
 * reads the releases holding the document.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type { Release } from "@admin/types/releases";

import { EntryLocaleProvider } from "../../../EntryLocaleContext";
import { DocumentPanel, type DocumentPanelProps } from "../DocumentPanel";

const localization = vi.hoisted(() => ({
  current: {
    enabled: false,
    locales: [] as { code: string; label: string }[],
    defaultLocale: "en",
  },
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    ...localization.current,
    fallback: true,
    getLocale: (code: string | undefined) =>
      localization.current.locales.find(l => l.code === code),
  }),
}));

const releases = vi.hoisted(() => ({
  current: {
    data: undefined as { items: Release[] } | undefined,
    isError: false,
    isPending: false,
  },
  asked: [] as unknown[],
}));
vi.mock("@admin/hooks/queries/useReleases", () => ({
  useReleasesContaining: (document: unknown, enabled: boolean) => {
    releases.asked.push({ document, enabled });
    return releases.current;
  },
}));

const can = vi.hoisted(() => ({ current: true }));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => can.current }));

// The language panel as it is today, stood in for: what matters here is where
// the section puts it.
vi.mock("../../../LanguagePanel", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../LanguagePanel")>()),
  DocumentLanguagePanel: () => <div data-testid="language-panel" />,
}));

const releaseDocument = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
};

function panel(props: Partial<DocumentPanelProps> = {}, localized = false) {
  const element = (
    <DocumentPanel
      mode="edit"
      entry={{ id: "e1", createdAt: "2026-10-01T09:00:00Z" }}
      hasStatus
      documentStatus={{ status: "draft", hasWorkingDraft: false }}
      releaseDocument={releaseDocument}
      {...props}
    />
  );
  return render(
    <EntryLocaleProvider
      value={{
        locale: localized ? "fr" : undefined,
        rtl: false,
        collectionLocalized: localized,
        isNonDefaultLocale: localized,
      }}
    >
      {element}
    </EntryLocaleProvider>
  );
}

/** The panel's sections, by the headings that name them, in order. */
function sectionTitles(): string[] {
  return screen
    .getAllByRole("region")
    .map(region => region.getAttribute("data-panel-section") ?? "");
}

beforeEach(() => {
  localization.current = { enabled: false, locales: [], defaultLocale: "en" };
  releases.current = {
    data: { items: [] },
    isError: false,
    isPending: false,
  };
  releases.asked = [];
  can.current = true;
});

describe("the document panel's sections", () => {
  it("reads Status, Publishing, Language, Details, in that order", () => {
    localization.current = {
      enabled: true,
      locales: [
        { code: "en", label: "English" },
        { code: "fr", label: "French" },
      ],
      defaultLocale: "en",
    };
    panel({}, true);
    expect(sectionTitles()).toEqual([
      "Status",
      "Publishing",
      "Language",
      "Details",
    ]);
    // Each section is named by its heading, for a screen reader moving
    // between them.
    expect(screen.getByRole("region", { name: "Language" })).toContainElement(
      screen.getByTestId("language-panel")
    );
    expect(
      within(screen.getByRole("region", { name: "Details" })).getByRole(
        "button",
        { name: /copy id to clipboard/i }
      )
    ).toBeInTheDocument();
  });

  it("draws no Language section on a document with no languages", () => {
    panel();
    expect(sectionTitles()).toEqual(["Status", "Publishing", "Details"]);
  });

  it("draws no Status or Publishing on a document without the Draft/Published lifecycle", () => {
    panel({ hasStatus: false });
    expect(sectionTitles()).toEqual(["Details"]);
  });

  it("draws nothing before the document exists", () => {
    const { container } = panel({ mode: "create" });
    expect(container).toBeEmptyDOMElement();
  });
});

describe("the Status section", () => {
  it.each([
    [
      { status: "draft", hasWorkingDraft: false },
      "is a draft, not published yet.",
    ],
    [
      { status: "published", hasWorkingDraft: false },
      "is published and up to date.",
    ],
    [
      { status: "published", hasWorkingDraft: true },
      "is published. Changes saved since then are not live yet.",
    ],
  ])("says %o as a sentence", (documentStatus, sentence) => {
    panel({ documentStatus });
    const status = screen.getByRole("region", { name: "Status" });
    expect(status).toHaveTextContent(`This document ${sentence}`);
  });

  it("reads the language being edited, not the document's main row", () => {
    localization.current = {
      enabled: true,
      locales: [
        { code: "en", label: "English" },
        { code: "fr", label: "French" },
      ],
      defaultLocale: "en",
    };
    // The main row is published; the French being edited is a draft, and the
    // editor hands the panel the status of the language on screen.
    panel(
      {
        entry: { id: "e1", status: "published" },
        documentStatus: { status: "draft", hasWorkingDraft: false },
      },
      true
    );
    expect(screen.getByRole("region", { name: "Status" })).toHaveTextContent(
      "The French version is a draft, not published yet."
    );
  });
});

describe("the Publishing section", () => {
  const release = (over: Partial<Release>): Release =>
    ({
      id: "r1",
      title: "Spring launch",
      state: "scheduled",
      scheduledAt: "2026-10-31T09:00:00Z",
      timezone: "UTC",
      memberAction: "publish",
      ...over,
    }) as Release;

  it("says when nothing is scheduled", () => {
    panel();
    expect(
      screen.getByRole("region", { name: "Publishing" })
    ).toHaveTextContent("Not scheduled.");
  });

  it("names the release the document is in, links to it, and says when it goes live", () => {
    releases.current.data = { items: [release({})] };
    panel();
    const section = screen.getByRole("region", { name: "Publishing" });
    expect(
      within(section).getByRole("link", { name: "Spring launch" })
    ).toHaveAttribute("href", expect.stringContaining("r1"));
    expect(section).toHaveTextContent(/Goes live .*2026.*\(UTC\)/);
  });

  it("says a release takes the document down rather than live", () => {
    releases.current.data = {
      items: [release({ memberAction: "unpublish" })],
    };
    panel();
    expect(
      screen.getByRole("region", { name: "Publishing" })
    ).toHaveTextContent(/Comes down /);
  });

  it("says a stopped release will not run, rather than giving it a time", () => {
    releases.current.data = { items: [release({ state: "blocked" })] };
    panel();
    const section = screen.getByRole("region", { name: "Publishing" });
    expect(section).toHaveTextContent(
      "Stopped. It will not change this document until somebody fixes it."
    );
    expect(section).not.toHaveTextContent(/Goes live/);
  });

  it("does not call a stopped unpublish a publish that failed", () => {
    // The release was going to take the document down: "cannot go live"
    // would tell the author the opposite of what stopped.
    releases.current.data = {
      items: [release({ state: "blocked", memberAction: "unpublish" })],
    };
    panel();
    const section = screen.getByRole("region", { name: "Publishing" });
    expect(section).not.toHaveTextContent(/go live/i);
    expect(section).toHaveTextContent(/Stopped/);
  });

  it("does not call a failed lookup an empty schedule", () => {
    releases.current = { data: undefined, isError: true, isPending: false };
    panel();
    const section = screen.getByRole("region", { name: "Publishing" });
    expect(section).toHaveTextContent("could not be checked");
    expect(section).not.toHaveTextContent("Not scheduled");
  });

  it("asks for the document's releases by the address the banner asks with", () => {
    panel();
    expect(releases.asked).toContainEqual({
      document: releaseDocument,
      enabled: true,
    });
  });

  it("is not drawn for someone who may not read releases", () => {
    can.current = false;
    panel();
    expect(
      screen.queryByRole("region", { name: "Publishing" })
    ).not.toBeInTheDocument();
    // Nor asked: the list is gated, and the answer would be a refusal.
    expect(releases.asked).toContainEqual({
      document: releaseDocument,
      enabled: false,
    });
  });
});
