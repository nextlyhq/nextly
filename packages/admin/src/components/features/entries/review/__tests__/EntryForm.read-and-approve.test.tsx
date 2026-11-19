/**
 * A person who may read a document and approve it, but not change it, opens
 * the editor read-only (the fields held, no Save) with the review's steps in
 * the header: Approve leads, Request changes is offered beside it, and the
 * changes under review are shown.
 *
 * Each case runs against the same editor for a person who may change the
 * document, so what the reader is refused is the permission's doing, not the
 * fixture's.
 */
import { ShortcutProvider } from "@nextlyhq/ui";
import { QueryClientProvider } from "@tanstack/react-query";
import { render, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  cleanup,
  createTestQueryClient,
  screen,
  waitFor,
} from "@admin/__tests__/utils";
import type { PartReview } from "@admin/types/workflows";

const hooks = vi.hoisted(() => ({
  reader: true,
  fetchReviewState: vi.fn(),
  takeWorkflowStep: vi.fn(),
  useDocumentLock: vi.fn(),
  versions: vi.fn(),
}));

vi.mock("@admin/services/workflowApi", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/services/workflowApi")>()),
  fetchReviewState: hooks.fetchReviewState,
  takeWorkflowStep: hooks.takeWorkflowStep,
}));
vi.mock("@admin/hooks/useUpdateAnswer", async importOriginal => ({
  ...(await importOriginal<typeof import("@admin/hooks/useUpdateAnswer")>()),
  useUpdateAnswer: () => (hooks.reader ? "refused" : "allowed"),
}));
vi.mock("@admin/hooks/queries/useDocumentLock", () => ({
  useDocumentLock: hooks.useDocumentLock,
}));
vi.mock("@admin/hooks/useAutosaveRecovery", () => ({
  useAutosaveRecovery: () => ({
    offer: null,
    isResolved: true,
    dismiss: () => {},
    restore: () => {},
  }),
}));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: () => ({ status: "idle", lastSavedAt: null }),
}));
vi.mock("@admin/hooks/useLocalization", () => ({
  useLocalization: () => ({
    enabled: false,
    locales: [],
    defaultLocale: "",
    fallback: true,
    getLocale: () => undefined,
  }),
}));
// Neither person may publish: the reviewer approves, someone else publishes.
vi.mock("@admin/hooks/useCan", () => ({ useCan: () => false }));
vi.mock("@admin/hooks/queries/useVersions", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/queries/useVersions")
  >()),
  useVersions: (...args: unknown[]) => hooks.versions(...args),
}));
vi.mock("@admin/components/features/versions/diff/VersionDiffView", () => ({
  VersionDiffView: ({ from, to }: { from: number; to: number }) => (
    <p>
      comparing {from} with {to}
    </p>
  ),
}));

import { EntryForm } from "../../EntryForm/EntryForm";

function Providers({ children }: { children: ReactNode }): ReactElement {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      <ShortcutProvider isApple={false}>{children}</ShortcutProvider>
    </QueryClientProvider>
  );
}

const posts = {
  name: "posts",
  label: "Posts",
  status: true,
  workflow: { slug: "review" },
  fields: [{ name: "title", type: "text", label: "Title" }],
} as never;
const entry = { id: "e1", title: "Hello", status: "draft" } as never;

const inReview: PartReview = {
  part: null,
  stage: "inReview",
  stageLabel: "In review",
  publishable: false,
  enteredAt: null,
  enteredBy: null,
  assignee: null,
  dueAt: null,
  approval: null,
  revision: 2,
  version: "t2",
  steps: [
    {
      name: "approve",
      label: "Approve",
      kind: "approve",
      to: "approved",
      mayTake: true,
      primary: true,
      commentRequired: false,
    },
    {
      name: "send-back",
      label: "Request changes",
      kind: "request-changes",
      to: "drafting",
      mayTake: true,
      primary: false,
      commentRequired: true,
    },
  ],
  waitingFor: { kind: "roles", roles: [{ id: "r-rev", name: "Reviewers" }] },
  lastMove: null,
};

function renderAs(reader: boolean): void {
  hooks.reader = reader;
  render(<EntryForm collection={posts} entry={entry} mode="edit" />, {
    wrapper: Providers,
  });
}

/** The header's Approve, once the review state is read (the side panel offers one too). */
async function headerApprove(): Promise<HTMLElement> {
  const bar = await screen.findByTestId("document-bar");
  return within(bar).findByRole("button", { name: "Approve" });
}

/** Every action the header offers, in the bar and in its More actions menu, by name. */
async function offered(): Promise<string[]> {
  const bar = await screen.findByTestId("document-bar");
  const shown = within(bar)
    .getAllByRole("button")
    .map(button => button.textContent?.trim() ?? "");
  const more = within(bar).queryByRole("button", { name: "More actions" });
  if (more === null) return shown;
  await userEvent.click(more);
  const items = (await screen.findAllByRole("menuitem")).map(
    item => item.textContent?.trim() ?? ""
  );
  await userEvent.keyboard("{Escape}");
  return [...shown, ...items];
}

beforeEach(() => {
  vi.clearAllMocks();
  hooks.useDocumentLock.mockReturnValue({
    state: { status: "held-by-me" },
    takeOver: vi.fn(),
    requestAccess: vi.fn(),
  });
  hooks.fetchReviewState.mockResolvedValue({
    attached: true,
    review: {
      workflow: { slug: "review", label: "Review" },
      parts: [inReview],
      mayPublishWithoutReview: false,
    },
  });
  hooks.takeWorkflowStep.mockResolvedValue({
    message: "Step taken.",
    item: {},
  });
  hooks.versions.mockReturnValue({
    data: {
      pages: [
        {
          items: [
            { versionNo: 3, status: "draft", isAutosave: false },
            { versionNo: 1, status: "published", isAutosave: false },
          ],
          meta: {},
        },
      ],
    },
    isError: false,
  });
});

afterEach(() => {
  cleanup();
});

describe("a person who may read and approve, but not edit", () => {
  it("opens the document read-only, with nothing to save", async () => {
    renderAs(true);
    await headerApprove();

    expect(screen.getByRole("textbox", { name: /title/i })).toHaveAttribute(
      "readonly"
    );
    expect(await offered()).not.toContainEqual(expect.stringMatching(/^Save/));
    expect(
      screen.getByText(/Your access lets you view this, but not change it/)
    ).toBeVisible();

    // POPULATION CONTROL: a person who may edit is offered Save, in an
    // editable field, on the same document.
    cleanup();
    renderAs(false);
    await headerApprove();
    expect(screen.getByRole("textbox", { name: /title/i })).not.toHaveAttribute(
      "readonly"
    );
    expect(await offered()).toContainEqual(expect.stringMatching(/^Save/));
  });

  it("is offered Approve and Request changes, and sees the changes to judge", async () => {
    renderAs(true);

    const approve = await headerApprove();
    expect(approve).toBeEnabled();
    expect(await offered()).toContain("Request changes");
    expect(
      screen.getByRole("region", { name: "Changes to review" })
    ).toHaveTextContent("comparing 1 with 3");
  });

  it("approves the version on screen", async () => {
    renderAs(true);

    await userEvent.click(await headerApprove());

    await waitFor(() =>
      expect(hooks.takeWorkflowStep).toHaveBeenCalledWith({
        document: { collection: "posts", id: "e1" },
        step: "approve",
        parts: [null],
        seen: [{ part: null, revision: 2, version: "t2" }],
      })
    );
  });
});
