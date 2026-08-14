/**
 * A scaffolded project must arrive with an agent guide, and the template source of that guide
 * must NOT be a live instruction file in this repository.
 *
 * Both halves are the same mechanism seen from two sides. `AGENTS.md` and `CLAUDE.md` are read as
 * instructions for whatever directory they sit in, so the name that makes them work in a
 * generated project is the name that makes them misfire in the template: an agent maintaining
 * `templates/base` would follow scaffold guidance — an unresolved `{{databaseDialect}}`, commands
 * for a standalone app — instead of the monorepo's own.
 *
 * So the invariant is asserted on the NAME the template stores them under as well as on their
 * arrival in a project. Asserting only the second passes while the source sits in the repository
 * under its special name, which is the state this replaces.
 */
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { DatabaseConfig } from "../types";
import { copyTemplate } from "../utils/template";

const here = path.dirname(fileURLToPath(import.meta.url));
const templatesRoot = path.resolve(here, "../../../../templates");

const exists = (p: string): Promise<boolean> =>
  stat(p).then(
    () => true,
    () => false
  );

/** Every file under `dir`, as paths relative to it. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    if (entry.name === "node_modules") continue;
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      for (const nested of await filesUnder(child)) {
        found.push(path.join(entry.name, nested));
      }
    } else {
      found.push(entry.name);
    }
  }
  return found;
}

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

describe("the guide source stays inert in this repository", () => {
  // Read once: the assertion and its control must be answered by the SAME walk, or a walk that
  // reached nothing would satisfy the absence check while the control was proved elsewhere.
  let all: string[];

  beforeAll(async () => {
    all = await filesUnder(templatesRoot);
  });

  // The control, and it runs first because everything below is an absence claim. A walk that
  // returned nothing — a moved templates directory, a rename of the sources — would otherwise
  // certify the invariant without having read a single file.
  it("is looking at the real templates directory", () => {
    expect(all).toContain(path.join("base", "AGENTS.md.template"));
    expect(all).toContain(path.join("base", "CLAUDE.md.template"));
    expect(all).toContain(path.join("plugin", "AGENTS.md.template"));
    expect(all).toContain(path.join("plugin", "CLAUDE.md.template"));
  });

  it.each(["AGENTS.md", "CLAUDE.md"])(
    "stores no file named %s under templates/",
    special => {
      const offenders = all.filter(file => path.basename(file) === special);
      expect(
        offenders,
        `${offenders.join(", ")} would be read as instructions for this repository`
      ).toEqual([]);
    }
  );
});

// A REAL scaffold onto a real filesystem, for both shapes the CLI produces. The rename is one
// table shared by the app path and the plugin path, and a mocked filesystem would confirm the
// call was made rather than that a project ends up with the file.
describe("a scaffolded project arrives with the guide", () => {
  let workdir: string;

  beforeAll(() => {
    // Offline: version resolution falls back to `latest`. This asserts files, not versions.
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline test")));
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    if (workdir) await rm(workdir, { recursive: true, force: true });
  });

  it.each([
    { projectType: "blank" as const, name: "my-app" },
    { projectType: "plugin" as const, name: "@acme/nextly-plugin-test" },
  ])(
    "--template $projectType",
    async ({ projectType, name }) => {
      workdir = await mkdtemp(path.join(tmpdir(), "nextly-guide-"));
      const target = path.join(workdir, "project");

      await copyTemplate({
        projectName: name,
        projectType,
        targetDir: target,
        database: sqlite,
        templateSource: {
          basePath: path.join(templatesRoot, "base"),
          templatePath: path.join(templatesRoot, projectType),
        },
      });

      expect(await exists(path.join(target, "AGENTS.md"))).toBe(true);
      expect(await exists(path.join(target, "CLAUDE.md"))).toBe(true);

      // The shipped name must not survive alongside it: a copy that added the guide without
      // consuming the source would leave the project carrying both.
      expect(await exists(path.join(target, "AGENTS.md.template"))).toBe(false);
      expect(await exists(path.join(target, "CLAUDE.md.template"))).toBe(false);

      // The guide is generated from a template, so an unresolved placeholder would present
      // `{{databaseDialect}}` to the reader as though it were the answer.
      const guide = await readFile(path.join(target, "AGENTS.md"), "utf-8");
      expect(guide).not.toMatch(/\{\{\s*\w+\s*\}\}/);

      // CLAUDE.md is the pointer that makes the guide reachable; an empty or mismatched one
      // reads as present while sending the agent nowhere.
      expect(
        (await readFile(path.join(target, "CLAUDE.md"), "utf-8")).trim()
      ).toBe("@AGENTS.md");
    },
    30_000
  );
});
