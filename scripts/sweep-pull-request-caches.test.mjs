/**
 * Which caches the scheduled sweep deletes, and that it never reaches past a
 * pull request's merge ref, against a stand-in for the GitHub API.
 */
import { readFileSync } from "node:fs";

import { load } from "js-yaml";
import { describe, expect, it, vi } from "vitest";

import { familyOf, isPullRequestRef, main, sweepPlan } from "./sweep-pull-request-caches.mjs";

const REPO = "nextlyhq/nextly";
const SHA = n => String(n).repeat(40).slice(0, 40);
const PR = "refs/pull/7/merge";
const OTHER_PR = "refs/pull/8/merge";
const MAIN = "refs/heads/main";
let nextId = 1;
const cache = (ref, key, created, size = 1024 * 1024) => ({ id: nextId++, ref, key, created_at: created, size_in_bytes: size });
const planned = caches => sweepPlan(caches).map(({ cache: entry, reason }) => `${entry.ref} ${entry.key} ${reason}`);

describe("familyOf", () => {
  it("drops a trailing commit or content hash, and has no family for any other key", () => {
    expect(familyOf(`turbo-v2-Linux-ci-${SHA(1)}`)).toBe("turbo-v2-Linux-ci");
    expect(familyOf(`pnpm-store-v1-Linux-X64-${"a".repeat(64)}`)).toBe("pnpm-store-v1-Linux-X64");
    expect(familyOf("playwright-Linux-1.52.0")).toBeNull();
    expect(familyOf(`turbo-v2-Linux-ci-${"g".repeat(40)}`)).toBeNull();
  });
});

describe("isPullRequestRef", () => {
  it("is a pull request's merge ref only", () => {
    expect(isPullRequestRef(PR)).toBe(true);
    for (const ref of [MAIN, "refs/pull/7/head", "refs/heads/gh-readonly-queue/main/pr-7-abc", "refs/tags/v1", undefined]) {
      expect(isPullRequestRef(ref)).toBe(false);
    }
  });
});

describe("sweepPlan", () => {
  it("keeps the newest key of a family on a pull request's ref and deletes the older", () => {
    const caches = [
      cache(PR, `turbo-v2-Linux-ci-${SHA(1)}`, "2026-10-27T01:00:00Z"),
      cache(PR, `turbo-v2-Linux-ci-${SHA(3)}`, "2026-10-27T03:00:00Z"),
      cache(PR, `turbo-v2-Linux-ci-${SHA(2)}`, "2026-10-27T02:00:00Z"),
    ];
    expect(planned(caches)).toEqual([
      `${PR} turbo-v2-Linux-ci-${SHA(2)} superseded`,
      `${PR} turbo-v2-Linux-ci-${SHA(1)} superseded`,
    ]);
  });

  it("judges each pull request's family on its own", () => {
    const caches = [
      cache(PR, `turbo-v2-Linux-ci-${SHA(1)}`, "2026-10-27T01:00:00Z"),
      cache(OTHER_PR, `turbo-v2-Linux-ci-${SHA(2)}`, "2026-10-27T02:00:00Z"),
    ];
    expect(planned(caches)).toEqual([]);
  });

  it("deletes a pull request's copy of a key main holds, whatever its age, and never main's own", () => {
    const key = `pnpm-store-v1-macOS-ARM64-${"b".repeat(64)}`;
    const caches = [cache(MAIN, key, "2026-10-27T01:00:00Z"), cache(PR, key, "2026-10-27T05:00:00Z")];
    expect(planned(caches)).toEqual([`${PR} ${key} a copy of main's`]);
  });

  it("never deletes from main, the merge queue or a tag, however many keys of a family they hold", () => {
    const refs = [MAIN, "refs/heads/gh-readonly-queue/main/pr-7-abc", "refs/tags/v1"];
    const caches = refs.flatMap(ref => [
      cache(ref, `turbo-v2-Linux-ci-${SHA(1)}`, "2026-10-27T01:00:00Z"),
      cache(ref, `turbo-v2-Linux-ci-${SHA(2)}`, "2026-10-27T02:00:00Z"),
    ]);
    expect(planned(caches)).toEqual([]);
  });

  it("keeps a key with no family, even beside others of its prefix", () => {
    const caches = [cache(PR, "playwright-Linux-1.52.0", "2026-10-27T01:00:00Z"), cache(PR, "playwright-Linux-1.53.0", "2026-10-27T02:00:00Z")];
    expect(planned(caches)).toEqual([]);
  });
});

/** A fetch answering the cache list from `pages` and DELETEs with `deleteStatus(id)`, recording deletions. */
function api(pages, deleteStatus = () => 204) {
  const deleted = [];
  const fetchImpl = async (url, { method = "GET" } = {}) => {
    const path = url.replace("https://api.github.com/", "");
    if (method === "DELETE") {
      const id = Number(path.split("/").pop());
      deleted.push(id);
      const status = deleteStatus(id);
      return { ok: status >= 200 && status < 300, status };
    }
    const page = Number(/[?&]page=(\d+)/.exec(path)?.[1]);
    const answer = path.startsWith(`repos/${REPO}/actions/caches?per_page=100&page=`) ? pages[page - 1] : undefined;
    return answer === undefined ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => answer };
  };
  return { fetchImpl, deleted };
}

async function run(stub) {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const code = await main({ GITHUB_REPOSITORY: REPO, GH_TOKEN: "t" }, stub);
    return { code, printed: log.mock.calls.map(call => String(call[0])) };
  } finally {
    log.mockRestore();
  }
}

describe("main", () => {
  it("reads every page before planning, so a newer key on a later page supersedes an older one", async () => {
    const old = cache(PR, `turbo-v2-Linux-ci-${SHA(1)}`, "2026-10-27T01:00:00Z");
    const filler = Array.from({ length: 99 }, (_, index) => cache(MAIN, `main-${index}`, "2026-10-27T00:00:00Z"));
    const newer = cache(PR, `turbo-v2-Linux-ci-${SHA(2)}`, "2026-10-27T02:00:00Z");
    const stub = api([{ total_count: 101, actions_caches: [old, ...filler] }, { total_count: 101, actions_caches: [newer] }]);
    const { code, printed } = await run(stub);
    expect(code).toBe(0);
    expect(stub.deleted).toEqual([old.id]);
    expect(printed).toContainEqual(expect.stringContaining("1 of 101 cache(s) deleted, 1.0 MB"));
  });

  it("counts a cache already gone as deleted, and fails naming one it could not delete", async () => {
    const a = cache(PR, `turbo-v2-Linux-ci-${SHA(1)}`, "2026-10-27T01:00:00Z");
    const b = cache(PR, `turbo-v2-Linux-ci-${SHA(2)}`, "2026-10-27T02:00:00Z");
    const c = cache(PR, `turbo-v2-Linux-preview-${SHA(1)}`, "2026-10-27T01:00:00Z");
    const d = cache(PR, `turbo-v2-Linux-preview-${SHA(2)}`, "2026-10-27T02:00:00Z");
    const caches = [a, b, c, d];
    expect((await run(api([{ total_count: 4, actions_caches: caches }], () => 404))).code).toBe(0);
    const { code, printed } = await run(api([{ total_count: 4, actions_caches: caches }], id => (id === c.id ? 403 : 204)));
    expect(code).toBe(1);
    expect(printed).toContainEqual(expect.stringContaining(`could not delete 1 cache(s): ${c.key}`));
  });

  it("fails when the list came back shorter than GitHub's total, after sweeping what it held", async () => {
    const a = cache(PR, `turbo-v2-Linux-ci-${SHA(1)}`, "2026-10-27T01:00:00Z");
    const b = cache(PR, `turbo-v2-Linux-ci-${SHA(2)}`, "2026-10-27T02:00:00Z");
    const stub = api([{ total_count: 5, actions_caches: [a, b] }]);
    const { code, printed } = await run(stub);
    expect(code).toBe(1);
    expect(stub.deleted).toEqual([a.id]);
    expect(printed).toContainEqual(expect.stringContaining("the list was short"));
  });
});

describe("the sweep workflow", () => {
  const workflow = load(readFileSync(new URL("../.github/workflows/sweep-pull-request-caches.yml", import.meta.url), "utf8"));

  it("runs on a schedule and by hand only, never on a pull request's event", () => {
    const on = workflow.on ?? workflow[true];
    expect(Object.keys(on).sort()).toEqual(["schedule", "workflow_dispatch"]);
  });

  it("grants actions: write to its one job only, and runs the sweep there", () => {
    expect(workflow.permissions).toEqual({});
    const jobs = Object.values(workflow.jobs);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].permissions).toEqual({ contents: "read", actions: "write" });
    expect(jobs[0].steps.at(-1).run).toBe("node scripts/sweep-pull-request-caches.mjs");
  });
});
