/**
 * @vitest-environment jsdom
 */
import {
  COMPONENT_INSTANCE_TYPE,
  DEFAULT_LIMITS,
  DOCUMENT_FORMAT_VERSION,
  type BlockDocument,
} from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  OPEN_BUILDER_LABEL,
  PageBuilderCard,
  PREVIEW_PAGE_LABEL,
  SAVE_DRAFT_AND_OPEN_LABEL,
} from "./PageBuilderCard";
import { pageRenderInputs } from "./page-render-inputs";

/*
 * The editor's preview, as the surrounding form would offer it. Only this hook
 * is replaced; the rest of the module is the real one.
 */
const preview = vi.hoisted(() => ({
  current: null as null | { open: () => void },
}));
// The language the surrounding form shows; null outside a form, as at rest.
const locale = vi.hoisted(() => ({
  current: null as null | {
    code: string | null;
    documentLocalized: boolean;
    isDefaultLocale: boolean;
    rtl: boolean;
  },
}));
vi.mock("@nextlyhq/plugin-sdk/admin", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useDocumentPreview: () => preview.current,
  // No one signed in: the editor keeps no preferences.
  useCurrentUserId: () => null,
  useDocumentLocale: () => locale.current,
}));

beforeEach(() => {
  preview.current = null;
  locale.current = null;
});

// Derived from the block's own definition rather than pinned: the renderer
// drops a node whose version it cannot reconcile, and it drops it silently.
const TEXT = coreBlocks.find(block => block.name === "core/text");
if (!TEXT) throw new Error("core/text is missing from coreBlocks");

function doc(count: number): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: Array.from({ length: count }, (_, i) => ({
      id: `n${i}`,
      type: TEXT.name,
      version: TEXT.version,
      props: { text: `Block ${i}` },
    })),
  } as unknown as BlockDocument;
}

const base = {
  siteStyles: undefined,
  styleState: "ready" as const,
  components: { state: "ready" as const, retry: () => {} },
  // Built through the real derivation, so the fixture cannot describe a bundle
  // the product never produces.
  render: pageRenderInputs({
    siteStyle: undefined,
    clientConfig: undefined,
    previewContainer: undefined,
    limits: DEFAULT_LIMITS,
    definitions: new Map(),
  }),
  canEdit: true,
  href: "/admin/collections/pages/p1/builder?field=body",
  onNavigate: () => {},
};

const MINIATURE = '[data-slot="page-miniature-surface"]';
// The card itself. Its section list names each section by its first line,
// and is folded until asked for, so whether the PAGE was drawn is asked of
// the card as it is first drawn.
const PREVIEW = '[data-slot="page-builder-card"]';

/**
 * What the card shows: its text, leaving out the folded section list, which
 * names each section by its first line and is in the page, hidden, until the
 * fold is opened.
 */
function shownText(card: Element | null): string {
  if (card === null) return "";
  const shown = card.cloneNode(true) as Element;
  for (const hidden of shown.querySelectorAll("[hidden]")) hidden.remove();
  return shown.textContent ?? "";
}

function previewText(container: HTMLElement): string {
  return shownText(container.querySelector(PREVIEW));
}

describe("PageBuilderCard", () => {
  it("invites the author to build when the page is empty", () => {
    render(<PageBuilderCard {...base} document={doc(0)} />);

    expect(
      screen.getByRole("link", { name: OPEN_BUILDER_LABEL })
    ).toBeDefined();
  });

  it("does not draw an empty frame for a page with nothing in it", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(0)} />
    );

    expect(container.querySelector(MINIATURE)).toBeNull();
  });

  it("reads out how many sections the page holds, on the fold over them", () => {
    render(<PageBuilderCard {...base} document={doc(3)} />);

    expect(screen.getByRole("button", { name: "Sections (3)" })).toBeDefined();
  });

  /*
   * The trap this guards.
   *
   * Omitting `siteStyles` still emits the DEFAULT token set, so a page rendered
   * without the site's own sheet looks entirely plausible while missing the
   * site's named classes and block defaults. The canvas makes the sheet a
   * required prop for exactly this reason — a faithful-LOOKING preview that is
   * wrong is worse than one that is visibly not ready yet.
   */
  it("draws no page at all while the site style is still arriving", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(2)} styleState="pending" />
    );

    expect(container.querySelector(MINIATURE)).toBeNull();
    expect(previewText(container)).not.toContain("Block 0");
  });

  it("draws the page once the site style has resolved", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(2)} styleState="ready" />
    );

    expect(container.querySelector(MINIATURE)).not.toBeNull();
    expect(container.textContent).toContain("Block 0");
  });

  it("still reports what the page holds while the style is pending", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(2)} styleState="pending" />
    );

    expect(previewText(container)).toContain("Sections (2)");
  });

  /*
   * The third state, and the reason it has its own name.
   *
   * On a FAILED read `pending` goes false and the resolved style falls back to
   * the config defaults, so a card keyed on `pending` alone would draw a page
   * missing this site's stored classes, tokens and block defaults — the same
   * plausible-but-wrong picture the pending branch refuses, arriving through
   * the one door that branch does not watch.
   */
  it("draws no page when the site style could not be loaded", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(2)} styleState="unavailable" />
    );

    expect(container.querySelector(MINIATURE)).toBeNull();
    expect(previewText(container)).not.toContain("Block 0");
  });

  it("says why, rather than showing an empty frame", () => {
    render(
      <PageBuilderCard {...base} document={doc(2)} styleState="unavailable" />
    );

    expect(screen.getByRole("status").textContent).toMatch(
      /cannot be previewed/i
    );
  });

  // A failed preview must not take the way into the builder with it.
  it("still offers the way in when the style could not be loaded", () => {
    render(
      <PageBuilderCard {...base} document={doc(2)} styleState="unavailable" />
    );

    expect(
      screen.getByRole("link", { name: OPEN_BUILDER_LABEL })
    ).toBeDefined();
  });

  /*
   * The component read gates the miniature the way the style read does, and
   * for the same reason: drawn without definitions, every instance on the page
   * is the could-not-be-loaded marker, which is the picture of a different
   * problem. The one difference is the remedy — a failed read can be asked
   * again from here.
   */
  it("draws no page while the component definitions are still arriving", () => {
    const { container } = render(
      <PageBuilderCard
        {...base}
        document={doc(2)}
        components={{ state: "pending", retry: () => {} }}
      />
    );

    expect(container.querySelector(MINIATURE)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("still draws the page when the components could not be loaded, and says so beneath it", () => {
    // Unlike a failed style read, a failed component read does not refuse the
    // page: the route refuses a role that may edit pages but not read
    // components, and such an author would otherwise see every card refuse
    // forever. The sentence beneath is what tells the marker apart from a
    // deleted component, with the one remedy reachable from here.
    const retry = vi.fn();
    const { container } = render(
      <PageBuilderCard
        {...base}
        document={doc(2)}
        components={{ state: "unavailable", retry }}
      />
    );

    expect(container.querySelector(MINIATURE)).not.toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(
      /components could not be loaded/i
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("link", { name: OPEN_BUILDER_LABEL })
    ).toBeDefined();
  });

  it("draws the page from cached definitions when the read failed to refresh, and says they may be out of date", () => {
    // Told apart from a read that never answered: the miniature is drawn from
    // what the read last held, so "draw as missing" would be false beneath
    // it. The remedy is the same.
    const retry = vi.fn();
    const { container } = render(
      <PageBuilderCard
        {...base}
        document={doc(2)}
        components={{ state: "stale", retry }}
      />
    );

    expect(container.querySelector(MINIATURE)).not.toBeNull();
    expect(screen.getByRole("status").textContent).toMatch(
      /could not be reloaded/i
    );
    expect(screen.getByRole("status").textContent).not.toMatch(/missing/i);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  /*
   * Kept from the behaviour this replaces, whose reasoning is recorded in
   * BlocksField: a disabled control says "you could do this, but not now",
   * which is the wrong sentence for a document nobody may edit at all.
   */
  it("offers no action when the field cannot be edited", () => {
    render(<PageBuilderCard {...base} document={doc(2)} canEdit={false} />);

    // The fold over the sections is the only control: it shows, never edits.
    expect(
      screen.getAllByRole("button").map(button => button.textContent)
    ).toEqual(["Sections (2)"]);
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("still shows the page when the field cannot be edited", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={doc(2)} canEdit={false} />
    );

    expect(container.querySelector(MINIATURE)).not.toBeNull();
  });

  it("links to the builder's own address", () => {
    render(<PageBuilderCard {...base} document={doc(2)} />);
    expect(
      screen
        .getByRole("link", { name: OPEN_BUILDER_LABEL })
        .getAttribute("href")
    ).toBe(base.href);
  });

  it("moves within the admin on a plain click", () => {
    const onNavigate = vi.fn();
    render(
      <PageBuilderCard {...base} document={doc(2)} onNavigate={onNavigate} />
    );
    const link = screen.getByRole("link", { name: OPEN_BUILDER_LABEL });
    // `fireEvent` returns false when a handler prevented the default.
    expect(fireEvent.click(link, { button: 0 })).toBe(false);
    expect(onNavigate).toHaveBeenCalledWith(base.href);
  });

  it.each([
    ["Ctrl", { ctrlKey: true }],
    ["Meta", { metaKey: true }],
    ["Shift", { shiftKey: true }],
    ["Alt", { altKey: true }],
  ])(
    "leaves a %s-click to the browser, so a new tab still works",
    (_key, init) => {
      const onNavigate = vi.fn();
      render(
        <PageBuilderCard {...base} document={doc(2)} onNavigate={onNavigate} />
      );
      const link = screen.getByRole("link", { name: OPEN_BUILDER_LABEL });
      expect(fireEvent.click(link, { button: 0, ...init })).toBe(true);
      expect(onNavigate).not.toHaveBeenCalled();
    }
  );

  it("leaves a middle click to the browser", () => {
    const onNavigate = vi.fn();
    render(
      <PageBuilderCard {...base} document={doc(2)} onNavigate={onNavigate} />
    );
    const link = screen.getByRole("link", { name: OPEN_BUILDER_LABEL });
    fireEvent(
      link,
      new MouseEvent("auxclick", { bubbles: true, cancelable: true, button: 1 })
    );
    fireEvent.click(link, { button: 1 });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("says where an enabled way in leads, when it has a note", () => {
    render(
      <PageBuilderCard
        {...base}
        document={doc(2)}
        note="Opens the default language, the one the Page Builder edits."
      />
    );
    expect(screen.getByRole("link", { name: OPEN_BUILDER_LABEL })).toBeTruthy();
    expect(
      screen.queryByText(
        "Opens the default language, the one the Page Builder edits."
      )
    ).not.toBeNull();
  });

  it("draws the way in disabled, with the field's reason, where the field has no address", () => {
    // A row added since the last save: the builder's address names the row
    // by its saved id, which it does not have yet.
    render(
      <PageBuilderCard
        {...base}
        document={doc(2)}
        href={undefined}
        note="Save the entry once to design this row."
      />
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: OPEN_BUILDER_LABEL,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    expect(
      screen.queryByText("Save the entry once to design this row.")
    ).not.toBeNull();
  });
});

describe("PageBuilderCard on an entry never saved", () => {
  const saveAndOpen = (run = vi.fn(), saving = false) => ({
    label: SAVE_DRAFT_AND_OPEN_LABEL,
    run,
    saving,
  });

  it.each([
    ["with blocks", 2],
    ["empty", 0],
  ])("offers to save the draft and open the builder, enabled, %s", (_, n) => {
    const run = vi.fn();
    render(
      <PageBuilderCard
        {...base}
        document={doc(n)}
        href={undefined}
        saveAndOpen={saveAndOpen(run)}
      />
    );

    const action = screen.getByRole("button", {
      name: SAVE_DRAFT_AND_OPEN_LABEL,
    }) as HTMLButtonElement;
    expect(action.disabled).toBe(false);
    // A button, not a submit: it runs the form's save itself.
    expect(action.type).toBe("button");
    fireEvent.click(action);
    expect(run).toHaveBeenCalledTimes(1);
    // No disabled "Open in builder" beside it, and no sentence saying to
    // save first.
    expect(
      screen.queryByRole("button", { name: OPEN_BUILDER_LABEL })
    ).toBeNull();
    expect(screen.queryByText(/save this page/i)).toBeNull();
  });

  it("is not asked again while its save is under way", () => {
    render(
      <PageBuilderCard
        {...base}
        document={doc(2)}
        href={undefined}
        saveAndOpen={saveAndOpen(vi.fn(), true)}
      />
    );

    const action = screen.getByRole("button", {
      name: SAVE_DRAFT_AND_OPEN_LABEL,
    }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(action.getAttribute("aria-busy")).toBe("true");
  });

  it("is not offered to someone who may not edit the page", () => {
    render(
      <PageBuilderCard
        {...base}
        document={doc(2)}
        href={undefined}
        canEdit={false}
        saveAndOpen={saveAndOpen()}
      />
    );

    expect(
      screen.queryByRole("button", { name: SAVE_DRAFT_AND_OPEN_LABEL })
    ).toBeNull();
  });
});

function versionOf(type: string): number {
  const block = coreBlocks.find(candidate => candidate.name === type);
  if (!block) throw new Error(`${type} is missing from coreBlocks`);
  return block.version;
}

function node(
  id: string,
  type: string,
  props: Record<string, unknown> = {},
  extra: Record<string, unknown> = {}
) {
  return { id, type, version: versionOf(type), props, ...extra };
}

/** Five sections of different kinds, one of them with no text at all. */
const FIVE = {
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes: [
    node(
      "hero",
      "core/section",
      {},
      {
        slots: {
          children: [node("t", "core/heading", { text: "Welcome to Acme" })],
        },
      }
    ),
    node("intro", "core/text", { text: "Plain words first." }),
    node("rule", "core/divider"),
    node(
      "plans",
      "core/section",
      {},
      {
        name: "Pricing",
        slots: {
          children: [node("p", "core/text", { text: "Plans for teams" })],
        },
      }
    ),
    node("contact", "core/heading", { text: "Contact us" }),
  ],
} as unknown as BlockDocument;

/** The fold over the sections. */
function sectionsFold(): HTMLElement {
  return screen.getByRole("button", { name: /^Sections \(\d+\)$/ });
}

/** The section list, opened from its fold first where it is folded. */
function sectionList(): HTMLElement {
  const fold = sectionsFold();
  if (fold.getAttribute("aria-expanded") !== "true") fireEvent.click(fold);
  return screen.getByRole("list", { name: /^Sections \(\d+\)$/ });
}

describe("PageBuilderCard's sections fold", () => {
  it("is folded at first, under the section count, so the card stays short", () => {
    render(<PageBuilderCard {...base} document={FIVE} />);

    const fold = screen.getByRole("button", { name: "Sections (5)" });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "Sections (5)" })).toBeNull();
    // What the fold controls is there, hidden, so its reference holds.
    const controlled = document.getElementById(
      fold.getAttribute("aria-controls") ?? ""
    );
    expect(controlled?.hidden).toBe(true);
    expect(screen.queryByRole("link", { name: /^Edit section/ })).toBeNull();
  });

  it("opens on request, naming the list it shows, and folds again", () => {
    render(<PageBuilderCard {...base} document={FIVE} />);
    const fold = screen.getByRole("button", { name: "Sections (5)" });

    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("true");
    const list = screen.getByRole("list", { name: "Sections (5)" });
    // The list it controls holds the rows, each a way in.
    expect(
      document
        .getElementById(fold.getAttribute("aria-controls") ?? "")
        ?.contains(list)
    ).toBe(true);
    expect(within(list).getAllByRole("link")).toHaveLength(5);

    fireEvent.click(fold);
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "Sections (5)" })).toBeNull();
  });

  it("is a button of its own, never the form's submit", () => {
    render(<PageBuilderCard {...base} document={FIVE} />);
    expect(
      (
        screen.getByRole("button", {
          name: "Sections (5)",
        }) as HTMLButtonElement
      ).type
    ).toBe("button");
  });
});

describe("PageBuilderCard's sections", () => {
  it("lists every section in page order, numbered, named, with its first line", () => {
    render(<PageBuilderCard {...base} document={FIVE} />);

    const rows = within(sectionList())
      .getAllByRole("listitem")
      .map(row => row.textContent);
    expect(rows).toEqual([
      "1SectionWelcome to AcmeEdit",
      "2TextPlain words first.Edit",
      "3DividerEdit",
      "4PricingPlans for teamsEdit",
      "5HeadingContact usEdit",
    ]);
  });

  it("links each to the builder at that section, named for it", () => {
    render(<PageBuilderCard {...base} document={FIVE} />);

    const fourth = within(sectionList()).getByRole("link", {
      name: "Edit section 4, Pricing: Plans for teams",
    });
    expect(fourth.getAttribute("href")).toBe(
      "/admin/collections/pages/p1/builder?field=body&section=plans"
    );
    // A section with no text is named by its number and block alone.
    expect(
      within(sectionList()).getByRole("link", {
        name: "Edit section 3, Divider",
      })
    ).toBeDefined();
  });

  it("opens a section within the admin on a plain click", () => {
    const onNavigate = vi.fn();
    render(
      <PageBuilderCard {...base} document={FIVE} onNavigate={onNavigate} />
    );

    fireEvent.click(
      within(sectionList()).getByRole("link", { name: /Edit section 4/ }),
      { button: 0 }
    );

    expect(onNavigate).toHaveBeenCalledWith(
      "/admin/collections/pages/p1/builder?field=body&section=plans"
    );
  });

  it("says that adding, reordering and styling happen in the builder", () => {
    render(<PageBuilderCard {...base} document={FIVE} />);
    sectionList();

    expect(
      screen.getByText("Add, reorder and style sections in the Page Builder.")
    ).toBeDefined();
  });

  it("offers each section in the preview too, named and addressed as in the list", () => {
    render(<PageBuilderCard {...base} document={FIVE} />);

    const inPicture = screen.getByRole("link", {
      name: "Section 4, Pricing: Plans for teams",
    });
    expect(inPicture.getAttribute("href")).toBe(
      "/admin/collections/pages/p1/builder?field=body&section=plans"
    );
  });
});

describe("PageBuilderCard's full-page preview", () => {
  it("opens the editor's own preview where the editor offers one", () => {
    const open = vi.fn();
    preview.current = { open };
    render(<PageBuilderCard {...base} document={FIVE} />);

    fireEvent.click(screen.getByRole("button", { name: PREVIEW_PAGE_LABEL }));

    expect(open).toHaveBeenCalledTimes(1);
  });

  it("is not offered on a page drawn read-only, which may not be the live one", () => {
    // A version in history and the source language beside a translation are
    // drawn read-only inside the live editor, whose preview opens the CURRENT
    // page in the language being edited: offering it there opens a page other
    // than the one the card shows.
    preview.current = { open: vi.fn() };
    render(<PageBuilderCard {...base} document={FIVE} canEdit={false} />);

    expect(
      screen.queryByRole("button", { name: PREVIEW_PAGE_LABEL })
    ).toBeNull();
  });

  it("is not offered where the editor offers no preview", () => {
    render(<PageBuilderCard {...base} document={FIVE} />);

    expect(
      screen.queryByRole("button", { name: PREVIEW_PAGE_LABEL })
    ).toBeNull();
  });
});

describe("PageBuilderCard for someone who may not edit the page", () => {
  it("shows the page and its sections, and no way into the builder", () => {
    const { container } = render(
      <PageBuilderCard {...base} document={FIVE} canEdit={false} />
    );

    expect(container.querySelector(MINIATURE)).not.toBeNull();
    expect(within(sectionList()).getAllByRole("listitem")).toHaveLength(5);
    // No Edit link, no link over the picture, no "Open in builder".
    expect(screen.queryAllByRole("link")).toHaveLength(0);
    expect(
      screen.queryByText("Add, reorder and style sections in the Page Builder.")
    ).toBeNull();
  });
});

describe("PageBuilderCard for a page never saved", () => {
  it("lists its sections without links, since none has an address yet", () => {
    render(<PageBuilderCard {...base} document={FIVE} href={undefined} />);

    expect(within(sectionList()).getAllByRole("listitem")).toHaveLength(5);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("PageBuilderCard while another language is on screen", () => {
  it("offers no way into a single section, and still the way into the builder", () => {
    // The sections listed are this language's; the builder opens the default
    // language's document, whose sections need not be the same.
    locale.current = {
      code: "de",
      documentLocalized: true,
      isDefaultLocale: false,
      rtl: false,
    };
    render(<PageBuilderCard {...base} document={FIVE} />);

    expect(within(sectionList()).getAllByRole("listitem")).toHaveLength(5);
    expect(within(sectionList()).queryAllByRole("link")).toHaveLength(0);
    expect(screen.queryByRole("link", { name: /^Section \d/ })).toBeNull();
    expect(
      screen.getByRole("link", { name: OPEN_BUILDER_LABEL })
    ).toBeDefined();
  });

  it("links each section in the default language", () => {
    // The control: the same page, the default language, links as usual.
    locale.current = {
      code: null,
      documentLocalized: true,
      isDefaultLocale: true,
      rtl: false,
    };
    render(<PageBuilderCard {...base} document={FIVE} />);

    expect(within(sectionList()).getAllByRole("link")).toHaveLength(5);
  });
});

describe("PageBuilderCard with a placed component", () => {
  it("opens the component's section at the instance, which the editor holds", () => {
    const withHeader = pageRenderInputs({
      siteStyle: undefined,
      clientConfig: undefined,
      previewContainer: undefined,
      limits: DEFAULT_LIMITS,
      definitions: new Map([
        [
          "header",
          {
            formatVersion: DOCUMENT_FORMAT_VERSION,
            kind: "component",
            nodes: [node("d1", "core/heading", { text: "Site header" })],
          } as unknown as BlockDocument,
        ],
      ]),
    });
    const page = {
      formatVersion: DOCUMENT_FORMAT_VERSION,
      kind: "page",
      nodes: [
        {
          id: "i1",
          type: COMPONENT_INSTANCE_TYPE,
          version: 1,
          props: { componentId: "header" },
        },
      ],
    } as unknown as BlockDocument;

    render(<PageBuilderCard {...base} document={page} render={withHeader} />);

    const link = within(sectionList()).getByRole("link", {
      name: /^Edit section 1/,
    });
    expect(link.getAttribute("href")).toBe(
      "/admin/collections/pages/p1/builder?field=body&section=i1"
    );
  });
});
