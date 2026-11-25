/**
 * The preview's choices in the standalone editor's header: rows of the main
 * button's menu (or of More, where no main button is drawn).
 *
 * `previewChoices` decides which rows there are and is covered by
 * `PreviewActions`' suite; what is asserted here is that the header DRAWS them
 * and supplies the halves it owns. That is the property that was missing: the control, its service, its
 * hook and their tests all existed while nothing in the standalone editor
 * rendered any of them, so every component-level suite passed on a feature no
 * author could reach.
 */
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { FormProvider, useForm } from "react-hook-form";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";

const { canMock } = vi.hoisted(() => ({ canMock: vi.fn() }));

vi.mock("@admin/hooks/useCan", () => ({
  useCan: (permission: string) => canMock(permission) as boolean,
}));
// The share popover reads the document's live links when it opens.
vi.mock("@admin/services/previewLinkApi", () => ({
  previewLinkApi: { list: vi.fn().mockResolvedValue({ items: [], total: 0 }) },
}));

import { BarUnderTest as DocumentBar } from "./bar-under-test";

/**
 * The header reads form state through context, so it is given a real form:
 * a partial stub misses the ref plumbing `register` returns and fails for
 * reasons unrelated to what is under test.
 */
function WithForm({ children }: { children: ReactNode }) {
  const form = useForm();
  return <FormProvider {...form}>{children}</FormProvider>;
}

const SHARE_LABEL = "Share preview link…";
const SHARE_DOCUMENT = { collection: "posts", entryId: "e1" };

function renderHeader(overrides: Record<string, unknown> = {}) {
  return render(
    <WithForm>
      <DocumentBar
        mode="edit"
        hasStatus={false}
        collectionSlug="posts"
        entry={{ id: "e1" } as never}
        isSubmitting={false}
        isDirty={false}
        isLinkAvailable
        shareDocument={SHARE_DOCUMENT}
        {...overrides}
      />
    </WithForm>
  );
}

/**
 * The rows of the menu the preview's choices are drawn in: the main button's,
 * or More where no main button is drawn. Opened, read, and closed again.
 */
async function previewMenu(): Promise<HTMLElement> {
  const trigger =
    screen.queryByRole("button", {
      name: /^More (ways to publish|document actions)$/,
    }) ?? screen.getByRole("button", { name: "More actions" });
  await userEvent.click(trigger);
  return screen.findByRole("menu");
}

describe("DocumentBar preview choices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    canMock.mockReturnValue(true);
  });

  it("offers the shareable link on the main button's menu", async () => {
    renderHeader();
    const menu = await previewMenu();
    expect(
      within(menu).getByRole("menuitem", { name: SHARE_LABEL })
    ).toBeInTheDocument();
    // Not a button of its own beside the main one.
    expect(screen.queryByRole("button", { name: SHARE_LABEL })).toBeNull();
  });

  it("opens the share popover for the document it was given", async () => {
    renderHeader();
    const menu = await previewMenu();
    await userEvent.click(
      within(menu).getByRole("menuitem", { name: SHARE_LABEL })
    );
    expect(
      await screen.findByRole("heading", { name: "Share a preview" })
    ).toBeInTheDocument();
  });

  it("still offers the link when the flat permission list omits update", async () => {
    // `update` can be granted by a code-first `access.update` rule that the
    // flat `update-{slug}` list does not carry, and the mint endpoint evaluates
    // that rule. Gating the control on the list would hide the link from an
    // author who can edit the document — the same reasoning the Discard Draft
    // affordance beside it is built on. The endpoint refuses a caller who
    // genuinely may not update.
    canMock.mockReturnValue(false);
    renderHeader();
    const menu = await previewMenu();
    expect(
      within(menu).getByRole("menuitem", { name: SHARE_LABEL })
    ).toBeInTheDocument();
  });

  it("withholds the link when there is no saved document to name", async () => {
    renderHeader({
      mode: "create",
      entry: null,
      isLinkAvailable: false,
      shareDocument: undefined,
      isPreviewAvailable: true,
      onPreview: vi.fn(),
    });
    const menu = await previewMenu();
    // The control: the menu holds the preview's other choice.
    expect(
      within(menu).getByRole("menuitem", { name: "Preview" })
    ).toBeInTheDocument();
    expect(
      within(menu).queryByRole("menuitem", { name: SHARE_LABEL })
    ).toBeNull();
  });

  it("refuses a mint while the form is submitting", async () => {
    // Minting reads what is saved, so a submit in flight is a race with it.
    renderHeader({ isSubmitting: true });
    const menu = await previewMenu();
    expect(
      within(menu).getByRole("menuitem", { name: SHARE_LABEL })
    ).toHaveAttribute("aria-disabled", "true");
  });

  it("names opening by a declared label VERBATIM", async () => {
    /*
     * `previewLabel` is a complete label, not a noun. Collections legitimately
     * name one "View page" — the preview-link suite uses exactly that — and
     * interpolating it produced "Show View page", which is not English.
     */
    renderHeader({
      previewLabel: "View page",
      isPreviewAvailable: true,
      onPreview: vi.fn(),
    });
    const menu = await previewMenu();
    expect(
      within(menu).getByRole("menuitem", { name: "View page" })
    ).toBeInTheDocument();
    expect(screen.queryByText(/Show View page/)).toBeNull();
  });

  it("says in the pane row's words whether the click shows or hides it", async () => {
    // A menu row has no pressed state, so its words carry it: the only thing
    // that tells a screen-reader user the pane is open.
    const shown = renderHeader({
      onTogglePreviewPane: () => {},
      previewPaneOpen: false,
    });
    let menu = await previewMenu();
    expect(
      within(menu).getByRole("menuitem", { name: "Show preview pane" })
    ).toBeInTheDocument();
    shown.unmount();
    renderHeader({ onTogglePreviewPane: () => {}, previewPaneOpen: true });
    menu = await previewMenu();
    expect(
      within(menu).getByRole("menuitem", { name: "Hide preview pane" })
    ).toBeInTheDocument();
  });

  it("renders nothing when neither action is available", async () => {
    // A disabled control says "you cannot do this" without saying why, so the
    // header shows no preview affordance at all rather than a dead one.
    renderHeader({ isLinkAvailable: false, shareDocument: undefined });
    expect(screen.queryByRole("button", { name: /preview/i })).toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /^More (ways to publish|document actions)$/,
      })
    ).toBeNull();
  });
});
