import type { DocumentLockHolder } from "nextly/document-lock";
import { describe, expect, it } from "vitest";

import type { DocumentLockState } from "@admin/hooks/queries/useDocumentLock";

import {
  documentLockAffordances,
  readerAffordances,
} from "../document-lock-affordances";

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

describe("naming whoever holds the document", () => {
  /** Every sentence a holder can appear in, for `holder`. */
  const sentences = (holder: DocumentLockHolder) =>
    [
      documentLockAffordances({
        status: "held-by-other",
        holder,
        requestSent: false,
      }).notice,
      documentLockAffordances({
        status: "held-by-other",
        holder,
        requestSent: true,
      }).notice?.accessRequest,
      documentLockAffordances({ status: "taken-over", holder }).notice,
      documentLockAffordances({ status: "unavailable" }, holder).notice,
      readerAffordances(holder).notice,
    ].map(said =>
      said && "message" in said ? said.message : String(said ?? "")
    );

  it.each([
    ["a person, by name", "Bob", "Bob"],
    ["a person with no name, by email", "bob@example.com", "bob@example.com"],
    ["an API key, by its maker's name", "Ana's API key", "Ana's API key"],
    ["an API key with no maker's name", "An API key", "An API key"],
  ])("names %s", (_, label, name) => {
    const [held, sent, tookOver, unchecked, reader] = sentences({
      ...bob,
      ownerLabel: label,
    });
    expect(held).toBe(
      `${name} is editing this document. You can read it, or take over.`
    );
    expect(sent).toBe(`We have let ${name} know you are waiting.`);
    expect(tookOver).toMatch(new RegExp(`^${name} took over this document\\.`));
    expect(unchecked).toMatch(
      new RegExp(`^${name} was editing this document, and we could not`)
    );
    expect(reader).toBe(`${name} is editing this document right now.`);
  });

  it.each([
    ["no label", null],
    ["an empty label", ""],
    ["a label of spaces", "   "],
  ])(
    "says someone, never null or a blank, for a holder with %s",
    (_, ownerLabel) => {
      // 🔴 A lease taken before the server labelled every claim still reaches
      // the editor, and a sentence spelling its own fallback is how one of them
      // came to read "null is editing this document".
      const [held, sent, tookOver, unchecked, reader] = sentences({
        ...bob,
        ownerLabel,
      });
      expect(held).toBe(
        "Someone is editing this document. You can read it, or take over."
      );
      // The ask was for a person; with nobody to name, "them" rather than a
      // "Someone" who sounds like a third party.
      expect(sent).toBe("We have let them know you are waiting.");
      expect(tookOver).toMatch(/^Someone took over this document\./);
      expect(unchecked).toMatch(/^Someone was editing this document/);
      expect(reader).toBe("Someone is editing this document right now.");
      for (const sentence of [held, sent, tookOver, unchecked, reader]) {
        expect(sentence).not.toMatch(/null|undefined|^\s|\s{2}/);
      }
    }
  );
});

describe("the same person in another tab", () => {
  const ada: DocumentLockHolder = {
    ownerId: "u1",
    ownerLabel: "Ada",
    expiresInSeconds: 90,
  };

  it("tells a tab its own user opened the document elsewhere, and offers to continue here", () => {
    // 🔴 A claim is held per person, so a second tab moves it there. "Ada took
    // over this document", said to Ada, describes something that did not
    // happen.
    const affordances = documentLockAffordances(
      { status: "taken-over", holder: ada },
      null,
      "current",
      "u1"
    );

    expect(affordances.notice?.message).toBe(
      "You opened this document in another tab. Your unsaved changes are still here, but cannot be saved until you continue editing here."
    );
    expect(affordances.notice?.takeOverLabel).toBe("Continue editing here");
    // Their edits stay on screen, unsaved and unsaveable until they continue.
    expect(affordances.readOnly).toBe(true);
    expect(affordances.actionsDisabled).toBe(true);
  });

  it("still names a colleague who took over as a colleague", () => {
    const affordances = documentLockAffordances(
      { status: "taken-over", holder: bob },
      null,
      "current",
      "u1"
    );

    expect(affordances.notice?.message).toMatch(/^Bob took over/);
    expect(affordances.notice?.takeOverLabel).toBe("Take it back");
  });

  it("names the holder when who is signed in is not known yet", () => {
    // Guessing "another tab" for an unknown reader would tell a person their
    // colleague's claim is their own.
    const affordances = documentLockAffordances(
      { status: "taken-over", holder: ada },
      null,
      "current",
      null
    );

    expect(affordances.notice?.message).toMatch(/^Ada took over/);
  });

  it("offers no ask to oneself when one's own claim is reported as held", () => {
    const affordances = documentLockAffordances(
      { status: "held-by-other", holder: ada, requestSent: false },
      null,
      "current",
      "u1"
    );

    expect(affordances.notice?.message).toBe(
      "You have this document open in another tab. You can read it here, or continue editing here."
    );
    expect(affordances.notice?.takeOverLabel).toBe("Continue editing here");
    expect(affordances.notice?.accessRequest).toBeNull();
  });
});

describe("a copy of the document that may be out of date", () => {
  // Every state that lets the editor type, notices that withhold nothing
  // included: a save from any of them would write the copy on screen.
  it.each<[string, DocumentLockState, DocumentLockHolder | null]>([
    ["idle", { status: "idle" }, null],
    ["acquiring", { status: "acquiring" }, null],
    [
      "held by this editor",
      { status: "held-by-me", someoneWaiting: false },
      null,
    ],
    [
      "held, with a colleague waiting",
      { status: "held-by-me", someoneWaiting: true },
      null,
    ],
    ["unchecked, nobody ever reported", { status: "unavailable" }, null],
  ])("holds the editor back while %s", (_name, state, holder) => {
    const failed = documentLockAffordances(state, holder, "failed");
    expect(failed).toMatchObject({ readOnly: true, actionsDisabled: true });
    expect(failed.notice).toMatchObject({
      tone: "unloaded",
      retryLabel: "Try again",
    });
    expect(failed.notice?.message).toMatch(/couldn't load the latest version/);

    const loading = documentLockAffordances(state, holder, "loading");
    expect(loading).toMatchObject({ readOnly: true, actionsDisabled: true });
    expect(loading.notice?.tone).toBe("loading");
  });

  // Already read-only: the notice keeps its place, with the way back it offers.
  it.each<[string, DocumentLockState, DocumentLockHolder | null, string]>([
    [
      "held by a colleague",
      { status: "held-by-other", holder: bob, requestSent: false },
      null,
      "Take over",
    ],
    ["taken over", { status: "taken-over", holder: bob }, null, "Take it back"],
    ["lost", { status: "lost" }, null, "Take it back"],
    [
      "unchecked, a colleague reported before",
      { status: "unavailable" },
      bob,
      "Take over",
    ],
  ])(
    "leaves the notice of a form already withheld while %s",
    (_name, state, holder, label) => {
      const affordances = documentLockAffordances(state, holder, "failed");
      expect(affordances).toEqual(documentLockAffordances(state, holder));
      expect(affordances.notice?.takeOverLabel).toBe(label);
    }
  );
});
