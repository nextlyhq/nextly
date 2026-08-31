/**
 * What an author may do to a document, across every state the editor reaches.
 *
 * The property this module exists for is that exactly ONE action is primary.
 * The header it replaces had no such rule — a published document with a pending
 * draft drew Save, Publish and Unpublish side by side — so that invariant is
 * asserted over the whole state space rather than at the cases that happen to
 * be interesting.
 *
 * @module components/features/entries/EntryForm/__tests__/document-actions.test
 */
import { describe, expect, it } from "vitest";

import {
  actionsAt,
  documentActions,
  menuGroups,
  type DocumentActionState,
} from "../document-actions";

/** A permissive edit-mode document; each case names only what it changes. */
function state(over: Partial<DocumentActionState> = {}): DocumentActionState {
  return {
    mode: "edit",
    hasStatus: true,
    draftsEnabled: true,
    status: "draft",
    hasWorkingDraft: false,
    readingHistory: false,
    canPublish: true,
    canUnpublish: true,
    canDelete: true,
    isDirty: false,
    canDuplicate: true,
    ...over,
  };
}

/**
 * The cartesian product of every dimension, so the invariant below is asserted
 * over the STATE SPACE rather than over the states someone thought to list.
 *
 * Built by folding rather than by nesting seven loops: the nested form reached
 * a cognitive complexity the repository's gate refuses, and it refuses for the
 * reason that matters here — a reader cannot tell at a glance whether a
 * dimension is missing, which is exactly the mistake this generator exists to
 * prevent.
 */
const DIMENSIONS = {
  mode: ["create", "edit"],
  hasStatus: [true, false],
  draftsEnabled: [true, false],
  status: ["draft", "published", "unknown"],
  hasWorkingDraft: [true, false],
  readingHistory: [true, false],
  canPublish: [true, false],
} as const;

function everyState(): DocumentActionState[] {
  let combos: Record<string, unknown>[] = [{}];
  for (const [key, values] of Object.entries(DIMENSIONS)) {
    combos = combos.flatMap(combo =>
      (values as readonly unknown[]).map(value => ({ ...combo, [key]: value }))
    );
  }
  return combos.map(combo => state(combo as Partial<DocumentActionState>));
}

describe("exactly one action leads", () => {
  it("holds in every state the editor can reach", () => {
    const states = everyState();
    // Population first: a generator that produced nothing would satisfy every
    // assertion in the loop by never entering it.
    expect(states.length).toBe(192);

    for (const s of states) {
      const primaries = actionsAt(documentActions(s), "primary");
      expect(
        primaries.length,
        `${JSON.stringify(s)} produced ${primaries.length} primary actions`
      ).toBe(1);
    }
  });

  it("never repeats an id, so no action is offered twice", () => {
    // Save appears as primary in one state and in the toolbar in another; a
    // rule that added both would draw the same verb twice with different
    // weights, which is the shape of the defect being removed.
    for (const s of everyState()) {
      const ids = documentActions(s).map(a => a.id);
      expect(new Set(ids).size, `duplicate id in ${JSON.stringify(s)}`).toBe(
        ids.length
      );
    }
  });
});

describe("the action that leads, per state", () => {
  it("is Create only where there is no lifecycle to choose from", () => {
    /*
     * "Create" is the word for a collection with no publish state: one verb,
     * and the document does not exist yet. A collection that HAS a lifecycle
     * offers both from the start, so Create is the wrong word there — the case
     * below.
     */
    const actions = documentActions(
      state({ mode: "create", hasStatus: false })
    );
    expect(actionsAt(actions, "primary")[0]).toMatchObject({
      id: "save",
      label: "Create",
    });
    expect(actionsAt(actions, "toolbar")).toEqual([]);
  });

  it("offers Publish AND a draft save while creating in a lifecycle collection", () => {
    /*
     * Taken from the behaviour the header already had: creating in a collection
     * with a publish state has always offered both, and dropping one would take
     * away the ability to begin a document without publishing it.
     */
    const actions = documentActions(state({ mode: "create", hasStatus: true }));
    expect(actionsAt(actions, "primary")[0]).toMatchObject({
      id: "publish",
      label: "Publish",
    });
    expect(actionsAt(actions, "toolbar").map(a => a.label)).toEqual([
      "Save draft",
    ]);
  });

  it("is Publish on a draft, with saving offered beside it", () => {
    // A draft's purpose is to become published, so Publish leads — and an
    // author not ready for readers still needs somewhere to put the work.
    const actions = documentActions(state({ status: "draft" }));
    expect(actionsAt(actions, "primary")[0]).toMatchObject({ id: "publish" });
    expect(actionsAt(actions, "toolbar").map(a => a.label)).toEqual([
      "Save draft",
    ]);
  });

  it("says Publish CHANGES on a live document with pending edits", () => {
    /*
     * The label is the point. "Publish" on something already live reads as a
     * no-op and says nothing about the draft it promotes — and this is the
     * state that previously drew three buttons of equal weight.
     */
    const actions = documentActions(
      state({ status: "published", hasWorkingDraft: true })
    );
    expect(actionsAt(actions, "primary")[0]).toMatchObject({
      id: "publish",
      label: "Publish changes",
    });
    expect(actionsAt(actions, "toolbar").map(a => a.label)).toEqual(["Save"]);
  });

  it("is Save on a clean live document, which has nothing to publish", () => {
    /*
     * The WORD depends on where the work goes, a distinction the editor already
     * drew and this keeps: with drafts on it lands in a draft, so "Save"; with
     * drafts off it goes straight to readers, so "Save changes" says what will
     * happen. Both are asserted, because a model ignoring `draftsEnabled` would
     * pass whichever one it happened to hard-code.
     */
    const withDrafts = documentActions(
      state({
        status: "published",
        hasWorkingDraft: false,
        draftsEnabled: true,
      })
    );
    expect(actionsAt(withDrafts, "primary")[0]).toMatchObject({
      id: "save",
      label: "Save",
    });
    // And nothing joins it in the toolbar: there is no second act here.
    expect(actionsAt(withDrafts, "toolbar")).toEqual([]);

    const withoutDrafts = documentActions(
      state({
        status: "published",
        hasWorkingDraft: false,
        draftsEnabled: false,
      })
    );
    expect(actionsAt(withoutDrafts, "primary")[0]).toMatchObject({
      id: "save",
      label: "Save changes",
    });
  });

  it("is Save for a collection with no publish lifecycle at all", () => {
    const actions = documentActions(state({ hasStatus: false }));
    expect(actionsAt(actions, "primary")[0]).toMatchObject({ id: "save" });
    expect(actionsAt(actions, "menu").map(a => a.id)).not.toContain(
      "unpublish"
    );
  });
});

describe("what moved out of the toolbar", () => {
  it("puts Unpublish in the danger group, not beside Publish", () => {
    /*
     * The demotion this model exists to make expressible. The two most
     * consequential and opposite verbs in the editor were one slip apart and
     * styled almost alike; unpublishing is rare, public, and belongs with the
     * other destructive verbs.
     */
    const actions = documentActions(state({ status: "published" }));
    expect(actionsAt(actions, "toolbar").map(a => a.id)).not.toContain(
      "unpublish"
    );
    expect(menuGroups(actions).danger.map(a => a.id)).toContain("unpublish");
  });

  it("keeps routine and destructive verbs in separate groups", () => {
    // Duplicate and Delete sat in one flat list. A destructive verb one row
    // from a routine one is a slip waiting to happen.
    const groups = menuGroups(
      documentActions(state({ status: "published", isDirty: true }))
    );
    expect(groups.document.map(a => a.id)).toEqual(["duplicate", "view-api"]);
    expect(groups.danger.every(a => a.destructive === true)).toBe(true);
    // The control: a split that put everything on one side would satisfy the
    // assertion above about `danger` while telling us nothing.
    expect(groups.document.length).toBeGreaterThan(0);
    expect(groups.danger.length).toBeGreaterThan(0);
  });

  it("offers the two kinds of discard separately, and only when they apply", () => {
    /*
     * Different acts on different things: a pending working draft is saved work
     * readers cannot see, unsaved form changes were never written down.
     * Collapsing them would let an author dropping a typo throw away a rewrite.
     */
    const both = documentActions(
      state({ status: "published", hasWorkingDraft: true, isDirty: true })
    );
    expect(menuGroups(both).danger.map(a => a.id)).toEqual(
      expect.arrayContaining(["discard-draft", "discard-changes"])
    );

    const neither = documentActions(
      state({ status: "published", hasWorkingDraft: false, isDirty: false })
    );
    const ids = neither.map(a => a.id);
    expect(ids).not.toContain("discard-draft");
    expect(ids).not.toContain("discard-changes");
  });
});

describe("why an action cannot be used", () => {
  it("says so rather than going quietly dead", () => {
    // Three independent permissions decide these, so a disabled control with no
    // explanation reads as broken rather than as forbidden.
    const actions = documentActions(
      state({ status: "published", canUnpublish: false, canDelete: false })
    );
    const byId = new Map(actions.map(a => [a.id, a]));
    expect(byId.get("unpublish")?.disabledReason).toMatch(/permission/i);
    expect(byId.get("delete")?.disabledReason).toMatch(/permission/i);
  });

  it("leaves the reason absent when the action IS available", () => {
    // The control. A model that attached a reason unconditionally would satisfy
    // the case above while disabling everything.
    const actions = documentActions(state({ status: "published" }));
    for (const action of actions) {
      expect(action.disabledReason).toBeUndefined();
    }
  });

  it("blocks every MUTATION while a past version is on screen", () => {
    /*
     * Reading history is a MODE, not a permission: the document on screen is
     * not the live one, so a write would land on the wrong thing. The reason
     * names the way out rather than only refusing.
     */
    const actions = documentActions(state({ readingHistory: true }));
    const mutations = actions.filter(a => a.id !== "view-api");
    // Population: an empty list would satisfy the loop by never entering it.
    expect(mutations.length).toBeGreaterThan(0);
    for (const action of mutations) {
      expect(action.disabledReason, `${action.id} was left usable`).toMatch(
        /past version/i
      );
    }
  });

  it("leaves the one READ available there, because it writes nothing", () => {
    /*
     * The discriminating half, and the reason the case above is not simply
     * "every action". Viewing the API response changes nothing and is most
     * useful exactly when an author is trying to understand the version in
     * front of them. A rule that disabled the whole list would satisfy the test
     * above while taking away the one thing that still makes sense.
     */
    const actions = documentActions(state({ readingHistory: true }));
    const viewApi = actions.find(a => a.id === "view-api");
    expect(viewApi).toBeDefined();
    expect(viewApi?.disabledReason).toBeUndefined();
  });
});
