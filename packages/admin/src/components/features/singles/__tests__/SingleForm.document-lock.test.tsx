import { describe, it, expect, vi, beforeEach } from "vitest";

import userEvent from "@testing-library/user-event";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@admin/__tests__/utils";

const { useDocumentLock, useDocumentAutosave } = vi.hoisted(() => ({
  useDocumentLock: vi.fn(),
  useDocumentAutosave: vi.fn(() => ({ status: "idle", lastSavedAt: null })),
}));

vi.mock("@admin/hooks/queries/useDocumentLock", () => ({ useDocumentLock }));
// Spied for its options rather than its behaviour: whether a recovery point may
// be written under someone else's claim is the thing being decided.
vi.mock("@admin/hooks/useDocumentAutosave", async importOriginal => ({
  ...(await importOriginal<
    typeof import("@admin/hooks/useDocumentAutosave")
  >()),
  useDocumentAutosave,
}));

import {
  SingleForm,
  type SingleSchema,
  type SingleDocumentData,
} from "../SingleForm";

const schema = {
  slug: "homepage",
  label: "Homepage",
  fields: [
    { type: "text", name: "title", label: "Title", required: true },
    { type: "text", name: "slug", label: "Slug", required: true, unique: true },
    { type: "text", name: "heroTitle", label: "Hero Title" },
  ],
} as unknown as SingleSchema;

const document = {
  id: "homepage",
  updatedAt: "2026-01-01T00:00:00.000Z",
  title: "Homepage",
  slug: "homepage",
  heroTitle: "",
} as unknown as SingleDocumentData;

const bob = { ownerId: "u2", ownerLabel: "Bob", expiresInSeconds: 90 };
/** The real DOM document, since `document` here is the single being edited. */
const document_ = globalThis.document;
const takeOver = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
});

/**
 * The wiring, not the derivation.
 *
 * `document-lock-affordances` decides what a state means and is tested on its
 * own; what these establish is that the editor actually consumes that decision —
 * a prop passed to the wrong component type-checks perfectly.
 */
describe("SingleForm under a document lock", () => {
  it("claims the single it is editing", () => {
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-me" },
      takeOver,
    });

    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    expect(useDocumentLock).toHaveBeenCalledWith(
      expect.objectContaining({
        scopeKind: "single",
        slug: "homepage",
        entryId: "homepage",
      })
    );
  });

  it("says nothing while this editor holds it", () => {
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-me" },
      takeOver,
    });

    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    expect(
      screen.queryByTestId("document-lock-banner")
    ).not.toBeInTheDocument();
    const hero = screen.getByLabelText("Hero Title") as HTMLInputElement;
    expect(hero.readOnly).toBe(false);
  });

  it("names the holder and renders the fields uneditable", () => {
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob },
      takeOver,
    });

    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    expect(screen.getByTestId("document-lock-banner")).toHaveTextContent("Bob");
    // 🔴 The field, not the banner. A tinted strip over an editable form tells
    // the reader one thing and lets them do another.
    const hero = screen.getByLabelText("Hero Title") as HTMLInputElement;
    expect(hero.readOnly).toBe(true);
  });

  it("offers the way back, and asks the engine for it", async () => {
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob },
      takeOver,
    });

    const user = userEvent.setup();
    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: "Take over" }));
    expect(takeOver).toHaveBeenCalledTimes(1);
  });

  it("keeps the editor working when the lock could not be checked", () => {
    // 🔴 The lock is advisory. A guard that stops work when the server cannot be
    // reached has turned a nicety into an outage.
    useDocumentLock.mockReturnValue({
      state: { status: "unavailable" },
      takeOver,
    });

    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    expect(screen.getByTestId("document-lock-banner")).toBeInTheDocument();
    const hero = screen.getByLabelText("Hero Title") as HTMLInputElement;
    expect(hero.readOnly).toBe(false);
    // Nothing to take over: nobody has said anyone holds it. Offering the button
    // would invite the reader to displace a colleague who may not exist.
    expect(
      screen.queryByRole("button", { name: /take (over|it back)/i })
    ).not.toBeInTheDocument();
  });

  it("keeps the author's own recovery running while a colleague holds it", () => {
    // 🔴 The opposite of what it looks like it should do, and the engine depends
    // on it. `useDocumentAutosave` does not write the document: it upserts a
    // recovery row keyed by document AND author, which the live-row predicate
    // excludes, so it cannot reach the holder's document or their recovery row.
    //
    // `document-lock-repository` says a takeover moves the ousted author's work
    // nowhere precisely BECAUSE that row keeps being written. Stopping it removes
    // the safety net at the moment the banner promises their unsaved changes are
    // still theirs.
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob },
      takeOver,
    });

    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    expect(useDocumentAutosave).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });

  it("refuses a save that reaches past the disabled controls", async () => {
    // 🔴 The controls are disabled, but disabling them one at a time is a list
    // the next write path gets added without. A displaced editor still has a
    // keyboard: this is the guard that does not depend on remembering.
    const onSubmit = vi.fn();
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-me" },
      takeOver,
    });

    const user = userEvent.setup();
    const { rerender } = render(
      <SingleForm schema={schema} document={document} onSubmit={onSubmit} />
    );

    // Dirty while they still hold it.
    await user.type(screen.getByLabelText("Hero Title"), "work");

    // Then a colleague takes it.
    useDocumentLock.mockReturnValue({
      state: { status: "taken-over", holder: bob },
      takeOver,
    });
    rerender(
      <SingleForm schema={schema} document={document} onSubmit={onSubmit} />
    );

    // Native submission, which no disabled button stands in front of.
    const form = document_.querySelector("form");
    expect(form, "the editor renders a form to submit").not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    // 🔴 Settled, not polled. `waitFor` around a negative assertion passes on its
    // first check - before the submit it is meant to catch has even run - which
    // is a test that cannot fail. The submit is asynchronous, so it is given time
    // to happen and then found not to have.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("saves normally when this editor holds it", async () => {
    // The other direction, so the gate cannot be satisfied by refusing everything.
    const onSubmit = vi.fn();
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-me" },
      takeOver,
    });

    const user = userEvent.setup();
    render(
      <SingleForm schema={schema} document={document} onSubmit={onSubmit} />
    );

    await user.type(screen.getByLabelText("Hero Title"), "work");
    const form = document_.querySelector("form");
    expect(form, "the editor renders a form to submit").not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
  });

  it("shows the write controls as refused, not merely inert", async () => {
    // 🔴 The handlers already refuse, so this is not what makes the document
    // safe - it is what stops the interface lying. A live Save beside a strip
    // saying the document is somebody else's invites a click that silently does
    // nothing, which reads as the editor being broken rather than the lock
    // working.
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob },
      takeOver,
    });

    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    const write = screen.getAllByRole("button", { name: /save|publish/i });
    expect(write.length, "the editor renders a write control").toBeGreaterThan(
      0
    );
    for (const control of write) {
      expect(control, control.textContent ?? "").toBeDisabled();
    }
  });

  it("leaves the write controls alone when this editor holds it", async () => {
    // The other direction, so the rule cannot be satisfied by disabling always.
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-me" },
      takeOver,
    });

    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    const write = screen.getAllByRole("button", { name: /save|publish/i });
    expect(write.some(control => !control.hasAttribute("disabled"))).toBe(true);
  });
});
