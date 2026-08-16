// @vitest-environment jsdom
/**
 * The block library is open the first time an author opens the editor.
 *
 * The shell defaults to no open panel, which is right for an editor whose author
 * already knows the document and wrong for a page builder, where the library is
 * how you begin. Before the shell was adopted the library was a permanently
 * visible pane; a default of "no panel" hid it behind a rail button.
 *
 * Caught by `e2e/tests/canvas/invalid-drop-feedback.test.ts` failing to find any
 * library entry, NOT by a unit test — which is why one exists now.
 */
import { afterEach, describe, expect, it } from "vitest";

import { editorPreferenceStore } from "../editorPreferences";

const STORAGE_KEY = "nextly.page-builder.shell";

afterEach(() => {
  window.localStorage.clear();
});

describe("first run", () => {
  it("opens the insert panel when nothing is stored", () => {
    const store = editorPreferenceStore();
    const seeded = store.read();

    expect(seeded).not.toBeNull();
    expect(JSON.parse(seeded as string)).toMatchObject({ leftPanel: "insert" });
  });

  it("never answers null, which is what makes the shell use ITS default", () => {
    // The separating property. `readPreferences` falls back to the shell's own
    // defaults — `leftPanel: null` — precisely when `read()` returns null, so a
    // store that answered null here would reproduce the regression exactly while
    // still looking like a configured store.
    expect(editorPreferenceStore().read()).not.toBeNull();
  });
});

describe("once the author has chosen", () => {
  it("returns what was stored rather than the seed", () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ leftPanel: "layers" })
    );

    const stored = editorPreferenceStore().read();
    expect(JSON.parse(stored as string)).toMatchObject({
      leftPanel: "layers",
    });
  });

  it("lets the author CLOSE the library and have it stay closed", () => {
    // The seed is a first-run default, not a policy. A store that re-seeded
    // whenever the panel was null would reopen the library on every mount and
    // make the close button look broken.
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ leftPanel: null })
    );

    const stored = editorPreferenceStore().read();
    expect(JSON.parse(stored as string).leftPanel).toBeNull();
  });

  it("keeps two embedded surfaces from driving each other", () => {
    // A form may embed several page-builder fields. Sharing one key means opening
    // one applies the panel the OTHER last chose, which reads as the editor
    // forgetting the author's choice at random.
    //
    // The separating property is that the two stores write to DIFFERENT keys —
    // asserting only that each reads back its own value would pass on a shared
    // key too, since the second write would simply be the last one made.
    const a = editorPreferenceStore("field:body");
    const b = editorPreferenceStore("field:sidebar");

    a.write(JSON.stringify({ leftPanel: "layers" }));
    b.write(JSON.stringify({ leftPanel: "tokens" }));

    expect(JSON.parse(a.read() as string)).toMatchObject({
      leftPanel: "layers",
    });
    expect(JSON.parse(b.read() as string)).toMatchObject({
      leftPanel: "tokens",
    });
  });

  it("gives an unidentified surface the bare key", () => {
    // The standalone edit view, which is the only surface of its kind on a page.
    editorPreferenceStore().write(JSON.stringify({ leftPanel: "fonts" }));

    expect(window.localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("writes through to storage under its own key", () => {
    // Its own key rather than the shell's default: two editor surfaces in one
    // document must not silently share one set of panel widths.
    editorPreferenceStore().write(JSON.stringify({ leftPanel: "tokens" }));

    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw as string)).toMatchObject({ leftPanel: "tokens" });
  });
});
