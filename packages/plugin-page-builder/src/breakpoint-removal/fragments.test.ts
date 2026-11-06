/**
 * Keeping what a breakpoint removal takes out, through the real walk: each
 * strip's fragment is kept before its write, a strip whose fragment cannot be
 * kept is not made, a write with nothing kept for it is refused, and a write
 * retried after a race keeps the fragment of the value it finally strips.
 *
 * @module breakpoint-removal/fragments.test
 */
import { describe, expect, it } from "vitest";

import type { HostAddress } from "../host-rewrite/contract";
import type { RunPhase } from "../host-rewrite/fence";
import type { HostState } from "../host-rewrite/progress";
import {
  rewriteHosts,
  type HostWrite,
  type RewriteDeps,
  type WriteResult,
} from "../host-rewrite/rewrite";
import { storedHash } from "../host-rewrite/stored-hash";

import { fragmentCapture, type FragmentRow } from "./fragments";
import { stripBreakpointsStep, type Removal } from "./strip";

const removingMobile: Removal = {
  ids: new Set(["mobile"]),
  before: {
    viewport: [
      { id: "tablet", label: "Tablet", maxWidth: 900 },
      { id: "mobile", label: "Mobile", maxWidth: 600 },
    ],
    container: [],
  },
};

/** A page whose text is blue at Mobile alone, `color` its Mobile colour. */
function page(color: string) {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "t1",
        type: "core/text",
        version: 1,
        props: { text: "Hello" },
        styles: { base: { base: { color: "#000" }, mobile: { color } } },
      },
    ],
  };
}

const HOST: HostAddress = {
  kind: "collection",
  slug: "pages",
  id: "p1",
  path: ["content"],
};

/**
 * One page, live, in memory, walked by the real walk with the capture's step
 * and writer; `keep` and `write` are what the test makes of them, and `log`
 * says in which order they ran.
 */
function walkOne(options: {
  keep: (row: FragmentRow) => Promise<void>;
  /** Before each write lands; answering `changed` refuses it as a race. */
  beforeWrite?: (attempt: number) => WriteResult | undefined;
}) {
  let stored: unknown = page("#1155cc");
  const log: string[] = [];
  let phase: RunPhase = "converting";
  let cursor: string | null = null;
  const progress = new Map<string, HostState>();
  let attempt = 0;
  // The rows kept and not discarded, by id.
  const alive = new Map<string, FragmentRow>();
  let ids = 0;
  const capture = fragmentCapture(
    {
      keep: async row => {
        log.push("keep");
        await options.keep(row);
        const id = `row-${String((ids += 1))}`;
        alive.set(id, row);
        return id;
      },
      discard: async id => {
        log.push("discard");
        alive.delete(id);
      },
    },
    "run-1"
  );
  const write = async (write: HostWrite): Promise<WriteResult> => {
    attempt += 1;
    const refused = options.beforeWrite?.(attempt);
    if (refused !== undefined) return refused;
    if ((await storedHash(stored)) !== write.expected.hash) {
      return { kind: "changed" };
    }
    log.push("write");
    stored = write.value;
    return { kind: "written" };
  };
  const deps: RewriteDeps = {
    fence: {
      runById: async () => ({ id: "run-1", phase, cursor }),
      advance: async (_id, from, to, next) => {
        if (phase !== from) return false;
        phase = to;
        cursor = next;
        return true;
      },
    },
    progress: {
      record: async (_run, key, state) => {
        progress.set(key, state);
      },
      all: async () =>
        [...progress].map(([documentKey, state]) => ({
          documentKey,
          state,
          reason: null,
        })),
      reopenLeft: async () => false,
    },
    source: {
      async *documents(from) {
        if (from === null) {
          yield { key: "doc:p1", hosts: [{ host: HOST, access: "write" }] };
        }
      },
      cursorOf: () => "p1",
      hinted: async () => [],
      outside: async () => [],
    },
    read: async () => ({
      published: { kind: "value", value: structuredClone(stored) },
      draft: null,
      liveState: "published",
    }),
    write: capture.writer(write),
  };
  return {
    walk: () =>
      rewriteHosts(deps, {
        runId: "run-1",
        step: stripBreakpointsStep(removingMobile, capture.remember),
      }),
    stored: () => stored,
    alive: () => [...alive.values()],
    log,
    setStored: (value: unknown) => {
      stored = value;
    },
  };
}

describe("keeping what a removal takes out", () => {
  it("keeps each strip's fragment, then makes the write", async () => {
    const kept: FragmentRow[] = [];
    const site = walkOne({
      keep: async row => {
        kept.push(row);
      },
    });
    await site.walk();
    expect(site.log).toEqual(["keep", "write"]);
    expect(kept).toEqual([
      {
        runId: "run-1",
        host: HOST,
        form: "published",
        fragment: {
          nodes: { t1: { styles: { base: { mobile: { color: "#1155cc" } } } } },
        },
      },
    ]);
    expect(site.stored()).toEqual({
      ...page("#1155cc"),
      nodes: [
        {
          ...page("#1155cc").nodes[0],
          styles: { base: { base: { color: "#000" } } },
        },
      ],
    });
  });

  it("does not strip a value whose fragment could not be kept", async () => {
    const site = walkOne({
      keep: async () => {
        throw new Error("the fragments table refused the row");
      },
    });
    await expect(site.walk()).rejects.toThrow("refused the row");
    expect(site.log).toEqual(["keep"]);
    // Still holding Mobile's colour: nothing was stripped.
    expect(site.stored()).toEqual(page("#1155cc"));
  });

  it("keeps the fragment of the value it finally strips when a race retries the write", async () => {
    const kept: FragmentRow[] = [];
    let site: ReturnType<typeof walkOne> | undefined;
    site = walkOne({
      keep: async row => {
        kept.push(row);
      },
      // Someone saves another Mobile colour before the first write lands.
      beforeWrite: attempt => {
        if (attempt !== 1) return undefined;
        site?.setStored(page("#ff0000"));
        return { kind: "changed" };
      },
    });
    await site.walk();
    expect(kept.map(row => row.fragment)).toEqual([
      { nodes: { t1: { styles: { base: { mobile: { color: "#1155cc" } } } } } },
      { nodes: { t1: { styles: { base: { mobile: { color: "#ff0000" } } } } } },
    ]);
    expect(site.log).toEqual(["keep", "discard", "keep", "write"]);
    // Only the strip that was made is on record.
    expect(site.alive().map(row => row.fragment)).toEqual([
      { nodes: { t1: { styles: { base: { mobile: { color: "#ff0000" } } } } } },
    ]);
  });

  it("keeps nothing for a value someone else cleared before the strip's write landed", async () => {
    let site: ReturnType<typeof walkOne> | undefined;
    site = walkOne({
      keep: async () => {},
      // The author takes Mobile's colour out themselves meanwhile.
      beforeWrite: attempt => {
        if (attempt !== 1) return undefined;
        site?.setStored({
          ...page("#000"),
          nodes: [
            {
              ...page("#000").nodes[0],
              styles: { base: { base: { color: "#000" } } },
            },
          ],
        });
        return { kind: "changed" };
      },
    });
    await site.walk();
    expect(site.log).toEqual(["keep", "discard"]);
    // No row to put their colour back from.
    expect(site.alive()).toEqual([]);
  });

  it("refuses a write it has kept nothing for", async () => {
    const written: HostWrite[] = [];
    const capture = fragmentCapture(
      { keep: async () => "row-1", discard: async () => {} },
      "run-1"
    );
    const writer = capture.writer(async write => {
      written.push(write);
      return { kind: "written" };
    });
    await expect(
      writer({
        host: HOST,
        value: page("#000"),
        mode: "save",
        expected: { form: "draft", hash: "h" },
      })
    ).rejects.toMatchObject({ code: "INTERNAL_ERROR" });
    expect(written).toEqual([]);
  });
});
