/**
 * Running a document action from somewhere other than its control.
 *
 * A plugin's document view has no header, so it runs the document's actions
 * through the host. What these pin is that a run does what the control does,
 * refuses what the control would refuse in the control's own words, asks the
 * same question first where the control would, and says what it came to — so a
 * caller can act on the answer. Each case is one a runner that simply called
 * the handler would get wrong.
 */
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@admin/__tests__/utils";

import {
  DocumentActionsHost,
  useHostedDocumentActions,
} from "../DocumentActionsContext";
import type {
  DocumentActionBindings,
  DocumentActionBindingsInput,
  DocumentSaveState as DocumentBindingsSaveState,
} from "../useDocumentActionBindings";

const { canFor } = vi.hoisted(() => ({
  canFor: vi.fn((_slug: string) => true),
}));
vi.mock("@admin/hooks/useCan", () => ({
  useCan: (slug: string) => canFor(slug),
}));

beforeEach(() => {
  canFor.mockReset();
  canFor.mockImplementation(() => true);
});

const saved = { ok: true as const, item: { id: "e1" } };
const draft = { id: "e1", title: "Hello", status: "draft" };
const published = { id: "e1", title: "Hello", status: "published" };

/** The host as an editor renders it, with a surface that runs actions. */
function renderHost(input: Partial<DocumentActionBindingsInput> = {}) {
  const runner: { run: DocumentActionBindings["run"] } = {
    run: () => Promise.reject(new Error("not rendered")),
  };
  function Surface(): ReactElement | null {
    runner.run = useHostedDocumentActions().run;
    return null;
  }
  render(
    <DocumentActionsHost
      input={{
        mode: "edit",
        hasStatus: true,
        entry: draft,
        collectionSlug: "posts",
        ...input,
      }}
    >
      <Surface />
    </DocumentActionsHost>
  );
  return runner;
}

describe("running a document action through the host", () => {
  it("runs the save the control would, and answers with the saved document", async () => {
    const onSaveDraft = vi.fn(() => Promise.resolve(saved));
    const runner = renderHost({ onSaveDraft });

    let outcome: unknown;
    await act(async () => {
      outcome = await runner.run("save");
    });

    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual(saved);
  });

  it("passes on the save's own refusal rather than reporting success", async () => {
    const failed = {
      ok: false as const,
      reason: "failed" as const,
      message: "The slug is taken.",
    };
    const runner = renderHost({
      onSaveDraft: () => Promise.resolve(failed),
    });

    let outcome: unknown;
    await act(async () => {
      outcome = await runner.run("save");
    });

    expect(outcome).toEqual(failed);
  });

  it("refuses a save while one is in flight, as busy, without running it", async () => {
    const onPublish = vi.fn(() => Promise.resolve(saved));
    const runner = renderHost({ onPublish, isSubmitting: true });

    let outcome: unknown;
    await act(async () => {
      outcome = await runner.run("publish");
    });

    expect(onPublish).not.toHaveBeenCalled();
    expect(outcome).toEqual({ ok: false, reason: "busy", message: "Saving…" });
  });

  it("refuses while a colleague holds the document, in the words the control shows", async () => {
    const onSaveDraft = vi.fn(() => Promise.resolve(saved));
    const runner = renderHost({ onSaveDraft, documentLocked: true });

    let outcome: unknown;
    await act(async () => {
      outcome = await runner.run("save");
    });

    expect(onSaveDraft).not.toHaveBeenCalled();
    expect(outcome).toEqual({
      ok: false,
      reason: "refused",
      message: "Someone else is editing this document",
    });
  });

  it("refuses an invalid form as invalid", async () => {
    const onPublish = vi.fn(() => Promise.resolve(saved));
    const runner = renderHost({ onPublish, isInvalid: true });

    let outcome: unknown;
    await act(async () => {
      outcome = await runner.run("publish");
    });

    expect(onPublish).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
  });

  it("refuses an action this document does not offer", async () => {
    const runner = renderHost();

    let outcome: unknown;
    await act(async () => {
      outcome = await runner.run("delete");
    });

    expect(outcome).toMatchObject({ ok: false, reason: "refused" });
  });

  it("asks before unpublishing, and answers once the author confirms", async () => {
    const user = userEvent.setup();
    const onUnpublish = vi.fn(() => Promise.resolve(saved));
    const runner = renderHost({ entry: published, onUnpublish });

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = runner.run("unpublish");
    });

    // Asked first: nothing has been unpublished yet.
    await screen.findByRole("alertdialog");
    expect(onUnpublish).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Unpublish" }));

    // The dialog closing straight after the click is not a dismissal: the
    // answer is the unpublish's own.
    await expect(pending).resolves.toEqual(saved);
    expect(onUnpublish).toHaveBeenCalledTimes(1);
  });

  it("answers a dismissed question as cancelled, never as a refusal or a failure", async () => {
    const user = userEvent.setup();
    const onUnpublish = vi.fn(() => Promise.resolve(saved));
    const runner = renderHost({ entry: published, onUnpublish });

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = runner.run("unpublish");
    });
    await screen.findByRole("alertdialog");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await expect(pending).resolves.toEqual({
      ok: false,
      reason: "cancelled",
      message: "Cancelled.",
    });
    expect(onUnpublish).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );
  });

  it("keeps the discard question open after a failed discard, and answers the retry", async () => {
    const user = userEvent.setup();
    const onDiscardWorkingDraft = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(undefined);
    const runner = renderHost({
      entry: { ...published, _isWorkingDraft: true },
      draftsEnabled: true,
      onDiscardWorkingDraft,
    });

    let settled = false;
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = runner.run("discard-draft").then(outcome => {
        settled = true;
        return outcome;
      });
    });
    await screen.findByRole("alertdialog");

    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(onDiscardWorkingDraft).toHaveBeenCalledTimes(1));
    // Still asking: a failure is not an answer.
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(settled).toBe(false);

    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    await expect(pending).resolves.toEqual({ ok: true });
    expect(onDiscardWorkingDraft).toHaveBeenCalledTimes(2);
  });

  it("answers a delete once it is answered, with what it came to", async () => {
    let answer: (outcome: {
      ok: false;
      reason: "failed";
      message: string;
    }) => void = () => {};
    const onDelete = vi.fn(
      () =>
        new Promise<{ ok: false; reason: "failed"; message: string }>(
          resolve => {
            answer = resolve;
          }
        )
    );
    const runner = renderHost({ entry: published, onDelete });

    let settled = false;
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = runner.run("delete").then(outcome => {
        settled = true;
        return outcome;
      });
    });
    await waitFor(() => expect(onDelete).toHaveBeenCalledTimes(1));
    // Still deleting: nothing may say it is gone yet.
    await act(async () => {
      await Promise.resolve();
    });
    expect(settled).toBe(false);

    await act(async () => {
      answer({ ok: false, reason: "failed", message: "offline" });
    });
    await expect(pending).resolves.toEqual({
      ok: false,
      reason: "failed",
      message: "offline",
    });
  });

  it("answers the first discard when it is confirmed twice before the dialog updates", async () => {
    let finish: () => void = () => {};
    // The first discard is still running; a second call returns at once, as
    // the Single editor's latched handler does.
    const onDiscardWorkingDraft = vi
      .fn<() => Promise<void>>()
      .mockImplementationOnce(
        () =>
          new Promise<void>(resolve => {
            finish = resolve;
          })
      )
      .mockResolvedValue(undefined);
    const runner = renderHost({
      entry: { ...published, _isWorkingDraft: true },
      draftsEnabled: true,
      onDiscardWorkingDraft,
    });

    let settled = false;
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = runner.run("discard-draft").then(outcome => {
        settled = true;
        return outcome;
      });
    });
    const confirm = await screen.findByRole("button", {
      name: "Discard draft",
    });
    // Twice, in one turn: the dialog has not yet drawn its progress.
    act(() => {
      fireEvent.click(confirm);
      fireEvent.click(confirm);
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(onDiscardWorkingDraft).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);
    await act(async () => {
      finish();
    });
    await expect(pending).resolves.toEqual({ ok: true });
  });

  it("cannot be dismissed while the discard runs, and answers what it came to", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const onDiscardWorkingDraft = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    const runner = renderHost({
      entry: { ...published, _isWorkingDraft: true },
      draftsEnabled: true,
      onDiscardWorkingDraft,
    });

    let settled = false;
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = runner.run("discard-draft").then(outcome => {
        settled = true;
        return outcome;
      });
    });
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Discard draft" }));
    await waitFor(() => expect(onDiscardWorkingDraft).toHaveBeenCalledTimes(1));

    // Escape mid-discard: the write goes on, so nothing may say "cancelled".
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(settled).toBe(false);

    await act(async () => {
      finish();
    });
    await expect(pending).resolves.toEqual({ ok: true });
  });
});

/*
 * What a failed store offers belongs to the document and language it failed
 * in. The host stays mounted while the editor switches languages, and a Retry
 * carried across would run the action against the translation now on screen.
 */
describe("a failed store's Retry", () => {
  function renderInLocale(onPublish: DocumentActionBindingsInput["onPublish"]) {
    const seen: { saveState: DocumentBindingsSaveState } = {
      saveState: { kind: "saved", at: null },
    };
    const runner: { run: DocumentActionBindings["run"] } = {
      run: () => Promise.reject(new Error("not rendered")),
    };
    function Surface(): ReactElement | null {
      const hosted = useHostedDocumentActions();
      runner.run = hosted.run;
      seen.saveState = hosted.saveState;
      return null;
    }
    const host = (locale: string) => (
      <DocumentActionsHost
        input={{
          mode: "edit",
          hasStatus: true,
          entry: draft,
          collectionSlug: "posts",
          locale,
          onPublish,
        }}
      >
        <Surface />
      </DocumentActionsHost>
    );
    const view = render(host("en"));
    return {
      runner,
      seen,
      switchTo: (locale: string) => view.rerender(host(locale)),
    };
  }

  it("is offered only in the language it failed in, and not again on return", async () => {
    // The publish the server refused, as the editor's handler answers it.
    const onPublish = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        reason: "failed" as const,
        message: "offline",
      })
    );
    const { runner, seen, switchTo } = renderInLocale(onPublish);

    await act(async () => {
      await runner.run("publish");
    });
    expect(seen.saveState.kind).toBe("failed");

    act(() => {
      switchTo("fr");
    });
    expect(seen.saveState.kind).not.toBe("failed");

    act(() => {
      switchTo("en");
    });
    expect(seen.saveState.kind).not.toBe("failed");
  });

  it("is not offered for a store that fails after the language changed", async () => {
    let refuse: () => void = () => {};
    const onPublish = vi.fn(
      () =>
        new Promise<{ ok: false; reason: "failed"; message: string }>(
          resolve => {
            refuse = () =>
              resolve({ ok: false, reason: "failed", message: "offline" });
          }
        )
    );
    const { runner, seen, switchTo } = renderInLocale(onPublish);

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = runner.run("publish");
    });
    await waitFor(() => expect(onPublish).toHaveBeenCalledTimes(1));
    act(() => {
      switchTo("fr");
    });
    await act(async () => {
      refuse();
      await pending;
    });

    expect(seen.saveState.kind).not.toBe("failed");
  });
});

/*
 * Which save "save" is. Mod+S runs this action, so these are also what the
 * shortcut stores: a rule for the shortcut written beside the button's would be
 * a second answer to one question.
 */
describe("the save a document's state calls for", () => {
  const handlers = () => ({
    onSubmit: vi.fn(() => Promise.resolve(saved)),
    onSaveDraft: vi.fn(() => Promise.resolve(saved)),
    onSaveChanges: vi.fn(() => Promise.resolve(saved)),
    onSaveWorkingDraft: vi.fn(() => Promise.resolve(saved)),
  });

  async function save(runner: ReturnType<typeof renderHost>) {
    await act(async () => {
      await runner.run("save");
    });
  }

  it("stores a working draft for a published entry on a drafts collection", async () => {
    const h = handlers();
    await save(
      renderHost({
        ...h,
        entry: published,
        draftsEnabled: true,
        isDirty: true,
      })
    );
    expect(h.onSaveWorkingDraft).toHaveBeenCalledTimes(1);
    expect(h.onSaveChanges).not.toHaveBeenCalled();
  });

  it("re-asserts published for a published entry without drafts", async () => {
    const h = handlers();
    await save(renderHost({ ...h, entry: published, isDirty: true }));
    expect(h.onSaveChanges).toHaveBeenCalledTimes(1);
  });

  it("saves a draft for a draft", async () => {
    const h = handlers();
    await save(renderHost({ ...h, entry: draft }));
    expect(h.onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("saves a draft in a language that has not been published, though the main row is", async () => {
    // On a non-default language the main row may be published while this
    // translation is not. Keying off the main row would re-publish the wrong
    // language.
    const h = handlers();
    await save(
      renderHost({
        ...h,
        entry: { ...published, _translations: { fr: { translated: false } } },
        locale: "fr",
        isDirty: true,
      })
    );
    expect(h.onSaveDraft).toHaveBeenCalledTimes(1);
    expect(h.onSaveChanges).not.toHaveBeenCalled();
  });

  it("submits with no lifecycle intent for a collection without a status", async () => {
    const h = handlers();
    await save(
      renderHost({
        ...h,
        hasStatus: false,
        // No status column, so no lifecycle on the row.
        entry: { id: "e1", title: "Hello" },
      })
    );
    expect(h.onSubmit).toHaveBeenCalledTimes(1);
    expect(h.onSaveDraft).not.toHaveBeenCalled();
  });

  it("just saves when creating in a collection without a status", async () => {
    // No lifecycle to name: a create submits as the collection's Save does,
    // and never as a draft, which would write a column it does not have.
    const h = handlers();
    await save(
      renderHost({ ...h, mode: "create", hasStatus: false, entry: null })
    );
    expect(h.onSubmit).toHaveBeenCalledTimes(1);
    expect(h.onSaveDraft).not.toHaveBeenCalled();
  });

  it("saves a draft when creating, as the Save draft button does", async () => {
    const h = handlers();
    await save(renderHost({ ...h, mode: "create", entry: null }));
    expect(h.onSaveDraft).toHaveBeenCalledTimes(1);
  });

  it("offers a published document's save for work a field holds outside the form", async () => {
    // The host passes the WHOLE unsaved-work state as `isDirty`: the page
    // builder holds its change outside the form's values, and a save refused
    // as "Nothing has changed yet" there is the shortcut looking broken.
    const h = handlers();
    const runner = renderHost({ ...h, entry: published, isDirty: false });
    let refused: unknown;
    await act(async () => {
      refused = await runner.run("save");
    });
    expect(refused).toMatchObject({
      ok: false,
      reason: "refused",
      message: "Nothing has changed yet.",
    });
    expect(h.onSaveChanges).not.toHaveBeenCalled();
  });
});
