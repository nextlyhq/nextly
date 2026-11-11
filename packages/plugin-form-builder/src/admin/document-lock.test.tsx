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
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { within } from "@testing-library/react";

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

const save = () => screen.getByRole("button", { name: "Save" });

/**
 * One unsaved change, made through the bar's status menu. Save is offered
 * only with something to save, so without one a held save and an idle one
 * look the same and nothing here would be about the claim.
 */
async function edit(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /^Status:/ }));
  await user.click(await screen.findByRole("menuitemradio", { name: /^Live/ }));
}

describe("the form builder under a colleague's claim", () => {
  it("saves normally when nobody else holds the document", async () => {
    // The control. Without it "did not save" is satisfied by a builder that
    // never saves, and every assertion below would pass on a broken view.
    const { onSave } = view({ readOnly: false, actionsDisabled: false });
    const user = userEvent.setup();
    await edit(user);

    expect(save()).toBeEnabled();
    await user.click(save());

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("saves normally when the page passes no claim at all", async () => {
    // Creating has no document to claim, and a view rendered outside the entry
    // page is handed nothing. Neither is a reason to refuse a save.
    const { onSave } = view(undefined);
    const user = userEvent.setup();
    await edit(user);

    expect(save()).toBeEnabled();
    await user.click(save());

    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it("withholds the save while a colleague holds it", async () => {
    // Writes held but edits allowed, so there IS a change to save: a form the
    // editor cannot change has nothing to save either, and Save would be
    // withheld for that reason with the claim ignored.
    const { onSave } = view({ readOnly: false, actionsDisabled: true });
    const user = userEvent.setup();
    await edit(user);

    expect(save()).toBeDisabled();
    await user.click(save());

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
    const user = userEvent.setup();
    await edit(user);

    claimChangesTo({ readOnly: true, actionsDisabled: true });
    await user.click(save());

    expect(onSave).not.toHaveBeenCalled();
  });

  /**
   * Opens Delete's question with the form held, lets a colleague take it when
   * `claimed`, answers Delete, and reports what was sent.
   */
  async function confirmDelete(claimed: boolean) {
    // The question is asked with the document held; the answer comes after a
    // colleague has taken it. The claim is advisory on the server, so the
    // editor is the only thing between that answer and the delete.
    // An admin, so Delete is offered: the claim is what is under test.
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve(
        new Response(
          url.includes("/me/permissions") ? '{"isSuperAdmin":true}' : "{}",
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);
    const onDelete = vi.fn();
    const deletable = (lock: {
      readOnly: boolean;
      actionsDisabled: boolean;
    }) => (
      <QueryClientProvider client={client}>
        <FormBuilderView
          entryId="form-1"
          initialData={{
            name: "Contact",
            slug: "contact",
            fields: [
              { id: "f1", name: "email", label: "Email", type: "email" },
            ],
          }}
          onDelete={onDelete}
          documentLock={lock}
        />
      </QueryClientProvider>
    );
    const client = new QueryClient();
    const { rerender } = render(
      deletable({ readOnly: false, actionsDisabled: false })
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "More" }));
    await user.click(
      await screen.findByRole("menuitem", { name: /Delete form/ })
    );
    const dialog = await screen.findByRole("alertdialog");

    if (claimed) rerender(deletable({ readOnly: true, actionsDisabled: true }));
    await user.click(
      within(dialog).getByRole("button", { name: "Delete form" })
    );

    const deletes = fetchMock.mock.calls.filter(
      call =>
        (call as unknown[])[1] !== undefined &&
        ((call as unknown[])[1] as RequestInit).method === "DELETE"
    );
    vi.unstubAllGlobals();
    return { deletes, onDelete };
  }

  it("deletes the form when Delete is confirmed while the editor holds it", async () => {
    // The control: without it "nothing was deleted" is met by a Delete that
    // never deletes.
    const { deletes, onDelete } = await confirmDelete(false);
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    expect(deletes).toHaveLength(1);
  });

  it("does not delete the form when a colleague takes it while Delete is being confirmed", async () => {
    const { deletes, onDelete } = await confirmDelete(true);
    expect(deletes).toHaveLength(0);
    expect(onDelete).not.toHaveBeenCalled();
  });
});
