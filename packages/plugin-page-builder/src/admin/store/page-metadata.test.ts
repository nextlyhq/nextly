/**
 * Page metadata is unsaved work, so it moves the one flag that says so.
 *
 * Title and slug used to live in `SaveShell`'s own `useState`. Nothing wrong was
 * visible there until something else had to ask whether the page had unsaved
 * changes: `state.dirty` is that question's single answer, a component-local
 * copy cannot move it, and a page whose title had been retyped therefore
 * reported itself clean. The exit confirmation read that answer and let the
 * edit go without asking.
 *
 * The repair is that the editor state owns every field Save persists, so
 * `dirty` covers them by construction rather than by each new consumer
 * remembering to check a second place. These assertions pin that: metadata
 * edits mark the page unsaved, saving clears it, and the fields survive the
 * document being replaced underneath them.
 *
 * WHAT THIS DOES NOT COVER, stated rather than left to be assumed. This package
 * runs vitest under `environment: "node"` with no React renderer, so the wiring
 * from the title INPUT to the dispatch below is not exercised here — only the
 * store's response to it. What keeps the two in step is that `state.metadata`
 * is now the only place a title or slug exists, so `SaveShell` has nowhere else
 * to read one from; reintroducing a local copy is a visible change to that file
 * rather than a drift. A render test would assert it directly and belongs here
 * the moment this package gains a DOM harness.
 */
import { describe, expect, it } from "vitest";

import { makeNode } from "../../core/tree";
import type { BlockDocument } from "../../core/types";
import "../../render/blocks"; // populate defaultBlockRegistry (block defaults)

import { editorReducer, initialState } from "./editorStore";

function baseDoc(): BlockDocument {
  return {
    version: 1,
    root: makeNode("core/container", {}, undefined, { default: [] }),
  };
}

const LOADED = { title: "About us", slug: "about-us" };

describe("page metadata in the editor state", () => {
  it("starts from what the page was loaded with, and starts clean", () => {
    // Positive control for the assertions below: an initial state that dropped
    // the metadata would satisfy "editing marks dirty" perfectly.
    const s = initialState(baseDoc(), "", LOADED);
    expect(s.metadata).toEqual(LOADED);
    expect(s.dirty).toBe(false);
  });

  it("marks the page unsaved when only the title changes", () => {
    // The separating case. This is the edit that used to leave `dirty` false,
    // and it is the one the exit confirmation was letting through.
    const s = editorReducer(initialState(baseDoc(), "", LOADED), {
      type: "SET_PAGE_METADATA",
      metadata: { title: "About the team" },
    });
    expect(s.metadata.title).toBe("About the team");
    expect(s.dirty).toBe(true);
  });

  it("marks the page unsaved when only the slug changes", () => {
    const s = editorReducer(initialState(baseDoc(), "", LOADED), {
      type: "SET_PAGE_METADATA",
      metadata: { slug: "about-the-team" },
    });
    expect(s.metadata.slug).toBe("about-the-team");
    expect(s.dirty).toBe(true);
  });

  it("leaves the field it was not given alone", () => {
    // The inputs edit one field each, so a partial update that blanked the
    // other would silently discard whichever was typed first.
    const s = editorReducer(initialState(baseDoc(), "", LOADED), {
      type: "SET_PAGE_METADATA",
      metadata: { title: "Renamed" },
    });
    expect(s.metadata.slug).toBe(LOADED.slug);
  });

  it("is clean again once the page is saved", () => {
    const edited = editorReducer(initialState(baseDoc(), "", LOADED), {
      type: "SET_PAGE_METADATA",
      metadata: { title: "Renamed" },
    });
    const saved = editorReducer(edited, { type: "MARK_SAVED" });
    expect(saved.dirty).toBe(false);
    expect(saved.metadata.title).toBe("Renamed");
  });

  it("keeps the metadata when the document is replaced", () => {
    // REPLACE rebuilds the state from a new document. Rebuilding without the
    // metadata would blank the title and slug inputs mid-edit, and — because
    // the rebuild also clears `dirty` — do it without reporting anything.
    const edited = editorReducer(initialState(baseDoc(), "", LOADED), {
      type: "SET_PAGE_METADATA",
      metadata: { title: "Renamed" },
    });
    const replaced = editorReducer(edited, {
      type: "REPLACE",
      document: baseDoc(),
    });
    expect(replaced.metadata.title).toBe("Renamed");
  });
});
