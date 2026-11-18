/**
 * `nextly upgrade [version]` moves every Nextly package of a project to one
 * release with the project's own package manager, and leaves the project as
 * it was when it cannot.
 *
 * Each case is a real project, installed by a real package manager from a
 * registry inside this process, with the command run from source as a
 * process. What would separate a correct command from a broken one:
 *
 * - a package left behind, or moved to another release than the rest;
 * - a release chosen from the wrong tag: `latest`, or the newest under any
 *   tag, where the installed release's channel names another;
 * - a failure that leaves `package.json` or the lockfile changed, or that
 *   restores both files and leaves another release installed beside them.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import type { LocalRegistry } from "../../__tests__/helpers/local-registry";
import { NEXTLY_RUN_TIMEOUT } from "../../__tests__/helpers/run-nextly";

import {
  CANDIDATE,
  MANAGERS,
  MIDDLE,
  NEWEST,
  OLDEST,
  PACKAGES,
  STABLE,
  UNSERVED,
  createProject,
  hasManager,
  startNextlyRegistry,
  type Manager,
  type UpgradeProject,
} from "./helpers/upgrade-project";

/**
 * These cases name no database, so they run once: on the leg that sets no
 * database address, and not again on each leg that tests one.
 */
const OTHER_LEG = Boolean(
  process.env.TEST_POSTGRES_URL ?? process.env.TEST_MYSQL_URL
);

/** A project install and a run of the command, each of which compiles or downloads. */
const TIMEOUT = NEXTLY_RUN_TIMEOUT * 2;

let registry: LocalRegistry;
const projects: UpgradeProject[] = [];

beforeAll(async () => {
  registry = await startNextlyRegistry();
});

afterAll(async () => {
  await registry.close();
});

afterEach(() => {
  registry.failDownloadOf(undefined);
  for (const project of projects.splice(0)) project.remove();
});

async function project(
  args: Omit<Parameters<typeof createProject>[0], "registry">
): Promise<UpgradeProject> {
  const made = await createProject({ ...args, registry });
  projects.push(made);
  return made;
}

/** Every package's declared and installed version. */
const versions = (of: UpgradeProject) =>
  Object.fromEntries(
    PACKAGES.map(name => [
      name,
      { declared: of.declared(name), installed: of.installed(name) },
    ])
  );

/** Every package declared and installed at `version`, exactly. */
const allAt = (version: string) =>
  Object.fromEntries(
    PACKAGES.map(name => [name, { declared: version, installed: version }])
  );

const output = (run: { stdout: string; stderr: string }) =>
  `${run.stdout}\n${run.stderr}`;

/**
 * A manager this machine lacks is skipped here and required in CI, where a
 * skipped manager would be a case nobody ran.
 */
function managerCases(manager: Manager, define: () => void): void {
  const present = hasManager(manager);
  if (!present && process.env.CI) {
    it(`${manager} is installed on the machine that runs these tests`, () => {
      expect(present, `${manager} --version did not run`).toBe(true);
    });
    return;
  }
  describe.skipIf(!present)(`with ${manager}`, define);
}

describe.skipIf(OTHER_LEG)(
  "nextly upgrade moves every Nextly package to one release",
  () => {
    for (const manager of MANAGERS) {
      managerCases(manager, () => {
        it(
          "with no version, moves each to the release its channel's tag names, exactly, and says what to run next",
          async () => {
            const app = await project({ manager, versions: OLDEST });
            // The fixture's control: installed where the command starts from.
            expect(versions(app)).toEqual(allAt(OLDEST));

            const run = await app.nextly(["upgrade"]);

            expect(run.status, output(run)).toBe(0);
            expect(versions(app)).toEqual(allAt(MIDDLE));
            expect(run.stdout).toContain(
              `https://github.com/nextlyhq/nextly/releases/tag/v${MIDDLE}`
            );
            expect(run.stdout).toContain("nextly migrate:create");
            expect(run.stdout).toMatch(/then.*`nextly migrate`/s);
          },
          TIMEOUT
        );

        it(
          "moves to an older release when it is named",
          async () => {
            const app = await project({ manager, versions: MIDDLE });

            const run = await app.nextly(["upgrade", OLDEST]);

            expect(run.status, output(run)).toBe(0);
            expect(versions(app)).toEqual(allAt(OLDEST));
          },
          TIMEOUT
        );

        it(
          "moves a package held at another version into lockstep",
          async () => {
            const app = await project({
              manager,
              versions: {
                nextly: OLDEST,
                "@nextlyhq/admin": NEWEST,
                "@nextlyhq/adapter-sqlite": OLDEST,
              },
            });
            expect(app.installed("@nextlyhq/admin")).toBe(NEWEST);

            const run = await app.nextly(["upgrade"]);

            expect(run.status, output(run)).toBe(0);
            expect(versions(app)).toEqual(allAt(MIDDLE));
          },
          TIMEOUT
        );

        it(
          "leaves package.json, the lockfile and every installed package as they were when the registry fails part-way",
          async () => {
            const app = await project({ manager, versions: OLDEST });
            const before = app.files();
            const downloadsBefore = registry.downloads.length;
            // One package's download fails; the others' are served.
            registry.failDownloadOf(`@nextlyhq/admin@${UNSERVED}`);

            const run = await app.nextly(["upgrade", UNSERVED]);

            expect(run.status, output(run)).toBe(1);
            // The control: this run's install did reach the registry for it.
            expect(registry.downloads.slice(downloadsBefore)).toContain(
              `@nextlyhq/admin@${UNSERVED}`
            );
            expect(app.files()).toEqual(before);
            expect(versions(app)).toEqual(allAt(OLDEST));
            expect(output(run)).toContain("(UPGRADE_INSTALL_FAILED)");
          },
          TIMEOUT
        );
      });
    }

    managerCases("npm", () => {
      it(
        "leaves all three as they were when a dependencies script fails after npm changed node_modules",
        async () => {
          // npm runs `dependencies` once it has changed `node_modules` and both
          // files. It passes for the fixture's install and fails once asked to.
          const app = await project({
            manager: "npm",
            versions: OLDEST,
            manifest: {
              scripts: {
                dependencies:
                  "node -e \"process.exit(require('fs').existsSync('fail-now') ? 1 : 0)\"",
              },
            },
          });
          const before = app.files();
          const downloadsBefore = registry.downloads.length;
          writeFileSync(join(app.dir, "fail-now"), "");

          const run = await app.nextly(["upgrade"]);

          expect(run.status, output(run)).toBe(1);
          // The control: npm did fetch the new release, so `node_modules` had
          // changed by the time the script failed.
          expect(registry.downloads.slice(downloadsBefore)).toContain(
            `nextly@${MIDDLE}`
          );
          expect(output(run)).toContain("(UPGRADE_INSTALL_FAILED)");
          expect(app.files()).toEqual(before);
          expect(versions(app)).toEqual(allAt(OLDEST));
        },
        TIMEOUT
      );
    });
  }
);

describe.skipIf(OTHER_LEG)(
  "nextly upgrade with no version follows the installed release's channel",
  () => {
    it(
      "changes nothing on the channel's newest release, exits 0, and names the newer release another tag holds",
      async () => {
        const app = await project({ manager: "npm", versions: MIDDLE });
        const before = app.files();

        const run = await app.nextly(["upgrade"]);

        expect(run.status, output(run)).toBe(0);
        expect(app.files()).toEqual(before);
        expect(versions(app)).toEqual(allAt(MIDDLE));
        expect(run.stdout).toContain(`nextly upgrade ${NEWEST}`);
        expect(run.stdout).toContain("beta");
      },
      TIMEOUT
    );

    it(
      "on the channel's newest release, still moves a package held at another version into lockstep",
      async () => {
        const app = await project({
          manager: "npm",
          versions: {
            nextly: MIDDLE,
            "@nextlyhq/admin": OLDEST,
            "@nextlyhq/adapter-sqlite": MIDDLE,
          },
        });

        const run = await app.nextly(["upgrade"]);

        expect(run.status, output(run)).toBe(0);
        expect(versions(app)).toEqual(allAt(MIDDLE));
      },
      TIMEOUT
    );

    it(
      "lists each package's move in a dry run, changes nothing and exits 0",
      async () => {
        const app = await project({ manager: "npm", versions: OLDEST });
        const before = app.files();

        const run = await app.nextly(["upgrade", "--dry-run"]);

        expect(run.status, output(run)).toBe(0);
        for (const name of PACKAGES) {
          expect(run.stdout).toContain(
            `Would move ${name} from ${OLDEST} to ${MIDDLE}`
          );
        }
        expect(run.stdout).toContain("Dry run: nothing was changed.");
        expect(app.files()).toEqual(before);
        expect(versions(app)).toEqual(allAt(OLDEST));
      },
      TIMEOUT
    );

    it(
      "names in a dry run the refusal a real run would make, and exits 0",
      async () => {
        const app = await project({ manager: "npm", versions: OLDEST });
        const before = app.files();

        const run = await app.nextly(["upgrade", "9.0.0-beta.9", "--dry-run"]);

        expect(run.status, output(run)).toBe(0);
        expect(run.stdout).toContain("A real run would refuse:");
        expect(run.stdout).toContain("9.0.0-beta.9");
        expect(run.stdout).toContain(`nextly upgrade ${MIDDLE}`);
        expect(app.files()).toEqual(before);
      },
      TIMEOUT
    );

    it(
      "follows latest from a release with no prerelease identifier",
      async () => {
        const app = await project({ manager: "npm", versions: STABLE });

        const run = await app.nextly(["upgrade"]);

        expect(run.status, output(run)).toBe(0);
        // `latest` names the oldest prerelease here; `alpha` and `beta` are newer.
        expect(versions(app)).toEqual(allAt(OLDEST));
      },
      TIMEOUT
    );

    /** A refusal that can name no release: every tag, each with its release. */
    function expectEveryTag(run: { stdout: string; stderr: string }): void {
      for (const [tag, version] of [
        ["latest", OLDEST],
        ["alpha", MIDDLE],
        ["beta", NEWEST],
      ]) {
        expect(output(run)).toMatch(new RegExp(`${tag}[^\\n]*${version}`));
      }
      expect(output(run)).toContain("nextly upgrade <version>");
    }

    it(
      "changes nothing and exits 1 on a channel the registry has no tag for, naming every tag",
      async () => {
        const app = await project({ manager: "npm", versions: CANDIDATE });
        const before = app.files();

        const run = await app.nextly(["upgrade"]);

        expect(run.status, output(run)).toBe(1);
        expect(app.files()).toEqual(before);
        expect(versions(app)).toEqual(allAt(CANDIDATE));
        expect(output(run)).toContain("rc");
        expectEveryTag(run);
      },
      TIMEOUT
    );

    it(
      "does the same where the packages are not installed",
      async () => {
        const app = await project({
          manager: "npm",
          versions: OLDEST,
          install: false,
        });
        const before = app.files();

        const run = await app.nextly(["upgrade"]);

        expect(run.status, output(run)).toBe(1);
        expect(app.files()).toEqual(before);
        expect(app.installed("nextly")).toBeUndefined();
        expect(output(run)).toContain("not installed");
        expectEveryTag(run);
      },
      TIMEOUT
    );

    it.each([`9.0.0-beta.9`, "not-a-version"])(
      "refuses %s, which is not a published release, naming the installed channel's release",
      async given => {
        const app = await project({ manager: "npm", versions: OLDEST });
        const before = app.files();

        const run = await app.nextly(["upgrade", given]);

        expect(run.status, output(run)).toBe(1);
        expect(app.files()).toEqual(before);
        expect(versions(app)).toEqual(allAt(OLDEST));
        expect(output(run)).toContain(given);
        expect(output(run)).toContain(`nextly upgrade ${MIDDLE}`);
      },
      TIMEOUT
    );

    it.each([`9.0.0-beta.9`, "not-a-version"])(
      "refuses %s with every tag where the packages are not installed",
      async given => {
        const app = await project({
          manager: "npm",
          versions: OLDEST,
          install: false,
        });
        const before = app.files();

        const run = await app.nextly(["upgrade", given]);

        expect(run.status, output(run)).toBe(1);
        expect(app.files()).toEqual(before);
        expectEveryTag(run);
      },
      TIMEOUT
    );
  }
);
