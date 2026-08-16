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
 * arrival in a project. Checking only the scaffolded output would pass while the source sat in
 * this repository under its special name, misfiring on every agent that reads it here.
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
import { scriptRunner } from "../utils/package-manager-commands";
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
        packageManager: "npm",
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
      // Asserted POSITIVELY. A token rendered from a missing value leaves no braces behind, so
      // the check above cannot see it — `undefined dev` reads as successfully substituted. A
      // negative match on "undefined" is no good either: the guide legitimately explains that a
      // missing field yields `undefined`. Naming the expected command separates the cases.
      expect(guide).toContain(`${scriptRunner("npm")} dev`);

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
      // A seeded name may be nested — an include graph that runs through a subdirectory is
      // exactly where a relative `@../file` resolves differently from the project root.
      const file = path.join(target, name);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents, "utf-8");
    }

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      packageManager: "npm",
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

  it("does not swallow notes under an unmatched start marker", async () => {
    // A stray start marker with no end — a hand-edit, or a previous run that appended a block
    // below one. Pairing the FIRST start with the FIRST end would treat everything between the
    // stray marker and the appended block's end as managed, and replace it.
    const after = await scaffoldOver({
      "AGENTS.md": [
        "<!-- nextly:managed:start -->",
        "",
        "I pasted a marker here by accident.",
        "Ask Dedan before touching the payments module.",
      ].join("\n"),
    });

    expect(after["AGENTS.md"]).toContain(
      "Ask Dedan before touching the payments module."
    );
    expect(after["AGENTS.md"]).toContain("Agent guide for this Nextly project");
  }, 30_000);

  it("does not swallow prose before an unmatched END marker", async () => {
    // The mirror of the stray-start case, and the one a backward search introduces: a VALID block,
    // then prose, then a stray end. Pairing the valid start with the LAST end deletes the prose
    // between them.
    const after = await scaffoldOver({
      "AGENTS.md": [
        "<!-- nextly:managed:start -->",
        "old generated content",
        "<!-- nextly:managed:end -->",
        "",
        "Deployment runbook lives in the wiki.",
        "",
        "<!-- nextly:managed:end -->",
      ].join("\n"),
    });

    expect(after["AGENTS.md"]).toContain(
      "Deployment runbook lives in the wiki."
    );
    expect(after["AGENTS.md"]).not.toContain("old generated content");
    expect(after["AGENTS.md"]).toContain("Agent guide for this Nextly project");
  }, 30_000);

  it("puts scaffold ignore rules ABOVE the developer's, so theirs still win", async () => {
    // git applies the LAST matching pattern, so appending `.env*` after a deliberate `!/.env`
    // would silently re-ignore a file the developer had un-ignored.
    const after = await scaffoldOver({ ".gitignore": "!/.env\n" });

    const lines = after[".gitignore"].split("\n");
    const negation = lines.indexOf("!/.env");
    const shipped = lines.findIndex(l => l.startsWith(".env"));
    expect(negation).toBeGreaterThan(-1);
    expect(shipped).toBeGreaterThan(-1);
    // Theirs comes after, so it is the last match and it decides.
    expect(negation).toBeGreaterThan(shipped);
  }, 30_000);

  it("updates the existing block when a stray START follows it", async () => {
    // A complete block followed by an unmatched start marker. The region a regeneration owns is
    // the complete pair, so the block must be REPLACED and the stray left alone — an
    // implementation that treats the stray as the region finds no end for it and appends a
    // second block, leaving the stale generated instructions in place permanently.
    const after = await scaffoldOver({
      "AGENTS.md": [
        "<!-- nextly:managed:start -->",
        "stale generated content",
        "<!-- nextly:managed:end -->",
        "",
        "My notes.",
        "",
        "<!-- nextly:managed:start -->",
      ].join("\n"),
    });

    expect(after["AGENTS.md"]).toContain("My notes.");
    expect(after["AGENTS.md"]).not.toContain("stale generated content");
    // Exactly one generated block, not two.
    expect(
      after["AGENTS.md"].split("Agent guide for this Nextly project").length - 1
    ).toBe(1);
  }, 30_000);

  it("does not add a pointer that resolves back to the file it is written into", async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-reverse-"));
    const target = path.join(workdir, "project");
    await mkdir(target, { recursive: true });

    // The REVERSE arrangement: the guide name points at the pointer name.
    const claude = path.join(target, "CLAUDE.md");
    await writeFile(
      claude,
      "# House rules\n\nBe careful with billing.\n",
      "utf-8"
    );
    await symlink("CLAUDE.md", path.join(target, "AGENTS.md"));

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      packageManager: "npm",
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "blank"),
      },
      allowExistingTarget: true,
    });

    // Adding `@AGENTS.md` here would make the file import itself, since AGENTS.md IS this file.
    const after = await readFile(claude, "utf-8");
    expect(after).toContain("Be careful with billing.");
    expect(after.split("\n").filter(l => l.trim() === "@AGENTS.md")).toEqual(
      []
    );
  }, 30_000);

  it("treats managed markers inside a fenced example as text, not a region", async () => {
    // A guide can legitimately DOCUMENT the markers. Read literally, that example is a region a
    // regeneration owns — so the generated block lands inside the code fence, where it is not
    // active instruction, and the developer's example is destroyed.
    const after = await scaffoldOver({
      "AGENTS.md": [
        "# Our guide",
        "",
        "Scaffolded projects carry a managed block that looks like this:",
        "",
        "```markdown",
        "<!-- nextly:managed:start -->",
        "generated content goes here",
        "<!-- nextly:managed:end -->",
        "```",
        "",
        "Do not edit inside it.",
      ].join("\n"),
    });

    expect(after["AGENTS.md"]).toContain("generated content goes here");
    expect(after["AGENTS.md"]).toContain("Do not edit inside it.");
    // Appended below their file, because it holds no real managed region.
    expect(after["AGENTS.md"]).toContain("Agent guide for this Nextly project");
  }, 30_000);

  it("adds a real pointer when the matching line is only an example", async () => {
    const after = await scaffoldOver({
      "CLAUDE.md": [
        "# Notes",
        "",
        "A Nextly scaffold writes a pointer that reads:",
        "",
        "```",
        "@AGENTS.md",
        "```",
      ].join("\n"),
    });

    // The fenced occurrence is text about the file. Without a real include line, Claude Code
    // never reads the guide — so the pointer must still be added.
    const lines = after["CLAUDE.md"].split("\n").map(l => l.trim());
    const firstFence = lines.indexOf("```");
    expect(firstFence).toBeGreaterThan(-1);
    // Scaffold lines are written ABOVE the developer's content, so an active include sits
    // before the fenced example rather than after it. Their example survives either way.
    const active = lines.findIndex(l => l === "@AGENTS.md");
    expect(active).toBeGreaterThan(-1);
    expect(active).toBeLessThan(firstFence);
  }, 30_000);

  it("does not close an indirect pointer cycle", async () => {
    // `AGENTS.md` already includes `@CLAUDE.md`. That is inert while CLAUDE.md is absent —
    // writing the pointer is what makes the pair include each other.
    const after = await scaffoldOver({
      "AGENTS.md": "# Ours\n\n@CLAUDE.md\n\nHouse rules live in CLAUDE.md.\n",
    });

    expect(after["AGENTS.md"]).toContain("House rules live in CLAUDE.md.");
    const claude = await readFile(
      path.join(workdir, "project", "CLAUDE.md"),
      "utf-8"
    ).catch(() => "");
    expect(claude.split("\n").filter(l => l.trim() === "@AGENTS.md")).toEqual(
      []
    );
  }, 30_000);

  it("still writes the pointer when the guide has an unrelated dangling include", async () => {
    // The separating case, and the reason the cycle tests above cannot stand in for it: they
    // also pass if EVERY unresolved descendant is rejected, because rejecting everything
    // produces the same "no pointer" outcome a real cycle does.
    //
    // Here `AGENTS.md` includes an absent optional file. That leaf is a dead end in the
    // developer's own graph, not a path back to `CLAUDE.md` — nothing includes `CLAUDE.md` at
    // all — so the pointer must still be written.
    const after = await scaffoldOver({
      "AGENTS.md":
        "# Ours\n\n@OPTIONAL.md\n\nOptional extras, usually absent.\n",
    });

    expect(after["AGENTS.md"]).toContain("Optional extras, usually absent.");
    const claude = await readFile(
      path.join(workdir, "project", "CLAUDE.md"),
      "utf-8"
    ).catch(() => "");
    expect(claude.split("\n").filter(l => l.trim() === "@AGENTS.md")).toEqual([
      "@AGENTS.md",
    ]);
  }, 30_000);

  it("resolves a nested include from the file that wrote it", async () => {
    // `rules/team.md` includes `@../CLAUDE.md`, which is relative to `rules/` and therefore
    // names the project's own CLAUDE.md. Resolving every hop against the project root instead
    // checks `rules/../..`, finds nothing, treats it as a dead end, and writes a pointer that
    // closes a real cycle.
    const after = await scaffoldOver({
      "AGENTS.md": "# Ours\n\n@rules/team.md\n\nTeam rules live in rules/.\n",
      "rules/team.md": "# Team\n\n@../CLAUDE.md\n",
    });

    expect(after["AGENTS.md"]).toContain("Team rules live in rules/.");
    const claude = await readFile(
      path.join(workdir, "project", "CLAUDE.md"),
      "utf-8"
    ).catch(() => "");
    expect(claude.split("\n").filter(l => l.trim() === "@AGENTS.md")).toEqual(
      []
    );
  }, 30_000);

  it("expands a shared include reached from two different directories", async () => {
    // `shared.md` is reached twice — directly, and through `rules/alias.md` which symlinks to
    // it. Its `@../CLAUDE.md` resolves from the DIRECTORY it was reached from, so the two
    // arrivals point at different files: the ROOT arrival's `..` leaves the project entirely
    // and is a dead end, while the `rules/` arrival's `..` names the project's own CLAUDE.md
    // and closes the cycle.
    //
    // Keying a visited node by its referent alone collapses the two, skips the second before
    // its edges are expanded, and writes the cyclic pointer.
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-existing-"));
    const target = path.join(workdir, "project");
    await mkdir(path.join(target, "rules"), { recursive: true });

    await writeFile(
      path.join(target, "AGENTS.md"),
      "# Ours\n\n@shared.md\n\n@rules/alias.md\n\nOur own notes.\n",
      "utf-8"
    );
    await writeFile(
      path.join(target, "shared.md"),
      "# Shared\n\n@../CLAUDE.md\n",
      "utf-8"
    );
    await symlink(
      path.join(target, "shared.md"),
      path.join(target, "rules", "alias.md"),
      "file"
    );

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      packageManager: "npm",
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "blank"),
      },
      allowExistingTarget: true,
    });

    const guide = await readFile(path.join(target, "AGENTS.md"), "utf-8");
    expect(guide).toContain("Our own notes.");

    // The ROOT arrival at `shared.md` reaches `../CLAUDE.md` outside the project — a dead end.
    // The `rules/` arrival at the same file reaches the project's OWN `CLAUDE.md` and closes the
    // cycle, so the pointer must NOT be written.
    //
    // Keying by referent alone records the root arrival, skips the `rules/` one as already seen,
    // never expands its edge, misses the cycle, and writes a pointer that loops.
    const claude = await readFile(
      path.join(target, "CLAUDE.md"),
      "utf-8"
    ).catch(() => "");
    expect(claude.split("\n").filter(l => l.trim() === "@AGENTS.md")).toEqual(
      []
    );
  }, 30_000);

  it("keeps alias contexts distinct when the DIRECTORY itself is a symlink", async () => {
    // `alias -> ../shared-dir`, so a file reached through `alias/` and through the real
    // directory is one file arriving from two lexically different places. Its `@../CLAUDE.md`
    // resolves from the directory it was written in: through `alias/` that is the project, and
    // from the real `shared-dir/` it is outside.
    //
    // Canonicalising the directory in the identity collapses these two arrivals, skips the
    // alias one, misses the cycle it closes, and writes a looping pointer.
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-existing-"));
    const target = path.join(workdir, "project");
    await mkdir(target, { recursive: true });
    await mkdir(path.join(workdir, "shared-dir"), { recursive: true });

    await writeFile(
      path.join(workdir, "shared-dir", "shared.md"),
      "# Shared\n\n@../CLAUDE.md\n",
      "utf-8"
    );
    await symlink(
      path.join(workdir, "shared-dir"),
      path.join(target, "alias"),
      "dir"
    );
    await writeFile(
      path.join(target, "AGENTS.md"),
      "# Ours\n\n@../shared-dir/shared.md\n\n@alias/shared.md\n\nOur own notes.\n",
      "utf-8"
    );

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      packageManager: "npm",
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "blank"),
      },
      allowExistingTarget: true,
    });

    expect(
      (await readFile(path.join(target, "AGENTS.md"), "utf-8")).includes(
        "Our own notes."
      )
    ).toBe(true);

    const claude = await readFile(
      path.join(target, "CLAUDE.md"),
      "utf-8"
    ).catch(() => "");
    expect(claude.split("\n").filter(l => l.trim() === "@AGENTS.md")).toEqual(
      []
    );
  }, 30_000);

  it("does not count a commented-out or inline pointer as installed", async () => {
    // Three inactive forms. A reader acts on none of them, so the real pointer must still be
    // added — otherwise the guide is silently unreachable.
    const after = await scaffoldOver({
      "CLAUDE.md": [
        "# Notes",
        "",
        // A MULTI-LINE comment, so the include sits alone on its own line. The single-line
        // form `<!-- @AGENTS.md -->` never matched anyway — the comparison key is the whole
        // trimmed line — so a fixture using it cannot reach the mechanism.
        "<!--",
        "@AGENTS.md",
        "-->",
        "",
        "The scaffold writes an `@AGENTS.md` include at the top.",
      ].join("\n"),
    });

    const lines = after["CLAUDE.md"].split("\n").map(l => l.trim());
    // Positional, because their commented occurrence is ALSO an `@AGENTS.md` line — asserting
    // the string is present cannot tell an added include from the one already there. Scaffold
    // lines are written above the developer's content, so an ACTIVE include precedes the
    // comment that contains the inert one.
    const firstInclude = lines.indexOf("@AGENTS.md");
    const commentOpens = lines.indexOf("<!--");
    expect(commentOpens).toBeGreaterThan(-1);
    expect(firstInclude).toBeGreaterThan(-1);
    expect(firstInclude).toBeLessThan(commentOpens);
    // Their commented and inline mentions survive untouched.
    expect(after["CLAUDE.md"]).toContain("<!--\n@AGENTS.md\n-->");
    expect(after["CLAUDE.md"]).toContain("`@AGENTS.md`");
  }, 30_000);

  it("materializes a DANGLING ignore symlink instead of aborting", async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-dangling-ignore-"));
    const target = path.join(workdir, "project");
    await mkdir(target, { recursive: true });

    // Points at nothing. `lstat` still selects the materialize branch, and a read that assumed
    // a readable referent would throw ENOENT and take the whole scaffold down.
    await symlink(
      path.join(workdir, "no-such-file"),
      path.join(target, ".gitignore")
    );

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      packageManager: "npm",
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "blank"),
      },
      allowExistingTarget: true,
    });

    // A dangling link carries no rules, so replacing it with the scaffold's defaults is exactly
    // right — and `.env` ends up ignored, which the link could never have achieved.
    const stat = await lstat(path.join(target, ".gitignore"));
    expect(stat.isSymbolicLink()).toBe(false);
    expect(await readFile(path.join(target, ".gitignore"), "utf-8")).toMatch(
      /^\.env/m
    );
  }, 30_000);

  it("does not close a cycle that runs through a third file", async () => {
    // `AGENTS.md` -> `RULES.md` -> `CLAUDE.md`, where CLAUDE.md does not exist yet. Every file
    // in the chain is the developer's, so its length is not something the scaffolder bounds —
    // a one-hop check accepts this and the write completes the loop.
    const after = await scaffoldOver({
      "AGENTS.md": "# Ours\n\n@RULES.md\n\nHouse rules are split out.\n",
      "RULES.md": "# Rules\n\n@CLAUDE.md\n",
    });

    expect(after["AGENTS.md"]).toContain("House rules are split out.");
    expect(after["RULES.md"]).toContain("@CLAUDE.md");
    const claude = await readFile(
      path.join(workdir, "project", "CLAUDE.md"),
      "utf-8"
    ).catch(() => "");
    expect(claude.split("\n").filter(l => l.trim() === "@AGENTS.md")).toEqual(
      []
    );
  }, 30_000);

  it("keeps an existing .gitignore's BOM at byte zero", async () => {
    // A UTF-8 BOM is only a BOM in first position. Prepending in front of one moves it into the
    // middle, where git stops stripping it and it becomes part of the developer's first pattern.
    const after = await scaffoldOver({ ".gitignore": "\ufeffcoverage/\n" });

    expect(after[".gitignore"].startsWith("\ufeff")).toBe(true);
    // Exactly one, and their pattern is clean of it.
    expect(after[".gitignore"].split("\ufeff")).toHaveLength(2);
    expect(after[".gitignore"]).toMatch(/^coverage\/$/m);
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
      packageManager: "npm",
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

  it("materializes a symlinked .gitignore so its patterns apply", async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-ignore-link-"));
    const target = path.join(workdir, "project");
    await mkdir(target, { recursive: true });

    // git does NOT follow a symlinked `.gitignore` — it reads the link, not its target — so a
    // preserved link means none of the scaffold's patterns apply and the real `.env` a scaffold
    // writes stays committable. The guide entries preserve links; this one must not.
    const shared = path.join(workdir, "shared-ignore");
    await writeFile(shared, "coverage/\n", "utf-8");
    await symlink(shared, path.join(target, ".gitignore"));

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      packageManager: "npm",
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "blank"),
      },
      allowExistingTarget: true,
    });

    // A regular file now, carrying what the link held plus the scaffold's patterns.
    const stat = await lstat(path.join(target, ".gitignore"));
    expect(stat.isSymbolicLink()).toBe(false);
    const contents = await readFile(path.join(target, ".gitignore"), "utf-8");
    expect(contents).toContain("coverage/");
    expect(contents).toMatch(/^\.env/m);

    // The referent is left exactly as it was: materializing takes this project out of the
    // arrangement rather than editing whatever else points at that file.
    expect(await readFile(shared, "utf-8")).toBe("coverage/\n");
  }, 30_000);

  it("does not create a self-pointer through a DANGLING guide symlink", async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-dangling-"));
    const target = path.join(workdir, "project");
    await mkdir(target, { recursive: true });

    // `AGENTS.md -> CLAUDE.md` where CLAUDE.md does not exist YET. The guide entry is skipped as
    // a link; the pointer entry then finds no destination and takes the move path — which makes
    // the dangling link live, pointing at the file just written. Without the check, that file
    // contains `@AGENTS.md` and imports itself.
    await symlink("CLAUDE.md", path.join(target, "AGENTS.md"));

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      packageManager: "npm",
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "blank"),
      },
      allowExistingTarget: true,
    });

    const claude = await readFile(
      path.join(target, "CLAUDE.md"),
      "utf-8"
    ).catch(() => "");
    expect(claude.split("\n").filter(l => l.trim() === "@AGENTS.md")).toEqual(
      []
    );
  }, 30_000);

  it("leaves a developer's own {{runCommand}} text alone", async () => {
    // The recursive placeholder pass walks every file in the target. When scaffolding over an
    // existing project that includes the developer's files, and one may legitimately contain a
    // literal command token — in its own template, or in documentation about this scaffolder.
    const after = await scaffoldOver({
      "TEAM-NOTES.md":
        "Our generator emits {{runCommand}} for the chosen manager.\n",
    });

    expect(after["TEAM-NOTES.md"]).toContain("{{runCommand}}");
  }, 30_000);

  it("does not write through a hard-linked guide", async () => {
    workdir = await mkdtemp(path.join(tmpdir(), "nextly-hardlink-"));
    const target = path.join(workdir, "project");
    await mkdir(target, { recursive: true });

    // A shared guide OUTSIDE the project, with a second directory entry inside it. `lstat`
    // reports a regular file for both, because that is what a hard link is — only the link
    // count separates them.
    const shared = path.join(workdir, "shared-AGENTS.md");
    // Carries a PLACEHOLDER on purpose. The merge declines a linked destination, but the
    // recursive placeholder pass is a SECOND writer and sees a hard link as an ordinary file —
    // without a token here it has nothing to substitute and the second writer stays invisible.
    const sharedText =
      "# Shared\n\nHouse style lives here.\n\nDialect: {{databaseDialect}}\n";
    await writeFile(shared, sharedText, "utf-8");
    await link(shared, path.join(target, "AGENTS.md"));

    await copyTemplate({
      projectName: "my-app",
      projectType: "blank",
      targetDir: target,
      database: sqlite,
      packageManager: "npm",
      templateSource: {
        basePath: path.join(templatesRoot, "base"),
        templatePath: path.join(templatesRoot, "blank"),
      },
      allowExistingTarget: true,
    });

    // The shared file is one inode reached by two names, so merging into either edits both —
    // and the other name may belong to a different project entirely.
    const sharedAfter = await readFile(shared, "utf-8");
    expect(sharedAfter).toBe(sharedText);
    // Named explicitly: the placeholder must still be a placeholder. Substituting it would mean
    // a write reached the shared inode from the recursive pass.
    expect(sharedAfter).toContain("{{databaseDialect}}");
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

describe("guide commands match the package manager in use", () => {
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

  // Under Yarn's default PnP linker there is no `node_modules/.bin`, so an `npm run dev` printed
  // into a Yarn project cannot resolve `next` and simply fails. The guide has to speak the
  // manager the project was scaffolded with.
  it.each([
    { packageManager: "npm" as const, run: "npm run dev", exec: "npx nextly" },
    { packageManager: "yarn" as const, run: "yarn dev", exec: "yarn nextly" },
    {
      packageManager: "pnpm" as const,
      run: "pnpm dev",
      exec: "pnpm exec nextly",
    },
    { packageManager: "bun" as const, run: "bun run dev", exec: "bunx nextly" },
  ])(
    "$packageManager",
    async ({ packageManager, run, exec }) => {
      workdir = await mkdtemp(path.join(tmpdir(), "nextly-pm-"));
      const target = path.join(workdir, "project");

      await copyTemplate({
        projectName: "my-app",
        projectType: "blank",
        targetDir: target,
        database: sqlite,
        packageManager,
        templateSource: {
          basePath: path.join(templatesRoot, "base"),
          templatePath: path.join(templatesRoot, "blank"),
        },
      });

      const guide = await readFile(path.join(target, "AGENTS.md"), "utf-8");
      expect(guide).toContain(run);
      expect(guide).toContain(exec);
      expect(guide).not.toMatch(/\{\{\s*\w+\s*\}\}/);
    },
    30_000
  );
});
