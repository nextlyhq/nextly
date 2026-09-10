import type { DocumentLockHolder } from "nextly/document-lock";
import { describe, expect, it } from "vitest";

import type { DocumentLockState } from "@admin/hooks/queries/useDocumentLock";

import { documentLockAffordances } from "../document-lock-affordances";

const bob: DocumentLockHolder = {
  ownerId: "u2",
  ownerLabel: "Bob",
  expiresInSeconds: 90,
};

describe("what a lock state means for the editor", () => {
  it.each<DocumentLockState>([
    { status: "idle" },
    { status: "acquiring" },
    { status: "held-by-me", someoneWaiting: false },
  ])("leaves the editor alone while $status", state => {
    expect(documentLockAffordances(state)).toEqual({
      readOnly: false,
      actionsDisabled: false,
      notice: null,
    });
  });

  it("does not block editing while the claim is still being asked for", () => {
    // 🔴 Every document open would otherwise wait on a round trip before its
    // first keystroke, to guard against a case that is rare — and nothing here
    // clears the form, so those keystrokes survive a refusal.
    const affordances = documentLockAffordances({ status: "acquiring" });
    expect(affordances.readOnly).toBe(false);
    expect(affordances.notice).toBeNull();
  });

  it("names the holder and offers to take over", () => {
    const affordances = documentLockAffordances({
      status: "held-by-other",
      holder: bob,
      requestSent: false,
    });
    expect(affordances.readOnly).toBe(true);
    expect(affordances.actionsDisabled).toBe(true);
    expect(affordances.notice?.message).toContain("Bob");
    expect(affordances.notice?.takeOverLabel).toBe("Take over");
  });

  it("offers the polite option beside the one that displaces a colleague", () => {
    // Both, and never only the steal. Taking over is the loudest thing this
    // interface can do, and until now it was the only thing a locked-out editor
    // could do at all.
    const affordances = documentLockAffordances({
      status: "held-by-other",
      holder: bob,
      requestSent: false,
    });
    expect(affordances.notice?.accessRequest).toEqual({
      kind: "offer",
      label: "Request edit access",
    });
    expect(affordances.notice?.takeOverLabel).toBe("Take over");
  });

  it("replaces the offer with a confirmation once the ask is on record", () => {
    // 🔴 REPLACES. A control that stays put having stopped doing anything is
    // what a broken one looks like, and the sentence is the entire answer the
    // person gets -- nothing else about the page changes, by design.
    const affordances = documentLockAffordances({
      status: "held-by-other",
      holder: bob,
      requestSent: true,
    });
    expect(affordances.notice?.accessRequest).toEqual({
      kind: "sent",
      message: "We have let Bob know you are waiting.",
    });
    // Still offered: asking politely does not spend the option of not asking.
    expect(affordances.notice?.takeOverLabel).toBe("Take over");
  });

  it("says the colleague was told without naming one the server did not", () => {
    // A claim carries no label when the account had no name to record, and
    // "We have let null know" is worse than the unnamed sentence.
    const affordances = documentLockAffordances({
      status: "held-by-other",
      holder: { ...bob, ownerLabel: null },
      requestSent: true,
    });
    expect(affordances.notice?.accessRequest).toEqual({
      kind: "sent",
      message: "We have let them know you are waiting.",
    });
  });

  it("tells the holder somebody is waiting, and withholds nothing for it", () => {
    // 🔴 The courtesy notice is the whole feature: a request moves no claim,
    // demands no answer and cannot be refused, so anything withheld here would
    // be a consent gate wearing a courtesy notice's words. The holder keeps
    // every action they had -- including the Save they are being given time for.
    const affordances = documentLockAffordances({
      status: "held-by-me",
      someoneWaiting: true,
    });
    expect(affordances.readOnly).toBe(false);
    expect(affordances.actionsDisabled).toBe(false);
    expect(affordances.notice?.tone).toBe("awaited");
    expect(affordances.notice?.message).toBe(
      "Someone is waiting to edit this document."
    );
    // Nothing to press. The lease expiring is what transfers a document.
    expect(affordances.notice?.takeOverLabel).toBeNull();
    expect(affordances.notice?.accessRequest).toBeNull();
  });

  it("says nothing to a holder nobody is waiting on", () => {
    // The control for the case above: a notice that rendered either way would
    // put a permanent strip over every document its author opens.
    const affordances = documentLockAffordances({
      status: "held-by-me",
      someoneWaiting: false,
    });
    expect(affordances.notice).toBeNull();
  });

  it("offers no ask where the beat has stopped or never reached the server", () => {
    // A button that asks a server this editor is not talking to is exactly the
    // silent control the confirmation exists to rule out. `taken-over` and
    // `lost` have stopped polling; `unavailable` did not reach it this beat.
    const cases: [DocumentLockState, DocumentLockHolder | null][] = [
      [{ status: "taken-over", holder: bob }, null],
      [{ status: "lost" }, null],
      [{ status: "unavailable" }, bob],
      [{ status: "unavailable" }, null],
    ];
    for (const [state, known] of cases) {
      const affordances = documentLockAffordances(state, known);
      expect(
        affordances.notice?.accessRequest ?? null,
        state.status
      ).toBeNull();
    }
  });

  it("says the work is still there when someone takes over", () => {
    // Read-only, not cleared. Their unsaved work stays on screen and stays
    // theirs; what stops is writing.
    const affordances = documentLockAffordances({
      status: "taken-over",
      holder: bob,
    });
    expect(affordances.readOnly).toBe(true);
    expect(affordances.notice?.message).toContain("Bob");
    expect(affordances.notice?.message).toContain(
      "unsaved changes are still here"
    );
    expect(affordances.notice?.takeOverLabel).toBe("Take it back");
  });

  it("names nobody when the claim simply lapsed", () => {
    // 🔴 The server reports `lost` with no holder when nobody took it. Inventing
    // one would be a claim about a colleague.
    const affordances = documentLockAffordances({ status: "taken-over" });
    expect(affordances.notice?.message).not.toContain("Bob");
    expect(affordances.notice?.message).toContain(
      "Your claim on this document ended"
    );
  });

  it("does not say someone took over when nobody said that", () => {
    // `lost` is this editor being unable to vouch for its own claim, which is a
    // different statement from a colleague having taken it.
    const affordances = documentLockAffordances({ status: "lost" });
    expect(affordances.readOnly).toBe(true);
    expect(affordances.notice?.message).not.toContain("took over");
    expect(affordances.notice?.takeOverLabel).toBe("Take it back");
  });

  it("keeps the editor working when nothing was ever known", () => {
    // 🔴 The lock is advisory: it exists to tell two people about each other, not
    // to be a permission. Stopping work on the FIRST failed check turns an
    // advisory nicety into an outage, and fails in the direction that loses the
    // author's afternoon.
    const affordances = documentLockAffordances({ status: "unavailable" });
    expect(affordances.readOnly).toBe(false);
    expect(affordances.actionsDisabled).toBe(false);
    expect(affordances.notice?.takeOverLabel).toBeNull();
    expect(affordances.notice?.tone).toBe("unchecked");
  });

  it("keeps a known colleague's claim when the refresh fails", () => {
    // 🔴 `unavailable` is not only the first check: every beat re-asks, and any
    // transient rejection lands there. Treating that as "unlocked" hands the
    // document to a second editor while the last confirmed fact is that a
    // colleague holds an unexpired lease.
    const affordances = documentLockAffordances({ status: "unavailable" }, bob);
    expect(affordances.readOnly).toBe(true);
    expect(affordances.actionsDisabled).toBe(true);
    expect(affordances.notice?.message).toContain("Bob");
    expect(affordances.notice?.takeOverLabel).toBe("Take over");
  });

  it("offers a way back from every state it withholds writing in", () => {
    // A read-only document with no affordance is a dead end, and the reader
    // cannot tell it from one they lack permission for.
    const cases: [DocumentLockState, DocumentLockHolder | null][] = [
      [{ status: "held-by-other", holder: bob, requestSent: false }, null],
      [{ status: "taken-over", holder: bob }, null],
      [{ status: "taken-over" }, null],
      [{ status: "lost" }, null],
      [{ status: "unavailable" }, bob],
    ];
    for (const [state, known] of cases) {
      const affordances = documentLockAffordances(state, known);
      expect(affordances.readOnly, state.status).toBe(true);
      expect(affordances.notice?.takeOverLabel, state.status).toBeTruthy();
    }
  });

  it("withholds every write together, never just some", () => {
    // 🔴 Read-only fields with live Save is the worst of both: the banner says the
    // document is somebody else's and the editor can still overwrite them.
    const cases: DocumentLockState[] = [
      { status: "held-by-other", holder: bob, requestSent: false },
      { status: "taken-over", holder: bob },
      { status: "lost" },
    ];
    for (const state of cases) {
      const affordances = documentLockAffordances(state);
      expect(affordances.actionsDisabled, state.status).toBe(
        affordances.readOnly
      );
    }
  });
});
