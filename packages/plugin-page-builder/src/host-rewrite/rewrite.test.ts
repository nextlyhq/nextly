/**
 * The walker over in-memory hosts: the step contract, the compare-and-swap
 * retry, resuming after a budget or a crash, and the final walk that trusts no
 * progress row.
 *
 * The fakes keep one stored value per host and form, and the fake writer does
 * what the real write's validation does: it refuses a write whose expected
 * hash is not the hash of what is stored now.
 */
import { storedValueHash } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import type { HostAddress, HostStep, LeftHost, StepOutcome } from "./contract";
import type { DeletionRun, RunPhase } from "./fence";
import type { HostState } from "./progress";
import {
  rewriteHosts,
  type CopiesResult,
  type HostAccess,
  type HostCopiesWrite,
  type HostDocument,
  type HostWrite,
  type RewriteDeps,
  type WriteResult,
} from "./rewrite";

/** A stored value the test step understands: how many copies it still holds. */
interface Value {
  copies: number;
  edit?: string;
  refuse?: boolean;
}

/** Converts every copy; refuses a value marked so; leaves the rest. */
const step: HostStep = (doc): StepOutcome => {
  const value = doc as Value;
  if (value.refuse === true) return { kind: "refuse", reason: "marked" };
  if (value.copies === 0) return { kind: "unchanged" };
  return { kind: "rewritten", value: { ...value, copies: 0 } };
};

interface StoredHost {
  published: Value | null;
  draft: Value | null;
  live: boolean;
  /** The public state a live row is stored in. */
  state: string;
  access: HostAccess;
}

/** Whether a host still holds what a write was computed from. */
async function stillAsRead(
  held: StoredHost,
  write: HostWrite
): Promise<boolean> {
  const now =
    write.expected.form === "draft" && held.draft !== null
      ? held.draft
      : held.published;
  const stored =
    now === null
      ? ({ kind: "absent" } as const)
      : ({ kind: "value", value: now } as const);
  return (await storedValueHash(stored)) === write.expected.hash;
}

/** Store a write where it lands: live for a publish or a row with no draft. */
function store(held: StoredHost, write: HostWrite): void {
  const value = write.value as Value;
  if (write.mode === "publish" || held.draft === null) held.published = value;
  else held.draft = value;
}

/** A site of hosts, one per document, keyed by document id. */
function site(hosts: Record<string, Partial<StoredHost>>) {
  const stored = new Map<string, StoredHost>(
    Object.entries(hosts).map(([id, host]) => [
      id,
      {
        published: host.published ?? null,
        draft: host.draft ?? null,
        live: host.live ?? false,
        state: host.state ?? "published",
        access: host.access ?? "write",
      },
    ])
  );
  const ids = [...stored.keys()].sort();
  const addressOf = (id: string): HostAddress => ({
    kind: "collection",
    slug: "pages",
    id,
    path: ["content"],
  });
  const documentOf = (id: string): HostDocument => ({
    key: `doc:${id}`,
    hosts: [{ host: addressOf(id), access: stored.get(id)?.access ?? "write" }],
  });

  let run: DeletionRun = {
    id: "run-1",
    componentId: "card",
    startedBy: "u1",
    phase: "converting",
    cursor: null,
  };
  const progress = new Map<string, HostState>();
  const reasons = new Map<string, string | undefined>();
  const outside: LeftHost[] = [];
  const writes: HostWrite[] = [];
  const hooks = {
    /** Called before each write; may throw (a crash) or edit the host. */
    beforeWrite: (_write: HostWrite): void => undefined,
    /** Called after each read of a host. */
    afterRead: (_id: string): void => undefined,
    /** Called after each document the final walk finishes. */
    afterAdvance: (): void => undefined,
  };
  const denied = new Set<string>();

  const deps: RewriteDeps = {
    fence: {
      runById: async id => (id === run.id ? run : null),
      advance: async (_id, from: RunPhase, to: RunPhase, cursor) => {
        if (run.phase !== from) return false;
        run = { ...run, phase: to, cursor };
        hooks.afterAdvance();
        return true;
      },
    },
    progress: {
      record: async (_run, key, state, reason) => {
        progress.set(key, state);
        reasons.set(key, reason);
      },
      settledAmong: async (_run: string, keys: readonly string[]) =>
        new Set(
          keys.filter(key => {
            const state = progress.get(key);
            return state !== undefined && state !== "pending";
          })
        ),
      all: async () =>
        [...progress].map(([documentKey, state]) => ({
          documentKey,
          state,
          reason: reasons.get(documentKey) ?? null,
        })),
      reopenLeft: async () => {
        const left = [...progress].filter(([, state]) => state === "left");
        if (left.length === 0) return false;
        for (const [key] of left) progress.set(key, "pending");
        if (run.phase === "done")
          run = { ...run, phase: "converting", cursor: null };
        return true;
      },
    },
    source: {
      async *documents(cursor) {
        for (const id of ids) {
          if (cursor !== null && id <= cursor) continue;
          yield documentOf(id);
        }
      },
      cursorOf: document => document.hosts[0]?.host.id ?? "",
      hinted: async () => [],
      outside: async () => outside,
    },
    read: async host => {
      const held = stored.get(host.id ?? "");
      if (held === undefined) throw new Error("no such host");
      const read = {
        published:
          held.published === null
            ? ({ kind: "absent" } as const)
            : ({
                kind: "value",
                value: structuredClone(held.published),
              } as const),
        draft:
          held.draft === null
            ? null
            : ({ kind: "value", value: structuredClone(held.draft) } as const),
        liveState: held.live ? held.state : null,
      };
      hooks.afterRead(host.id ?? "");
      return read;
    },
    write: async (write): Promise<WriteResult> => {
      hooks.beforeWrite(write);
      // The write's own access gate, judging this entry.
      if (denied.has(write.host.id ?? "")) return { kind: "forbidden" };
      const held = stored.get(write.host.id ?? "");
      if (held === undefined) throw new Error("no such host");
      if (!(await stillAsRead(held, write))) return { kind: "changed" };
      writes.push(write);
      store(held, write);
      return { kind: "written" };
    },
  };

  return {
    deps,
    stored,
    progress,
    writes,
    hooks,
    denied,
    outside,
    run: () => run,
    setRun: (next: Partial<DeletionRun>) => {
      run = { ...run, ...next };
    },
  };
}

const args = { runId: "run-1", step };

/** Every host's live value, by id. */
function liveOf(s: ReturnType<typeof site>): Record<string, Value | null> {
  return Object.fromEntries(
    [...s.stored].map(([id, host]) => [id, host.published])
  );
}

describe("rewriting every host of a component", () => {
  it("rewrites every host, and the final walk then finds nothing to do", async () => {
    const s = site({
      a: { published: { copies: 1 } },
      b: { published: { copies: 2 } },
      c: { published: { copies: 0 } },
    });

    const report = await rewriteHosts(s.deps, args);

    expect(report.finished).toBe(true);
    expect(report.rewritten.map(host => host.id)).toEqual(["a", "b"]);
    expect(report.caughtByFinalWalk).toEqual([]);
    expect(liveOf(s)).toEqual({
      a: { copies: 0 },
      b: { copies: 0 },
      c: { copies: 0 },
    });
    expect(s.run().phase).toBe("done");
  });

  it("does not let a progress row claiming a host is done skip the final walk", async () => {
    const s = site({
      a: { published: { copies: 1 } },
      b: { published: { copies: 1 } },
    });
    // A row nobody's walk wrote: it claims `a` is finished.
    s.progress.set("doc:a", "unchanged");

    const report = await rewriteHosts(s.deps, args);

    expect(report.finished).toBe(true);
    expect(liveOf(s)).toEqual({ a: { copies: 0 }, b: { copies: 0 } });
    expect(report.caughtByFinalWalk.map(host => host.id)).toEqual(["a"]);
  });

  it("resumes after its budget without skipping or repeating a document", async () => {
    const s = site({
      a: { published: { copies: 1 } },
      b: { published: { copies: 1 } },
      c: { published: { copies: 1 } },
    });

    const first = await rewriteHosts(s.deps, { ...args, maxDocuments: 1 });
    expect(first.finished).toBe(false);
    expect(first.rewritten.map(host => host.id)).toEqual(["a"]);

    const second = await rewriteHosts(s.deps, args);
    expect(second.finished).toBe(true);
    expect(second.rewritten.map(host => host.id)).toEqual(["b", "c"]);
    // The converting walk did the work: the final walk found none left.
    expect(second.caughtByFinalWalk).toEqual([]);
    expect(s.writes).toHaveLength(3);
  });

  it("resumes after a crash mid-run without skipping the host it crashed on", async () => {
    const s = site({
      a: { published: { copies: 1 } },
      b: { published: { copies: 1 } },
      c: { published: { copies: 1 } },
    });
    let crashed = false;
    s.hooks.beforeWrite = write => {
      if (write.host.id === "b" && !crashed) {
        crashed = true;
        throw new Error("the process stopped");
      }
    };

    await expect(rewriteHosts(s.deps, args)).rejects.toThrow(
      "the process stopped"
    );
    const report = await rewriteHosts(s.deps, args);

    expect(report.finished).toBe(true);
    expect(liveOf(s)).toEqual({
      a: { copies: 0 },
      b: { copies: 0 },
      c: { copies: 0 },
    });
    expect(report.caughtByFinalWalk).toEqual([]);
  });

  it("resumes the final walk where it stopped", async () => {
    const s = site({
      a: { published: { copies: 0 } },
      b: { published: { copies: 0 } },
      c: { published: { copies: 0 } },
    });
    s.setRun({ phase: "final", cursor: "a" });
    const read: string[] = [];
    s.hooks.afterRead = id => read.push(id);

    const report = await rewriteHosts(s.deps, args);

    expect(report.finished).toBe(true);
    expect(read).toEqual(["b", "c"]);
  });

  it("stops the final walk when a write sends the run back to converting", async () => {
    const s = site({
      a: { published: { copies: 0 } },
      b: { published: { copies: 0 } },
    });
    s.setRun({ phase: "final", cursor: null });
    s.hooks.afterRead = id => {
      // A write re-queues a document while the final walk reads `a`.
      if (id === "a") s.setRun({ phase: "converting", cursor: null });
    };

    const report = await rewriteHosts(s.deps, args);

    expect(report.finished).toBe(false);
    expect(s.run().phase).toBe("converting");
  });

  it("reads a host again when it changed under the write, keeping the edit", async () => {
    const s = site({ a: { published: { copies: 1 } } });
    let edited = false;
    s.hooks.afterRead = id => {
      if (id !== "a" || edited) return;
      edited = true;
      // An author saves between the rewrite's read and its write.
      const held = s.stored.get("a");
      if (held !== undefined) held.published = { copies: 1, edit: "author" };
    };

    const report = await rewriteHosts(s.deps, args);

    expect(report.finished).toBe(true);
    expect(s.stored.get("a")?.published).toEqual({ copies: 0, edit: "author" });
  });

  it("leaves a host that keeps changing once its retries are spent", async () => {
    const s = site({ a: { published: { copies: 1 } } });
    let n = 0;
    s.hooks.afterRead = () => {
      n += 1;
      const held = s.stored.get("a");
      if (held !== undefined) held.published = { copies: 1, edit: String(n) };
    };

    const report = await rewriteHosts(s.deps, { ...args, maxAttempts: 2 });

    expect(report.left).toContainEqual(
      expect.objectContaining({ reason: "changed" })
    );
    expect(s.writes).toEqual([]);
  });

  it("publishes a live row with no pending draft, checked against the live form", async () => {
    const s = site({ a: { published: { copies: 1 }, live: true } });

    await rewriteHosts(s.deps, args);

    expect(s.writes[0]?.mode).toBe("publish");
    expect(s.writes[0]?.expected.form).toBe("published");
  });

  it("converts a pending draft and leaves its live row, reporting it", async () => {
    const s = site({
      a: {
        published: { copies: 1 },
        draft: { copies: 1, edit: "draft" },
        live: true,
      },
    });

    const report = await rewriteHosts(s.deps, args);

    expect(s.writes.map(write => [write.mode, write.expected.form])).toEqual([
      ["save", "draft"],
    ]);
    expect(s.stored.get("a")).toMatchObject({
      draft: { copies: 0, edit: "draft" },
      published: { copies: 1 },
    });
    expect(report.left).toContainEqual(
      expect.objectContaining({ reason: "pending-draft" })
    );
  });

  it("leaves a host the write's own gate refuses, and moves on", async () => {
    const s = site({
      a: { published: { copies: 1 } },
      b: { published: { copies: 1 } },
    });
    s.denied.add("a");

    const report = await rewriteHosts(s.deps, args);

    expect(report.left.map(left => [left.host.id, left.reason])).toContainEqual(
      ["a", "not-permitted"]
    );
    expect(s.stored.get("a")?.published).toEqual({ copies: 1 });
    expect(s.stored.get("b")?.published).toEqual({ copies: 0 });
  });

  it("asks no permission of its own: the write decides, even on a row a rule filters", async () => {
    // Nothing is refused before the write is attempted, so a host whose rule
    // admits this row is written rather than left on a collection-wide guess.
    const s = site({ a: { published: { copies: 1 }, live: true } });

    const report = await rewriteHosts(s.deps, args);

    expect(report.rewritten.map(host => host.id)).toEqual(["a"]);
  });

  it("gets past a host left for good when its budget is one document a call", async () => {
    const s = site({
      a: { published: { copies: 1, refuse: true } },
      b: { published: { copies: 1 } },
      c: { published: { copies: 1 } },
    });

    let calls = 0;
    let report = await rewriteHosts(s.deps, { ...args, maxDocuments: 1 });
    while (!report.finished && calls < 10) {
      calls += 1;
      report = await rewriteHosts(s.deps, { ...args, maxDocuments: 1 });
    }

    expect(report.finished).toBe(true);
    expect(s.stored.get("b")?.published).toEqual({ copies: 0 });
    expect(s.stored.get("c")?.published).toEqual({ copies: 0 });
  });

  it("publishes a live row again in the public state it was read in", async () => {
    const s = site({
      a: { published: { copies: 1 }, live: true, state: "featured" },
    });

    await rewriteHosts(s.deps, args);

    expect(s.writes[0]).toMatchObject({
      mode: "publish",
      publishAs: "featured",
    });
  });

  it("records what blocks it outside the walk before it is done", async () => {
    const s = site({ a: { published: { copies: 0 } } });
    s.outside.push({
      host: { kind: "collection", slug: "layouts", id: "l1", path: ["areas"] },
      reason: "layout",
      detail: "Main",
    });
    let recordedWhenDone: string | undefined;
    s.hooks.afterAdvance = () => {
      if (s.run().phase === "done") {
        recordedWhenDone = s.progress.get("collection\u001Flayouts\u001Fl1");
      }
    };

    const first = await rewriteHosts(s.deps, args);

    expect(first.finished).toBe(true);
    expect(recordedWhenDone).toBe("left");
  });

  it("reads a finished run's left hosts again when asked once more", async () => {
    const s = site({
      a: { published: { copies: 1 }, draft: { copies: 1 }, live: true },
    });
    const first = await rewriteHosts(s.deps, args);
    expect(first.left).toContainEqual(
      expect.objectContaining({ reason: "pending-draft" })
    );
    // The author publishes the converted draft.
    const held = s.stored.get("a");
    if (held !== undefined) {
      held.published = held.draft;
      held.draft = null;
    }

    const later = await rewriteHosts(s.deps, args);

    expect(later.finished).toBe(true);
    expect(later.left).toEqual([]);
    expect(s.progress.get("doc:a")).toBe("unchanged");
  });

  it("CONTROL: a finished run with nothing left reads nothing more", async () => {
    const s = site({ a: { published: { copies: 1 } } });
    await rewriteHosts(s.deps, args);
    const read: string[] = [];
    s.hooks.afterRead = id => read.push(id);

    const later = await rewriteHosts(s.deps, args);

    expect(later.finished).toBe(true);
    expect(read).toEqual([]);
  });

  it("leaves a host the step refuses, and one it cannot read", async () => {
    const s = site({ a: { published: { copies: 1, refuse: true } } });
    s.hooks.afterRead = id => {
      if (id === "a") throw new Error("read failed");
    };
    const unreadable = await rewriteHosts(s.deps, { ...args, dryRun: true });
    expect(unreadable.left).toContainEqual(
      expect.objectContaining({ reason: "unreadable" })
    );

    s.hooks.afterRead = () => undefined;
    const refused = await rewriteHosts(s.deps, args);
    expect(refused.left).toContainEqual(
      expect.objectContaining({ reason: "refused", detail: "marked" })
    );
    expect(s.writes).toEqual([]);
  });

  it("never writes a host it can read but not address", async () => {
    const s = site({
      a: { published: { copies: 1 }, access: "read" },
      b: { published: { copies: 0 }, access: "read" },
    });

    const report = await rewriteHosts(s.deps, args);

    expect(report.left.map(left => [left.host.id, left.reason])).toEqual([
      ["a", "unaddressable"],
      ["a", "unaddressable"],
    ]);
    expect(s.writes).toEqual([]);
    expect(report.unchanged.map(host => host.id)).toContain("b");
  });

  it("writes and records nothing on a dry run", async () => {
    const s = site({
      a: { published: { copies: 1 } },
      b: { published: { copies: 0 } },
    });

    const report = await rewriteHosts(s.deps, { ...args, dryRun: true });

    expect(report.rewritten.map(host => host.id)).toEqual(["a"]);
    expect(s.writes).toEqual([]);
    expect(s.progress.size).toBe(0);
    expect(s.run().phase).toBe("converting");
  });

  it("holds no write's body on a dry run that does not ask for them", async () => {
    const s = site({
      a: { published: { copies: 1 } },
      b: { published: { copies: 1 } },
    });

    const report = await rewriteHosts(s.deps, { ...args, dryRun: true });

    // The usage confirmation walks thousands of documents this way.
    expect(report.rewritten.map(host => host.id)).toEqual(["a", "b"]);
    expect(report.writes).toBeUndefined();
  });

  it("reports each write with its body on a dry run that asks for them", async () => {
    const s = site({
      a: { published: { copies: 1 } },
      b: { published: { copies: 0 } },
    });

    const report = await rewriteHosts(s.deps, {
      ...args,
      dryRun: true,
      plannedWrites: true,
    });

    expect(report.writes?.map(write => write.host.id)).toEqual(["a"]);
    expect(report.writes?.[0]?.value).toBeDefined();
    expect(s.writes).toEqual([]);
  });

  it("walks only the run it was given, never one opened in its place", async () => {
    const s = site({ a: { published: { copies: 1 } } });
    const read: string[] = [];
    s.hooks.afterRead = id => read.push(id);
    // The checked run was closed and another opened for the same component.
    s.setRun({ id: "run-2" });

    await expect(rewriteHosts(s.deps, args)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(read).toEqual([]);
    expect(s.writes).toEqual([]);
  });
});

describe("the version each host write carries", () => {
  // Each write is made from a read of its host, and carries that read's
  // version, so a save of the host in between refuses it.
  function withVersions(s: ReturnType<typeof site>) {
    const read = s.deps.read;
    Object.assign(s.deps, {
      read: async (host: Parameters<typeof read>[0]) => ({
        ...(await read(host)),
        rev: `v-${host.id ?? ""}`,
      }),
    });
  }

  it("writes a live row with the version its read gave", async () => {
    const s = site({ a: { published: { copies: 1 } } });
    withVersions(s);
    await rewriteHosts(s.deps, args);
    expect(s.writes.map(write => [write.host.id, write.rev])).toEqual([
      ["a", "v-a"],
    ]);
  });

  it("writes a pending draft with the version its read gave", async () => {
    const s = site({
      a: { published: { copies: 1 }, draft: { copies: 1 }, live: true },
    });
    withVersions(s);
    await rewriteHosts(s.deps, args);
    expect(s.writes.map(write => [write.expected.form, write.rev])).toEqual([
      ["draft", "v-a"],
    ]);
  });
});

describe("a pending draft rewritten with its live copy", () => {
  /**
   * A copies writer over `s`, as core's field rewrite: the version read is
   * given (`v1`), each stored copy takes the step's answer for its own value,
   * all or none, and a refusal or a save since the read is answered as the
   * rewrite answers it. Answers every copies write asked.
   */
  function withCopies(
    s: ReturnType<typeof site>,
    options: { forbidden?: boolean; changedTimes?: number; rev?: boolean } = {}
  ): HostCopiesWrite[] {
    const asked: HostCopiesWrite[] = [];
    let changed = options.changedTimes ?? 0;
    const read = s.deps.read;
    Object.assign(s.deps, {
      read: async (host: HostAddress) => ({
        ...(await read(host)),
        ...(options.rev === false ? {} : { rev: "v1" }),
      }),
      writeCopies: async (write: HostCopiesWrite): Promise<CopiesResult> => {
        asked.push(write);
        if (options.forbidden === true) return { kind: "forbidden" };
        if (changed > 0) {
          changed -= 1;
          return { kind: "changed" };
        }
        const held = s.stored.get(write.host.id ?? "");
        if (held === undefined) throw new Error("no such host");
        const next: Partial<Record<"published" | "draft", Value>> = {};
        for (const key of ["published", "draft"] as const) {
          const value = held[key];
          if (value === null) continue;
          const outcome = await write.step(value, {
            host: write.host,
            form: key === "published" ? write.liveForm : "draft",
          });
          if (outcome.kind === "refuse") {
            return { kind: "step-refused", detail: outcome.reason };
          }
          if (outcome.kind === "rewritten") next[key] = outcome.value as Value;
        }
        Object.assign(held, next);
        return { kind: "written" };
      },
    });
    return asked;
  }

  const both = () =>
    site({
      a: {
        published: { copies: 1 },
        draft: { copies: 2, edit: "draft" },
        live: true,
      },
    });

  it("rewrites the live copy and the draft in one write, each from its own value", async () => {
    const s = both();
    const asked = withCopies(s);

    const report = await rewriteHosts(s.deps, args);

    expect(report.finished).toBe(true);
    expect(report.rewritten.map(host => host.id)).toEqual(["a"]);
    expect(report.left).toEqual([]);
    // The live copy no longer holds the component, and the draft is still
    // the author's draft, converted.
    expect(s.stored.get("a")).toMatchObject({
      published: { copies: 0 },
      draft: { copies: 0, edit: "draft" },
      live: true,
    });
    // One rewrite, from the version read, and no single write.
    expect(asked[0]).toMatchObject({ rev: "v1", liveForm: "published" });
    expect(s.writes).toEqual([]);
  });

  it("converts the draft alone where the person may not make the rewrite, and leaves the live copy", async () => {
    const s = both();
    withCopies(s, { forbidden: true });

    const report = await rewriteHosts(s.deps, args);

    expect(s.writes.map(write => [write.mode, write.expected.form])).toEqual([
      ["save", "draft"],
    ]);
    expect(s.stored.get("a")).toMatchObject({
      published: { copies: 1 },
      draft: { copies: 0, edit: "draft" },
    });
    expect(report.left).toContainEqual(
      expect.objectContaining({ reason: "pending-draft" })
    );
  });

  it("reads the host again when it was saved since the read, and rewrites it", async () => {
    const s = both();
    const asked = withCopies(s, { changedTimes: 1 });

    const report = await rewriteHosts(s.deps, args);

    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(report.left).toEqual([]);
    expect(s.stored.get("a")?.published).toEqual({ copies: 0 });
  });

  it("leaves a host that keeps being saved once its retries are spent", async () => {
    const s = both();
    const asked = withCopies(s, { changedTimes: 10 });

    const report = await rewriteHosts(s.deps, { ...args, maxAttempts: 2 });

    expect(report.left).toContainEqual(
      expect.objectContaining({ reason: "changed" })
    );
    // Each walk tried it twice, the bound, and nothing was written.
    expect(asked.length % 2).toBe(0);
    expect(asked.length).toBeGreaterThanOrEqual(2);
    expect(s.stored.get("a")).toMatchObject({
      published: { copies: 1 },
      draft: { copies: 2, edit: "draft" },
    });
  });

  it("leaves a host one of whose copies the step refuses when the rewrite asks it", async () => {
    const s = both();
    withCopies(s);
    // A copy the walk did not read: refused only when the rewrite reaches it.
    s.hooks.afterRead = id => {
      const held = s.stored.get(id);
      if (held !== undefined) held.draft = { copies: 1, refuse: true };
    };

    const report = await rewriteHosts(s.deps, args);

    expect(report.left).toContainEqual(
      expect.objectContaining({ reason: "refused", detail: "marked" })
    );
    expect(s.stored.get("a")?.published).toEqual({ copies: 1 });
  });

  it("counts it as converted on a dry run, reporting the write it would make", async () => {
    const s = both();
    const asked = withCopies(s);

    const report = await rewriteHosts(s.deps, {
      ...args,
      dryRun: true,
      plannedWrites: true,
    });

    expect(report.rewritten.map(host => host.id)).toEqual(["a"]);
    expect(report.left).toEqual([]);
    expect(report.writes).toEqual([
      expect.objectContaining({ value: { copies: 0, edit: "draft" } }),
    ]);
    expect(asked).toEqual([]);
  });

  it("writes the draft alone, as before, for a read that gave no version", async () => {
    const s = both();
    const asked = withCopies(s, { rev: false });

    const report = await rewriteHosts(s.deps, args);

    expect(asked).toEqual([]);
    expect(report.left).toContainEqual(
      expect.objectContaining({ reason: "pending-draft" })
    );
  });
});
