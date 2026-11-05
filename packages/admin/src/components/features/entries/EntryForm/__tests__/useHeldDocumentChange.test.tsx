/**
 * What an editor holding a document does with someone else's change the lock
 * told it of: a form with no unsaved edits takes the current version at once
 * and says whose changes it now shows; a form with edits keeps them on screen,
 * held so no read replaces them, and offers to load the current version
 * (keeping the edits as a recovery point) or to keep editing; and a document
 * taken back after it changed loads the current version, keeping the edits,
 * before the form unlocks.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { DocumentLockChangeNotice } from "@admin/hooks/queries/useDocumentLock";

import type { DocumentLockAffordances } from "../document-lock-affordances";
import {
  useHeldDocumentChange,
  withHeldChange,
  type HeldDocumentChangeOptions,
} from "../useHeldDocumentChange";

const ANA = { kind: "person" as const, name: "Ana" };

function notice(
  overrides: Partial<DocumentLockChangeNotice["change"]> = {},
  whileAway = false
): DocumentLockChangeNotice {
  return {
    change: {
      currentVersion: "2",
      changedBy: ANA,
      changedAt: "2026-11-05T10:42:00.000Z",
      ...overrides,
    },
    whileAway,
  };
}

/** A promise and the function that settles it, to watch what waits on it. */
function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>(settle => {
    resolve = settle;
  });
  return { promise, resolve };
}

function setup(
  dirty: boolean,
  overrides: Partial<HeldDocumentChangeOptions> = {}
) {
  const calls: string[] = [];
  const options: HeldDocumentChangeOptions = {
    change: null,
    settleChange: vi.fn(),
    dirty: () => dirty,
    hold: vi.fn(() => void calls.push("hold")),
    loadCurrent: vi.fn(async () => void calls.push("loadCurrent")),
    reload: vi.fn(async () => void calls.push("reload")),
    ...overrides,
  };
  const hook = renderHook(
    (props: HeldDocumentChangeOptions) => useHeldDocumentChange(props),
    { initialProps: options }
  );
  const tell = (change: DocumentLockChangeNotice) =>
    act(() => hook.rerender({ ...options, change }));
  return { ...hook, options, calls, tell };
}

describe("someone else's change to a document this editor holds", () => {
  it("loads the current version at once into a form with no unsaved edits, and says whose changes it shows", async () => {
    const { result, options, tell } = setup(false);
    tell(notice());

    await waitFor(() => expect(options.reload).toHaveBeenCalledTimes(1));
    // Nothing unsaved to keep, so nothing is held and nothing is written.
    expect(options.hold).not.toHaveBeenCalled();
    expect(options.loadCurrent).not.toHaveBeenCalled();
    expect(options.settleChange).toHaveBeenCalled();
    expect(result.current.notice).toMatchObject({
      tone: "updated",
      message: expect.stringMatching(
        /^Ana changed this document at .+, so it now shows the latest version\.$/
      ),
    });
  });

  it("keeps unsaved edits on screen, held, and offers to load the current version or keep editing", async () => {
    const { result, options, tell } = setup(true);
    tell(notice());

    await waitFor(() =>
      expect(options.hold).toHaveBeenCalledWith(notice().change)
    );
    // 🔴 Nothing reads the document over the edits before the editor chooses.
    expect(options.reload).not.toHaveBeenCalled();
    expect(options.loadCurrent).not.toHaveBeenCalled();
    expect(result.current.holding).toBe(false);
    expect(result.current.notice).toMatchObject({
      tone: "changed",
      message: expect.stringMatching(
        /^Ana changed this document at .+\. Your unsaved edits are still here\.$/
      ),
      choices: [
        { choice: "load-current", label: "Load current version" },
        { choice: "keep-editing", label: "Keep editing" },
      ],
    });
  });

  it("keeps the edits as a recovery point, then loads the current version, when the editor chooses to", async () => {
    const { result, options, calls, tell } = setup(true);
    tell(notice());
    await waitFor(() => expect(result.current.notice).not.toBeNull());

    await act(async () => result.current.choose("load-current"));
    expect(calls).toEqual(["hold", "loadCurrent", "reload"]);
    expect(options.loadCurrent).toHaveBeenCalledTimes(1);
    expect(result.current.notice).toBeNull();
    expect(result.current.holding).toBe(false);
  });

  it("loads nothing when the editor keeps editing, and says no more about that change", async () => {
    const { result, options, tell } = setup(true);
    tell(notice());
    await waitFor(() => expect(result.current.notice).not.toBeNull());

    act(() => result.current.choose("keep-editing"));
    expect(result.current.notice).toBeNull();
    expect(options.loadCurrent).not.toHaveBeenCalled();
    expect(options.reload).not.toHaveBeenCalled();
  });

  it("on taking back a changed document, keeps the edits and loads the current version before the form unlocks", async () => {
    const kept = deferred();
    const { result, calls, tell } = setup(true, {
      loadCurrent: vi.fn(async () => {
        calls.push("loadCurrent");
        await kept.promise;
      }),
    });
    tell(notice({}, true));

    await waitFor(() => expect(calls).toEqual(["hold", "loadCurrent"]));
    // Withheld while the edits are kept and the current version loads.
    expect(result.current.holding).toBe(true);
    expect(result.current.notice?.message).toMatch(
      /^Ana changed this document at .+ while you were away\. It now shows the latest version, and your unsaved edits are kept as a recovery point\.$/
    );

    await act(async () => kept.resolve());
    await waitFor(() => expect(result.current.holding).toBe(false));
    expect(calls).toEqual(["hold", "loadCurrent", "reload"]);
    // The sentence stays to say what happened; nothing is asked.
    expect(result.current.notice?.choices).toEqual([
      { choice: "dismiss", label: "Dismiss" },
    ]);
  });

  it("names nobody, and no time, when the change names neither", async () => {
    const { result, tell } = setup(true);
    tell({ change: { currentVersion: "2" }, whileAway: false });

    await waitFor(() =>
      expect(result.current.notice?.message).toBe(
        "This document changed. Your unsaved edits are still here."
      )
    );
  });

  it("names an API key and a release by what they are", async () => {
    const { result, tell } = setup(false);
    tell(notice({ changedBy: { kind: "apiKey", name: null } }));
    await waitFor(() =>
      expect(result.current.notice?.message).toMatch(
        /^An API key changed this document at /
      )
    );
  });
});

describe("the lock's affordances with someone else's change", () => {
  const held: DocumentLockAffordances = {
    readOnly: false,
    actionsDisabled: false,
    notice: null,
  };
  const change = {
    notice: {
      tone: "changed" as const,
      message: "Ana changed this document.",
      takeOverLabel: null,
      accessRequest: null,
    },
    holding: false,
    choose: () => {},
  };

  it("says the change where the lock says nothing", () => {
    expect(withHeldChange(held, change).notice).toBe(change.notice);
  });

  it("withholds the form while the current version loads", () => {
    expect(withHeldChange(held, { ...change, holding: true })).toMatchObject({
      readOnly: true,
      actionsDisabled: true,
    });
  });

  it("leaves a colleague's claim, which withholds the form, as it is", () => {
    const takenOver: DocumentLockAffordances = {
      readOnly: true,
      actionsDisabled: true,
      notice: {
        tone: "surrendered",
        message: "Ben took over this document.",
        takeOverLabel: "Take it back",
        accessRequest: null,
      },
    };
    const merged = withHeldChange(takenOver, change);
    expect(merged).toMatchObject(takenOver);
    expect(merged.notice).toBe(takenOver.notice);
  });
});
