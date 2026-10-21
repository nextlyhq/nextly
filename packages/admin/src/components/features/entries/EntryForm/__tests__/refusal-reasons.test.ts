/**
 * Why a document action cannot run at this instant, in the words its control
 * shows — and which kind of refusal those words are, which is what running the
 * action from elsewhere reports.
 *
 * The order is the claim: a colleague's lock outranks a save in flight, which
 * outranks an invalid form, which outranks a published document with nothing
 * changed. A refusal that named the wrong one would tell an author to fix
 * something that is not what is stopping them.
 */
import { describe, expect, it } from "vitest";

import { refusalReasons } from "../useDocumentActionBindings";

const free = {
  isSubmitting: false,
  isInvalid: false,
  isDirty: true,
  documentLocked: false,
  isPublishedEditState: false,
};

describe("refusalReasons", () => {
  it("refuses nothing when the editor is free to write", () => {
    const { reasons } = refusalReasons(free);
    expect(Object.values(reasons).filter(r => r !== undefined)).toEqual([]);
  });

  it("names a colleague's lock first, over a save in flight", () => {
    const { reasons, refusalFor } = refusalReasons({
      ...free,
      documentLocked: true,
      isSubmitting: true,
    });
    expect(reasons.save).toBe("Someone else is editing this document");
    expect(refusalFor(reasons.save ?? "")).toBe("refused");
  });

  it("names a save in flight as busy", () => {
    const { reasons, refusalFor } = refusalReasons({
      ...free,
      isSubmitting: true,
    });
    expect(reasons.publish).toBe("Saving…");
    expect(refusalFor("Saving…")).toBe("busy");
  });

  it("names an invalid form as invalid, for save and publish but not for delete", () => {
    const { reasons, refusalFor } = refusalReasons({
      ...free,
      isInvalid: true,
    });
    expect(reasons.save).toBe("Fix the errors on this page first.");
    expect(reasons.publish).toBe("Fix the errors on this page first.");
    expect(reasons.delete).toBeUndefined();
    expect(refusalFor(reasons.save ?? "")).toBe("invalid");
  });

  it("refuses saving a published document with nothing changed, and nothing else", () => {
    const { reasons, refusalFor } = refusalReasons({
      ...free,
      isPublishedEditState: true,
      isDirty: false,
    });
    expect(reasons.save).toBe("Nothing has changed yet.");
    expect(reasons.publish).toBeUndefined();
    expect(refusalFor(reasons.save ?? "")).toBe("refused");
  });

  it("lets Discard changes run under a lock, refusing it only mid-save", () => {
    expect(
      refusalReasons({ ...free, documentLocked: true }).reasons[
        "discard-changes"
      ]
    ).toBeUndefined();
    expect(
      refusalReasons({ ...free, isSubmitting: true }).reasons["discard-changes"]
    ).toBe("Saving…");
  });
});
