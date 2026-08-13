/**
 * No package script may background a process with `&` and then `wait` for it.
 *
 * That construct is POSIX. pnpm runs scripts through `cmd.exe` on Windows, where `&` separates
 * commands SEQUENTIALLY and `wait` is not a builtin, so the first command holds the line and
 * everything after it never runs. When the first command is a watcher — which never exits by
 * design — the rest of the script is unreachable for the whole session.
 *
 * It is checked rather than merely fixed because of how it fails: nothing errors, nothing exits
 * non-zero, and the developer sees a running process. `packages/ui` carried it while producing a
 * healthy client bundle and stale server-safe artifacts beside it, and the fix — a `spawn` runner —
 * is ordinary JavaScript that a later edit could plausibly collapse back into a one-line script.
 *
 * The set of manifests is DERIVED from `pnpm-workspace.yaml` rather than listed here. A hand-written
 * list is a second definition of what the workspace contains: it agreed with pnpm the day it was
 * written, and the first package added outside its assumptions is silently unscanned.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const repoRoot = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  ".."
);

/**
 * Backgrounding followed by a wait, in the forms a shell actually accepts.
 *
 * `&` is a control operator, so a shell needs no whitespace around it: `a & wait`, `a &wait` and
 * `a&wait` are the same command and all three carry the Windows failure. The separator before
 * `wait` is therefore optional whitespace rather than required whitespace.
 *
 * `wait` still has to stand alone as a command rather than open a longer word, so `wait-for-db`
 * is not matched — that is a perfectly portable script name.
 */
const BACKGROUND_THEN_WAIT = /&[\s\S]*?(?:^|[\s;&])?\bwait(?![\w-])/;

/**
 * Directory globs pnpm treats as workspaces, read from its own configuration.
 *
 * Only the shapes this repository uses are interpreted — a trailing `/*` meaning "every child of
 * this directory", and a bare path meaning one package. An unrecognised pattern throws rather than
 * being skipped, because silently ignoring a workspace glob is how this scan would come to cover
 * less than it claims while still reporting a pass.
 */
function workspaceDirectories(): string[] {
  const yaml = readFileSync(join(repoRoot, "pnpm-workspace.yaml"), "utf8");
  const patterns = [
    ...yaml.matchAll(/^\s*-\s*["']?([^"'\n#]+?)["']?\s*$/gm),
  ].map(match => match[1]);
  if (patterns.length === 0) {
    throw new Error(
      "No workspace patterns were parsed from pnpm-workspace.yaml, so this scan would read " +
        "nothing and report no violations — which is what a clean workspace also looks like."
    );
  }

  const directories: string[] = [];
  for (const pattern of patterns) {
    if (pattern.endsWith("/*")) {
      const parent = join(repoRoot, pattern.slice(0, -2));
      if (!existsSync(parent)) continue;
      for (const entry of readdirSync(parent, { withFileTypes: true })) {
        if (entry.isDirectory()) directories.push(join(parent, entry.name));
      }
      continue;
    }
    if (pattern.includes("*")) {
      throw new Error(
        `pnpm-workspace.yaml contains the pattern "${pattern}", which this scan does not know how ` +
          "to expand. Teach it the shape rather than letting those packages go unscanned."
      );
    }
    directories.push(join(repoRoot, pattern));
  }
  return directories;
}

/**
 * Every manifest whose scripts a contributor runs.
 *
 * The workspace packages plus the repository root, whose scripts go through the same pnpm and
 * break the same way.
 *
 * `templates/` is deliberately NOT here: none of those directories contains a `package.json` at
 * all. A scaffolded project's manifest is GENERATED, which is what `generatedScriptCommands()`
 * below covers — filtering this list by file existence would silently drop every template while
 * this suite claimed to scan them.
 */
function scannedManifests(): {
  path: string;
  scripts: Record<string, string>;
}[] {
  return [repoRoot, ...workspaceDirectories()]
    .map(directory => ({
      directory,
      manifest: join(directory, "package.json"),
    }))
    .filter(({ manifest }) => existsSync(manifest))
    .map(({ directory, manifest }) => {
      const parsed = JSON.parse(readFileSync(manifest, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const relative =
        directory === repoRoot
          ? "<root>"
          : directory.slice(repoRoot.length + 1);
      return { path: relative, scripts: parsed.scripts ?? {} };
    });
}

/** Where a scaffolded project's `scripts` block is actually written. */
const GENERATOR = join(
  repoRoot,
  "packages",
  "create-nextly-app",
  "src",
  "utils",
  "template.ts"
);

/**
 * Every command a scaffolded project's `package.json` will contain.
 *
 * A user's project is not in this repository — it is produced by `generatePackageJson` and its
 * plugin counterpart — so scanning directories cannot see those scripts at all. A forbidden
 * construct there is worse than one here: it ships to people who never chose it, and their first
 * build is where it surfaces.
 *
 * Read from the generator's own syntax rather than by calling it, because calling it would make
 * this package depend on `create-nextly-app` at test time; this repository already guards across
 * package boundaries by reading source, as the contrast utilities do for admin.
 */
function generatedScriptCommands(): {
  path: string;
  scripts: Record<string, string>;
}[] {
  const source = ts.createSourceFile(
    GENERATOR,
    readFileSync(GENERATOR, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );

  const blocks: Record<string, string>[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "scripts" &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      const block: Record<string, string> = {};
      for (const property of node.initializer.properties) {
        if (!ts.isPropertyAssignment(property)) continue;
        const key = ts.isIdentifier(property.name)
          ? property.name.text
          : ts.isStringLiteral(property.name)
            ? property.name.text
            : undefined;
        // Only literal commands can be judged. A computed one is reported rather than skipped, so
        // a script assembled at runtime cannot pass by being unreadable.
        if (key === undefined) continue;
        block[key] = ts.isStringLiteral(property.initializer)
          ? property.initializer.text
          : ts.isNoSubstitutionTemplateLiteral(property.initializer)
            ? property.initializer.text
            : `<non-literal: ${property.initializer.getText(source)}>`;
      }
      blocks.push(block);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return blocks.map((scripts, index) => ({
    path: `create-nextly-app scripts block #${index + 1}`,
    scripts,
  }));
}

describe("package scripts run on every supported platform", () => {
  // A scan that reads nothing reports no violations, which is the same output as a clean
  // workspace. These separate the two.
  it("scans the root and every pnpm workspace", () => {
    const paths = scannedManifests().map(({ path }) => path);
    expect(paths).toContain("<root>");
    expect(paths).toContain("packages/ui");
    // `e2e` is a workspace that is neither under `packages/` nor `apps/`, so it is the one a
    // hand-written directory list would miss.
    expect(paths).toContain("e2e");
    expect(paths.length).toBeGreaterThan(10);
  });

  // The generator is the only place a scaffolded project's scripts exist, and a scan of it that
  // silently found nothing would report no violations — the same output as a clean generator.
  it("reads the scripts a scaffolded project will actually receive", () => {
    const blocks = generatedScriptCommands();
    expect(blocks.length).toBeGreaterThanOrEqual(2);

    const commands = blocks.flatMap(({ scripts }) => Object.entries(scripts));
    expect(commands.length).toBeGreaterThan(5);
    // Pinned because they are what a user runs first. If the generator stops emitting these, the
    // scan is reading the wrong thing and should say so rather than pass over an empty set.
    expect(commands.map(([name]) => name)).toEqual(
      expect.arrayContaining(["dev", "build"])
    );
  });

  it("recognises the construct it exists to reject, spaced or not", () => {
    for (const command of [
      "tsup --watch & tsup --config other.ts --watch & wait",
      "node a.mjs & node b.mjs & wait",
      "node a.mjs &wait",
      "node a.mjs&wait",
      "node a.mjs & wait;",
    ]) {
      expect(BACKGROUND_THEN_WAIT.test(command), command).toBe(true);
    }
  });

  it("does not reject portable scripts that merely contain the word", () => {
    for (const command of [
      "node scripts/dev.mjs",
      "pnpm run wait-for-db && vitest",
      "tsup && tsup --config tsup.server-safe.config.ts",
      "echo waiting && next build",
    ]) {
      expect(BACKGROUND_THEN_WAIT.test(command), command).toBe(false);
    }
  });

  it("no scanned or generated script backgrounds a process and waits for it", () => {
    const offenders = [
      ...scannedManifests(),
      ...generatedScriptCommands(),
    ].flatMap(({ path, scripts }) =>
      Object.entries(scripts)
        .filter(([, command]) => BACKGROUND_THEN_WAIT.test(command))
        .map(([name, command]) => `${path} → ${name}: ${command}`)
    );
    expect(offenders).toEqual([]);
  });
});
