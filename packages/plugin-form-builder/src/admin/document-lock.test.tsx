// @vitest-environment jsdom

/**
 * What a colleague's claim withholds from the form builder.
 *
 * This view replaces the entry FORM, not the facts about the document, and the
 * page that renders it puts a strip above saying in words that unsaved changes
 * cannot be saved while someone else holds the claim. A builder that committed
 * anyway would make that sentence false and would overwrite the holder's row.
 *
 * Run against the real view rather than a mocked one, because the defect was
 * that the decision never crossed into it.
 *
 * @module admin/document-lock.test
 */
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { FormBuilderView } from "./FormBuilderView";

beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(cleanup);

function builder(
  documentLock: { readOnly: boolean; actionsDisabled: boolean } | undefined,
  onSave: ReturnType<typeof vi.fn>
) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <FormBuilderView
        entryId="form-1"
        initialData={{
          name: "Contact",
          slug: "contact",
          // A form with no fields refuses to save for its own reason, which
          // would pass this test without the lock doing anything.
          fields: [{ id: "f1", name: "email", label: "Email", type: "email" }],
        }}
        onSave={onSave}
        documentLock={documentLock}
      />
    </QueryClientProvider>
  );
}

function view(documentLock?: { readOnly: boolean; actionsDisabled: boolean }) {
  const onSave = vi.fn();
  const { rerender } = render(builder(documentLock, onSave));
  return {
    onSave,
    /** Re-render as the page does when the claim changes under the editor. */
    claimChangesTo: (next: { readOnly: boolean; actionsDisabled: boolean }) =>
      rerender(builder(next, onSave)),
  };
}

const save = () => screen.getByRole("button", { name: /save/i });

describe("the form builder under a colleague's claim", () => {
  it("saves normally when nobody else holds the document", async () => {
    // The control. Without it "did not save" is satisfied by a builder that
    // never saves, and every assertion below would pass on a broken view.
    const { onSave } = view({ readOnly: false, actionsDisabled: false });

    expect(save()).toBeEnabled();
    await userEvent.setup().click(save());

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("saves normally when the page passes no claim at all", async () => {
    // Creating has no document to claim, and a view rendered outside the entry
    // page is handed nothing. Neither is a reason to refuse a save.
    const { onSave } = view(undefined);

    expect(save()).toBeEnabled();
    await userEvent.setup().click(save());

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("withholds the save while a colleague holds it", async () => {
    const { onSave } = view({ readOnly: true, actionsDisabled: true });

    expect(save()).toBeDisabled();
    await userEvent.setup().click(save());

    expect(onSave).not.toHaveBeenCalled();
  });
  it("withholds it after a colleague takes the document mid-session", async () => {
    // The transition, not the mount: an editor who HELD the document when they
    // opened it, and lost it while they worked.
    //
    // This does not distinguish the commit gate from the disabled button, and
    // it does not pin the callback's dependency on the claim either - the
    // button's disabled state is computed on every render, so it withholds the
    // click whether or not the callback went stale. Removing that dependency
    // leaves this passing. It is here for the scenario, not as evidence.
    const { onSave, claimChangesTo } = view({
      readOnly: false,
      actionsDisabled: false,
    });

    claimChangesTo({ readOnly: true, actionsDisabled: true });
    await userEvent.setup().click(save());

    expect(onSave).not.toHaveBeenCalled();
  });
});
