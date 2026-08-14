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
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
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

// Scaffolding does not always start from an empty directory: the installer targets the current
// directory, and offers "ignore files and continue" on a non-empty one. Everything the developer
// already wrote at these names has to survive.
describe("scaffolding over a project that already has these files", () => {
  let workdir: string;

  beforeAll(() => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline test")));
  });
  afterAll(() => {
    vi.unstubAllGlobals();
  });

  afterEach(async () => {
    if (workdir) await rm(workdir, { recursive: true, force: true });
  });

  /** Scaffold into a directory already holding `seed`, and return what it holds afterwards. */
  async function scaffoldOver(
    seed: Record<string, string>
  ): Promise<Record<string, string>> {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-existing-"));
    const target = path.join(workdir, "project");
    await mkdir(target, { recursive: true });
    for (const [name, contents] of Object.entries(seed)) {
      await writeFile(path.join(target, name), contents, "utf-8");
    }

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "blank"),
      },
      // What the installer sets once the developer has chosen to continue into a non-empty
      // directory. Without it the copy refuses, and none of this is reachable.
      allowExistingTarget: true,
    });

    const out: Record<string, string> = {};
    for (const name of Object.keys(seed)) {
      out[name] = await readFile(path.join(target, name), "utf-8");
    }
    return out;
  }

  it("keeps notes written outside the managed block", async () => {
    const after = await scaffoldOver({
      "AGENTS.md": [
        "# House rules",
        "",
        "Never touch billing/ without a review.",
        "",
        "<!-- nextly:managed:start -->",
        "stale generated content",
        "<!-- nextly:managed:end -->",
        "",
        "## Footnotes",
        "Ask Priya about the staging database.",
      ].join("\n"),
    });

    // The developer's own text, on BOTH sides of the block.
    expect(after["AGENTS.md"]).toContain(
      "Never touch billing/ without a review."
    );
    expect(after["AGENTS.md"]).toContain(
      "Ask Priya about the staging database."
    );
    // The block itself is the region a regeneration owns, so it IS replaced.
    expect(after["AGENTS.md"]).not.toContain("stale generated content");
    expect(after["AGENTS.md"]).toContain("Agent guide for this Nextly project");
  }, 30_000);

  it("appends the block to a guide that has no managed region", async () => {
    const after = await scaffoldOver({
      "AGENTS.md": "# My own guide\n\nRun the thing, then the other thing.\n",
    });

    expect(after["AGENTS.md"]).toContain(
      "Run the thing, then the other thing."
    );
    expect(after["AGENTS.md"]).toContain("Agent guide for this Nextly project");
    // Their guide comes FIRST: an agent reads what the developer wrote before what a scaffold
    // contributed.
    expect(after["AGENTS.md"].indexOf("Run the thing")).toBeLessThan(
      after["AGENTS.md"].indexOf("Agent guide for this Nextly project")
    );
  }, 30_000);

  it("keeps an existing .gitignore's patterns and adds the missing ones", async () => {
    const after = await scaffoldOver({
      ".gitignore": "# ours\ncoverage/\n.env\n",
    });

    expect(after[".gitignore"]).toContain("coverage/");
    // Present in the seed already, so it must not be duplicated.
    expect(
      after[".gitignore"].split("\n").filter(l => l.trim() === ".env")
    ).toHaveLength(1);
    // A pattern only the template knows about still arrives.
    expect(after[".gitignore"]).toContain("node_modules");
  }, 30_000);

  it("keeps a CLAUDE.md the developer wrote and adds the pointer", async () => {
    const after = await scaffoldOver({
      "CLAUDE.md": "Always run the linter before you claim you are done.\n",
    });

    expect(after["CLAUDE.md"]).toContain(
      "Always run the linter before you claim you are done."
    );
    expect(after["CLAUDE.md"]).toContain("@AGENTS.md");
  }, 30_000);

  it("does not rewrite a placeholder the developer wrote in their own prose", async () => {
    const after = await scaffoldOver({
      "AGENTS.md":
        "# Notes\n\nOur deploy script substitutes {{databaseDialect}} itself.\n",
    });

    // The merge renders the INCOMING guide and leaves their text alone. The recursive pass that
    // renders the rest of the scaffold rewrites whole files, so it has to skip this one.
    expect(after["AGENTS.md"]).toContain(
      "Our deploy script substitutes {{databaseDialect}} itself."
    );
    // ...while the guide it merged in is still rendered.
    expect(after["AGENTS.md"]).toContain("Agent guide for this Nextly project");
    expect(after["AGENTS.md"]).toContain("This project uses **sqlite**");
  }, 30_000);

  it("treats a whitespace-prefixed ignore pattern as a different pattern", async () => {
    // git strips TRAILING whitespace from a pattern and keeps LEADING whitespace, so ` .env*`
    // does not ignore `.env` — measured with `git check-ignore -v .env`. Treating it as equal to
    // `.env*` would skip adding the pattern that works, and the scaffold writes a real `.env`.
    const after = await scaffoldOver({ ".gitignore": " .env*\n" });

    const lines = after[".gitignore"].split("\n");
    expect(lines).toContain(" .env*"); // theirs, untouched
    expect(lines.some(l => l === ".env" || l === ".env*")).toBe(true);
  }, 30_000);

  it("does not write through a CLAUDE.md symlink", async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-symlink-"));
    const target = path.join(workdir, "project");
    await mkdir(target, { recursive: true });

    const guide = "# My guide\n\nRun the linter before saying you are done.\n";
    await writeFile(path.join(target, "AGENTS.md"), guide, "utf-8");
    // The common arrangement: one file, reachable under both names.
    await symlink("AGENTS.md", path.join(target, "CLAUDE.md"));

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "blank"),
      },
      allowExistingTarget: true,
    });

    // Writing through the link would append the pointer INTO the guide it points at — measured:
    // `AGENTS.md` ends up containing a literal `@AGENTS.md` line, and the link still looks
    // untouched, so nothing in the project shows it happened.
    const merged = await readFile(path.join(target, "AGENTS.md"), "utf-8");
    expect(merged).toContain("Run the linter before saying you are done.");
    expect(merged.split("\n").filter(l => l.trim() === "@AGENTS.md")).toEqual(
      []
    );
    // And the link is left as the developer arranged it.
    expect((await lstat(path.join(target, "CLAUDE.md"))).isSymbolicLink()).toBe(
      true
    );
  }, 30_000);

  it("does not write through a hard-linked guide", async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-hardlink-"));
    const target = path.join(workdir, "project");
    await mkdir(target, { recursive: true });

    // A shared guide OUTSIDE the project, with a second directory entry inside it. `lstat`
    // reports a regular file for both, because that is what a hard link is — only the link
    // count separates them.
    const shared = path.join(workdir, "shared-AGENTS.md");
    await writeFile(shared, "# Shared\n\nHouse style lives here.\n", "utf-8");
    await link(shared, path.join(target, "AGENTS.md"));

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "blank"),
      },
      allowExistingTarget: true,
    });

    // The shared file is one inode reached by two names, so merging into either edits both —
    // and the other name may belong to a different project entirely.
    const sharedAfter = await readFile(shared, "utf-8");
    expect(sharedAfter).toBe("# Shared\n\nHouse style lives here.\n");
  }, 30_000);

  it("does not duplicate a CLAUDE.md pointer that is already there", async () => {
    const after = await scaffoldOver({
      "CLAUDE.md": "@AGENTS.md\n",
    });

    expect(
      after["CLAUDE.md"].split("\n").filter(l => l.trim() === "@AGENTS.md")
    ).toHaveLength(1);
  }, 30_000);
});
