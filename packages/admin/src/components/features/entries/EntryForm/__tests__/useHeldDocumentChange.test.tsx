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
    keepsEdits: () => true,
    release: vi.fn(() => void calls.push("release")),
    stopLoading: vi.fn(() => void calls.push("stopLoading")),
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
    // Said once the latest version has loaded, not as it is asked for.
    await waitFor(() =>
      expect(result.current.notice).toMatchObject({
        tone: "updated",
        message: expect.stringMatching(
          /^Ana changed this document at .+, so it now shows the latest version\.$/
        ),
      })
    );
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
    // Withheld while the edits are kept and the current version loads, and
    // nothing said yet that has not happened.
    expect(result.current.holding).toBe(true);
    expect(result.current.notice).toBeNull();

    await act(async () => kept.resolve());
    await waitFor(() => expect(result.current.holding).toBe(false));
    expect(calls).toEqual(["hold", "loadCurrent", "reload"]);
    expect(result.current.notice?.message).toMatch(
      /^Ana changed this document at .+ while you were away\. It now shows the latest version, and your unsaved edits are kept as a recovery point\.$/
    );
    // The sentence stays to say what happened; nothing is asked.
    expect(result.current.notice?.choices).toEqual([
      { choice: "dismiss", label: "Dismiss" },
    ]);
  });

  it("withholds the form, and lets it render withheld, before keeping the edits", async () => {
    // 🔴 A field holding its own work, the page builder's store, hands it to
    // the form as it unmounts: kept in the same turn, the recovery point
    // would miss it.
    let heldWhenKept: boolean | undefined;
    const rendered = setup(true, {
      loadCurrent: vi.fn(async () => {
        heldWhenKept = rendered.result.current.holding;
      }),
    });
    rendered.tell(notice());
    await waitFor(() => expect(rendered.result.current.notice).not.toBeNull());

    await act(async () => rendered.result.current.choose("load-current"));
    expect(heldWhenKept).toBe(true);
  });

  it("says a clean copy shows the latest version only once it does, and offers to try again when it cannot", async () => {
    let fails = true;
    const { result, options, calls, tell } = setup(false, {
      reload: vi.fn(async () => {
        calls.push("reload");
        if (fails) throw new Error("offline");
      }),
    });
    tell(notice());

    await waitFor(() =>
      expect(result.current.notice?.message).toMatch(
        /could not be updated to the latest version\.$/
      )
    );
    // Still the older copy: held, so a save from it is refused, not written
    // over the change.
    expect(options.hold).toHaveBeenCalledWith(notice().change);
    expect(result.current.notice?.choices).toEqual([
      { choice: "try-again", label: "Try again" },
    ]);
    expect(result.current.holding).toBe(false);

    fails = false;
    calls.length = 0;
    await act(async () => result.current.choose("try-again"));
    // The failed try's hold is let go before the read, or the form would turn
    // the read away.
    await waitFor(() => expect(calls).toContain("reload"));
    expect(calls.indexOf("release")).toBeGreaterThan(-1);
    expect(calls.indexOf("release")).toBeLessThan(calls.indexOf("reload"));
    await waitFor(() =>
      expect(result.current.notice?.message).toMatch(
        /so it now shows the latest version\.$/
      )
    );
  });

  it("asks before trying again over edits typed since the failed refresh", async () => {
    // 🔴 The form unlocks under the Try again strip: what is typed there is
    // unsaved work, which a reload would replace.
    let typed = false;
    const { result, options, calls, tell } = setup(false, {
      dirty: () => typed,
      reload: vi.fn(async () => {
        calls.push("reload");
        throw new Error("offline");
      }),
    });
    tell(notice());
    await waitFor(() =>
      expect(result.current.notice?.choices).toEqual([
        { choice: "try-again", label: "Try again" },
      ])
    );

    typed = true;
    calls.length = 0;
    await act(async () => result.current.choose("try-again"));

    expect(calls).not.toContain("release");
    expect(calls).not.toContain("reload");
    expect(options.hold).toHaveBeenLastCalledWith(notice().change);
    expect(result.current.notice?.message).toMatch(
      /^Ana changed this document at .+\. Your unsaved edits are still here\.$/
    );
    expect(result.current.notice?.choices).toEqual([
      { choice: "load-current", label: "Load current version" },
      { choice: "keep-editing", label: "Keep editing" },
    ]);
  });

  it("stops waiting for the current version once the editor keeps editing after a failed load", async () => {
    // 🔴 The load may already wait for the current version when its read
    // fails: left waiting, that version replaces the edits on arrival.
    const { result, options, tell } = setup(true, {
      reload: vi.fn(async () => {
        throw new Error("offline");
      }),
    });
    tell(notice());
    await waitFor(() => expect(result.current.notice).not.toBeNull());
    await act(async () => result.current.choose("load-current"));
    await waitFor(() =>
      expect(result.current.notice?.choices).toContainEqual({
        choice: "keep-editing",
        label: "Keep editing",
      })
    );

    act(() => result.current.choose("keep-editing"));
    expect(options.stopLoading).toHaveBeenCalledTimes(1);
    expect(result.current.notice).toBeNull();
  });

  it("leaves the copy's version to the read it applies, never to the change told", async () => {
    // 🔴 The read answers a render before its values reach the form. Marked
    // current over the older values, the copy would let a save in that moment
    // write them over the change, accepted; left on its version, it is refused.
    const { calls, options, tell } = setup(false);
    tell(notice());
    await waitFor(() => expect(calls).toEqual(["release", "reload"]));
    expect(options).not.toHaveProperty("adopt");
  });

  it("says the edits could not be kept, replaces nothing, and offers it again", async () => {
    const { result, options, tell } = setup(true, {
      loadCurrent: vi.fn(async () => {
        throw new Error("recovery point refused");
      }),
    });
    tell(notice());
    await waitFor(() => expect(result.current.notice).not.toBeNull());

    await act(async () => result.current.choose("load-current"));
    expect(options.reload).not.toHaveBeenCalled();
    expect(result.current.notice).toMatchObject({
      message: expect.stringMatching(
        /could not be kept as a recovery point, so the latest version was not loaded\.$/
      ),
      choices: [
        { choice: "load-current", label: "Load current version" },
        { choice: "keep-editing", label: "Keep editing" },
      ],
    });
    expect(result.current.holding).toBe(false);
  });

  it("waits for an answer while a change over unsaved edits is offered, and not once answered", async () => {
    const { result, tell } = setup(true);
    expect(result.current.awaitingAnswer).toBe(false);
    tell(notice());
    await waitFor(() => expect(result.current.awaitingAnswer).toBe(true));

    act(() => result.current.choose("keep-editing"));
    expect(result.current.awaitingAnswer).toBe(false);
  });

  it("on taking back a document that keeps no recovery points, loads nothing over the edits until the editor chooses", async () => {
    // 🔴 There loading the current version discards the edits, so it is never
    // done for the editor, and the strip says what it would cost.
    const { result, options, tell } = setup(true, { keepsEdits: () => false });
    tell(notice({}, true));

    await waitFor(() =>
      expect(result.current.notice?.message).toMatch(
        /^Ana changed this document at .+ while you were away\. Your unsaved edits are still here\. Loading the current version discards them\.$/
      )
    );
    expect(options.hold).toHaveBeenCalledWith(notice().change);
    expect(options.loadCurrent).not.toHaveBeenCalled();
    expect(options.reload).not.toHaveBeenCalled();
    expect(result.current.holding).toBe(false);
    expect(result.current.notice?.choices).toEqual([
      { choice: "load-current", label: "Load current version" },
      { choice: "keep-editing", label: "Keep editing" },
    ]);
  });

  it("lets go of a hold its edits no longer need before loading a clean copy", async () => {
    // Kept editing, then undone: a hold left in place would turn the reload
    // away while the strip said the latest version was shown.
    const { calls, tell } = setup(false);
    tell(notice());
    await waitFor(() => expect(calls[0]).toBe("release"));
    expect(calls.indexOf("release")).toBeLessThan(calls.indexOf("reload"));
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
    awaitingAnswer: true,
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
