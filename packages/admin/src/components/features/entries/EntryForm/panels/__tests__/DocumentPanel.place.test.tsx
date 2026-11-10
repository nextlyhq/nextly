/**
 * Plugins' sections in the document panel: each stands where the server put
 * it among the panel's own four, under its own label and behind its own
 * boundary, told which document the page shows; one replacing a built-in
 * section is drawn where that one was.
 *
 * The panel is drawn as the editors draw it: its order from the place's list
 * by the one rule every place part follows (`placedPanelOrder`), and each
 * section handed the place's context and entry with the document's handles
 * (`sidebarSectionProps`).
 */
import type { AdminContributionsMeta } from "nextly/config";
import { beforeEach, describe, expect, it, vi } from "vitest";

import userEvent from "@testing-library/user-event";

import { render, screen, within } from "@admin/__tests__/utils";
import {
  registerComponent,
  type DocumentPanelSectionProps,
} from "@admin/lib/plugins/component-registry";
import { placedPanelOrder } from "@admin/lib/plugins/document-surfaces";

import { EntryLocaleProvider } from "../../../EntryLocaleContext";
import { sidebarSectionProps, type DocumentPlace } from "../../document-place";
import { DocumentPanel } from "../DocumentPanel";

const meta = {
  contributions: undefined as AdminContributionsMeta | undefined,
};
// Languages on, so all four of the panel's own sections are drawn.
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: true,
    locales: [
      { code: "en", label: "English" },
      { code: "fr", label: "French" },
    ],
    defaultLocale: "en",
    fallback: true,
    getLocale: () => undefined,
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
vi.mock("../../../LanguagePanel", async importOriginal => ({
  ...(await importOriginal<typeof import("../../../LanguagePanel")>()),
  DocumentLanguagePanel: () => <div data-testid="language-panel" />,
}));

const SIGNED_IN = "11111111-1111-4111-8111-111111111111";

const NOTES = "@acme/a/admin#Notes";
registerComponent(NOTES, ((props: {
  context?: unknown;
  entry?: unknown;
  collectionSlug?: unknown;
}) => (
  <pre data-testid="notes">
    {JSON.stringify({
      context: props.context,
      entry: props.entry,
      collectionSlug: props.collectionSlug,
    })}
  </pre>
)) as never);
const OWN_FORM = "@acme/a/admin#OwnForm";
registerComponent(OWN_FORM, (() => (
  <form
    onSubmit={event => {
      event.preventDefault();
      ownSubmit();
    }}
  >
    <button type="submit">Send</button>
  </form>
)) as never);
const ownSubmit = vi.fn();
const THROWS = "@acme/a/admin#Throws";
registerComponent(THROWS, (() => {
  throw new Error("the section failed");
}) as never);

function section(id: string, label: string, extra: object = {}) {
  return {
    plugin: "@acme/a",
    id,
    kind: "sidebarSection",
    label,
    component: NOTES,
    ...extra,
  };
}

const ENTRY = { id: "e1", createdAt: "2026-10-01T09:00:00Z" };

const SHOWN = { userId: SIGNED_IN, collection: "posts", entryId: "e1" };

/** The document's own handles, as a collection entry's page hands them. */
const DOCUMENT_PROPS = {
  collectionSlug: "posts",
  entryId: "e1",
  documentLock: { readOnly: false, actionsDisabled: false },
  mayWrite: () => true,
  documentChanged: () => {},
} as unknown as DocumentPanelSectionProps;

/** The panel on a post's edit page, as the viewer `context` names, or none yet. */
/** The panel inside a document form, as the editors draw it. */
function panel(
  context: typeof SHOWN | null = SHOWN,
  onDocumentSubmit: () => void = () => {}
) {
  const place: DocumentPlace = {
    place: "collection.edit",
    context,
    entry: ENTRY,
  };
  const order = placedPanelOrder(meta.contributions, place.place, place);
  const props = sidebarSectionProps(place, DOCUMENT_PROPS);
  return render(
    <form
      onSubmit={event => {
        event.preventDefault();
        onDocumentSubmit();
      }}
    >
      <EntryLocaleProvider
        value={{
          locale: "fr",
          rtl: false,
          collectionLocalized: true,
          isNonDefaultLocale: true,
        }}
      >
        <DocumentPanel
          {...(order === undefined ? {} : { panelOrder: order })}
          {...(props === undefined ? {} : { placedSectionProps: props })}
          mode="edit"
          entry={ENTRY}
          hasStatus
          documentStatus={{ status: "draft", hasWorkingDraft: false }}
          releaseDocument={{
            scopeKind: "collection",
            scopeSlug: "posts",
            entryId: "e1",
          }}
        />
      </EntryLocaleProvider>
    </form>
  );
}

/** The panel's sections, by the headings that name them, in order. */
function sectionTitles(): string[] {
  return screen
    .getAllByRole("region")
    .map(region => region.getAttribute("data-panel-section") ?? "");
}

function sections(...entries: object[]): void {
  meta.contributions = {
    "collection.edit": { sidebarSection: entries },
  } as AdminContributionsMeta;
}

beforeEach(() => {
  meta.contributions = undefined;
});

describe("plugins' sections in the document panel", () => {
  it("with no contributions the panel draws its own four, in order", () => {
    panel();
    expect(sectionTitles()).toEqual([
      "Status",
      "Publishing",
      "Language",
      "Details",
    ]);
  });

  it("a contributed section straight after `status`", () => {
    sections(
      { builtIn: "status" },
      section("acme-a.notes", "Notes", { after: "status" }),
      { builtIn: "publishing" },
      { builtIn: "language" },
      { builtIn: "details" }
    );
    panel();

    expect(sectionTitles()).toEqual([
      "Status",
      "Notes",
      "Publishing",
      "Language",
      "Details",
    ]);
    // Drawn inside its own section, told the page's ids and its document.
    const notes = within(screen.getByRole("region", { name: "Notes" }));
    // The place's context and entry, and the document's own handles.
    expect(JSON.parse(notes.getByTestId("notes").textContent ?? "")).toEqual({
      context: { userId: SIGNED_IN, collection: "posts", entryId: "e1" },
      entry: ENTRY,
      collectionSlug: "posts",
    });
  });

  it("a section replacing `language` stands where it was", () => {
    // The server sends the replacement in the built-in's place and the
    // built-in no more.
    sections(
      { builtIn: "status" },
      { builtIn: "publishing" },
      section("acme-a.languages", "Translations", { replaces: "language" }),
      { builtIn: "details" }
    );
    panel();

    expect(sectionTitles()).toEqual([
      "Status",
      "Publishing",
      "Translations",
      "Details",
    ]);
    expect(screen.queryByTestId("language-panel")).toBeNull();
  });

  it("a throwing section draws its own fallback, and the rest of the panel stays", () => {
    sections(
      { builtIn: "status" },
      section("acme-a.broken", "Broken", { component: THROWS }),
      { builtIn: "publishing" },
      { builtIn: "language" },
      { builtIn: "details" }
    );
    vi.spyOn(console, "error").mockImplementation(() => {});
    panel();

    expect(sectionTitles()).toEqual([
      "Status",
      "Broken",
      "Publishing",
      "Language",
      "Details",
    ]);
    expect(
      screen.getByRole("region", { name: "Broken" })
    ).not.toHaveTextContent("the section failed");
    expect(screen.getByTestId("language-panel")).toBeInTheDocument();
  });

  it("says under a section's heading that its component could not be found", () => {
    sections(
      { builtIn: "status" },
      section("acme-a.missing", "Missing", {
        after: "status",
        component: "@acme/a/admin#NotRegistered",
      }),
      { builtIn: "publishing" },
      { builtIn: "language" },
      { builtIn: "details" }
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    panel();

    // The section stays, under its own heading, and says what happened in
    // place of a body that never arrived.
    expect(
      within(screen.getByRole("region", { name: "Missing" })).getByRole(
        "status"
      )
    ).toHaveTextContent("This part of the page couldn't be loaded.");
  });

  it("keeps a section's own form from submitting the document", async () => {
    const documentSubmit = vi.fn();
    ownSubmit.mockClear();
    sections(
      { builtIn: "status" },
      section("acme-a.form", "Own form", { component: OWN_FORM }),
      { builtIn: "publishing" },
      { builtIn: "language" },
      { builtIn: "details" }
    );
    panel(SHOWN, documentSubmit);

    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(ownSubmit).toHaveBeenCalledTimes(1);
    expect(documentSubmit).not.toHaveBeenCalled();
  });

  it("draws no plugin's section before the viewer is known", () => {
    sections(
      { builtIn: "status" },
      section("acme-a.notes", "Notes", { after: "status" }),
      { builtIn: "publishing" },
      { builtIn: "language" },
      { builtIn: "details" }
    );
    panel(null);

    expect(screen.queryByTestId("notes")).toBeNull();
    expect(sectionTitles()).toEqual([
      "Status",
      "Publishing",
      "Language",
      "Details",
    ]);
  });
});
