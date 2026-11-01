/**
 * The nightly newest-minor run (`.github/workflows/newest-minor.yml`): it
 * installs the newest Next.js and React releases within the supported ranges
 * and runs the scaffold build and browser suite against them. It reuses the
 * scaffold build's own matrix, whose pull request runs must not change, and it
 * must never write a cache a pull request or `main` reads.
 */
import { readFileSync } from "node:fs";

import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

const read = path => load(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
const nightly = read(".github/workflows/newest-minor.yml");
const scaffold = read(".github/workflows/scaffold-build.yml");
const triggers = workflow => workflow.on ?? workflow[true];
const text = value => JSON.stringify(value);

describe("the newest-minor workflow", () => {
  it("runs on its schedule or by hand, never on a pull request or a push", () => {
    expect(Object.keys(triggers(nightly)).sort()).toEqual(["schedule", "workflow_dispatch"]);
  });

  it("reads the repository, and only its report job writes, to issues alone", () => {
    expect(nightly.permissions).toEqual({ contents: "read" });
    const writers = Object.entries(nightly.jobs).filter(([, job]) => job.permissions !== undefined);
    expect(writers.map(([id, job]) => [id, job.permissions])).toEqual([["report", { issues: "write" }]]);
  });

  it("runs the scaffold build's own matrix with the resolved versions", () => {
    expect(nightly.jobs.scaffold.uses).toBe("./.github/workflows/scaffold-build.yml");
    expect(nightly.jobs.scaffold.with).toEqual({ versions: "${{ needs.resolve.outputs.versions }}" });
  });

  it("installs the newest minors before it builds and runs the browser suite, and checks they are the ones installed", () => {
    const names = nightly.jobs.browser.steps.map(step => step.name);
    const at = name => names.indexOf(name);
    expect(at("Use the newest minors")).toBeGreaterThan(at("Install dependencies"));
    expect(at("Check the newest minors are the ones installed")).toBe(at("Use the newest minors") + 1);
    expect(at("Build packages")).toBeGreaterThan(at("Check the newest minors are the ones installed"));
    expect(at("Run browser tests (production server)")).toBeGreaterThan(at("Build packages"));
  });

  it("never saves or reads a Turbo cache, nor saves the pnpm store", () => {
    const steps = Object.values(nightly.jobs).flatMap(job => job.steps ?? []);
    expect(steps.filter(step => String(step.uses ?? "").startsWith("actions/cache"))).toEqual([]);
    expect(steps.filter(step => step.with?.save !== undefined)).toEqual([]);
    expect(text(nightly)).not.toMatch(/TURBO_TOKEN|TURBO_REMOTE_CACHE|TURBO_CACHE_DIR/);
  });

  it("reports after every job, whatever their outcome, unless it was cancelled", () => {
    expect([nightly.jobs.report.needs].flat().sort()).toEqual(Object.keys(nightly.jobs).filter(id => id !== "report").sort());
    expect(nightly.jobs.report.if).toBe("${{ !cancelled() }}");
  });
});

describe("the scaffold build, as the nightly calls it", () => {
  const steps = scaffold.jobs["scaffold-build"].steps;
  const usingInput = steps.filter(step => /\binputs\./.test(text(step)));

  it("takes the versions as an input that is empty unless given", () => {
    expect(triggers(scaffold).workflow_call.inputs).toEqual({
      versions: expect.objectContaining({ type: "string", default: "" }),
    });
    expect(triggers(scaffold).pull_request).toBeDefined();
  });

  it("reads the input in one step only, run only when the input is given, just before the build", () => {
    expect(usingInput.map(step => step.name)).toEqual(["Install the newest Next.js and React minors"]);
    const [install] = usingInput;
    expect(install.if).toBe("inputs.versions");
    expect(steps[steps.indexOf(install) + 1].name).toBe("Build the scaffolded project");
    // Through the environment only, never spliced into the script.
    expect(install.run).not.toContain("inputs.");
    expect(install.env).toEqual({ VERSIONS: "${{ inputs.versions }}" });
  });
});
