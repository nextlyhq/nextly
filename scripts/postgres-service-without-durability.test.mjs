/**
 * CI's PostgreSQL test service runs without crash durability.
 *
 * The database a postgres integration leg uses is thrown away with its job, so
 * surviving a crash buys it nothing and costs a wait on every commit. Two
 * things make that so, and this file holds the workflow to both: the service's
 * data directory lives on tmpfs, and before the suite runs, a step turns off
 * fsync, synchronous_commit and full_page_writes, then fails the job unless the
 * server reads all three back as off.
 *
 * The population is read from the workflow: every job whose services run a
 * `postgres` image. A floor keeps a reader that found none from passing with
 * nothing to check. And each rule is seen to refuse a workflow that breaks it,
 * by running the same check over the real file with that one part removed.
 *
 * @module postgres-service-without-durability.test
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { load } from "js-yaml";
import { beforeAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKFLOW = path.join(
  HERE,
  "..",
  ".github",
  "workflows",
  "integration.yml"
);

/** The settings PostgreSQL's "Non-Durable Settings" turns off. */
const SETTINGS = ["fsync", "synchronous_commit", "full_page_writes"];

/** The step that runs a postgres leg's suite. */
const SUITE = /\blane:test:integration:postgres\b/;

/**
 * Where the official image keeps its data, by major version, unless the service
 * sets PGDATA. Only the versions this workflow has used: a newer image moved
 * its data directory, and a tmpfs over the old path would leave the data on
 * disk, so an unknown version is refused rather than guessed.
 */
const DATA_DIRECTORY = new Map([[17, "/var/lib/postgresql/data"]]);

/** The postgres services in a parsed workflow, each with the job it belongs to. */
function postgresServices(workflow) {
  return Object.entries(workflow.jobs ?? {}).flatMap(([id, job]) =>
    Object.values(job.services ?? {})
      .filter(service => /^postgres:/.test(String(service.image)))
      .map(service => ({ id, job, service }))
  );
}

/** What is wrong with one job's postgres service and its steps, if anything. */
function jobProblems({ id, job, service }) {
  return [dataDirectoryProblem(service), ...stepProblems(job.steps ?? [])]
    .filter(Boolean)
    .map(problem => `${id}: ${problem}`);
}

/** Where a postgres service keeps its data: PGDATA if it sets one, else its image's. */
function dataDirectory(service) {
  const major = Number(/^postgres:(\d+)/.exec(service.image)?.[1]);
  return service.env?.PGDATA ?? DATA_DIRECTORY.get(major);
}

/** Why the service's data directory is not on tmpfs, or null when it is. */
function dataDirectoryProblem(service) {
  const data = dataDirectory(service);
  if (data === undefined) {
    return `where ${service.image} keeps its data is not known here`;
  }
  return String(service.options).includes(`--tmpfs ${data}`)
    ? null
    : `the service's data directory ${data} is not on tmpfs`;
}

/** What is missing or out of order among a job's steps. */
function stepProblems(steps) {
  const suite = steps.findIndex(step => SUITE.test(String(step.run)));
  const relax = steps.findIndex(step => turnsOffDurability(step.run));
  if (suite === -1) return ["no step runs the postgres suite"];
  if (relax === -1) {
    return [
      `no step turns off and checks ${SETTINGS.join(", ")} before the suite`,
    ];
  }
  return relax > suite
    ? ["durability is turned off only after the suite runs"]
    : [];
}

/**
 * Whether a step's script turns each setting off, reloads, reads each back, and
 * fails the job when they do not all read off.
 */
function turnsOffDurability(run) {
  const script = String(run);
  return (
    SETTINGS.every(
      name =>
        script.includes(`ALTER SYSTEM SET ${name} = off`) &&
        script.includes(`SHOW ${name}`)
    ) &&
    script.includes("pg_reload_conf()") &&
    /exit 1/.test(script)
  );
}

/** Every problem in a workflow's text, or none. */
function problems(text) {
  const services = postgresServices(load(text));
  if (services.length === 0) return ["no job runs a postgres service"];
  return services.flatMap(jobProblems);
}

/** The workflow with `from` replaced once by `to`, refusing a replacement that misses. */
function without(text, from, to = "") {
  expect(text.split(from).length - 1, `exactly one "${from}"`).toBe(1);
  return text.replace(from, to);
}

describe("CI's postgres test service", () => {
  let text;

  beforeAll(async () => {
    text = await readFile(WORKFLOW, "utf8");
  });

  it("runs without crash durability on every job that starts it", () => {
    // The floor: a reader that found no postgres service has checked nothing.
    expect(postgresServices(load(text)).length).toBeGreaterThan(0);
    expect(problems(text)).toEqual([]);
  });

  it("is refused with its data directory left on the runner's disk", () => {
    expect(
      problems(without(text, "\n          --tmpfs /var/lib/postgresql/data"))
    ).toEqual([
      expect.stringMatching(
        /data directory \/var\/lib\/postgresql\/data is not on tmpfs/
      ),
    ]);
  });

  it("is refused when any one setting is left on", () => {
    for (const name of SETTINGS) {
      const broken = without(
        text,
        `-c "ALTER SYSTEM SET ${name} = off"`,
        `-c "SELECT 1"`
      );
      expect(problems(broken), name).toEqual([
        expect.stringMatching(/no step turns off and checks/),
      ]);
    }
  });

  it("is refused when the job does not fail on a setting the server still reads on", () => {
    expect(
      problems(
        without(
          text,
          `echo "::error::the test database still runs with crash durability: $settings"; exit 1;`,
          `true;`
        )
      )
    ).toEqual([expect.stringMatching(/no step turns off and checks/)]);
  });

  it("is refused when durability is turned off only after the suite", () => {
    const workflow = load(text);
    const [{ job }] = postgresServices(workflow);
    const relax = job.steps.findIndex(step => turnsOffDurability(step.run));
    const [step] = job.steps.splice(relax, 1);
    job.steps.push(step);
    expect(postgresServices(workflow).flatMap(jobProblems)).toEqual([
      expect.stringMatching(/only after the suite runs/),
    ]);
  });

  it("refuses an image whose data directory it does not know", () => {
    expect(
      problems(without(text, "image: postgres:17", "image: postgres:18"))
    ).toEqual([
      expect.stringMatching(
        /where postgres:18 keeps its data is not known here/
      ),
    ]);
  });
});
