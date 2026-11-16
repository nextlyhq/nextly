/**
 * An entry the editor gains starts its form again from the loaded copy.
 *
 * The form resets to a newer version on its own, telling versions apart by
 * `updatedAt`. Two saves inside one timestamp unit share it, and the form then
 * keeps what the editor typed as its own. A gain's load resets it whatever the
 * timestamps say, each time.
 */
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { render, screen, waitFor } from "@admin/__tests__/utils";

const { useDocumentLock } = vi.hoisted(() => ({ useDocumentLock: vi.fn() }));
vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave: () => ({ status: "idle", lastSavedAt: null }),
}));
vi.mock("@admin/components/features/entries/EntryForm/DocumentBar", () => ({
  DocumentBar: () => <div data-testid="document-bar" />,
}));

import { EntryForm } from "../EntryForm";

const collection = {
  name: "posts",
  label: "Posts",
  fields: [
    { name: "title", type: "text", label: "Title" },
    { name: "excerpt", type: "text", label: "Excerpt" },
  ],
} as never;
const bob = { ownerId: "u2", ownerLabel: "Bob", expiresInSeconds: 90 };
/** One timestamp for every save here, as a column kept to the second gives. */
const SAME_SECOND = "2026-01-01T00:00:00.000Z";

const lockState = (state: object, gains: number) => ({
  state,
  gains,
  takeOver: vi.fn(),
  requestAccess: vi.fn(),
});
const keptOut = (gains: number) =>
  lockState(
    { status: "held-by-other", holder: bob, requestSent: false },
    gains
  );
const holding = (gains: number) =>
  lockState({ status: "held-by-me", someoneWaiting: false }, gains);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("EntryForm when it gains an entry", () => {
  it("starts again from the loaded copy on each gain, though every save shares one timestamp", async () => {
    const reload = vi.fn(() => Promise.resolve());
    const view = (excerpt: string, readAt: number) => (
      <EntryForm
        collection={collection}
        entry={
          { id: "e1", title: "Post", excerpt, updatedAt: SAME_SECOND } as never
        }
        mode="edit"
        latest={{ readAt, failed: false, reload }}
      />
    );
    const excerpt = () => screen.getByLabelText("Excerpt") as HTMLInputElement;
    const user = userEvent.setup();

    // The first claim is still on its way, so the form is editable, and the
    // editor types before learning Bob holds the entry.
    useDocumentLock.mockReturnValue(lockState({ status: "acquiring" }, 0));
    const { rerender } = render(view("From the start", 1));
    await user.type(excerpt(), " and mine");
    useDocumentLock.mockReturnValue(keptOut(0));
    rerender(view("From the start", 1));

    // Bob saves and leaves; the editor gains the entry and loads it.
    useDocumentLock.mockReturnValue(holding(1));
    rerender(view("From the start", 1));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    rerender(view("Bob's first", 2));
    await waitFor(() => expect(excerpt().value).toBe("Bob's first"));
    expect(excerpt().readOnly).toBe(false);

    // Again, inside the same second: the editor types, Bob takes it, saves
    // and leaves, and the editor gains it once more.
    await user.type(excerpt(), " and mine again");
    useDocumentLock.mockReturnValue(keptOut(1));
    rerender(view("Bob's first", 2));
    useDocumentLock.mockReturnValue(holding(2));
    rerender(view("Bob's first", 2));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    rerender(view("Bob's second", 3));
    await waitFor(() => expect(excerpt().value).toBe("Bob's second"));
  });
});

describe("EntryForm trying again after a read failed with nothing gained", () => {
  it("keeps what the editor typed", async () => {
    // The editor holds the entry throughout. Starting the form again here
    // would lose the work the failed read kept on screen.
    const reload = vi.fn(() => Promise.resolve());
    const view = (readAt: number, failed: boolean) => (
      <EntryForm
        collection={collection}
        entry={
          {
            id: "e1",
            title: "Post",
            excerpt: "Stored",
            updatedAt: SAME_SECOND,
          } as never
        }
        mode="edit"
        latest={{ readAt, failed, reload }}
      />
    );
    const excerpt = () => screen.getByLabelText("Excerpt") as HTMLInputElement;
    const user = userEvent.setup();
    useDocumentLock.mockReturnValue(holding(0));
    const { rerender } = render(view(1, false));
    await user.type(excerpt(), " and mine");

    rerender(view(1, true));
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    rerender(view(2, false));

    await waitFor(() => expect(excerpt().readOnly).toBe(false));
    expect(excerpt().value).toBe("Stored and mine");
  });
});
