import { describe, it, expect, vi, beforeEach } from "vitest";

import userEvent from "@testing-library/user-event";

import { render, screen } from "@admin/__tests__/utils";

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

  it("stops autosaving while a colleague holds the document", () => {
    // 🔴 The quietest of the four. A recovery point is a write to the same row,
    // so an autosave running under someone else's claim is exactly the overwrite
    // this feature exists to prevent, on a timer nobody is watching.
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-other", holder: bob },
      takeOver,
    });

    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    expect(useDocumentAutosave).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false })
    );
  });

  it("autosaves normally when this editor holds it", () => {
    // The other direction, so the rule cannot be satisfied by never autosaving.
    useDocumentLock.mockReturnValue({
      state: { status: "held-by-me" },
      takeOver,
    });

    render(
      <SingleForm schema={schema} document={document} onSubmit={vi.fn()} />
    );

    expect(useDocumentAutosave).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true })
    );
  });
});
