/**
 * CI's PostgreSQL test service keeps its data on tmpfs.
 *
 * The database a postgres integration leg uses is thrown away with its job, so
 * its data directory lives in memory, as the mysql leg's does, and the runner's
 * shared disk sets no pace for the suite.
 *
 * The population is read from the workflow: every job whose services run a
 * `postgres` image. A floor keeps a reader that found none from passing with
 * nothing to check. The tmpfs mount is read as Docker reads it, the mount path
 * as a whole argument, so a mount beside the data directory does not count for
 * it. And each rule is seen to refuse a workflow that breaks it, by running the
 * same check over the real file with that one part changed.
 *
 * @module postgres-service-data-on-tmpfs.test
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
      .map(service => ({ id, service }))
  );
}

/** Where a postgres service keeps its data: PGDATA if it sets one, else its image's. */
function dataDirectory(service) {
  const major = Number(/^postgres:(\d+)/.exec(service.image)?.[1]);
  return service.env?.PGDATA ?? DATA_DIRECTORY.get(major);
}

/**
 * The paths a service's options mount on tmpfs, as Docker reads them: the
 * argument after `--tmpfs` (or after `--tmpfs=`), up to its `:options`.
 */
function tmpfsMounts(options) {
  const words = String(options).split(/\s+/);
  const mounts = [];
  words.forEach((word, i) => {
    if (word === "--tmpfs") mounts.push(words[i + 1]);
    else if (word.startsWith("--tmpfs=")) mounts.push(word.slice(8));
  });
  return mounts.filter(Boolean).map(mount => mount.split(":")[0]);
}

/** Why the service's data directory is not on tmpfs, or null when it is. */
function dataDirectoryProblem({ id, service }) {
  const data = dataDirectory(service);
  if (data === undefined) {
    return `${id}: where ${service.image} keeps its data is not known here`;
  }
  return tmpfsMounts(service.options).includes(data)
    ? null
    : `${id}: the service's data directory ${data} is not on tmpfs`;
}

/** Every problem in a workflow's text, or none. */
function problems(text) {
  const services = postgresServices(load(text));
  if (services.length === 0) return ["no job runs a postgres service"];
  return services.map(dataDirectoryProblem).filter(Boolean);
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

  it("keeps its data on tmpfs on every job that starts it", () => {
    // The floor: a reader that found no postgres service has checked nothing.
    expect(postgresServices(load(text)).length).toBeGreaterThan(0);
    expect(problems(text)).toEqual([]);
  });

  it("is refused with its data directory left on the runner's disk", () => {
    expect(
      problems(without(text, "\n          --tmpfs /var/lib/postgresql/data"))
    ).toEqual([expect.stringMatching(/is not on tmpfs/)]);
  });

  it("is refused when tmpfs is mounted beside the data directory rather than on it", () => {
    expect(
      problems(
        without(
          text,
          "--tmpfs /var/lib/postgresql/data",
          "--tmpfs /var/lib/postgresql/data-backup"
        )
      )
    ).toEqual([expect.stringMatching(/is not on tmpfs/)]);
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
