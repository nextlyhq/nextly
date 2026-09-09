// @vitest-environment jsdom

/**
 * What the editor actually posts when an author saves a selection.
 *
 * The assertion that matters most is that the DOCUMENT and the SELECTION
 * travel, rather than a pattern this side built: what a saved pattern is
 * depends on the block registry, and this browser holds only the core blocks
 * while the server also holds every block another plugin declared.
 *
 * The second is that the library read is named as stale. A save the author
 * cannot then see is indistinguishable from one that failed.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  usePluginRouteMutation: vi.fn(),
  apiErrorMessage: vi.fn(
    (error: unknown, fallback: string) =>
      (error as Error | null)?.message || fallback
  ),
  // Present because the mock REPLACES the module: the subject reads the
  // planner's cause off a refusal through this, so omitting it is a missing
  // export rather than an unused stub. Answers with nothing by default, which
  // is every failure that is not a validation refusal.
  validationIssues: vi.fn(() => []),
}));

import {
  apiErrorMessage,
  usePluginRouteMutation,
  validationIssues,
} from "@nextlyhq/plugin-sdk/admin";

import { compositionRefusalReason } from "@nextlyhq/builder";

import {
  LIBRARY_ROUTE_PATH,
  PAGE_BUILDER_PLUGIN_NAME,
  SAVE_PATTERN_ROUTE_PATH,
} from "../library-contract";

import { useSavePattern } from "./save-pattern-client";

const mutation = vi.mocked(usePluginRouteMutation);

/**
 * The hook as it behaves when a write ANSWERS.
 *
 * Separate from {@link refusing} rather than one helper with a default,
 * because the value that distinguishes the two is `undefined` — which a default
 * parameter silently replaces. Written that way first, and the failure-path
 * case exercised the success path and passed.
 */
function writing(error: Error | null = null) {
  const write = vi.fn(async () => ({
    message: "Pattern created.",
    item: { id: "p1" },
  }));
  mutation.mockReturnValue({
    write,
    pending: false,
    error,
  } as unknown as ReturnType<typeof usePluginRouteMutation>);
  return write;
}

/** The hook as it behaves when a write fails: it resolves with nothing. */
function refusing(error: Error | null = null) {
  const write = vi.fn(async () => undefined);
  mutation.mockReturnValue({
    write,
    pending: false,
    error,
  } as unknown as ReturnType<typeof usePluginRouteMutation>);
  return write;
}

const document = {
  formatVersion: 1,
  kind: "page",
  nodes: [{ id: "a", type: "core/box", version: 1, props: {} }],
} as never;

const fields = { title: "Hero", granularity: "section" } as never;

describe("what the save posts", () => {
  it("addresses THIS plugin's save route", () => {
    // A plugin names itself: nothing in a plugin component's React context says
    // which plugin contributed it.
    writing();

    renderHook(() => useSavePattern());

    expect(mutation.mock.calls[0]?.[0]).toMatchObject({
      plugin: PAGE_BUILDER_PLUGIN_NAME,
      path: SAVE_PATTERN_ROUTE_PATH,
    });
  });

  it("names the library read as stale, so the panel shows the new pattern", () => {
    // Named rather than inferred: nothing in the admin's cache knows which
    // reads a plugin's write affects.
    writing();

    renderHook(() => useSavePattern());

    expect(mutation.mock.calls[0]?.[0]?.invalidates).toEqual([
      LIBRARY_ROUTE_PATH,
    ]);
  });

  it("sends the DOCUMENT and the SELECTION, not a pattern built here", async () => {
    // The whole architecture of the feature in one assertion. A browser that
    // planned its own save would answer nesting questions about blocks it has
    // never heard of — and the guarantee the insert panel leans on, that a
    // stored pattern is one the planner would place, would hold only for
    // callers who chose to honour it.
    const write = writing();
    const { result } = renderHook(() => useSavePattern());

    await act(async () => {
      await result.current.save(document, ["a", "b"], fields);
    });

    expect(write).toHaveBeenCalledWith({
      document,
      selectedIds: ["a", "b"],
      fields,
    });
  });
});

describe("what the save reports back", () => {
  it("hands back the ROUTE's answer, warnings and all", async () => {
    // Not a boolean. A post-commit hook cannot un-write the row, so the route
    // reports its failures as `warnings` beside a success — and a client that
    // reduced every answer to `true` would present an unindexed pattern, a
    // failed webhook or an unpurged cache as a clean save.
    const warnings = [
      {
        severity: "failure",
        phase: "afterChange",
        key: "patterns",
        message: "x",
      },
    ];
    const write = vi.fn(async () => ({
      message: "Pattern created.",
      item: { id: "p1" },
      warnings,
    }));
    mutation.mockReturnValue({
      write,
      pending: false,
      error: null,
    } as unknown as ReturnType<typeof usePluginRouteMutation>);
    const { result } = renderHook(() => useSavePattern());

    let answered: unknown;
    await act(async () => {
      answered = await result.current.save(document, ["a"], fields);
    });

    expect(answered).toEqual({
      message: "Pattern created.",
      item: { id: "p1" },
      warnings,
    });
  });

  it("answers NOTHING when the write resolved with nothing", async () => {
    // The published hook resolves `undefined` on failure rather than
    // rejecting, so the absence of an answer IS the failure signal. A caller
    // that read it as "answered with no body" would close the form on a refused
    // save and throw the draft away.
    const write = refusing();
    const { result } = renderHook(() => useSavePattern());

    let answered: unknown;
    await act(async () => {
      answered = await result.current.save(document, ["a"], fields);
    });

    expect(write).toHaveBeenCalled();
    expect(answered).toBeUndefined();
  });

  it("phrases a failure through the admin's own extractor", async () => {
    // Not assembled here. A plugin building its own message shows
    // "Validation failed." — true, and silent about which field — while the
    // admin's own screens show the per-field reasons.
    refusing(new Error("A pattern with that name already exists."));

    const { result } = renderHook(() => useSavePattern());

    expect(vi.mocked(apiErrorMessage)).toHaveBeenCalled();
    expect(result.current.error).toBe(
      "A pattern with that name already exists."
    );
  });

  it("says nothing when no save has failed", () => {
    writing();

    const { result } = renderHook(() => useSavePattern());

    expect(result.current.error).toBeUndefined();
  });
});

describe("a refusal the two registries disagreed about", () => {
  /** A refusal as the route sends one: the planner's cause as the machine code. */
  function refusedWith(problem: string) {
    vi.mocked(validationIssues).mockReturnValue([
      {
        path: "selectedIds",
        code: problem,
        message: "The selection cannot be saved as a pattern.",
      },
    ]);
    return refusing(new Error("The selection cannot be saved as a pattern."));
  }

  it("phrases the PLANNER's cause with the shared vocabulary", () => {
    // This case means the browser found the selection savable and the server —
    // which also knows every block another plugin declared — did not. The
    // route's own message is deliberately generic, because the server is not
    // the surface that phrases refusals; the cause travels so that this side
    // can.
    refusedWith("gap");

    const { result } = renderHook(() => useSavePattern());

    expect(result.current.error).toBe(
      compositionRefusalReason({ problem: "gap" })
    );
    // And NOT the route's generic sentence, which is what a client discarding
    // the cause would show.
    expect(result.current.error).not.toBe(
      "The selection cannot be saved as a pattern."
    );
  });

  it("falls back to the admin's extractor for a cause it does not know", () => {
    // A duplicate name, a permission, a transport failure — none of them is a
    // planner cause, and none has a remedy this vocabulary could phrase.
    refusedWith("DUPLICATE");

    const { result } = renderHook(() => useSavePattern());

    expect(result.current.error).toBe(
      "The selection cannot be saved as a pattern."
    );
  });
});
