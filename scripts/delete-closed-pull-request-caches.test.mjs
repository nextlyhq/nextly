/**
 * Deleting a closed pull request's Actions caches, against a stand-in for the
 * GitHub API that answers only the routes a case gives it.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { cachesOf, main, mergeRefOf } from "./delete-closed-pull-request-caches.mjs";

const REPO = "nextlyhq/nextly";
const NUMBER = 41;
const REF = mergeRefOf(NUMBER);

const cache = (id, ref = REF, size = 1024 * 1024) => ({ id, key: `key-${id}`, ref, size_in_bytes: size });
const listPage = page => `GET repos/${REPO}/actions/caches?ref=${encodeURIComponent(REF)}&per_page=100&page=${page}`;
const pullRoute = `GET repos/${REPO}/pulls/${NUMBER}`;

/** The temporary directories the event files went in, removed after each test. */
const made = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The workflow's environment, with an event file naming the closed pull request. */
function envFor() {
  const dir = mkdtempSync(join(tmpdir(), "delete-caches-"));
  made.push(dir);
  const path = join(dir, "event.json");
  writeFileSync(path, JSON.stringify({ pull_request: { number: NUMBER } }));
  return { GITHUB_EVENT_PATH: path, GITHUB_REPOSITORY: REPO, GH_TOKEN: "t" };
}

/** A fetch answering GETs from `routes` and DELETEs with `deleteStatus(id)`, recording every call. */
function api(routes, deleteStatus = () => 204) {
  const calls = [];
  const fetchImpl = async (url, { method = "GET" } = {}) => {
    const path = url.replace("https://api.github.com/", "");
    const key = `${method} ${path}`;
    calls.push(key);
    if (method === "DELETE") {
      const status = deleteStatus(Number(path.split("/").pop()));
      return { ok: status >= 200 && status < 300, status };
    }
    const answer = routes[key];
    return answer === undefined ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => answer };
  };
  return { fetchImpl, deleted: () => calls.filter(call => call.startsWith("DELETE")).map(call => Number(call.split("/").pop())) };
}

/** Runs `main` with console output captured, returning the exit code and what was printed. */
async function run(stub) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const code = await main(envFor(), stub);
    return { code, printed: log.mock.calls.map(call => String(call[0])) };
  } finally {
    log.mockRestore();
  }
}

describe("cachesOf", () => {
  it("keeps only the pull request's own merge ref, never main's, another pull request's or its head", () => {
    const caches = [cache(1), cache(2, "refs/heads/main"), cache(3, mergeRefOf(410)), cache(4, `refs/pull/${NUMBER}/head`), cache(5)];
    expect(cachesOf(NUMBER, caches).map(entry => entry.id)).toEqual([1, 5]);
  });
});

describe("main", () => {
  const closed = { [pullRoute]: { state: "closed" } };

  it("deletes every cache under the merge ref, across pages, and nothing the listing returned for another ref", async () => {
    const first = Array.from({ length: 99 }, (_, index) => cache(index + 1)).concat([cache(500, "refs/heads/main")]);
    const stub = api({ ...closed, [listPage(1)]: { total_count: 101, actions_caches: first }, [listPage(2)]: { total_count: 101, actions_caches: [cache(100)] } });
    const { code } = await run(stub);
    expect(code).toBe(0);
    expect(stub.deleted()).toEqual(Array.from({ length: 100 }, (_, index) => index + 1));
  });

  it("counts a cache already gone as deleted", async () => {
    const stub = api({ ...closed, [listPage(1)]: { total_count: 2, actions_caches: [cache(1), cache(2)] } }, id => (id === 2 ? 404 : 204));
    expect((await run(stub)).code).toBe(0);
  });

  it("fails, naming it, when a cache could not be deleted", async () => {
    const stub = api({ ...closed, [listPage(1)]: { total_count: 2, actions_caches: [cache(1), cache(2)] } }, id => (id === 2 ? 403 : 204));
    const { code, printed } = await run(stub);
    expect(code).toBe(1);
    expect(printed).toContainEqual(expect.stringContaining("could not delete 1 cache(s): key-2"));
  });

  it("fails when the list came back shorter than GitHub's total, after deleting what it held", async () => {
    const stub = api({ ...closed, [listPage(1)]: { total_count: 3, actions_caches: [cache(1), cache(2)] } });
    const { code, printed } = await run(stub);
    expect(code).toBe(1);
    expect(stub.deleted()).toEqual([1, 2]);
    expect(printed).toContainEqual(expect.stringContaining("the list was short"));
  });

  it("deletes nothing for a pull request reopened while its caches were listed", async () => {
    let reads = 0;
    const stub = api({ [listPage(1)]: { total_count: 1, actions_caches: [cache(1)] } });
    const fetchImpl = async (url, init) => {
      if (url.endsWith(`repos/${REPO}/pulls/${NUMBER}`)) {
        reads += 1;
        return { ok: true, status: 200, json: async () => ({ state: reads === 1 ? "closed" : "open" }) };
      }
      return stub.fetchImpl(url, init);
    };
    expect((await run({ fetchImpl })).code).toBe(0);
    expect(reads).toBe(2);
    expect(stub.deleted()).toEqual([]);
  });

  it("deletes nothing for a pull request reopened since it closed", async () => {
    const stub = api({ [pullRoute]: { state: "open" }, [listPage(1)]: { total_count: 1, actions_caches: [cache(1)] } });
    expect((await run(stub)).code).toBe(0);
    expect(stub.deleted()).toEqual([]);
  });

  it("fails when it cannot read the pull request", async () => {
    const stub = api({ [listPage(1)]: { total_count: 1, actions_caches: [cache(1)] } });
    expect((await run(stub)).code).toBe(1);
    expect(stub.deleted()).toEqual([]);
  });
});
