/**
 * A Single's side panel: what it is, then Status, Publishing and Language
 * where they apply, then when it was last changed and by whom, then the
 * sections plugins add, then "For developers" with its API address and ID.
 *
 * The property separating this from a plausible broken panel is the ORDER,
 * with sections a plugin anchors after Details: "For developers" keeps
 * Details' place, so a section placed `after: "details"` stays straight
 * under it, and "Last changed" stays above every plugin section.
 */
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import {
  registerComponent,
  unregisterComponent,
  type DocumentPanelSectionProps,
} from "@admin/lib/plugins/component-registry";
import type { PanelOrderEntry } from "@admin/lib/plugins/document-surfaces";

import { EntryLocaleProvider } from "../../../EntryLocaleContext";
import type { EntryChanger } from "../../entry-details-read";
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
vi.mock("@admin/hooks/queries/useReleasesContaining", () => ({
  useReleasesContaining: () => ({
    data: { items: [] },
    isError: false,
    isPending: false,
  }),
}));
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
// The language panel stood in for: what matters here is where it is drawn.
vi.mock("../../../LanguagePanel", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../LanguagePanel")>()),
  DocumentLanguagePanel: () => <div data-testid="language-panel" />,
}));

const SEARCH = "test/seo#Search";
function Search(props: DocumentPanelSectionProps) {
  return <p>Search lines for {props.entryId}</p>;
}

const ID = "0f00a1b2-c3d4-4e5f-8a9b-0c1d2e3f44c7";
const API = "/admin/api/singles/contact-details";
const ANA: EntryChanger = { kind: "person", name: "Ana Lopez" };
const twoHoursAgo = () => new Date(Date.now() - 2 * 3_600_000).toISOString();

const sectionProps: DocumentPanelSectionProps = {
  collectionSlug: "contact-details",
  entryId: ID,
  documentLock: { readOnly: false, actionsDisabled: false },
  mayWrite: () => true,
  documentChanged: vi.fn(),
};

function clipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: { writeText },
  });
}

function singlePanel(
  props: Partial<DocumentPanelProps> = {},
  localized = false
) {
  return render(
    <EntryLocaleProvider
      value={{
        locale: localized ? "fr" : undefined,
        rtl: false,
        collectionLocalized: localized,
        isNonDefaultLocale: localized,
      }}
    >
      <DocumentPanel
        mode="edit"
        entry={{
          id: ID,
          createdAt: "2026-10-01T09:00:00Z",
          updatedAt: "2026-10-02T09:00:00Z",
        }}
        hasStatus={false}
        apiAddress={API}
        details={{ createdBy: ANA, updatedBy: ANA, updatedAt: twoHoursAgo() }}
        single={{ label: "Contact details", onOpenHistory: vi.fn() }}
        {...props}
      />
    </EntryLocaleProvider>
  );
}

/** The panel's sections, by the headings that name them, in order. */
function sectionTitles(): string[] {
  return screen
    .getAllByRole("region", { hidden: true })
    .map(region => region.getAttribute("data-panel-section") ?? "");
}

const section = (name: string) => screen.getByRole("region", { name });

beforeEach(() => {
  localization.current = { enabled: false, locales: [], defaultLocale: "en" };
  registerComponent(SEARCH, Search as never);
});

afterEach(() => {
  unregisterComponent(SEARCH);
  vi.clearAllMocks();
});

describe("a Single's side panel", () => {
  it("with nothing else, reads what it is, when it last changed and by whom, then For developers", () => {
    singlePanel();
    expect(sectionTitles()).toEqual([
      "What this is",
      "Last changed",
      "For developers",
    ]);
    expect(section("What this is")).toHaveTextContent(
      "One entry the site uses in one place. There's only ever one Contact details."
    );
    expect(section("Last changed")).toHaveTextContent(
      "2 hours ago by Ana Lopez"
    );
    // Details' own rows are an entry's: a Single says its last change once.
    expect(screen.queryByRole("region", { name: "Details" })).toBeNull();
    expect(screen.queryByText("Created")).toBeNull();
    expect(screen.queryByText("Updated")).toBeNull();
  });

  it("shows API, then ID, each with a copy, under For developers", () => {
    singlePanel();
    const developers = section("For developers");
    const labels = within(developers)
      .getAllByRole("term")
      .map(term => term.textContent);
    expect(labels).toEqual(["API", "ID"]);
    expect(developers).toHaveTextContent(API);
    expect(
      within(developers).getByRole("button", { name: "Copy API address" })
    ).toBeVisible();
    expect(
      within(developers).getByRole("button", { name: "Copy ID to clipboard" })
    ).toBeVisible();
  });

  it("copies the API address whole, as a URL on this admin, and the ID whole", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    clipboard(writeText);
    singlePanel();
    await userEvent.click(
      screen.getByRole("button", { name: "Copy API address" })
    );
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${API}`);
    await userEvent.click(
      screen.getByRole("button", { name: "Copy ID to clipboard" })
    );
    expect(writeText).toHaveBeenCalledWith(ID);
  });

  it("says the Single's own description where its code gives one, in place of the fixed sentence", () => {
    singlePanel({
      single: {
        label: "Contact details",
        description: "The phone, email and address the footer shows.",
      },
    });
    expect(section("What this is")).toHaveTextContent(
      "The phone, email and address the footer shows."
    );
    expect(screen.queryByText(/There's only ever one/)).toBeNull();
  });

  it("with drafts, reads Status and Publishing above Last changed", () => {
    singlePanel({
      hasStatus: true,
      documentStatus: { status: "draft", hasWorkingDraft: false },
      releaseDocument: {
        scopeKind: "single",
        scopeSlug: "contact-details",
        entryId: ID,
      },
    });
    expect(sectionTitles()).toEqual([
      "What this is",
      "Status",
      "Publishing",
      "Last changed",
      "For developers",
    ]);
  });

  it("with languages, reads Language above Last changed", () => {
    localization.current = {
      enabled: true,
      locales: [
        { code: "en", label: "English" },
        { code: "fr", label: "French" },
      ],
      defaultLocale: "en",
    };
    singlePanel({}, true);
    expect(sectionTitles()).toEqual([
      "What this is",
      "Language",
      "Last changed",
      "For developers",
    ]);
  });

  it("opens the Single's history from History", async () => {
    const onOpenHistory = vi.fn();
    singlePanel({ single: { label: "Contact details", onOpenHistory } });
    await userEvent.click(
      within(section("Last changed")).getByRole("button", { name: "History" })
    );
    expect(onOpenHistory).toHaveBeenCalledTimes(1);
  });

  it("draws History in the panel's text colour, not the brand's", () => {
    // `--nx-primary` is a fill a site's brand may set to any colour (the
    // e2e suite's indigo reads 4.35:1 on the panel, under AA's 4.5:1), so
    // text drawn in it is only as readable as the brand happens to be. The
    // panel's other links read in `--nx-foreground`, which every theme and
    // brand keeps readable on the panel.
    singlePanel({
      single: { label: "Contact details", onOpenHistory: vi.fn() },
    });
    const history = within(section("Last changed")).getByRole("button", {
      name: "History",
    });
    expect(history.className.split(/\s+/)).toContain("text-foreground");
    expect(history.className).not.toMatch(/(^|\s)text-primary(\s|$)/);
    // In the same colour as the sentence around it, so underlined at rest:
    // its weight alone would not say it can be pressed.
    expect(history.className.split(/\s+/)).toContain("underline");
  });

  it("leaves History out where the Single keeps no history", () => {
    singlePanel({ single: { label: "Contact details" } });
    expect(section("Last changed")).toHaveTextContent(
      "2 hours ago by Ana Lopez"
    );
    expect(
      within(section("Last changed")).queryByRole("button", {
        name: "History",
      })
    ).toBeNull();
  });

  it.each<[string, EntryChanger, string]>([
    [
      "a former user",
      { kind: "person", name: null, gone: true },
      "by a former user",
    ],
    ["an API key", { kind: "apiKey", name: null }, "by an API key"],
    ["the system", { kind: "system", name: null }, "by the system"],
  ])("names who changed it as %s", (_, updatedBy, words) => {
    singlePanel({
      details: { createdBy: null, updatedBy, updatedAt: twoHoursAgo() },
    });
    expect(section("Last changed")).toHaveTextContent(`2 hours ago ${words}`);
  });

  it("says the time alone where nobody is recorded, from the Single's own update time", () => {
    singlePanel({
      entry: { id: ID, updatedAt: twoHoursAgo() },
      details: undefined,
    });
    const lastChanged = section("Last changed");
    expect(lastChanged).toHaveTextContent("2 hours ago");
    expect(lastChanged).not.toHaveTextContent(" by ");
  });

  it("gives the full date of the change on its time", () => {
    singlePanel({
      details: {
        createdBy: null,
        updatedBy: ANA,
        updatedAt: "2026-10-02T09:30:00Z",
      },
    });
    const time = section("Last changed").querySelector("time");
    expect(time).not.toBeNull();
    expect(time).toHaveAttribute("datetime", "2026-10-02T09:30:00Z");
    expect(time?.getAttribute("title")).toMatch(/2026/);
  });

  it("keeps a section anchored after Details straight under For developers, and Last changed above every plugin section", () => {
    const order: PanelOrderEntry[] = [
      { kind: "builtIn", name: "status" },
      { kind: "builtIn", name: "publishing" },
      { kind: "builtIn", name: "language" },
      {
        kind: "section",
        id: "acme.before-details",
        plugin: "@acme/notes",
        title: "Notes",
        component: SEARCH,
      },
      { kind: "builtIn", name: "details" },
      // The SEO plugin's line, placed `after: "details"` at single.edit.
      {
        kind: "section",
        id: "nextlyhq-plugin-seo.single-status",
        plugin: "@nextlyhq/plugin-seo",
        title: "Search",
        component: SEARCH,
      },
    ];
    singlePanel({ panelOrder: order, placedSectionProps: sectionProps });
    expect(sectionTitles()).toEqual([
      "What this is",
      "Last changed",
      "Notes",
      "For developers",
      "Search",
    ]);
  });
});

describe("a collection entry's panel", () => {
  it("is unchanged without a Single: Details with ID, API, Created and Updated", () => {
    render(
      <DocumentPanel
        mode="edit"
        entry={{ id: "e1", createdAt: "2026-10-01T09:00:00Z" }}
        hasStatus={false}
        apiAddress="/admin/api/collections/posts/entries/e1"
      />
    );
    expect(sectionTitles()).toEqual(["Details"]);
    expect(screen.queryByRole("region", { name: "What this is" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Last changed" })).toBeNull();
    const labels = within(section("Details"))
      .getAllByRole("term")
      .map(term => term.textContent);
    expect(labels).toEqual(["ID", "API", "Created", "Updated"]);
  });
});
