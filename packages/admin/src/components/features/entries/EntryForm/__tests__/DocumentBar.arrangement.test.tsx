/**
 * The document bar's arrangement, and that it draws no empty control.
 *
 * The bar is one sticky band: where the document stands at the left (status,
 * save state, language), every action at the right in one order (a feature's
 * controls, History, Preview, Save draft, the primary action, More, the panel
 * toggle). The title and the way back are not in it. And in every document
 * state, each button shows something: an icon, or words that are not hidden. A
 * button whose only content is a label hidden at narrow widths draws as an
 * empty bordered box.
 *
 * jsdom evaluates no CSS, so "hidden" is read from the classes that hide: a
 * label inside an element carrying `sr-only`, under any width variant, is not
 * counted as something the button shows.
 */
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { EntryLocaleProvider } from "../../EntryLocaleContext";
import { NARROW_ONLY, WIDE_ONLY } from "../DocumentActionBar";
import { BarUnderTest as DocumentBar } from "./bar-under-test";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));
vi.mock("@admin/hooks/useCanRequest", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useCanRequest")>()),
  useCanRequest: () => true,
}));
// The share popover reads the document's live links when it opens.
vi.mock("@admin/services/previewLinkApi", () => ({
  previewLinkApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));

interface State {
  name: string;
  mode: "create" | "edit";
  hasStatus?: boolean;
  draftsEnabled?: boolean;
  entry?: {
    id: string;
    status?: string;
    title?: string;
    _isWorkingDraft?: boolean;
  } | null;
  isDirty?: boolean;
}

// The states the header draws a different set of controls for.
const STATES: State[] = [
  { name: "a new entry", mode: "create" },
  {
    name: "a draft",
    mode: "edit",
    entry: { id: "e1", status: "draft", title: "Hello" },
  },
  {
    name: "a published entry",
    mode: "edit",
    entry: { id: "e1", status: "published", title: "Hello" },
  },
  {
    name: "a published entry with unsaved edits",
    mode: "edit",
    entry: { id: "e1", status: "published", title: "Hello" },
    isDirty: true,
  },
  {
    name: "a published entry with a working draft",
    mode: "edit",
    draftsEnabled: true,
    entry: {
      id: "e1",
      status: "published",
      title: "Hello",
      _isWorkingDraft: true,
    },
  },
  {
    name: "an entry with no status",
    mode: "edit",
    hasStatus: false,
    entry: { id: "e1", title: "Hello" },
  },
];

function Harness({
  state,
  share = false,
  toolbarSlot,
  preview = false,
}: {
  state: State;
  /** Whether this document may be shared, which offers the share row. */
  share?: boolean;
  /** A feature's toolbar control. */
  toolbarSlot?: React.ReactNode;
  /** Whether a preview can be opened, which draws the preview control. */
  preview?: boolean;
}) {
  const methods = useForm({
    defaultValues: { title: state.entry?.title ?? "" },
  });
  return (
    <FormProvider {...methods}>
      <DocumentBar
        mode={state.mode}
        hasStatus={state.hasStatus ?? true}
        draftsEnabled={state.draftsEnabled ?? false}
        isDirty={state.isDirty ?? false}
        entry={state.entry ?? null}
        collectionSlug="posts"
        historyFields={[]}
        autosaveEnabled
        documentStatus={{
          status: state.entry?.status ?? "draft",
          hasWorkingDraft: state.entry?._isWorkingDraft === true,
        }}
        toolbarSlot={toolbarSlot}
        {...(preview ? { isPreviewAvailable: true, onPreview: vi.fn() } : {})}
        {...(share
          ? {
              shareDocument: { collection: "posts", entryId: "e1" },
              isLinkAvailable: true,
            }
          : {})}
        onSaveDraft={vi.fn()}
        onPublish={vi.fn()}
        onSaveChanges={vi.fn()}
        onSaveWorkingDraft={vi.fn()}
        onUnpublish={vi.fn()}
        onDiscardWorkingDraft={vi.fn()}
        onToggleRail={vi.fn()}
      />
    </FormProvider>
  );
}

/** Whether an element hides what it holds at some width or always. */
function hides(element: Element): boolean {
  return /(^|\s|:)sr-only(\s|$)/.test(element.getAttribute("class") ?? "");
}

/** Whether a button shows an icon, or words nothing hides. */
function showsSomething(button: HTMLElement): boolean {
  if (button.querySelector("svg")) return true;
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim()) continue;
    let hidden = false;
    for (
      let parent = node.parentElement;
      parent && parent !== button.parentElement;
      parent = parent.parentElement
    ) {
      if (hides(parent)) hidden = true;
    }
    if (!hidden) return true;
  }
  return false;
}

describe("the document bar", () => {
  it.each(STATES.map(state => [state.name, state] as const))(
    "draws no empty control for %s",
    (_, state) => {
      const { container } = render(<Harness state={state} />);
      const buttons = [...container.querySelectorAll("button")];
      expect(buttons.length).toBeGreaterThan(0);
      const empty = buttons
        .filter(button => !showsSomething(button))
        .map(
          button =>
            button.getAttribute("aria-label") ??
            button.getAttribute("title") ??
            button.textContent
        );
      expect(empty).toEqual([]);
    }
  );

  it("draws its actions in one order: a feature's controls, History, Preview, Save draft, the primary action, More, then the panel toggle", () => {
    render(
      <Harness
        state={STATES[1]!}
        preview
        toolbarSlot={<button type="button">SEO check</button>}
      />
    );
    const order = [
      screen.getByRole("button", { name: "SEO check" }),
      screen.getByRole("button", { name: "History" }),
      screen.getByRole("button", { name: /^preview$/i }),
      screen.getByRole("button", { name: /^save draft$/i }),
      screen.getByRole("button", { name: /^publish$/i }),
      screen.getByRole("button", { name: "More actions" }),
      screen.getByRole("button", { name: /^(show|hide) rail$/i }),
    ];
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    for (let i = 1; i < order.length; i++) {
      expect(follows(order[i - 1]!, order[i]!)).toBe(true);
    }
    expect(order[4]).toHaveAttribute("data-primary", "true");
  });

  it("sticks to the top of the editor's scroll area", () => {
    render(<Harness state={STATES[1]!} />);
    const bar = screen.getByTestId("document-bar");
    expect(bar.className).toMatch(/(^|\s)sticky(\s|$)/);
    expect(bar.className).toMatch(/(^|\s)top-0(\s|$)/);
  });

  it("says where the document stands first: the status, then the save state, then the language off the default", () => {
    function Translating() {
      const methods = useForm({ defaultValues: { title: "Bonjour" } });
      return (
        <EntryLocaleProvider
          value={{
            locale: "fr",
            rtl: false,
            collectionLocalized: true,
            isNonDefaultLocale: true,
          }}
        >
          <FormProvider {...methods}>
            <DocumentBar
              mode="edit"
              hasStatus
              isDirty
              entry={{ id: "e1", status: "published", title: "Bonjour" }}
              documentStatus={{ status: "published", hasWorkingDraft: false }}
              collectionSlug="posts"
              historyFields={[]}
              onSaveDraft={vi.fn()}
              onPublish={vi.fn()}
              onSaveChanges={vi.fn()}
              onUnpublish={vi.fn()}
            />
          </FormProvider>
        </EntryLocaleProvider>
      );
    }
    render(<Translating />);
    const bar = screen.getByTestId("document-bar");
    const pill = within(bar).getByText("Published");
    const save = within(bar).getByTestId("save-state-indicator");
    const language = within(bar).getByText("fr");
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(pill, save)).toBe(true);
    expect(follows(save, language)).toBe(true);
    // Before every action.
    expect(
      follows(language, within(bar).getByRole("button", { name: "History" }))
    ).toBe(true);
  });

  it("shows no language code in the default language", () => {
    render(<Harness state={STATES[1]!} />);
    expect(screen.queryByText("en")).not.toBeInTheDocument();
  });

  it("draws neither the title nor a link: the title is the editor's, the way back the top bar's", () => {
    render(<Harness state={STATES[1]!} />);
    const bar = screen.getByTestId("document-bar");
    expect(within(bar).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(bar).queryByRole("link")).not.toBeInTheDocument();
  });

  it("gives every icon-only button a name and a tooltip", () => {
    const { container } = render(<Harness state={STATES[1]!} share />);
    const iconOnly = [...container.querySelectorAll("button")].filter(
      button =>
        button.querySelector("svg") &&
        ![...button.childNodes].some(
          node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim()
        ) &&
        !button.querySelector("span:not([aria-hidden])")?.textContent?.trim()
    );
    expect(iconOnly.length).toBeGreaterThan(0);
    for (const button of iconOnly) {
      expect(button.getAttribute("aria-label") ?? "").not.toBe("");
      expect(button.getAttribute("title") ?? "").not.toBe("");
    }
  });

  it("lets History's word step aside for its icon, as the preview's does, keeping its name and a tooltip", () => {
    // A narrow bar (history open beside it, say) has no width for every
    // label; History gives up its word like the other supporting action
    // rather than pushing the bar's content into itself.
    render(<Harness state={STATES[1]!} />);
    const history = screen.getByRole("button", { name: "History" });
    expect(history.querySelector("svg")).not.toBeNull();
    expect(history).toHaveAttribute("title", "History");
    const label = [...history.querySelectorAll("span")].find(
      span => span.textContent === "History"
    );
    expect(label).toBeDefined();
    expect(hides(label!)).toBe(true);
  });

  it("folds History and the preview into the menu on a narrow screen, and hides the panel toggle there", async () => {
    const user = userEvent.setup();
    render(<Harness state={STATES[1]!} share />);
    // On a narrow screen these controls go...
    const narrowHidden = WIDE_ONLY;
    expect(screen.getByRole("button", { name: "History" }).className).toContain(
      narrowHidden
    );
    expect(
      screen
        .getByRole("button", { name: "Share preview link…" })
        .closest("div.contents")?.className
    ).toContain(narrowHidden);
    expect(
      screen.getByRole("button", { name: /^(show|hide) rail$/i }).className
    ).toContain(narrowHidden);

    // ...and the menu offers them, as rows shown only at that width.
    await user.click(screen.getByRole("button", { name: "More actions" }));
    const shownNarrow = NARROW_ONLY.split(" ").at(-1)!;
    const history = await screen.findByRole("menuitem", {
      name: "History",
    });
    expect(history.className).toContain(shownNarrow);
    const share = screen.getByRole("menuitem", { name: "Share preview link…" });
    expect(share.className).toContain(shownNarrow);
    await user.click(share);
    // The same popover the wide control opens, hung from the row that stays
    // on screen.
    expect(
      await screen.findByRole("heading", { name: "Share a preview" })
    ).toBeInTheDocument();
  });

  it("draws no panel toggle while history is open, since history takes the panel's place", () => {
    window.history.replaceState(
      null,
      "",
      "/admin/collections/posts/e1?history=1"
    );
    try {
      render(<Harness state={STATES[1]!} />);
      // `hidden`, because the open panel may withdraw the page behind it from
      // the accessibility tree: the toggle must be absent, not merely hidden.
      expect(
        screen.queryByRole("button", {
          name: /^(show|hide) rail$/i,
          hidden: true,
        })
      ).not.toBeInTheDocument();
    } finally {
      window.history.replaceState(null, "", "/");
    }
    // The control: without history open the toggle is there.
    render(<Harness state={STATES[1]!} />);
    expect(
      screen.getByRole("button", { name: /^(show|hide) rail$/i })
    ).toBeInTheDocument();
  });

  it("lets the actions wrap within the row rather than run past it", () => {
    // A feature's contributed controls are sized by the feature, so the
    // cluster must be able to break inside the row's width.
    render(<Harness state={STATES[1]!} />);
    const cluster = screen
      .getByRole("button", { name: /^save draft$/i })
      .closest("div.ml-auto");
    expect(cluster?.className).toContain("flex-wrap");
    expect(cluster?.className).toContain("max-w-full");
  });
});
