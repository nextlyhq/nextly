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
  const open = { text: "ruleset 7 (protect-main) lets Team 42 bypass it (always)", known: true };
  const unchecked = { text: "ruleset 7 (protect-main)'s bypass actors could not be read", known: false };

  it("selects only on a pull request, with the switch on and no path around the queue", () => {
    expect(selectionMode({ event: "pull_request", switchValue: "on", paths: [] }).mode).toBe("select");
  });

  it("tests everything on main, in the queue and on a dispatch, whatever the switch says", () => {
    for (const event of ["push", "merge_group", "workflow_dispatch"]) {
      expect(selectionMode({ event, switchValue: "on", paths: [] })).toMatchObject({ mode: "full", guardFailure: null });
    }
  });

  it("runs a pull request in shadow while the switch is anything but on", () => {
    for (const switchValue of ["", "off", "true", "ON"]) {
      expect(selectionMode({ event: "pull_request", switchValue, paths: [] })).toMatchObject({ mode: "shadow", guardFailure: null });
    }
  });

  it("tests everything, without failing, when main's rules could not be read", () => {
    expect(selectionMode({ event: "pull_request", switchValue: "on", paths: null })).toMatchObject({ mode: "full", guardFailure: null });
  });

  it("tests everything and fails when the switch is on and a path around the queue is known", () => {
    const verdict = selectionMode({ event: "pull_request", switchValue: "on", paths: [unchecked, open] });
    expect(verdict.mode).toBe("full");
    expect(verdict.guardFailure).toContain(SELECTION_SWITCH);
    expect(verdict.guardFailure).toContain("lets Team 42 bypass it");
  });

  it("tests everything without failing when a path could not be checked, as bypass actors read without administration rights cannot", () => {
    expect(selectionMode({ event: "pull_request", switchValue: "on", paths: [unchecked] })).toMatchObject({
      mode: "full",
      guardFailure: null,
      reason: expect.stringContaining("could not be confirmed"),
    });
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
  const queue = { id: 1, name: "protect-main", enforcement: "active", bypass_actors: [] };
  const signing = { id: 2, name: "signed-commits", enforcement: "active", bypass_actors: [] };
  const rules = [{ type: "pull_request", ruleset_id: 1 }, { type: "merge_queue", ruleset_id: 1 }, { type: "required_signatures", ruleset_id: 2 }];
  const releaseBot = { actor_type: "Integration", actor_id: 9, bypass_mode: "always" };
  const team = { actor_type: "Team", actor_id: 42, bypass_mode: "pull_request" };

  it("finds none for an active queue ruleset with no bypass actors", () => {
    expect(directPaths([queue, signing], rules)).toEqual([]);
  });

  it("ignores a bypass actor on a ruleset that does not carry the merge queue", () => {
    // Bypassing the signing rules leaves the queue ruleset's rules in force.
    expect(directPaths([queue, { ...signing, bypass_actors: [releaseBot] }], rules)).toEqual([]);
  });

  it("does not read the bypass actors of a ruleset that does not carry the merge queue", () => {
    expect(directPaths([queue, { ...signing, bypass_actors: null }], rules)).toEqual([]);
    expect(directPaths([queue, { id: 2, unreadable: true }], rules)).toEqual([]);
  });

  it("names a bypass actor on the queue ruleset itself as a known way around the queue", () => {
    expect(directPaths([{ ...queue, bypass_actors: [team] }, signing], rules)).toEqual([
      { text: "ruleset 1 (protect-main) let Team 42 bypass the merge queue (pull_request)", known: true },
    ]);
  });

  it("holds the queue through any one queue ruleset nobody may bypass, whatever another lets through", () => {
    const second = { id: 3, name: "queue-too", enforcement: "active", bypass_actors: [team] };
    const both = [...rules, { type: "merge_queue", ruleset_id: 3 }];
    expect(directPaths([queue, second], both)).toEqual([]);
  });

  it("names only an actor every queue ruleset lets through, when each names someone", () => {
    const both = [...rules, { type: "merge_queue", ruleset_id: 3 }];
    const otherQueue = { id: 3, name: "queue-too", enforcement: "active" };
    expect(directPaths([{ ...queue, bypass_actors: [team] }, { ...otherQueue, bypass_actors: [releaseBot] }], both)).toEqual([]);
    expect(directPaths([{ ...queue, bypass_actors: [team, releaseBot] }, { ...otherQueue, bypass_actors: [releaseBot] }], both)).toEqual([
      { text: "ruleset 1 (protect-main) and ruleset 3 (queue-too) let Integration 9 bypass the merge queue (always)", known: true },
    ]);
  });

  it("treats a queue ruleset whose bypass actors, or whose whole answer, could not be read as unchecked, not as none", () => {
    expect(directPaths([{ ...queue, bypass_actors: null }], rules)).toEqual([
      { text: expect.stringContaining("bypass actors could not be read"), known: false },
    ]);
    expect(directPaths([{ id: 1, unreadable: true }], rules)).toEqual([{ text: expect.stringContaining("could not be read"), known: false }]);
  });

  it("knows the queue is missing when no active ruleset carries it", () => {
    expect(directPaths([signing], [{ type: "required_signatures", ruleset_id: 2 }])).toEqual([
      { text: "no active ruleset puts the merge queue on main", known: true },
    ]);
    expect(directPaths([{ ...queue, enforcement: "evaluate" }], rules)).toEqual([
      { text: "no active ruleset puts the merge queue on main", known: true },
    ]);
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

/** The routes a selecting run reads, for one ruleset (id 1) behind main's rules. */
const ruleset1 = `repos/${REPO}/rulesets/1`;
const ruleset2 = `repos/${REPO}/rulesets/2`;
const clearPaths = {
  [rulesPage(1)]: queueRules,
  [ruleset1]: { id: 1, name: "protect-main", enforcement: "active", bypass_actors: [] },
};
const selectEnv = output => ({ GITHUB_REPOSITORY: REPO, GITHUB_EVENT_NAME: "pull_request", [SELECTION_SWITCH]: "on", GITHUB_ENV: output });
const outputFile = () => join(mkdtempSync(join(tmpdir(), "merge-path-")), "out");

/** Runs `select` against `routes`, and returns its exit code, the mode it set and what it printed. */
async function runSelect(routes) {
  const output = outputFile();
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    const code = await main(["select"], selectEnv(output), api(routes));
    return { code, mode: readFileSync(output, "utf8"), printed: log.mock.calls.map(call => String(call[0])).join("\n") };
  } finally {
    log.mockRestore();
  }
}

describe("main", () => {
  it("sets the mode for the job's later steps and fails the step on a switch with no queue behind it", async () => {
    const { code, mode } = await runSelect({ ...clearPaths, [rulesPage(1)]: [{ type: "pull_request", ruleset_id: 1 }] });
    expect(code).toBe(1);
    expect(mode).toBe(`${MODE_VARIABLE}=full\n`);
  });

  it("selects only when every path to main is read and goes through the queue", async () => {
    const { code, mode } = await runSelect(clearPaths);
    expect(code).toBe(0);
    expect(mode).toBe(`${MODE_VARIABLE}=select\n`);
  });

  it("tests everything and fails when a ruleset it can read names a bypass actor", async () => {
    const bypassed = { id: 1, name: "protect-main", enforcement: "active", bypass_actors: [{ actor_type: "RepositoryRole", actor_id: 5, bypass_mode: "always" }] };
    const { code, mode, printed } = await runSelect({ ...clearPaths, [ruleset1]: bypassed });
    expect(code).toBe(1);
    expect(mode).toBe(`${MODE_VARIABLE}=full\n`);
    expect(printed).toContain("let RepositoryRole 5 bypass the merge queue (always)");
  });

  it("tests everything, without failing, when it cannot read the bypass actors, as a workflow's own token cannot", async () => {
    const { code, mode, printed } = await runSelect({ ...clearPaths, [ruleset1]: { id: 1, name: "protect-main", enforcement: "active", bypass_actors: null } });
    expect(code).toBe(0);
    expect(mode).toBe(`${MODE_VARIABLE}=full\n`);
    expect(printed).toContain("could not be confirmed");
  });

  it("tests everything, without failing, when the queue ruleset cannot be read", async () => {
    const { code, mode } = await runSelect({ ...clearPaths, [ruleset1]: undefined });
    expect(code).toBe(0);
    expect(mode).toBe(`${MODE_VARIABLE}=full\n`);
  });

  it("still selects when another ruleset, layered over the queue's, lets someone bypass it", async () => {
    const routes = {
      ...clearPaths,
      [rulesPage(1)]: [...queueRules, { type: "required_signatures", ruleset_id: 2 }],
      [ruleset2]: { id: 2, name: "signed-commits", enforcement: "active", bypass_actors: [{ actor_type: "Integration", actor_id: 9, bypass_mode: "always" }] },
    };
    const { code, mode } = await runSelect(routes);
    expect(code).toBe(0);
    expect(mode).toBe(`${MODE_VARIABLE}=select\n`);
  });

  it("reads every page of main's rules, so a merge queue on a later page still counts", async () => {
    const firstPage = Array.from({ length: 100 }, () => ({ type: "required_status_checks", ruleset_id: 1 }));
    const { code, mode } = await runSelect({ ...clearPaths, [rulesPage(1)]: firstPage, [rulesPage(2)]: [{ type: "merge_queue", ruleset_id: 1 }] });
    expect(code).toBe(0);
    expect(mode).toBe(`${MODE_VARIABLE}=select\n`);
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
