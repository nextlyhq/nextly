// @vitest-environment jsdom

/**
 * The editor's one read and one write for the Site Style document.
 *
 * What is only true here is the COMPOSITION: that the read merges the stored
 * tier over the host's defaults rather than showing either alone, that a write
 * names one section and nothing else, and that a refusal is reported rather
 * than mistaken for a save. The narrowing and the merge are asserted where they
 * live — `site-style-record` and `site-style` — and re-asserting them here
 * would be a second statement of rules this module deliberately does not own.
 *
 * The admin's single hooks are replaced with recorders. Standing a real query
 * client up would put the admin's transport in every assertion, which is a
 * different subject with its own tests.
 *
 * @module admin/site-style-client.test
 */
import type { ValidationIssue } from "@nextlyhq/plugin-sdk/admin";
import { renderHook, act, waitFor } from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** What the stubbed read answers with for the test in hand. */
let readAnswer: {
  data: unknown;
  isPending: boolean;
  error: Error | null;
} = { data: undefined, isPending: false, error: null };

/**
 * What the stubbed write does, and what it was called with.
 *
 * A function rather than a value, because the contract under test is that a
 * refusal REJECTS: the service answers `{ success: false }`,
 * `unwrapServiceResult` throws it, the route answers non-2xx, and the admin's
 * fetcher turns that into a rejected promise carrying an `ApiError`. A stub
 * that resolved with the service's envelope would test a boundary the browser
 * never sees.
 */
let writeBehaviour: () => Promise<unknown> = async () => ({ id: "1" });

/**
 * What the stubbed extractor answers with.
 *
 * A fixed list rather than a second reading of `ApiError.data`, so this file
 * states no opinion about the wire shape — that is `validationIssues`' own
 * question and is asserted where it lives, against a payload built by
 * `parseApiError`. What IS only true here is what this module does with the
 * result: which issues it keeps and what it keys them by.
 */
let issuesAnswer: readonly ValidationIssue[] = [];
const writes: Record<string, unknown>[] = [];
/** Whether each write, in order, said to overwrite; kept apart from `writes`. */
const overwrites: unknown[] = [];
/** What reached Settings' route, and how often the document was read again. */
const routeWrites: unknown[] = [];
let refetches = 0;
/** Whether the read after a write answers that it failed. */
let readFails = false;
/** What a fresh read answers with, and how many were made. */
let freshAnswer: () => unknown = () => readAnswer.data;
let freshReads = 0;
/** The options the write hook was constructed with, for the scope assertion. */
let writeOptions: { scopeId?: string } | undefined;
/** What the form's storing gate was handed to wait for, in order. */
const tracked: { label: string; settled: Promise<unknown> }[] = [];

// The stored style arrives through the editor's one read of the plugin's
// route; that read's own request is asserted in `site-style-read.test`.
vi.mock("./site-style-read", () => ({
  useStoredSiteStyle: () => ({
    ...readAnswer,
    refetch: async () => {
      refetches += 1;
      return { isError: readFails };
    },
    readFresh: async () => {
      freshReads += 1;
      return freshAnswer();
    },
  }),
}));

// No `useSingleDocument` here: the editor must not read the Single, which an
// author without Design's permission is refused, so a read of it fails.
// The admin's own sentence for a refusal, as a surface reads it.
const { apiErrorMessage } =
  await vi.importActual<typeof import("@nextlyhq/admin")>("@nextlyhq/admin");

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  apiErrorMessage,
  // The site's breakpoints go through Settings' route, answered like the
  // Single's own update so one switch drives both.
  writePluginRoute: async (write: unknown) => {
    routeWrites.push(write);
    return writeBehaviour();
  },
  validationIssues: () => issuesAnswer,
  // The form's storing gate, recording each write it is handed to wait for.
  useTrackedWrite: () => (label: string, settled: Promise<unknown>) => {
    tracked.push({ label, settled });
  },
  readPluginRoute: async () => undefined,
  useUpdateSingleDocument: (
    _slug: string,
    _locale?: string,
    options?: { scopeId?: string }
  ) => {
    writeOptions = options;
    return {
      mutateAsync: async (data: Record<string, unknown>) => {
        const { _overwrite, ...sections } = data;
        overwrites.push(_overwrite);
        writes.push(sections);
        return writeBehaviour();
      },
      isPending: false,
    };
  },
}));

const {
  SITE_STYLE_PAUSE_MS,
  SiteStyleHistoryContext,
  extendHeldSiteStyle,
  releaseHeldSiteStyle,
  useFontCatalogueClient,
  useSaveSiteStyle,
  useSaveSpacingMode,
  useSiteStyle,
} = await import("./site-style-client");
const { KEPT_CHANGING_WORDS } = await import("./conflict-words");

/** A defaults tier a host states in code. */
const DEFAULTS = {
  breakpoints: {
    viewport: [
      { id: "base", label: "Base" },
      { id: "lg", label: "Large", maxWidth: 1200 },
    ],
    container: [],
  },
} as never;

beforeEach(() => {
  readAnswer = { data: undefined, isPending: false, error: null };
  writeBehaviour = async () => ({ id: "1" });
  issuesAnswer = [];
  writes.length = 0;
  overwrites.length = 0;
  routeWrites.length = 0;
  refetches = 0;
  readFails = false;
  freshAnswer = () => readAnswer.data;
  freshReads = 0;
  writeOptions = undefined;
  tracked.length = 0;
});

describe("reading the site style", () => {
  it("answers with the host's defaults when nothing is stored", () => {
    // The case a site that never opened a studio is in, and it must not read as
    // an error or an empty design.
    const { result } = renderHook(() => useSiteStyle(DEFAULTS));

    expect(result.current.siteStyle.breakpoints?.viewport).toHaveLength(2);
    expect(result.current.error).toBeNull();
  });

  it("layers the STORED tier over the defaults", () => {
    // The whole point of the read. A stored breakpoint set replaces the
    // defaults' as one designed cascade, which is `resolveSiteStyle`'s rule —
    // asserted here only to prove the stored tier reaches the merge at all.
    readAnswer = {
      data: {
        breakpoints: {
          viewport: [{ id: "base", label: "Base" }],
          container: [],
        },
      },
      isPending: false,
      error: null,
    };

    const { result } = renderHook(() => useSiteStyle(DEFAULTS));

    expect(result.current.siteStyle.breakpoints?.viewport).toHaveLength(1);
  });

  it("degrades a malformed record to what it can type, not to an error", () => {
    // A stored row predates its validators. A read that refused would take the
    // whole editor down over one legacy value, so it keeps what it can type —
    // and here that leaves the host's defaults standing.
    readAnswer = {
      data: { breakpoints: "not a breakpoint set", tokens: 42 },
      isPending: false,
      error: null,
    };

    const { result } = renderHook(() => useSiteStyle(DEFAULTS));

    expect(result.current.error).toBeNull();
    expect(result.current.siteStyle.breakpoints?.viewport).toHaveLength(2);
  });

  it("reports PENDING separately, because defaults alone are also a real answer", () => {
    // The distinction a surface cannot make by looking at the value: a site
    // that stored nothing and a read that has not returned produce the same
    // merged style.
    readAnswer = { data: undefined, isPending: true, error: null };

    const { result } = renderHook(() => useSiteStyle(DEFAULTS));

    expect(result.current.pending).toBe(true);
    expect(result.current.siteStyle.breakpoints?.viewport).toHaveLength(2);
  });
});

describe("saving the space between blocks", () => {
  it("writes the model through its route, then reads the style again", async () => {
    // Reading again is what moves the canvas: it compiles from that read.
    const { result } = renderHook(() => useSaveSpacingMode());
    let verdict;
    await act(async () => {
      verdict = await result.current.save("classic");
    });
    expect(verdict).toEqual({ saved: true, refreshed: true });
    expect(routeWrites).toEqual([
      {
        plugin: "@nextlyhq/plugin-page-builder",
        path: "/site/style/spacing-mode",
        body: { mode: "classic" },
      },
    ]);
    expect(writes).toEqual([]);
    expect(refetches).toBe(1);
  });

  it("says the choice is stored but not read back when the reread fails", async () => {
    readFails = true;
    const { result } = renderHook(() => useSaveSpacingMode());
    let verdict;
    await act(async () => {
      verdict = await result.current.save("classic");
    });
    expect(verdict).toMatchObject({ saved: true, refreshed: false });
    expect(refetches).toBe(1);
  });

  it("answers a refusal in the route's words and reads nothing again", async () => {
    writeBehaviour = () => Promise.reject(new Error("Not allowed."));
    const { result } = renderHook(() => useSaveSpacingMode());
    let verdict;
    await act(async () => {
      verdict = await result.current.save("gaps");
    });
    expect(verdict).toMatchObject({ saved: false });
    expect(refetches).toBe(0);
  });
});

/** The admin transport's refusal of a write made from a replaced version. */
function staleRefusal(currentVersion: string, changedBy?: string): Error {
  return Object.assign(
    new Error("This document changed since the version you gave."),
    {
      status: 409,
      code: "STALE_VERSION",
      data: {
        currentVersion,
        ...(changedBy === undefined
          ? {}
          : { changedBy: { kind: "person", name: changedBy } }),
      },
    }
  );
}

describe("a save across two studios", () => {
  it("stores both sections, the second read again and merged after its refusal", async () => {
    // A page save releases each studio's held edit at once. The server is
    // modelled as the Single's update judges a write: one that names a
    // version other than the current one is refused. Both studios read
    // version 3; the second write is refused once, read again, and stored.
    let current = 3;
    const doc = () => ({
      tokens: null,
      fonts: null,
      classes: null,
      breakpoints: null,
      _rev: String(current),
    });
    readAnswer = { data: doc(), isPending: false, error: null };
    freshAnswer = doc;
    writeBehaviour = async () => {
      const sent = writes[writes.length - 1] ?? {};
      if (sent._rev !== String(current)) throw staleRefusal(String(current));
      current += 1;
      return { id: "1", _rev: String(current) };
    };
    const tokens = renderHook(() => useSaveSiteStyle());
    const fonts = renderHook(() => useSaveSiteStyle());

    let results: unknown[] = [];
    await act(async () => {
      results = await Promise.all([
        tokens.result.current.save("tokens", { tokens: [] }),
        fonts.result.current.save("fonts", []),
      ]);
    });

    expect(results).toEqual([
      { saved: true, issues: {}, stored: { tokens: [] } },
      { saved: true, issues: {}, stored: [] },
    ]);
    // Each write names the version it was merged onto, and none overwrites.
    expect(writes).toEqual([
      { tokens: { tokens: [] }, _rev: "3" },
      { fonts: [], _rev: "3" },
      { fonts: [], _rev: "4" },
    ]);
    expect(overwrites).toEqual([undefined, undefined, undefined]);
    expect(freshReads).toBe(1);
  });
});

describe("a save merged onto the newest stored copy", () => {
  const card = { id: "c1", slug: "card", orderIndex: 0, styles: {} };
  const hero = { id: "c2", slug: "hero", orderIndex: 1, styles: {} };
  const promo = { id: "c3", slug: "promo", orderIndex: 2, styles: {} };

  it("keeps a style saved since the studio's base, and sends the read's version", async () => {
    // The studio built its list before hero was saved elsewhere; the read
    // already holds hero, so the merge keeps it without a refusal.
    readAnswer = {
      data: { classes: [card, hero], _rev: "5" },
      isPending: false,
      error: null,
    };
    writeBehaviour = async () => ({ id: "1", _rev: "6" });
    const { result } = renderHook(() => useSaveSiteStyle());
    const renamed = { ...card, label: "Promo card" };
    let verdict: unknown;
    await act(async () => {
      verdict = await result.current.save("classes", [renamed], {
        base: [card],
      });
    });
    expect(writes).toEqual([{ classes: [renamed, hero], _rev: "5" }]);
    expect(verdict).toEqual({
      saved: true,
      issues: {},
      stored: [renamed, hero],
    });
    expect(freshReads).toBe(0);
  });

  it("reads again after a stale refusal and merges onto the fresh copy", async () => {
    readAnswer = {
      data: { classes: [card], _rev: "5" },
      isPending: false,
      error: null,
    };
    freshAnswer = () => ({ classes: [card, promo], _rev: "6" });
    let calls = 0;
    writeBehaviour = async () => {
      calls += 1;
      if (calls === 1) throw staleRefusal("6", "Sam");
      return { id: "1", _rev: "7" };
    };
    const { result } = renderHook(() => useSaveSiteStyle());
    const renamed = { ...card, label: "Promo card" };
    let verdict: unknown;
    await act(async () => {
      verdict = await result.current.save("classes", [renamed], {
        base: [card],
      });
    });
    expect(writes).toEqual([
      { classes: [renamed], _rev: "5" },
      { classes: [renamed, promo], _rev: "6" },
    ]);
    expect(verdict).toMatchObject({ saved: true, stored: [renamed, promo] });
    expect(freshReads).toBe(1);
  });

  it("answers the true conflicts it settled, with who caused them", async () => {
    // Both changed card's name: mine is kept and the conflict is described,
    // naming Sam because exactly one save came between versions 5 and 6.
    readAnswer = {
      data: { classes: [card], _rev: "5" },
      isPending: false,
      error: null,
    };
    const theirs = { ...card, label: "Their card" };
    freshAnswer = () => ({ classes: [theirs], _rev: "6" });
    let calls = 0;
    writeBehaviour = async () => {
      calls += 1;
      if (calls === 1) throw staleRefusal("6", "Sam");
      return { id: "1", _rev: "7" };
    };
    const { result } = renderHook(() => useSaveSiteStyle());
    const mine = { ...card, label: "My card" };
    let verdict: { stored?: unknown; conflicts?: unknown } | undefined;
    await act(async () => {
      verdict = await result.current.save("classes", [mine], { base: [card] });
    });
    expect(verdict?.stored).toEqual([mine]);
    expect(verdict?.conflicts).toEqual({
      entries: [
        {
          key: "c1",
          setting: false,
          kind: "changed",
          kept: "mine",
          base: card,
          mine,
          theirs,
        },
      ],
      refusal: {
        changedBy: { name: "Sam", kind: "person" },
        oneSaveBetween: true,
      },
    });
  });

  it("is refused as kept changing after three stale refusals", async () => {
    readAnswer = {
      data: { classes: [card], _rev: "5" },
      isPending: false,
      error: null,
    };
    let current = 5;
    freshAnswer = () => ({ classes: [card], _rev: String(current) });
    writeBehaviour = async () => {
      current += 1;
      throw staleRefusal(String(current));
    };
    const { result } = renderHook(() => useSaveSiteStyle());
    let verdict: unknown;
    await act(async () => {
      verdict = await result.current.save("classes", [hero], { base: [card] });
    });
    expect(writes).toHaveLength(3);
    // Refused in the editor's one sentence for it, wherever it is shown.
    expect(verdict).toMatchObject({
      saved: false,
      keptChanging: true,
      issues: { classes: KEPT_CHANGING_WORDS },
    });
  });

  it("keeps the form's leave guard asking until a write retried after a refusal has answered", async () => {
    // The entry form asks before the page is left while a tracked write is
    // unanswered. A write refused as stale and sent again is still
    // unanswered between the two, so its attempt must not settle there.
    const history = { record: () => () => {}, settled: new Map() };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SiteStyleHistoryContext.Provider value={history}>
        {children}
      </SiteStyleHistoryContext.Provider>
    );
    readAnswer = {
      data: { classes: [card], _rev: "5" },
      isPending: false,
      error: null,
    };
    freshAnswer = () => ({ classes: [card], _rev: "6" });
    const answers: {
      ok: (value: unknown) => void;
      no: (reason: unknown) => void;
    }[] = [];
    writeBehaviour = () =>
      new Promise((ok, no) => {
        answers.push({ ok, no });
      });
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = result.current.save("classes", [hero], { base: [card] });
    });
    expect(tracked).toHaveLength(1);
    let answered = false;
    void tracked[0]?.settled.then(() => {
      answered = true;
    });
    await waitFor(() => expect(answers).toHaveLength(1));
    expect(answered).toBe(false);

    await act(async () => {
      answers[0]?.no(staleRefusal("6"));
    });
    await waitFor(() => expect(answers).toHaveLength(2));
    expect(answered).toBe(false);

    await act(async () => {
      answers[1]?.ok({ id: "1", _rev: "7" });
      await saving;
    });
    await waitFor(() => expect(answered).toBe(true));
  });

  it("undoes onto the newest copy, yielding to a change made since", async () => {
    // Mine renamed card and was stored; someone then renamed it again. The
    // undo cannot take back a change that is no longer there, so theirs stays.
    const steps: { undo: () => Promise<unknown> }[] = [];
    const history = {
      record: (step: { undo: () => Promise<unknown> }) => {
        steps.push(step);
        return () => {};
      },
      settled: new Map(),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SiteStyleHistoryContext.Provider value={history}>
        {children}
      </SiteStyleHistoryContext.Provider>
    );
    readAnswer = {
      data: { classes: [card], _rev: "5" },
      isPending: false,
      error: null,
    };
    const mine = { ...card, label: "My card" };
    const theirs = { ...card, label: "Their card" };
    let calls = 0;
    writeBehaviour = async () => {
      calls += 1;
      if (calls === 2) throw staleRefusal("7", "Sam");
      return { id: "1", _rev: String(5 + calls) };
    };
    freshAnswer = () => ({ classes: [theirs], _rev: "7" });
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    await act(async () => {
      await result.current.save("classes", [mine], { base: [card] });
    });
    let replay: unknown;
    await act(async () => {
      replay = await steps[0]?.undo();
    });
    // The undo answers what it kept of theirs, so the history can say so.
    expect(replay).toMatchObject({
      stored: true,
      conflicts: {
        entries: [{ key: "c1", kind: "changed", kept: "theirs" }],
        refusal: { oneSaveBetween: true },
      },
    });
    expect(writes).toEqual([
      { classes: [mine], _rev: "5" },
      // Undo's first try, made from this editor's own write: back to card.
      { classes: [card], _rev: "6" },
      // Refused; merged onto their rename, which it yields to.
      { classes: [theirs], _rev: "7" },
    ]);
  });

  /** A history keeping each step it is handed, and the provider around it. */
  function keptSteps() {
    const steps: {
      undo: () => Promise<unknown>;
      redo: () => Promise<unknown>;
    }[] = [];
    const history = {
      record: (step: (typeof steps)[number]) => {
        steps.push(step);
        return () => {};
      },
      settled: new Map(),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SiteStyleHistoryContext.Provider value={history}>
        {children}
      </SiteStyleHistoryContext.Provider>
    );
    return { steps, wrapper };
  }

  it("undoes from the step's own record when another author's save was read in first", async () => {
    // Mine renamed card; another author then renamed hero, and the read has
    // already brought that in when Undo starts. Undo takes back card alone.
    const { steps, wrapper } = keptSteps();
    readAnswer = {
      data: { classes: [card, hero], _rev: "5" },
      isPending: false,
      error: null,
    };
    let rev = 5;
    writeBehaviour = async () => {
      rev += 1;
      return { id: "1", _rev: String(rev) };
    };
    const mine = { ...card, label: "My card" };
    const theirHero = { ...hero, label: "Their hero" };
    const { result, rerender } = renderHook(() => useSaveSiteStyle(), {
      wrapper,
    });
    await act(async () => {
      await result.current.save("classes", [mine, hero], {
        base: [card, hero],
      });
    });
    readAnswer = {
      data: { classes: [mine, theirHero], _rev: "7" },
      isPending: false,
      error: null,
    };
    rev = 7;
    rerender();
    await act(async () => {
      await steps[0]?.undo();
    });
    expect(writes.at(-1)).toEqual({ classes: [card, theirHero], _rev: "7" });
  });

  it("redoes from the step's own record when another author's save was read in first", async () => {
    const { steps, wrapper } = keptSteps();
    readAnswer = {
      data: { classes: [card, hero], _rev: "5" },
      isPending: false,
      error: null,
    };
    let rev = 5;
    writeBehaviour = async () => {
      rev += 1;
      return { id: "1", _rev: String(rev) };
    };
    const mine = { ...card, label: "My card" };
    const theirHero = { ...hero, label: "Their hero" };
    const { result, rerender } = renderHook(() => useSaveSiteStyle(), {
      wrapper,
    });
    await act(async () => {
      await result.current.save("classes", [mine, hero], {
        base: [card, hero],
      });
    });
    await act(async () => {
      await steps[0]?.undo();
    });
    expect(writes.at(-1)).toEqual({ classes: [card, hero], _rev: "6" });
    // Another author renames hero after the undo; the read brings it in.
    readAnswer = {
      data: { classes: [card, theirHero], _rev: "9" },
      isPending: false,
      error: null,
    };
    rev = 9;
    rerender();
    await act(async () => {
      await steps[0]?.redo();
    });
    expect(writes.at(-1)).toEqual({ classes: [mine, theirHero], _rev: "9" });
  });

  it("writes the section alone, unmerged, when the read gives no version", async () => {
    // A server that issues no versions: the write is made as it always was.
    readAnswer = {
      data: { classes: [card, hero] },
      isPending: false,
      error: null,
    };
    const { result } = renderHook(() => useSaveSiteStyle());
    let verdict: unknown;
    await act(async () => {
      verdict = await result.current.save("classes", [promo], { base: [card] });
    });
    expect(writes).toEqual([{ classes: [promo] }]);
    // Said to be made over whatever is stored: a write naming neither a
    // version nor an overwrite is refused by the Single.
    expect(overwrites).toEqual([true]);
    expect(verdict).toEqual({ saved: true, issues: {} });
  });
});

describe("writing one section", () => {
  it("sends ONLY the section named", async () => {
    // The property the whole four-studio arrangement rests on. A write carrying
    // a section it did not edit would overwrite whatever another studio had
    // just saved there.
    const { result } = renderHook(() => useSaveSiteStyle());

    await act(async () => {
      await result.current.save("tokens", { tokens: [] });
    });

    expect(writes).toHaveLength(1);
    expect(Object.keys(writes[0] ?? {})).toEqual(["tokens"]);
  });

  it("writes the breakpoints through Settings' route, and reads the document again", async () => {
    // The one write the site style lets change them; the Single's own update
    // would be refused.
    const { result } = renderHook(() => useSaveSiteStyle());
    const set = {
      viewport: [{ id: "tablet", label: "Tablet", maxWidth: 900 }],
      container: [],
    };

    let verdict;
    await act(async () => {
      verdict = await result.current.save("breakpoints", set);
    });

    expect(verdict).toEqual({ saved: true, issues: {} });
    expect(writes).toEqual([]);
    expect(routeWrites).toEqual([
      {
        plugin: "@nextlyhq/plugin-page-builder",
        path: "/site/breakpoints",
        body: { breakpoints: set },
        // Unload-safe, as every site style write is: the browser finishes it
        // if the page goes before it answers.
        keepalive: true,
      },
    ]);
    expect(refetches).toBe(1);
  });

  it("sends every other section to the Single, not the route", async () => {
    const { result } = renderHook(() => useSaveSiteStyle());
    await act(async () => {
      await result.current.save("fonts", []);
    });
    expect(routeWrites).toEqual([]);
    expect(writes).toEqual([{ fonts: [] }]);
    // Nothing invalidates the route's read for a Single write, so the writer
    // asks it again, or the canvas would keep drawing the old style.
    expect(refetches).toBe(1);
  });

  it("serializes against the other studios through one mutation scope", () => {
    // Four surfaces own four fields of one record. Without a shared scope their
    // saves run in parallel and their cache updates interleave, so the last one
    // to land decides what every panel is looking at.
    renderHook(() => useSaveSiteStyle());

    expect(writeOptions?.scopeId).toBe("site-style");
  });

  it("reports a REJECTED write as a refusal rather than letting it throw", async () => {
    // A refusal REJECTS by the time a browser sees it, so the whole result has
    // to be built from the rejected path rather than from a returned envelope.
    //
    // Every other link is proven where it lives: that the service refuses is
    // asserted in `__tests__/site-style-section-write.integration.test.ts`
    // against three dialects, that a non-2xx becomes a thrown `ApiError` is
    // asserted in the admin's own `fetcher.response-shape.test.ts`, and that
    // the payload is read by `path` rather than the service envelope's `field`
    // is asserted against `validationIssues` itself.
    writeBehaviour = () => Promise.reject(new Error("Validation failed."));
    issuesAnswer = [
      {
        path: "breakpoints",
        code: "CUSTOM",
        message: "breakpoints.viewport[0] is not a breakpoint.",
      },
    ];
    const { result } = renderHook(() => useSaveSiteStyle());

    let verdict;
    await act(async () => {
      verdict = await result.current.save("breakpoints", { viewport: [] });
    });

    expect(verdict).toEqual({
      saved: false,
      issues: {
        breakpoints: "breakpoints.viewport[0] is not a breakpoint.",
      },
    });
  });

  it("drops an issue with nothing to attach it to, or nothing to say", async () => {
    // The requirement this module adds on top of the extractor. `path` and
    // `message` are both optional over the wire, and keeping a half-formed
    // issue would key a message under `undefined` or show the word `undefined`
    // against a section — so an issue missing either is not a message this
    // surface can display, and the section names itself instead.
    writeBehaviour = () => Promise.reject(new Error("Validation failed."));
    issuesAnswer = [
      { path: "tokens", code: "CUSTOM" },
      { code: "CUSTOM", message: "Something was wrong somewhere." },
    ];
    const { result } = renderHook(() => useSaveSiteStyle());

    let verdict: { saved: boolean; issues: Record<string, string> } | undefined;
    await act(async () => {
      verdict = (await result.current.save("tokens", {})) as {
        saved: boolean;
        issues: Record<string, string>;
      };
    });

    expect(verdict?.saved).toBe(false);
    expect(verdict?.issues).toEqual({ tokens: "Validation failed." });
  });

  it("names the section itself when a rejection carries no per-path detail", async () => {
    // A refusal with nothing readable in it is still a refusal. Answering
    // `saved: true` because the payload could not be parsed would tell an
    // author their work is stored when it is not.
    writeBehaviour = () => Promise.reject(new Error("Network request failed"));
    const { result } = renderHook(() => useSaveSiteStyle());

    let verdict: { saved: boolean; issues: Record<string, string> } | undefined;
    await act(async () => {
      verdict = (await result.current.save("tokens", {})) as {
        saved: boolean;
        issues: Record<string, string>;
      };
    });

    expect(verdict?.saved).toBe(false);
    expect(verdict?.issues).toEqual({ tokens: "Network request failed" });
  });

  it("treats a resolved write as a save", async () => {
    // Success resolves with the document itself — `singleApi.updateDocument`
    // returns `result.item` — so there is no envelope to inspect and nothing
    // that should read as a failure.
    writeBehaviour = async () => ({ id: "1", tokens: {} });
    const { result } = renderHook(() => useSaveSiteStyle());

    let verdict: { saved: boolean } | undefined;
    await act(async () => {
      verdict = (await result.current.save("tokens", {})) as { saved: boolean };
    });

    expect(verdict?.saved).toBe(true);
  });
});

describe("a save inside the editor, as a step of its history", () => {
  type Step = {
    undo: () => Promise<{ stored: boolean }>;
    redo: () => Promise<{ stored: boolean }>;
  };

  /** The editor's side: what was recorded, and what each section last held. */
  function editorHistory() {
    const steps: Step[] = [];
    const value = {
      record: (step: Step) => {
        steps.push(step);
        return () => {
          steps.splice(steps.indexOf(step), 1);
        };
      },
      settled: new Map(),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SiteStyleHistoryContext.Provider value={value}>
        {children}
      </SiteStyleHistoryContext.Provider>
    );
    return { steps, wrapper };
  }

  it("records a step that writes the section back to what was stored, and forward again", async () => {
    readAnswer = {
      data: { tokens: { tokens: [{ name: "brand", kind: "color" }] } },
      isPending: false,
      error: null,
    };
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });

    await act(async () => {
      await result.current.save("tokens", { tokens: [] });
    });
    expect(steps).toHaveLength(1);

    let undone: { stored: boolean } | undefined;
    await act(async () => {
      undone = await steps[0]?.undo();
    });
    expect(undone?.stored).toBe(true);
    expect(writes.at(-1)).toEqual({
      tokens: { tokens: [{ name: "brand", kind: "color" }] },
    });

    await act(async () => {
      await steps[0]?.redo();
    });
    expect(writes.at(-1)).toEqual({ tokens: { tokens: [] } });
  });

  it("undoes a first write to a section by clearing it", async () => {
    // Nothing was stored: taking the change back stores nothing again, so the
    // site's own defaults show through.
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    await act(async () => {
      await result.current.save("classes", [{ id: "c1", slug: "card" }]);
    });
    await act(async () => {
      await steps[0]?.undo();
    });
    expect(writes.at(-1)).toEqual({ classes: null });
  });

  it("builds each step on the write before it, not on a read that has not caught up", async () => {
    // Two saves before the read refreshes: undoing the second must return
    // the section to the first, not to what the stale read still holds.
    readAnswer = { data: { classes: [] }, isPending: false, error: null };
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    const first = [{ id: "c1", slug: "card" }];
    const second = [...first, { id: "c2", slug: "hero" }];
    await act(async () => {
      await result.current.save("classes", first);
      await result.current.save("classes", second);
    });
    await act(async () => {
      await steps[1]?.undo();
    });
    expect(writes.at(-1)).toEqual({ classes: first });
  });

  it("records nothing for a refused save", async () => {
    writeBehaviour = async () => {
      throw new Error("refused");
    };
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    await act(async () => {
      await result.current.save("tokens", { tokens: [] });
    });
    expect(steps).toEqual([]);
  });

  it("answers false when the write taking the change back is refused", async () => {
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    await act(async () => {
      await result.current.save("tokens", { tokens: [] });
    });
    writeBehaviour = async () => {
      throw new Error("refused");
    };
    let undone: { stored: boolean } | undefined;
    await act(async () => {
      undone = await steps[0]?.undo();
    });
    expect(undone?.stored).toBe(false);
  });

  it("records nothing outside an editor", async () => {
    // The admin's own screens save without a history to join.
    const { result } = renderHook(() => useSaveSiteStyle());
    await act(async () => {
      await result.current.save("tokens", { tokens: [] });
    });
    expect(writes).toHaveLength(1);
  });

  it("builds each step on the save before it, even while that save is still in flight", async () => {
    // The studios save without waiting, so two edits can both be in flight.
    readAnswer = { data: { classes: [] }, isPending: false, error: null };
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    const first = [{ id: "c1", slug: "card" }];
    const second = [...first, { id: "c2", slug: "hero" }];
    await act(async () => {
      await Promise.all([
        result.current.save("classes", first),
        result.current.save("classes", second),
      ]);
    });
    await act(async () => {
      await steps[1]?.undo();
    });
    expect(writes.at(-1)).toEqual({ classes: first });
  });

  it("takes its place in the history when the change is made, not when it is stored", async () => {
    // A page edit made while the save is in flight comes after it.
    let land: (value: unknown) => void = () => {};
    writeBehaviour = () =>
      new Promise(resolve => {
        land = resolve;
      });
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = result.current.save("tokens", { tokens: [] });
    });
    expect(steps).toHaveLength(1);
    // The write starts once the writes before it have answered.
    await waitFor(() => expect(writes).toHaveLength(1));
    await act(async () => {
      land({ id: "1" });
      await saving;
    });
    expect(steps).toHaveLength(1);
  });

  it("withdraws the step it recorded when the save is refused", async () => {
    let refuse: (reason: unknown) => void = () => {};
    writeBehaviour = () =>
      new Promise((_, reject) => {
        refuse = reject;
      });
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = result.current.save("tokens", { tokens: [] });
    });
    expect(steps).toHaveLength(1);
    await waitFor(() => expect(writes).toHaveLength(1));
    await act(async () => {
      refuse(new Error("refused"));
      await saving;
    });
    expect(steps).toEqual([]);
  });

  it("builds on the newest save still in flight when an older one lands", async () => {
    // A and B are in flight; A lands, then C is made while B is still
    // pending. Undoing C must return the section to B, not to A.
    readAnswer = { data: { classes: [] }, isPending: false, error: null };
    const pending: Array<(value: unknown) => void> = [];
    writeBehaviour = () =>
      new Promise(resolve => {
        pending.push(resolve);
      });
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    const a = [{ id: "a", slug: "a" }];
    const b = [...a, { id: "b", slug: "b" }];
    const c = [...b, { id: "c", slug: "c" }];
    let saves: Promise<unknown>[] = [];
    act(() => {
      saves = [
        result.current.save("classes", a),
        result.current.save("classes", b),
      ];
    });
    // Writes go one at a time: A's lands, then B's starts and stays pending.
    await waitFor(() => expect(pending).toHaveLength(1));
    await act(async () => {
      pending[0]?.({ id: "1" });
      await saves[0];
    });
    await waitFor(() => expect(pending).toHaveLength(2));
    act(() => {
      saves.push(result.current.save("classes", c));
    });
    writeBehaviour = async () => ({ id: "1" });
    await act(async () => {
      pending[1]?.({ id: "1" });
      await Promise.all(saves);
    });
    await act(async () => {
      await steps[2]?.undo();
    });
    expect(writes.at(-1)).toEqual({ classes: b });
  });

  it("undoes a later save to what was stored, when the save before it was refused", async () => {
    // A is refused and B is stored: what stood before B is the section from
    // before A, so undoing B must not store the refused A after all.
    readAnswer = { data: { classes: [] }, isPending: false, error: null };
    const answers: Array<{
      ok: (v: unknown) => void;
      no: (r: unknown) => void;
    }> = [];
    writeBehaviour = () =>
      new Promise((ok, no) => {
        answers.push({ ok, no });
      });
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    const a = [{ id: "a", slug: "a" }];
    const b = [{ id: "b", slug: "b" }];
    let saves: Promise<unknown>[] = [];
    act(() => {
      saves = [
        result.current.save("classes", a),
        result.current.save("classes", b),
      ];
    });
    await waitFor(() => expect(answers).toHaveLength(1));
    writeBehaviour = async () => ({ id: "1" });
    await act(async () => {
      answers[0]?.no(new Error("refused"));
      await Promise.all(saves);
    });
    expect(steps).toHaveLength(1);
    await act(async () => {
      await steps[0]?.undo();
    });
    expect(writes.at(-1)).toEqual({ classes: [] });
  });

  it("hands the storing gate a correction back to the stored value, after a refusal", async () => {
    // A refused save leaves the form's gate holding a refusal. Typing the
    // stored value back is a save like any other to the gate: tracked, so
    // the gate's latest word on the section is that it saved, and Save works.
    readAnswer = { data: { classes: [] }, isPending: false, error: null };
    const { wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    writeBehaviour = async () => {
      throw new Error("refused");
    };
    await act(async () => {
      await result.current.save("classes", [{ id: "a", slug: "a" }]);
    });
    const refused = tracked.length;
    expect(refused).toBeGreaterThan(0);

    writeBehaviour = async () => ({ id: "1" });
    await act(async () => {
      await result.current.save("classes", []);
    });
    expect(tracked.length).toBe(refused + 1);
    await expect(tracked.at(-1)?.settled).resolves.toBeUndefined();
  });

  it("records no step for a save that leaves the section as it was", async () => {
    // Pressing Save on an unchanged set changes nothing: no Undo to take,
    // and the redo branch is left alone.
    readAnswer = {
      data: { classes: [{ id: "a", slug: "a" }] },
      isPending: false,
      error: null,
    };
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    await act(async () => {
      await result.current.save("classes", [{ id: "a", slug: "a" }]);
    });
    expect(steps).toEqual([]);
  });

  it("builds on a newer read once its own saves have settled", async () => {
    // Another tab changes the section after this editor's save: the next
    // step must take back to that, not to this editor's older value.
    readAnswer = { data: { classes: [] }, isPending: false, error: null };
    const { steps, wrapper } = editorHistory();
    const { result, rerender } = renderHook(() => useSaveSiteStyle(), {
      wrapper,
    });
    const mine = [{ id: "a", slug: "a" }];
    const theirs = [{ id: "t", slug: "theirs" }];
    await act(async () => {
      await result.current.save("classes", mine);
    });
    readAnswer = { data: { classes: theirs }, isPending: false, error: null };
    rerender();
    await act(async () => {
      await result.current.save("classes", [...theirs, { id: "b", slug: "b" }]);
    });
    await act(async () => {
      await steps[1]?.undo();
    });
    expect(writes.at(-1)).toEqual({ classes: theirs });
  });

  it("drops an undo and redo queued behind a save that is then refused", async () => {
    // Undone and redone while the save was in flight: once it is refused,
    // neither may store anything, or a change would land with no step left
    // to take it back.
    let refuse: (reason: unknown) => void = () => {};
    writeBehaviour = () =>
      new Promise((_, no) => {
        refuse = no;
      });
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    let saving: Promise<unknown> = Promise.resolve();
    act(() => {
      saving = result.current.save("tokens", { tokens: [] });
    });
    const [step] = steps;
    let undoing: Promise<unknown> = Promise.resolve();
    let redoing: Promise<unknown> = Promise.resolve();
    act(() => {
      undoing = step?.undo() ?? undoing;
      redoing = step?.redo() ?? redoing;
    });
    await waitFor(() => expect(writes).toHaveLength(1));
    writeBehaviour = async () => ({ id: "1" });
    await act(async () => {
      refuse(new Error("refused"));
      await Promise.all([saving, undoing, redoing]);
    });
    expect(writes).toHaveLength(1);
  });
});

describe("a save held for the author's pause", () => {
  type Step = {
    undo: () => Promise<{ stored: boolean }>;
    redo: () => Promise<{ stored: boolean }>;
  };

  function editorHistory() {
    const steps: Step[] = [];
    const value = {
      record: (step: Step) => {
        steps.push(step);
        return () => {
          steps.splice(steps.indexOf(step), 1);
        };
      },
      settled: new Map(),
      preview: vi.fn(),
    };
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <SiteStyleHistoryContext.Provider value={value}>
        {children}
      </SiteStyleHistoryContext.Provider>
    );
    return { steps, value, wrapper };
  }

  const set = (n: number) => ({ tokens: [{ name: `brand-${String(n)}` }] });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes a burst of saves once, as one step, after the pause", async () => {
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    const answers: Promise<unknown>[] = [];
    act(() => {
      for (let n = 1; n <= 10; n += 1) {
        answers.push(result.current.save("tokens", set(n), { hold: true }));
      }
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SITE_STYLE_PAUSE_MS - 1);
    });
    expect(writes).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    // The last value only, once, and one step to take the whole burst back.
    expect(writes).toEqual([{ tokens: set(10) }]);
    expect(steps).toHaveLength(1);
    // Every save of the burst answers with the write that stored it.
    expect(await Promise.all(answers)).toEqual(
      answers.map(() => ({ saved: true, issues: {} }))
    );

    await act(async () => {
      await steps[0]?.undo();
    });
    expect(writes.at(-1)).toEqual({ tokens: null });
    await act(async () => {
      await steps[0]?.redo();
    });
    expect(writes.at(-1)).toEqual({ tokens: set(10) });
  });

  it("waits again for each save, and while the author is still at work", async () => {
    const { value, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    act(() => {
      void result.current.save("tokens", set(1), { hold: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    act(() => {
      void result.current.save("tokens", set(2), { hold: true });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    // Typing in a field, with nothing committed yet, is still work.
    act(() => extendHeldSiteStyle(value));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(500);
    });
    expect(writes).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SITE_STYLE_PAUSE_MS);
    });
    expect(writes).toEqual([{ tokens: set(2) }]);
  });

  it("writes at once when released, without waiting for the pause", async () => {
    const { steps, value, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    act(() => {
      void result.current.save("tokens", set(1), { hold: true });
      void result.current.save("tokens", set(2), { hold: true });
    });
    await act(async () => {
      await releaseHeldSiteStyle(value);
    });
    expect(writes).toEqual([{ tokens: set(2) }]);
    expect(steps).toHaveLength(1);
    // Nothing is left to write when the pause would have ended.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SITE_STYLE_PAUSE_MS * 2);
    });
    expect(writes).toHaveLength(1);
  });

  it("writes a held change before a save that is not held, as the same write", async () => {
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    act(() => {
      void result.current.save("tokens", set(1), { hold: true });
    });
    await act(async () => {
      await result.current.save("tokens", set(2));
    });
    expect(writes).toEqual([{ tokens: set(2) }]);
    expect(steps).toHaveLength(1);
  });

  it("draws each held value, and says how the write that stores it went", async () => {
    const { value, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    act(() => {
      void result.current.save("tokens", set(1), { hold: true });
    });
    // Joined by a save that is not held: what is drawn is what is written.
    await act(async () => {
      await result.current.save("tokens", set(2));
    });
    expect(value.preview.mock.calls).toEqual([
      ["tokens", set(1), "held"],
      ["tokens", set(2), "held"],
      ["tokens", set(2), "stored"],
    ]);
  });

  it("draws nothing for a held save that changes nothing, which is not held", async () => {
    readAnswer = {
      data: { tokens: set(1) },
      isPending: false,
      error: null,
    };
    const { value, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    await act(async () => {
      await result.current.save("tokens", set(1), { hold: true });
    });
    expect(value.preview).not.toHaveBeenCalled();
    expect(writes).toEqual([{ tokens: set(1) }]);
  });

  it("writes a held change before undoing it", async () => {
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    act(() => {
      void result.current.save("tokens", set(1), { hold: true });
    });
    await act(async () => {
      await steps[0]?.undo();
    });
    expect(writes).toEqual([{ tokens: set(1) }, { tokens: null }]);
  });

  it("tells every save of the burst why its write was refused, and keeps no step", async () => {
    writeBehaviour = () => Promise.reject(new Error("Validation failed."));
    issuesAnswer = [
      { path: "tokens", code: "CUSTOM", message: "That value is refused." },
    ];
    const { steps, wrapper } = editorHistory();
    const { result } = renderHook(() => useSaveSiteStyle(), { wrapper });
    const answers: Promise<unknown>[] = [];
    act(() => {
      answers.push(result.current.save("tokens", set(1), { hold: true }));
      answers.push(result.current.save("tokens", set(2), { hold: true }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SITE_STYLE_PAUSE_MS);
    });
    const refused = {
      saved: false,
      issues: { tokens: "That value is refused." },
    };
    expect(await Promise.all(answers)).toEqual([refused, refused]);
    expect(writes).toHaveLength(1);
    expect(steps).toEqual([]);
  });
});

describe("adding a catalogue font", () => {
  const LORA = {
    id: "lora",
    weights: [400, 700],
    styles: ["normal" as const],
    subsets: ["latin"],
  };

  it("asks the server's route to add it, then reads the style again", async () => {
    const { result } = renderHook(() => useFontCatalogueClient());
    let refusal: string | undefined = "not answered";
    await act(async () => {
      refusal = await result.current.add(LORA);
    });
    expect(refusal).toBeUndefined();
    expect(writes).toEqual([]);
    expect(routeWrites).toEqual([
      {
        plugin: "@nextlyhq/plugin-page-builder",
        path: "/site/fonts",
        body: LORA,
      },
    ]);
    expect(refetches).toBe(1);
  });

  it("says why the server refused, and reads nothing again", async () => {
    writeBehaviour = async () => {
      throw new Error(
        "Google Fonts didn\u2019t answer in time. Nothing was added; try again."
      );
    };
    const { result } = renderHook(() => useFontCatalogueClient());
    let refusal: string | undefined;
    await act(async () => {
      refusal = await result.current.add(LORA);
    });
    expect(refusal).toContain("didn\u2019t answer in time");
    expect(refetches).toBe(0);
  });
});
