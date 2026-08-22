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
import { renderHook, act } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const writes: Record<string, unknown>[] = [];
/** The options the write hook was constructed with, for the scope assertion. */
let writeOptions: { scopeId?: string } | undefined;

vi.mock("@nextlyhq/plugin-sdk/admin", () => ({
  useSingleDocument: () => readAnswer,
  useUpdateSingleDocument: (
    _slug: string,
    _locale?: string,
    options?: { scopeId?: string }
  ) => {
    writeOptions = options;
    return {
      mutateAsync: async (data: Record<string, unknown>) => {
        writes.push(data);
        return writeBehaviour();
      },
      isPending: false,
    };
  },
}));

const { useSaveSiteStyle, useSiteStyle } = await import("./site-style-client");

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
  writes.length = 0;
  writeOptions = undefined;
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

  it("serializes against the other studios through one mutation scope", () => {
    // Four surfaces own four fields of one record. Without a shared scope their
    // saves run in parallel and their cache updates interleave, so the last one
    // to land decides what every panel is looking at.
    renderHook(() => useSaveSiteStyle());

    expect(writeOptions?.scopeId).toBe("site-style");
  });

  it("reports a REJECTED write as a refusal rather than letting it throw", async () => {
    // The shape a refusal actually has by the time a browser sees it. Keyed by
    // `path`, which is what `ValidationPublicData` carries and what
    // `parseApiError` puts on the thrown error's `data` — NOT the `field` the
    // service-level envelope uses. Reading the service's spelling here would
    // find nothing and report a refused write as saved.
    //
    // The other links are proven where they live: that the service refuses is
    // asserted in `__tests__/site-style-section-write.integration.test.ts`
    // against three dialects, and that a non-2xx becomes a thrown `ApiError` is
    // asserted in the admin's own `fetcher.response-shape.test.ts`.
    writeBehaviour = () =>
      Promise.reject(
        Object.assign(new Error("Validation failed."), {
          status: 400,
          code: "VALIDATION_ERROR",
          data: {
            errors: [
              {
                path: "breakpoints",
                code: "CUSTOM",
                message: "breakpoints.viewport[0] is not a breakpoint.",
              },
            ],
          },
        })
      );
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
