/**
 * When a pull request may narrow its unit tests, and the tripwire and the
 * enablement check that keep that narrowing honest.
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  MODE_VARIABLE,
  SELECTION_SWITCH,
  directMerges,
  directPaths,
  firstParentChain,
  main,
  selectionMode,
} from "./merge-path.mjs";

const REPO = "nextlyhq/nextly";
const queueRules = [{ type: "pull_request", ruleset_id: 1 }, { type: "merge_queue", ruleset_id: 1 }];

describe("selectionMode", () => {
  it("selects only on a pull request, with the switch on and the queue in main's rules", () => {
    expect(selectionMode({ event: "pull_request", switchValue: "on", rules: queueRules }).mode).toBe("select");
  });

  it("tests everything on main, in the queue and on a dispatch, whatever the switch says", () => {
    for (const event of ["push", "merge_group", "workflow_dispatch"]) {
      expect(selectionMode({ event, switchValue: "on", rules: queueRules })).toMatchObject({ mode: "full", guardFailure: null });
    }
  });

  it("runs a pull request in shadow while the switch is anything but on", () => {
    for (const switchValue of ["", "off", "true", "ON"]) {
      expect(selectionMode({ event: "pull_request", switchValue, rules: queueRules })).toMatchObject({ mode: "shadow", guardFailure: null });
    }
  });

  it("tests everything, without failing, when main's rules could not be read", () => {
    expect(selectionMode({ event: "pull_request", switchValue: "on", rules: null })).toMatchObject({ mode: "full", guardFailure: null });
  });

  it("tests everything and fails when the switch is on but main has no merge queue", () => {
    const verdict = selectionMode({ event: "pull_request", switchValue: "on", rules: [{ type: "pull_request" }] });
    expect(verdict.mode).toBe("full");
    expect(verdict.guardFailure).toContain(SELECTION_SWITCH);
  });
});

describe("firstParentChain", () => {
  // main: b <- m1 (a merge commit whose branch is x1 <- x2) <- s1
  const commits = [
    { sha: "x1", parents: [{ sha: "b" }] },
    { sha: "x2", parents: [{ sha: "x1" }] },
    { sha: "m1", parents: [{ sha: "b" }, { sha: "x2" }] },
    { sha: "s1", parents: [{ sha: "m1" }] },
  ];

  it("follows first parents back to the push's base, leaving a merged branch's own commits out", () => {
    expect(firstParentChain(commits, "b", "s1")).toEqual(["s1", "m1"]);
  });

  it("is null when the list does not reach the base, rather than a shorter chain", () => {
    expect(firstParentChain(commits.filter(commit => commit.sha !== "m1"), "b", "s1")).toBeNull();
  });
});

describe("directMerges", () => {
  it("names the commits without a queue run", () => {
    expect(directMerges(["s1", "m1"], sha => sha === "s1")).toEqual(["m1"]);
  });

  it("is null when any commit's answer is unknown, rather than counting it as queued or not", () => {
    expect(directMerges(["s1", "m1"], sha => (sha === "s1" ? true : null))).toBeNull();
  });
});

describe("directPaths", () => {
  const ruleset = { id: 7, name: "protect-main", enforcement: "active" };

  it("finds none for an active ruleset with no bypass actors and the queue", () => {
    expect(directPaths([{ ...ruleset, bypass_actors: [] }], queueRules)).toEqual([]);
  });

  it("names each bypass actor", () => {
    const problems = directPaths([{ ...ruleset, bypass_actors: [{ actor_type: "Team", actor_id: 42, bypass_mode: "pull_request" }] }], queueRules);
    expect(problems).toEqual(["ruleset 7 (protect-main) lets Team 42 bypass it (pull_request)"]);
  });

  it("treats bypass actors it could not read as a problem, not as none", () => {
    expect(directPaths([ruleset], queueRules)).toEqual([expect.stringContaining("could not be read")]);
  });

  it("reports a ruleset that is not active, and a main without the queue", () => {
    const problems = directPaths([{ ...ruleset, enforcement: "evaluate", bypass_actors: [] }], [{ type: "pull_request" }]);
    expect(problems).toEqual(["main has no merge_queue rule", "ruleset 7 (protect-main) is evaluate, not active"]);
  });
});

/** One page of main's rules, as the guard asks for it. */
const rulesPage = page => `repos/${REPO}/rules/branches/main?per_page=100&page=${page}`;

/** A fetch answering each route given and 404 to anything else, recording what was asked. */
function api(routes) {
  const asked = [];
  const fetchImpl = async url => {
    const key = url.replace("https://api.github.com/", "");
    asked.push(key);
    const answer = routes[key];
    return answer === undefined ? { ok: false, status: 404, json: async () => ({}) } : { ok: true, status: 200, json: async () => answer };
  };
  return { fetchImpl, asked };
}

describe("main", () => {
  it("sets the mode for the job's later steps and fails the step on a switch with no queue behind it", async () => {
    const output = join(mkdtempSync(join(tmpdir(), "merge-path-")), "out");
    const { fetchImpl } = api({ [rulesPage(1)]: [{ type: "pull_request" }] });
    const env = { GITHUB_REPOSITORY: REPO, GITHUB_EVENT_NAME: "pull_request", [SELECTION_SWITCH]: "on", GITHUB_ENV: output };
    expect(await main(["select"], env, { fetchImpl })).toBe(1);
    expect(readFileSync(output, "utf8")).toBe(`${MODE_VARIABLE}=full\n`);
  });

  it("reads every page of main's rules, so a merge queue on a later page still counts", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({ type: "required_status_checks", ruleset_id: index }));
    const routes = { [rulesPage(1)]: firstPage, [rulesPage(2)]: [{ type: "merge_queue", ruleset_id: 200 }] };
    const env = { GITHUB_REPOSITORY: REPO, GITHUB_EVENT_NAME: "pull_request", [SELECTION_SWITCH]: "on" };
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      expect(await main(["select"], env, api(routes))).toBe(0);
      expect(log.mock.calls.map(call => String(call[0]))).toContainEqual(expect.stringContaining("merge-path: select"));
    } finally {
      log.mockRestore();
    }
  });

  it("asks GitHub nothing for a run that cannot select", async () => {
    const { fetchImpl, asked } = api({});
    expect(await main(["select"], { GITHUB_EVENT_NAME: "push", [SELECTION_SWITCH]: "on" }, { fetchImpl })).toBe(0);
    expect(asked).toEqual([]);
  });

  const compare = { commits: [{ sha: "q1", parents: [{ sha: "b" }] }, { sha: "d1", parents: [{ sha: "q1" }] }] };
  const runs = sha => `repos/${REPO}/actions/workflows/ci.yml/runs?head_sha=${sha}&event=merge_group&status=success&per_page=1`;
  const tripwireEnv = { GITHUB_REPOSITORY: REPO, [SELECTION_SWITCH]: "on" };

  it("trips on a push whose commit never ran in the queue, and passes when every commit did", async () => {
    const routes = { [`repos/${REPO}/compare/b...d1?per_page=250`]: compare, [runs("q1")]: { total_count: 3 } };
    expect(await main(["tripwire", "b", "d1"], tripwireEnv, api({ ...routes, [runs("d1")]: { total_count: 0 } }))).toBe(1);
    expect(await main(["tripwire", "b", "d1"], tripwireEnv, api({ ...routes, [runs("d1")]: { total_count: 1 } }))).toBe(0);
  });

  it("fails as unknown when it cannot read a commit's runs, rather than calling it queued or direct", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const routes = { [`repos/${REPO}/compare/b...d1?per_page=250`]: compare, [runs("q1")]: { total_count: 3 } };
      expect(await main(["tripwire", "b", "d1"], tripwireEnv, api(routes))).toBe(1);
      const printed = log.mock.calls.map(call => String(call[0]));
      expect(printed).toContainEqual(expect.stringContaining("could not read the merge-queue runs"));
      expect(printed).not.toContainEqual(expect.stringContaining("reached main without the merge queue"));
    } finally {
      log.mockRestore();
    }
  });

  it("trips on a commit whose only queue runs are another workflow's, or a CI run that did not pass", async () => {
    // The CI-and-passed route answers none for d1; any other run on d1 is not asked about.
    const routes = { [`repos/${REPO}/compare/b...d1?per_page=250`]: compare, [runs("q1")]: { total_count: 1 }, [runs("d1")]: { total_count: 0 } };
    const { fetchImpl, asked } = api(routes);
    expect(await main(["tripwire", "b", "d1"], tripwireEnv, { fetchImpl })).toBe(1);
    expect(asked).toContain(runs("d1"));
    expect(asked.some(path => path.startsWith(`repos/${REPO}/actions/runs?`))).toBe(false);
  });

  it("checks nothing while the switch is off", async () => {
    const { fetchImpl, asked } = api({});
    expect(await main(["tripwire", "b", "d1"], { GITHUB_REPOSITORY: REPO }, { fetchImpl })).toBe(0);
    expect(asked).toEqual([]);
  });
});
