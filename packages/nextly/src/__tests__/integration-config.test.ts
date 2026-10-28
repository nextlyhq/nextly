/**
 * The integration run's projects run every integration file once, and a file that
 * takes a lock MySQL keeps for the whole server (the migrate lock's old,
 * shared name) only after every other file has finished, one at a time. A
 * database per worker isolates everything else, but not that name: a
 * migration on another worker checks it too and would find it busy.
 *
 * Which files take it is read from their source, not from the config's list,
 * so a new one cannot run beside the others unnoticed.
 */
import { globSync, readFileSync } from "node:fs";
import { sep } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { integrationProjects } from "./worker-database-guard";

const root = fileURLToPath(new URL("../..", import.meta.url));

interface Project {
  test: {
    name: string;
    include: string[];
    exclude?: string[];
    fileParallelism?: boolean;
    sequence?: { groupOrder?: number };
  };
}

const projects = integrationProjects({
  include: ["src/**/*.integration.test.ts"],
}) as Project[];
// The paths the config lists, with `/` between parts on every platform:
// `globSync` answers with the platform's own separator, `\` on Windows.
const integrationFiles = globSync("src/**/*.integration.test.ts", {
  cwd: root,
})
  .map(file => file.split(sep).join("/"))
  .sort();
const takesServerWideLock = integrationFiles.filter(file =>
  /GET_LOCK\(\s*['"]nextly:migrate['"]/.test(
    readFileSync(`${root}/${file}`, "utf8")
  )
);

describe("the integration config's groups", () => {
  it("finds the files that take the server-wide lock name", () => {
    // The scan's own control: at least the MySQL lock suite takes it.
    expect(takesServerWideLock).toContain(
      "src/domains/schema/pipeline/__tests__/migrate-lock-mysql-pins-connection.integration.test.ts"
    );
  });

  it("runs those files in a later group than every other file, one at a time", () => {
    const serverWide = projects.find(project =>
      takesServerWideLock.every(file => project.test.include.includes(file))
    );
    expect(serverWide).toBeDefined();
    expect([...(serverWide?.test.include ?? [])].sort()).toEqual(
      takesServerWideLock
    );
    expect(serverWide?.test.fileParallelism).toBe(false);
    for (const other of projects.filter(project => project !== serverWide)) {
      expect(other.test.exclude).toEqual(
        expect.arrayContaining(takesServerWideLock)
      );
      expect(other.test.sequence?.groupOrder ?? 0).toBeLessThan(
        serverWide?.test.sequence?.groupOrder ?? 0
      );
    }
  });
});
