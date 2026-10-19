/**
 * The editor header's arrangement, and that it draws no empty control.
 *
 * The header is one top row (the way back at the left, every action at the
 * right with History first), then the title on its own line, then the status
 * line. And in every document state, each button shows something: an icon, or
 * words that are not hidden. A button whose only content is a label hidden at
 * narrow widths draws as an empty bordered box, which is what the editor
 * showed beside "Saved" before the title had a line of its own.
 *
 * jsdom evaluates no CSS, so "hidden" is read from the classes that hide: a
 * label inside an element carrying `sr-only`, under any width variant, is not
 * counted as something the button shows.
 */
import userEvent from "@testing-library/user-event";
import { FormProvider, useForm } from "react-hook-form";
import { describe, expect, it, vi } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

import { NARROW_ONLY, WIDE_ONLY } from "../DocumentActionBar";
import { EntrySystemHeader } from "../EntrySystemHeader";

vi.mock("@admin/hooks/useCan", () => ({ useCan: () => true }));

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
  backLink,
  onCopyLink,
  isCopyingLink = false,
}: {
  state: State;
  backLink?: { href: string; label: string };
  onCopyLink?: () => void;
  isCopyingLink?: boolean;
}) {
  const methods = useForm({
    defaultValues: { title: state.entry?.title ?? "" },
  });
  return (
    <FormProvider {...methods}>
      <EntrySystemHeader
        mode={state.mode}
        hasStatus={state.hasStatus ?? true}
        draftsEnabled={state.draftsEnabled ?? false}
        isDirty={state.isDirty ?? false}
        entry={state.entry ?? null}
        collectionSlug="posts"
        historyFields={[]}
        autosaveEnabled
        autosaveStatus="idle"
        {...(backLink === undefined ? {} : { backLink })}
        {...(onCopyLink === undefined
          ? {}
          : { onCopyLink, isLinkAvailable: true })}
        isCopyingLink={isCopyingLink}
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

describe("the editor header", () => {
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

  it("puts the way back first, every action after it with History first, then the title on its own line", () => {
    render(
      <Harness
        state={STATES[1]!}
        backLink={{ href: "/admin/collections/posts", label: "Posts" }}
      />
    );
    const back = screen.getByRole("link", { name: "Posts" });
    expect(back).toHaveAttribute("href", "/admin/collections/posts");
    const history = screen.getByRole("button", { name: "Version history" });
    const save = screen.getByRole("button", { name: /^save draft$/i });
    const title = screen.getByRole("textbox");

    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(back, history)).toBe(true);
    expect(follows(history, save)).toBe(true);
    // The title is below the action row, not between the way back and it.
    expect(follows(save, title)).toBe(true);
    // The way back and the actions share the top row; the title has its own.
    const topRow = history.closest("div.min-h-9");
    expect(topRow).not.toBeNull();
    expect(within(topRow as HTMLElement).getByRole("link")).toBe(back);
    expect(topRow?.contains(title)).toBe(false);
  });

  it("draws no back link where the document has no list to go back to", () => {
    render(<Harness state={STATES[1]!} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("gives every icon-only button a name and a tooltip", () => {
    const { container } = render(
      <Harness state={STATES[1]!} onCopyLink={vi.fn()} />
    );
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

  it("folds History and the preview into the menu on a narrow screen, and hides the panel toggle there", async () => {
    const user = userEvent.setup();
    const onCopyLink = vi.fn();
    render(<Harness state={STATES[1]!} onCopyLink={onCopyLink} />);
    // On a narrow screen these controls go...
    const narrowHidden = WIDE_ONLY;
    expect(
      screen.getByRole("button", { name: "Version history" }).className
    ).toContain(narrowHidden);
    expect(
      screen
        .getByRole("button", { name: "Copy shareable link" })
        .closest("div.contents")?.className
    ).toContain(narrowHidden);
    expect(
      screen.getByRole("button", { name: /^(show|hide) rail$/i }).className
    ).toContain(narrowHidden);

    // ...and the menu offers them, as rows shown only at that width.
    await user.click(screen.getByRole("button", { name: "More actions" }));
    const shownNarrow = NARROW_ONLY.split(" ").at(-1)!;
    const history = await screen.findByRole("menuitem", {
      name: "Version history",
    });
    expect(history.className).toContain(shownNarrow);
    const copy = screen.getByRole("menuitem", { name: "Copy shareable link" });
    expect(copy.className).toContain(shownNarrow);
    await user.click(copy);
    expect(onCopyLink).toHaveBeenCalledTimes(1);
  });

  it("shows a folded copy still running on the menu's trigger, which stays", () => {
    render(<Harness state={STATES[1]!} onCopyLink={vi.fn()} isCopyingLink />);
    const trigger = screen.getByRole("button", { name: "More actions" });
    expect(trigger).toHaveAttribute("aria-busy", "true");
    // The spinner shows on a narrow screen only; a wider one shows it on the
    // copy control itself.
    expect(
      trigger.querySelector("svg.animate-spin")?.getAttribute("class")
    ).toContain("max-sm:block");
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
