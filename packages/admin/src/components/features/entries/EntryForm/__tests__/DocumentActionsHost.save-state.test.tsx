/**
 * The document's one save state.
 *
 * Every surface that says whether the work is stored reads this one value, so
 * what these pin is each way it could lie: "saved" over work that was refused,
 * "failed" after the author merely said no to a question, nothing at all while
 * a write the page depends on is still in flight, and a failure that outlives
 * the save that fixed it.
 */
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { act, render, screen, waitFor } from "@admin/__tests__/utils";

import {
  DocumentActionsHost,
  useHostedDocumentActions,
} from "../DocumentActionsContext";
import { useTrackedWrite } from "../useDocumentActionHooks";
import type {
  DocumentActionBindings,
  DocumentActionBindingsInput,
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

interface Probe {
  hosted: DocumentActionBindings | null;
  track: (label: string, write: Promise<unknown>) => void;
}

function renderHost(input: Partial<DocumentActionBindingsInput> = {}) {
  const probe: Probe = { hosted: null, track: () => {} };
  function Surface(): ReactElement | null {
    probe.hosted = useHostedDocumentActions();
    probe.track = useTrackedWrite();
    return null;
  }
  const base: DocumentActionBindingsInput = {
    mode: "edit",
    hasStatus: true,
    entry: draft,
    collectionSlug: "posts",
    ...input,
  };
  const view = render(
    <DocumentActionsHost input={base}>
      <Surface />
    </DocumentActionsHost>
  );
  const rerender = (next: Partial<DocumentActionBindingsInput>) =>
    view.rerender(
      <DocumentActionsHost input={{ ...base, ...next }}>
        <Surface />
      </DocumentActionsHost>
    );
  return { probe, rerender };
}

function state(probe: Probe) {
  if (probe.hosted === null) throw new Error("not rendered");
  return probe.hosted.saveState;
}

async function run(probe: Probe, id: string) {
  await act(async () => {
    await probe.hosted?.run(id);
  });
}

describe("the document's save state", () => {
  it("is saved, with no time, when nothing is unsaved and nothing has been stored", () => {
    const { probe } = renderHost();
    expect(state(probe)).toEqual({ kind: "saved", at: null });
  });

  it("stays failed over a still-unsaved form until a save lands", async () => {
    const { probe } = renderHost({
      isDirty: true,
      onSaveDraft: () =>
        Promise.resolve({
          ok: false as const,
          reason: "failed" as const,
          message: "offline",
        }),
    });
    await run(probe, "save");
    expect(state(probe).kind).toBe("failed");
  });

  it("is unsaved while there is unsaved work", () => {
    const { probe } = renderHost({ isDirty: true });
    expect(state(probe)).toEqual({ kind: "unsaved" });
  });

  it("is saving while a submit is in flight", () => {
    const { probe } = renderHost({ isDirty: true, isSubmitting: true });
    expect(state(probe)).toEqual({ kind: "saving" });
  });

  it("is saving while a write the page depends on is in flight", () => {
    const { probe } = renderHost();
    act(() => {
      probe.track("Site colours", new Promise(() => {}));
    });
    expect(state(probe)).toEqual({ kind: "saving" });
  });

  it("is saved, with the time, once a save lands", async () => {
    const { probe, rerender } = renderHost({
      isDirty: true,
      onSaveDraft: () => Promise.resolve(saved),
    });
    await run(probe, "save");
    // The form resets once its save lands, so it is clean again.
    rerender({ isDirty: false, onSaveDraft: () => Promise.resolve(saved) });
    const after = state(probe);
    expect(after.kind).toBe("saved");
    expect(after.kind === "saved" && after.at instanceof Date).toBe(true);
  });

  it("is failed, in the save's own words, when the save is refused, and retries it", async () => {
    const onSaveDraft = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        reason: "failed",
        message: "The slug is taken.",
      })
      .mockResolvedValueOnce(saved);
    const { probe, rerender } = renderHost({ isDirty: true, onSaveDraft });

    await run(probe, "save");
    const failed = state(probe);
    expect(failed).toMatchObject({
      kind: "failed",
      message: "The slug is taken.",
    });

    await act(async () => {
      if (failed.kind === "failed") {
        // A failed Save has a Retry: running it again can succeed.
        expect(failed.retry).toBeDefined();
        await failed.retry?.();
      }
    });
    expect(onSaveDraft).toHaveBeenCalledTimes(2);
    rerender({ isDirty: false, onSaveDraft });
    expect(state(probe).kind).toBe("saved");
  });

  it("is failed, naming the change, when a write the page depends on failed", async () => {
    const { probe } = renderHost();
    let fail: (error: Error) => void = () => {};
    const write = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    act(() => {
      probe.track("Site colours", write);
    });
    await act(async () => {
      fail(new Error("The server is unreachable."));
      await write.catch(() => {});
    });

    expect(state(probe)).toMatchObject({
      kind: "failed",
      message:
        "Site colours wasn't saved: The server is unreachable. Make that change again where you made it, and this page can then be saved.",
    });
    // Saving again would only refuse on the same failure: nothing to retry.
    expect(state(probe)).not.toHaveProperty("retry");
  });

  it("is unchanged by a save refused as busy: the one in flight answers for itself", async () => {
    // The refusal a second save in the same turn gets from the form's own
    // gate, which is the busy a storing action actually comes back with.
    const onSaveDraft = vi.fn(() =>
      Promise.resolve({
        ok: false as const,
        reason: "busy" as const,
        message: "A save is already in progress.",
      })
    );
    const { probe } = renderHost({ isDirty: true, onSaveDraft });
    const before = state(probe);
    await run(probe, "save");
    expect(onSaveDraft).toHaveBeenCalledTimes(1);
    expect(state(probe)).toEqual(before);
  });

  it("is unchanged when the author dismisses a question: cancelling is not a failure", async () => {
    const user = userEvent.setup();
    const { probe } = renderHost({
      entry: published,
      isDirty: true,
      onUnpublish: () => Promise.resolve(saved),
    });
    const before = state(probe);

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = probe.hosted?.run("unpublish") ?? Promise.resolve();
    });
    await screen.findByRole("alertdialog");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(pending).resolves.toMatchObject({ reason: "cancelled" });

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument()
    );
    expect(state(probe)).toEqual(before);
  });
});
