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
} {
  const rows = new Map<string, unknown>();
  const failSet = new Set<string>();
  const store = {
    rows,
    failSet,
    failReads: false,
    async getEntry<T>(key: string) {
      if (store.failReads) throw new Error("meta down");
      return rows.has(key)
        ? { present: true as const, value: rows.get(key) as T }
        : { present: false as const };
    },
    async insertIfAbsent(key: string, value: unknown) {
      if (!rows.has(key)) rows.set(key, structuredClone(value));
    },
    async set(key: string, value: unknown) {
      if (failSet.has(key)) throw new Error(`cannot write ${key}`);
      rows.set(key, structuredClone(value));
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
    expect(await readSampleContent(store)).toEqual({ answer: "loaded" });
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

  it("reports a failed load with what failed, and loads again only once confirmed", async () => {
    const store = memoryStore();
    const failing = vi.fn(async () => {
      throw new Error("post hello-world: column missing");
    });
    const failed = await startSampleContent(store, {
      by: "a",
      load: failing,
      now: at("2026-10-31T09:00:00.000Z"),
    });
    expect(failed).toEqual({
      outcome: "failed",
      failure: "post hello-world: column missing",
      startedAt: "2026-10-31T09:00:00.000Z",
    });
    // Asked once, never again on its own.
    expect(failing).toHaveBeenCalledTimes(1);
    expect(await readSampleContent(store)).toEqual({
      run: {
        state: "failed",
        startedAt: "2026-10-31T09:00:00.000Z",
        failure: "post hello-world: column missing",
      },
    });

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
      token: "run-1",
      now: at("2026-10-31T09:00:00.000Z"),
    });
    expect(start).toEqual({
      outcome: "unrecorded",
      result: "ok",
      run: "run-1",
      startedAt: "2026-10-31T09:00:00.000Z",
      failure: "cannot write seed.completedAt",
    });
    expect(await readSampleContent(store)).toEqual({
      run: {
        state: "unrecorded",
        startedAt: "2026-10-31T09:00:00.000Z",
        run: "run-1",
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
      if (key === "seed.run.1" && reads < 2) {
        reads += 1;
        if (reads === 2) release();
        await bothRead;
      }
      return entry;
    };
    const [one, two] = await Promise.all([
      startSampleContent(store, { by: "a", load: loads, token: "A" }),
      startSampleContent(store, { by: "b", load: loads, token: "B" }),
    ]);
    expect(loads).toHaveBeenCalledTimes(1);
    expect([one.outcome, two.outcome].sort()).toEqual(["loaded", "refused"]);
  });
});

describe("recording a load on its own", () => {
  async function unrecorded() {
    const store = memoryStore();
    store.failSet.add(SAMPLE_LOADED_KEY);
    const load = vi.fn(async () => "ok");
    await startSampleContent(store, { by: "a", load, token: "run-1" });
    store.failSet.clear();
    return { store, load };
  }

  it("records the run it names without loading again", async () => {
    const { store, load } = await unrecorded();
    expect(await recordSampleContent(store, { run: "run-1" })).toEqual({
      outcome: "loaded",
    });
    expect(load).toHaveBeenCalledTimes(1);
    expect(await readSampleContent(store)).toEqual({ answer: "loaded" });
  });

  it("refuses a run that is not the one waiting, and says when recording fails again", async () => {
    const { store } = await unrecorded();
    expect(await recordSampleContent(store, { run: "other" })).toMatchObject({
      outcome: "refused",
      reason: "not-this-run",
    });
    store.failSet.add(SAMPLE_LOADED_KEY);
    expect(await recordSampleContent(store, { run: "run-1" })).toMatchObject({
      outcome: "unrecorded",
      run: "run-1",
    });
  });

  it("never records a failed load as loaded", async () => {
    const store = memoryStore();
    await startSampleContent(store, {
      by: "a",
      token: "run-1",
      load: async () => {
        throw new Error("boom");
      },
    });
    expect(await recordSampleContent(store, { run: "run-1" })).toMatchObject({
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
    expect(await readSampleContent(store)).toEqual({ answer: "declined" });
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
    await vi.waitFor(() => expect(store.rows.has("seed.run.1")).toBe(true));
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
    expect(await readSampleContent(store)).toEqual({ answer: "declined" });
  });
});

describe("the project's POST", () => {
  const post = (body?: string) =>
    new Request("http://localhost/admin/api/seed", {
      method: "POST",
      ...(body === undefined ? {} : { body }),
    });

  it("starts on an empty body, answers 409 with why on a refusal, and 500 with what failed", async () => {
    const store = memoryStore();
    const failing = async () => {
      throw new Error("tag news: duplicate");
    };
    const failed = await sampleContentPost(post(), {
      store,
      by: "a",
      load: failing,
    });
    expect(failed.status).toBe(500);
    expect(await failed.json()).toMatchObject({
      outcome: "failed",
      failure: "tag news: duplicate",
      errors: [{ message: "tag news: duplicate" }],
    });

    const unconfirmed = await sampleContentPost(post(), {
      store,
      by: "a",
      load: async () => "ok",
    });
    expect(unconfirmed.status).toBe(409);
    expect(await unconfirmed.json()).toMatchObject({ reason: "confirm" });

    const confirmed = await sampleContentPost(post('{"confirm":true}'), {
      store,
      by: "a",
      load: async () => "ok",
    });
    expect(confirmed.status).toBe(200);
    expect(await confirmed.json()).toEqual({
      outcome: "loaded",
      result: "ok",
    });
  });

  it("refuses a body it does not take, loading nothing", async () => {
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
    expect(load).not.toHaveBeenCalled();
  });
});
