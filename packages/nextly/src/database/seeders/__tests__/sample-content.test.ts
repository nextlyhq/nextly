/**
 * The site's one sample-content load, over an in-memory `nextly_meta`: who may
 * start one, what each outcome leaves for every other reader, and what a
 * refused start, decline or record leaves untouched. The race on a real
 * database, on every dialect, is `sample-content.integration.test.ts`.
 */
import { describe, expect, it, vi } from "vitest";

import {
  declineSampleContent,
  readSampleContent,
  recordSampleContent,
  SAMPLE_LOADED_KEY,
  sampleContentPost,
  startSampleContent,
  type SampleContentStore,
} from "../sample-content";

/** `nextly_meta` in memory, with a key's writes made to fail on demand. */
function memoryStore(): SampleContentStore & {
  rows: Map<string, unknown>;
  failSet: Set<string>;
  failReads: boolean;
  duplicateThrows: boolean;
} {
  const rows = new Map<string, unknown>();
  const failSet = new Set<string>();
  const store = {
    rows,
    failSet,
    failReads: false,
    duplicateThrows: false,
    async getEntry<T>(key: string) {
      if (store.failReads) throw new Error("meta down");
      return rows.has(key)
        ? { present: true as const, value: rows.get(key) as T }
        : { present: false as const };
    },
    async insertIfAbsent(key: string, value: unknown) {
      if (failSet.has(key)) throw new Error(`cannot write ${key}`);
      // As a driver answers a second insert of one key that its conflict clause did not catch.
      if (store.duplicateThrows && rows.has(key)) {
        throw new Error(
          `duplicate key value violates unique constraint on ${key}`
        );
      }
      if (!rows.has(key)) rows.set(key, structuredClone(value));
    },
    async compareAndSet(key: string, expected: unknown, next: unknown) {
      if (failSet.has(key)) throw new Error(`cannot write ${key}`);
      if (JSON.stringify(rows.get(key)) !== JSON.stringify(expected)) {
        return false;
      }
      rows.set(key, structuredClone(next));
      return true;
    },
    async set(key: string, value: unknown) {
      if (failSet.has(key)) throw new Error(`cannot write ${key}`);
      rows.set(key, structuredClone(value));
    },
    async delete(key: string) {
      rows.delete(key);
    },
  };
  return store;
}

const at = (iso: string) => () => new Date(iso);

describe("starting a load", () => {
  it("loads once, records it, and closes the offer for everyone", async () => {
    const store = memoryStore();
    const load = vi.fn(async () => ({ posts: 3 }));
    expect(await startSampleContent(store, { by: "a", load })).toEqual({
      outcome: "loaded",
      result: { posts: 3 },
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(await readSampleContent(store)).toMatchObject({ answer: "loaded" });
    // Answered: a second start loads nothing.
    const again = await startSampleContent(store, { by: "b", load });
    expect(again).toMatchObject({ outcome: "refused", reason: "answered" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refuses a start while another load is unfinished, loading nothing, however long ago it started", async () => {
    const store = memoryStore();
    let finish: (() => void) | undefined;
    const first = startSampleContent(store, {
      by: "a",
      now: at("2020-01-01T00:00:00.000Z"),
      load: () =>
        new Promise<string>(resolve => {
          finish = () => resolve("done");
        }),
    });
    await vi.waitFor(() => expect(finish).toBeDefined());
    const second = vi.fn(async () => "second");
    const refused = await startSampleContent(store, {
      by: "b",
      load: second,
    });
    expect(refused).toEqual({
      outcome: "refused",
      reason: "in-progress",
      state: {
        run: { state: "unfinished", startedAt: "2020-01-01T00:00:00.000Z" },
      },
    });
    expect(second).not.toHaveBeenCalled();
    // Nor does a confirmation start one: only a failure may be loaded over.
    expect(
      await startSampleContent(store, { by: "b", confirm: true, load: second })
    ).toMatchObject({ reason: "in-progress" });
    expect(second).not.toHaveBeenCalled();
    finish?.();
    expect(await first).toEqual({ outcome: "loaded", result: "done" });
  });

  it("reports a failed load in safe words, never the loader's own message, and loads again only once confirmed", async () => {
    const store = memoryStore();
    // A driver's message, as a loader's database write throws it: kept off the wire and the card.
    const failing = vi.fn(async () => {
      throw new Error(
        'insert into "posts" ("title") values ($1) - relation "posts" does not exist'
      );
    });
    const failed = await startSampleContent(store, {
      by: "a",
      load: failing,
      now: at("2026-10-31T09:00:00.000Z"),
    });
    expect(failed).toEqual({
      outcome: "failed",
      failure:
        "The sample content could not be loaded. The server log says what failed.",
      startedAt: "2026-10-31T09:00:00.000Z",
    });
    // Asked once, never again on its own.
    expect(failing).toHaveBeenCalledTimes(1);
    expect(await readSampleContent(store)).toEqual({
      run: {
        state: "failed",
        startedAt: "2026-10-31T09:00:00.000Z",
        failure:
          "The sample content could not be loaded. The server log says what failed.",
      },
    });
    expect(JSON.stringify([...store.rows.values()])).not.toContain(
      "insert into"
    );

    const load = vi.fn(async () => "ok");
    expect(await startSampleContent(store, { by: "b", load })).toMatchObject({
      outcome: "refused",
      reason: "confirm",
    });
    expect(load).not.toHaveBeenCalled();
    expect(
      await startSampleContent(store, { by: "b", confirm: true, load })
    ).toEqual({ outcome: "loaded", result: "ok" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("says loaded but not recorded when the record fails, and refuses to load again over it", async () => {
    const store = memoryStore();
    store.failSet.add(SAMPLE_LOADED_KEY);
    const load = vi.fn(async () => "ok");
    const start = await startSampleContent(store, {
      by: "a",
      load,
      now: at("2026-10-31T09:00:00.000Z"),
    });
    expect(start).toEqual({
      outcome: "unrecorded",
      result: "ok",
      run: expect.any(String),
      startedAt: "2026-10-31T09:00:00.000Z",
      failure: "The sample content loaded, but the site could not record it.",
    });
    const run = start.outcome === "unrecorded" ? start.run : "";
    expect(await readSampleContent(store)).toEqual({
      run: {
        state: "unrecorded",
        startedAt: "2026-10-31T09:00:00.000Z",
        run,
      },
    });
    for (const confirm of [false, true]) {
      expect(
        await startSampleContent(store, { by: "b", confirm, load })
      ).toMatchObject({ reason: "unrecorded" });
    }
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reads a store it cannot read as a failure, never as nobody answered", async () => {
    const store = memoryStore();
    store.failReads = true;
    const load = vi.fn(async () => "ok");
    await expect(readSampleContent(store)).rejects.toThrow("meta down");
    await expect(
      startSampleContent(store, { by: "a", load })
    ).rejects.toThrow();
    expect(load).not.toHaveBeenCalled();
  });

  it("gives the site's one load to whichever claim lands first", async () => {
    // Two starts that both read "nobody started" before either claims: the claim decides.
    const store = memoryStore();
    const loads = vi.fn(async () => "ok");
    const realGet = store.getEntry.bind(store);
    let reads = 0;
    let release: () => void = () => undefined;
    const bothRead = new Promise<void>(resolve => {
      release = resolve;
    });
    store.getEntry = async <T>(key: string) => {
      const entry = await realGet<T>(key);
      if (key === "seed.current" && reads < 2) {
        reads += 1;
        if (reads === 2) release();
        await bothRead;
      }
      return entry;
    };
    const [one, two] = await Promise.all([
      startSampleContent(store, { by: "a", load: loads }),
      startSampleContent(store, { by: "b", load: loads }),
    ]);
    expect(loads).toHaveBeenCalledTimes(1);
    expect([one.outcome, two.outcome].sort()).toEqual(["loaded", "refused"]);
  });
});

describe("the site's answer after many loads", () => {
  it("reads three rows however many loads failed and were tried again, and keeps the last three copies", async () => {
    const store = memoryStore();
    const failing = async () => {
      throw new Error("boom");
    };
    await startSampleContent(store, { by: "a", load: failing });
    for (let attempt = 0; attempt < 12; attempt += 1) {
      expect(
        await startSampleContent(store, {
          by: "a",
          confirm: true,
          load: failing,
        })
      ).toMatchObject({ outcome: "failed" });
    }
    const reads = vi.spyOn(store, "getEntry");
    expect(await readSampleContent(store)).toMatchObject({
      run: { state: "failed" },
    });
    expect(reads).toHaveBeenCalledTimes(3);
    // The copies are the last three answers, 11 to 13; the answer itself is one row.
    const copies = [...store.rows.keys()].filter(key =>
      key.startsWith("seed.run.")
    );
    expect(copies.sort()).toEqual([
      "seed.run.11",
      "seed.run.12",
      "seed.run.13",
    ]);
    expect(store.rows.get("seed.current")).toMatchObject({ generation: 13 });
  });

  it("tells a start that lost its claim why, from the winner's answer as it reads now", async () => {
    // Both read "nobody started"; the winner's load fails before the loser's claim lands, so the
    // loser is told to confirm, as a start after a failure is, never that a load is running.
    const store = memoryStore();
    const realGet = store.getEntry.bind(store);
    const realInsert = store.insertIfAbsent.bind(store);
    let reads = 0;
    let release: () => void = () => undefined;
    const bothRead = new Promise<void>(resolve => {
      release = resolve;
    });
    store.getEntry = async <T>(key: string) => {
      const entry = await realGet<T>(key);
      if (key === "seed.current" && reads < 2) {
        reads += 1;
        if (reads === 2) release();
        await bothRead;
      }
      return entry;
    };
    let winner: Promise<unknown> | undefined;
    let inserts = 0;
    store.insertIfAbsent = async (key: string, value: unknown) => {
      inserts += 1;
      // The second claim lands only once the first start has finished.
      if (key === "seed.current" && inserts === 2) await winner;
      return realInsert(key, value);
    };
    const failing = async () => {
      throw new Error("boom");
    };
    winner = startSampleContent(store, { by: "a", load: failing });
    const loser = await startSampleContent(store, { by: "b", load: failing });
    expect(await winner).toMatchObject({ outcome: "failed" });
    expect(loser).toMatchObject({ outcome: "refused", reason: "confirm" });
  });

  it("lets a confirmed load claim over a failure only from the failure it read", async () => {
    // Two confirmed starts over one failure: both read it, one moves it, the other is refused.
    const store = memoryStore();
    await startSampleContent(store, {
      by: "a",
      load: async () => {
        throw new Error("boom");
      },
    });
    const realGet = store.getEntry.bind(store);
    let reads = 0;
    let release: () => void = () => undefined;
    const bothRead = new Promise<void>(resolve => {
      release = resolve;
    });
    store.getEntry = async <T>(key: string) => {
      const entry = await realGet<T>(key);
      if (key === "seed.current" && reads < 2) {
        reads += 1;
        if (reads === 2) release();
        await bothRead;
      }
      return entry;
    };
    const load = vi.fn(async () => "ok");
    const [one, two] = await Promise.all([
      startSampleContent(store, { by: "a", confirm: true, load }),
      startSampleContent(store, { by: "b", confirm: true, load }),
    ]);
    expect(load).toHaveBeenCalledTimes(1);
    expect([one.outcome, two.outcome].sort()).toEqual(["loaded", "refused"]);
  });
});

describe("recording a load on its own", () => {
  async function unrecorded() {
    const store = memoryStore();
    store.failSet.add(SAMPLE_LOADED_KEY);
    const load = vi.fn(async () => "ok");
    const start = await startSampleContent(store, { by: "a", load });
    store.failSet.clear();
    if (start.outcome !== "unrecorded") throw new Error("not unrecorded");
    return { store, load, run: start.run };
  }

  it("records the run it names without loading again", async () => {
    const { store, load, run } = await unrecorded();
    expect(await recordSampleContent(store, { run })).toEqual({
      outcome: "loaded",
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(await readSampleContent(store)).toMatchObject({ answer: "loaded" });
  });

  it("answers recorded to both of two records of the same load at once, though one's write lost", async () => {
    const { store, load, run } = await unrecorded();
    store.duplicateThrows = true;
    const [one, two] = await Promise.all([
      recordSampleContent(store, { run }),
      recordSampleContent(store, { run }),
    ]);
    expect(one).toEqual({ outcome: "loaded" });
    expect(two).toEqual({ outcome: "loaded" });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refuses a run that is not the one waiting, and says when recording fails again", async () => {
    const { store, run } = await unrecorded();
    expect(await recordSampleContent(store, { run: "other" })).toMatchObject({
      outcome: "refused",
      reason: "not-this-run",
    });
    store.failSet.add(SAMPLE_LOADED_KEY);
    expect(await recordSampleContent(store, { run })).toMatchObject({
      outcome: "unrecorded",
      run,
    });
  });

  it("never records a failed load as loaded", async () => {
    const store = memoryStore();
    await startSampleContent(store, {
      by: "a",
      load: async () => {
        throw new Error("boom");
      },
    });
    const current = store.rows.get("seed.current") as { token: string };
    expect(
      await recordSampleContent(store, { run: current.token })
    ).toMatchObject({
      outcome: "refused",
      reason: "not-this-run",
    });
    expect(store.rows.has(SAMPLE_LOADED_KEY)).toBe(false);
  });
});

describe("declining", () => {
  it("declines for the whole site, so a load started after it is refused", async () => {
    const store = memoryStore();
    expect(await declineSampleContent(store, { by: "a" })).toEqual({
      outcome: "declined",
    });
    expect(await readSampleContent(store)).toMatchObject({
      answer: "declined",
    });
    const load = vi.fn(async () => "ok");
    expect(await startSampleContent(store, { by: "b", load })).toMatchObject({
      reason: "answered",
    });
    expect(load).not.toHaveBeenCalled();
  });

  it("refuses a decline while a load is unfinished, and after one loaded", async () => {
    const store = memoryStore();
    let finish: () => void = () => undefined;
    const run = startSampleContent(store, {
      by: "a",
      load: () =>
        new Promise<void>(resolve => {
          finish = resolve;
        }),
    });
    await vi.waitFor(() => expect(store.rows.has("seed.current")).toBe(true));
    expect(await declineSampleContent(store, { by: "b" })).toMatchObject({
      reason: "in-progress",
    });
    finish();
    await run;
    expect(await declineSampleContent(store, { by: "b" })).toMatchObject({
      reason: "answered",
    });
  });

  it("holds the decline in its claim when the older flag cannot be written", async () => {
    const store = memoryStore();
    store.failSet.add("seed.skippedAt");
    expect(await declineSampleContent(store, { by: "a" })).toEqual({
      outcome: "declined",
    });
    expect(await readSampleContent(store)).toMatchObject({
      answer: "declined",
    });
  });
});

describe("the project's POST", () => {
  const post = (body?: string) =>
    new Request("http://localhost/admin/api/seed", {
      method: "POST",
      ...(body === undefined ? {} : { body }),
    });

  it("answers a load in the mutation envelope, a refusal as a conflict saying why, and a failure with what failed", async () => {
    const store = memoryStore();
    const failed = await sampleContentPost(post(), {
      store,
      by: "a",
      load: async () => {
        throw new Error(
          'duplicate key value violates unique constraint "tags_slug_key" on insert into "tags"'
        );
      },
    });
    expect(failed.status).toBe(500);
    const failedBody = await failed.text();
    // The driver's words never reach the response.
    expect(failedBody).not.toContain("insert into");
    expect(failedBody).not.toContain("tags_slug_key");
    expect(JSON.parse(failedBody)).toMatchObject({
      error: {
        code: "INTERNAL_ERROR",
        data: {
          reason: "failed",
          failure:
            "The sample content could not be loaded. The server log says what failed.",
        },
      },
    });

    const unconfirmed = await sampleContentPost(post("{}"), {
      store,
      by: "a",
      load: async () => "ok",
    });
    expect(unconfirmed.status).toBe(409);
    expect(await unconfirmed.json()).toMatchObject({
      error: { code: "CONFLICT", data: { reason: "confirm" } },
    });

    const confirmed = await sampleContentPost(post('{"confirm":true}'), {
      store,
      by: "a",
      load: async () => "ok",
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({
      message: "Sample content loaded.",
      item: { outcome: "loaded", result: "ok" },
    });
  });

  it("refuses a body it does not take, or one past its byte cap, loading nothing", async () => {
    const load = vi.fn(async () => "ok");
    for (const body of [
      '{"record":"run-1"}',
      "not json",
      '{"confirm":"yes"}',
    ]) {
      const res = await sampleContentPost(post(body), {
        store: memoryStore(),
        by: "a",
        load,
      });
      expect(res.status).toBe(400);
    }
    // 300 two-byte characters: under the cap counted in UTF-16 units, past it in bytes. Refused
    // as too large, not read and refused as a body it does not take.
    const wide = JSON.stringify({ note: "é".repeat(300) });
    expect(wide.length).toBeLessThan(512);
    const res = await sampleContentPost(post(wide), {
      store: memoryStore(),
      by: "a",
      load,
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { data: { errors: [{ code: "too_large" }] } },
    });
    expect(load).not.toHaveBeenCalled();
  });
});
