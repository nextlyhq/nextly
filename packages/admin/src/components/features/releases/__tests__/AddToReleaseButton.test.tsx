/**
 * When the add-to-release control is OFFERED, and when it is withheld.
 *
 * Every case here is a way the control could appear where the write would be
 * refused, and each was found in review rather than by anything failing. The
 * shape recurs because a control that should not be there looks exactly like
 * one that should: nothing errors, the button renders, and the refusal arrives
 * only after an editor has filled the dialog in. The server's refusal is also
 * one fixed sentence by design, so it cannot explain which of these it was.
 *
 * @module components/features/releases/__tests__/AddToReleaseButton.test
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

import { fireEvent, render, screen } from "@admin/__tests__/utils";

import { AddToReleaseButton } from "../AddToReleaseButton";

const { canFor, listReleases } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => true),
  listReleases: vi.fn(),
}));

vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));

// The queries are observed rather than stubbed away, because one of the cases
// below is about whether they are ISSUED at all.
vi.mock("@admin/hooks/queries/useReleases", () => ({
  useReleases: (params: unknown, enabled = true) => {
    listReleases(params, enabled);
    return { data: undefined, isPending: false, isError: false };
  },
  useAddReleaseMember: () => ({
    mutate: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
}));

const PROPS = {
  scopeKind: "collection" as const,
  scopeSlug: "posts",
  entryId: "e1",
  lifecycleEnabled: true,
  onDefaultLocale: true,
};

function renderButton(over: Partial<typeof PROPS> = {}) {
  return render(<AddToReleaseButton {...PROPS} {...over} />);
}

const button = () => screen.queryByRole("button", { name: /add to release/i });

beforeEach(() => {
  canFor.mockReset();
  canFor.mockImplementation(() => true);
  listReleases.mockReset();
});

describe("the control is offered", () => {
  it("to a caller who can assemble and publish this document", () => {
    renderButton();
    expect(button()).not.toBeNull();
  });
});

describe("the control is withheld where the write would be refused", () => {
  it("when the collection has no publish lifecycle", () => {
    // `useCan` answers true for the synthetic `publish-<slug>` check whatever
    // the schema says, so a super-admin editing a lifecycle-less collection
    // would be offered a control whose every submission the route rejects.
    renderButton({ lifecycleEnabled: false });
    expect(button()).toBeNull();
  });

  it("when the editor is on a translation rather than the default locale", () => {
    // A member is whole-document — the service refuses a locale-scoped one — so
    // adding from a translation would schedule every locale while every other
    // control on that screen acts on the one being edited.
    renderButton({ onDefaultLocale: false });
    expect(button()).toBeNull();
  });

  it("when the caller cannot assemble releases", () => {
    canFor.mockImplementation(slug => slug !== "create-content-releases");
    renderButton();
    expect(button()).toBeNull();
  });

  it("when the caller can neither publish nor unpublish the document", () => {
    // Assembling authority alone schedules nothing: every member performs a
    // lifecycle write on THIS document.
    canFor.mockImplementation(slug => !slug.endsWith("-posts"));
    renderButton();
    expect(button()).toBeNull();
  });
});

describe("the protected queries", () => {
  it("are not issued while the dialog is closed", () => {
    // These are gated endpoints. Mounting them unconditionally made every
    // editor visit issue requests for a picker nobody had opened — and, for a
    // reader without the grant, a pair of 403s per visit.
    renderButton();
    expect(listReleases).toHaveBeenCalled();
    for (const call of listReleases.mock.calls) {
      expect(call[1], "enabled").toBe(false);
    }
  });

  it("are not issued to a caller who may not read releases", () => {
    canFor.mockImplementation(slug => slug !== "read-content-releases");
    renderButton();
    for (const call of listReleases.mock.calls) {
      expect(call[1], "enabled").toBe(false);
    }
  });
});

describe("mounted inside the editor's form", () => {
  it("opens the dialog WITHOUT submitting the document", async () => {
    // The control moved into the form's action cluster, which put it inside the
    // editor's `<form>`. A `<button>` with no `type` defaults to `submit`, so
    // the trigger would have saved the document — publishing dirty fields —
    // before anybody had chosen a release, while still opening the dialog and
    // therefore looking entirely correct.
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
    render(
      <form onSubmit={onSubmit}>
        <AddToReleaseButton {...PROPS} />
      </form>
    );

    const trigger = button();
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger as HTMLElement);

    // The dialog opened...
    expect(screen.queryByRole("dialog")).not.toBeNull();
    // ...and the document was NOT saved on the way.
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("says so on the element rather than relying on where it is mounted", async () => {
    // The property is `type="button"` on the trigger itself. Asserted directly
    // as well as through the form above, because a future wrapper that happens
    // to swallow submits would make the behavioural case pass while leaving the
    // control unsafe anywhere else it is used.
    renderButton();
    expect(button()?.getAttribute("type")).toBe("button");
  });
});
