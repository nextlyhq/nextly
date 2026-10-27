/**
 * pnpm's package store is cached by one composite action
 * (`.github/actions/pnpm-store`), restored on every event and saved only by a
 * push to `main`, never by a pull request: a pull request's saved store sits
 * under its own ref, where no other run reads it.
 */
import { readdirSync, readFileSync } from "node:fs";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const read = path => load(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const WORKFLOWS = readdirSync(new URL("../.github/workflows/", import.meta.url))
  .filter(name => /\.ya?ml$/.test(name))
  .map(name => `.github/workflows/${name}`);
const COMPOSITES = readdirSync(new URL("../.github/actions/", import.meta.url)).map(
  name => `.github/actions/${name}/action.yml`
);
const STORE = "./.github/actions/pnpm-store";
const INTEGRATION_SETUP = "./.github/actions/integration-setup";

/** Every steps list in a file, as `{ where, steps, push }`: a workflow's jobs, or a composite's steps. */
function stepLists(path) {
  const file = read(path);
  if (file.runs) return [{ where: path, steps: file.runs.steps ?? [], composite: true }];
  const on = file.on ?? file[true] ?? {};
  return Object.entries(file.jobs ?? {}).map(([id, job]) => ({
    where: `${path} ${id}`,
    steps: job.steps ?? [],
    push: on.push,
  }));
}

const allLists = [...WORKFLOWS, ...COMPOSITES].flatMap(stepLists);
const isInstall = step => /^pnpm install\b/.test(String(step.run ?? "").trim());

describe("the pnpm store cache", () => {
  it("is read from the files it governs", () => {
    expect(WORKFLOWS.length).toBeGreaterThan(10);
    expect(allLists.filter(list => list.steps.some(isInstall)).length).toBeGreaterThan(20);
  });

  it("is never left to setup-node, whose cache saves on every event", () => {
    const withCache = allLists.flatMap(list =>
      list.steps
        .filter(step => String(step.uses ?? "").startsWith("actions/setup-node@") && step.with?.cache !== undefined)
        .map(() => list.where)
    );
    expect(withCache).toEqual([]);
  });

  it("is restored before every install", () => {
    const unrestored = allLists
      .filter(list => list.steps.some(isInstall))
      .filter(list => {
        const install = list.steps.findIndex(isInstall);
        return !list.steps
          .slice(0, install)
          .some(step => step.uses === STORE && step.with?.save !== "true");
      })
      .map(list => list.where);
    expect(unrestored).toEqual([]);
  });

  it("is saved only on a push, and only where a push means main", () => {
    const saves = allLists.flatMap(list =>
      list.steps.filter(step => step.uses === STORE && step.with?.save === "true").map(step => ({ list, step }))
    );
    expect(saves.length).toBeGreaterThan(0);
    for (const { list, step } of saves) {
      expect(step.if, list.where).toBe("github.event_name == 'push'");
      if (!list.composite) expect(list.push, list.where).toEqual({ branches: ["main"] });
    }
  });

  it("is saved by the integration setup only for workflows that push to main alone", () => {
    const callers = allLists.filter(list => list.steps.some(step => step.uses === INTEGRATION_SETUP));
    expect(callers.length).toBeGreaterThan(0);
    for (const caller of callers) expect(caller.push ?? null, caller.where).toEqual({ branches: ["main"] });
  });
});

describe("the pnpm-store action", () => {
  const steps = read(".github/actions/pnpm-store/action.yml").runs.steps;
  const named = name => steps.find(step => step.name === name);

  it("restores and saves under one key, and restores an older store by prefix", () => {
    const restore = named("Restore the store");
    const lookup = named("Ask whether this store is saved already");
    const save = named("Save the store");
    expect(restore.with.key).toBe(save.with.key);
    expect(lookup.with.key).toBe(save.with.key);
    expect(restore.with.key.startsWith(restore.with["restore-keys"].trim())).toBe(true);
  });

  it("saves only when asked to, after finding the key unsaved", () => {
    const lookup = named("Ask whether this store is saved already");
    expect(lookup.with["lookup-only"]).toBe(true);
    expect(named("Restore the store").if).toBe("inputs.save != 'true'");
    expect(named("Save the store").if).toBe("inputs.save == 'true' && steps.saved.outputs.cache-hit != 'true'");
  });
});
