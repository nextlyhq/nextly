#!/usr/bin/env node
/**
 * What a project that installs Nextly sees when it type-checks.
 *
 *   node scripts/consumer-types.mjs --tarballs <dir> [--typescript 5.9.3,6.0.3,7.0.2] [--work <dir>]
 *
 * `<dir>` holds the packed tarballs of every publishable package (`pnpm pack`,
 * as package-smoke packs them). For each, the packed manifest is checked:
 * every `types` an `exports` condition names is in the tarball, with the
 * extension its format needs. Then three projects are installed, with every
 * Nextly dependency pointed at its tarball: the blog app and the plugin
 * template, scaffolded by the packed `create-nextly-app` from this checkout's
 * templates; and a project depending on every published package, with a file
 * importing the types of every public subpath. Each is type-checked by every
 * TypeScript version given,
 * three ways: with the project's own settings, with `skipLibCheck` off so the
 * published declarations are themselves checked, and through `nodenext`
 * resolution, importing and requiring each subpath as Node resolves it (the
 * resolution rules attw checks).
 *
 * The verdict is a precondition for a release, so it fails closed:
 * - a diagnostic in a project file or in one of our packages fails the run;
 *   one in a third-party package is reported and does not;
 * - a run that could not ask (an install or a compiler that did not run)
 *   fails, and says it could not ask rather than reporting a verdict;
 * - a run that did not READ a declaration it should have fails, because a
 *   declaration the compiler never opened has no errors to report.
 *
 * The first line printed is the verdict.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

import { parseJsonc } from "./jsonc.mjs";

/** This checkout's project templates, which the scaffolded projects are made from. */
const TEMPLATES = join(import.meta.dirname, "..", "templates");

/** The TypeScript versions checked when none are given: the stable 5, 6 and 7 lines. */
export const DEFAULT_TYPESCRIPT = ["5.9.3", "6.0.3", "7.0.2"];

// ---------------------------------------------------------------------------
// The packed packages
// ---------------------------------------------------------------------------

/** One packed package: its manifest, and the files the tarball holds, without the `package/` prefix. */
export function readTarball(path) {
  const listing = execFileSync("tar", ["-tzf", path], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  const files = new Set(
    listing
      .split("\n")
      .filter(Boolean)
      .map(entry => entry.replace(/^package\//, ""))
  );
  const manifest = JSON.parse(
    execFileSync("tar", ["-xzOf", path, "package/package.json"], {
      encoding: "utf8",
    })
  );
  return { path, name: manifest.name, manifest, files };
}

/**
 * Every subpath a package publishes types for, as the specifier a consumer
 * writes, with the declaration each format reaches: `import` for ESM
 * resolution and `require` for CommonJS. A subpath with neither has no types
 * to check and is left out.
 */
export function typedSubpaths({ name, manifest }) {
  return Object.entries(manifest.exports ?? {})
    .filter(([key, target]) => isObject(target) && !key.includes("*"))
    .map(([key, target]) => ({
      specifier: key === "." ? name : `${name}/${key.slice(2)}`,
      import: importTypes(target),
      require: conditionTypes(target, "require"),
    }))
    .filter(entry => entry.import || entry.require);
}

const isObject = value => value !== null && typeof value === "object";

/**
 * The `types` a condition reaches: its own when its target is an object, the
 * subpath's top-level `types` when the target is a bare path.
 */
function conditionTypes(target, condition) {
  const holder =
    typeof target[condition] === "string" ? target : target[condition];
  return isObject(holder) && typeof holder.types === "string"
    ? holder.types
    : undefined;
}

/** What ESM resolution reaches: the `import` condition, else a `types` no `require` competes with. */
function importTypes(target) {
  const named = conditionTypes(target, "import");
  if (named !== undefined) return named;
  return target.require === undefined ? target.types : undefined;
}

/** The declaration extensions each format may name. */
const FORMAT_EXTENSIONS = {
  import: [".d.mts", ".d.ts"],
  require: [".d.cts", ".d.ts"],
};

/**
 * What is wrong with a packed manifest's types, as sentences.
 *
 * A `types` path the tarball does not hold resolves to nothing for every
 * consumer, and one whose extension belongs to the other module format is read
 * in that format: a `.d.cts` under `import` describes a CommonJS module the
 * runtime will never load. A `.d.ts` is read in the package's own `type`, so
 * it is accepted under either condition.
 */
export function manifestProblems(pkg) {
  const has = path => pkg.files.has(path.replace(/^\.\//, ""));
  const topLevel = pkg.manifest.types;
  const problems =
    typeof topLevel === "string" && !has(topLevel)
      ? [
          `${pkg.name}: "types" names ${topLevel}, which the tarball does not hold`,
        ]
      : [];
  const subpathProblems = typedSubpaths(pkg).flatMap(subpath =>
    Object.keys(FORMAT_EXTENSIONS).flatMap(format =>
      typesProblems(subpath, format, has)
    )
  );
  return [...problems, ...subpathProblems];
}

/** What is wrong with one subpath's declaration for one format, if anything. */
function typesProblems(subpath, format, has) {
  const types = subpath[format];
  if (!types) return [];
  if (!has(types))
    return [
      `${subpath.specifier} (${format}): types ${types} is not in the tarball`,
    ];
  return FORMAT_EXTENSIONS[format].some(extension => types.endsWith(extension))
    ? []
    : [
        `${subpath.specifier} (${format}): types ${types} is the wrong format for ${format}`,
      ];
}

// ---------------------------------------------------------------------------
// The check files
// ---------------------------------------------------------------------------

/** One subpath's import line in each module format, or nothing when that format has no types. */
const IMPORT_LINE = {
  esm: (subpath, binding) =>
    subpath.import &&
    `import type * as ${binding} from "${subpath.specifier}";`,
  cjs: (subpath, binding) =>
    subpath.require && `import ${binding} = require("${subpath.specifier}");`,
};

/**
 * A module importing the types of every subpath, so the compiler opens each
 * published declaration file. `style` is the module format: `esm` writes
 * `import type * as`, `cjs` writes `import x = require(…)` for the subpaths
 * with a `require` condition.
 */
export function typeImportsSource(subpaths, style) {
  const lines = subpaths
    .map((subpath, index) => IMPORT_LINE[style](subpath, `subpath${index}`))
    .filter(Boolean);
  const names = lines.map(line => /subpath\d+/.exec(line)[0]);
  // Each binding used as a type, so an unused import cannot be elided before its declaration is read.
  lines.push(
    `export type Everything = [${names.map(name => `typeof ${name}`).join(", ")}];`
  );
  return `${lines.join("\n")}\n`;
}

/**
 * The public API as a user writes it, from the documentation: a config with a
 * collection and its fields, a table of the app's own, and a plugin. A type
 * error here is a published signature that stopped accepting documented code.
 */
export const USAGE_SOURCE = `
import { col, defineTable } from "nextly/schema-extension";
import { defineCollection, defineConfig, text, textarea } from "nextly/config";
import { definePlugin } from "@nextlyhq/plugin-sdk";

const auditTrail = defineTable(
  "audit_trail",
  {
    id: col.id(),
    actorId: col.ref("users"),
    action: col.shortText(),
    payload: col.json<{ before?: unknown; after?: unknown }>({ nullable: true }),
    ...col.timestamps(),
  },
  { indexes: [{ columns: ["actorId", "createdAt"] }] }
);

export const Categories = defineCollection({
  slug: "categories",
  labels: { singular: "Category", plural: "Categories" },
  fields: [
    text({ name: "name", required: true }),
    text({ name: "slug", required: true, unique: true }),
    textarea({ name: "description" }),
  ],
  admin: { useAsTitle: "name" },
});

export const greetings = (opts: { greeting?: string } = {}) =>
  definePlugin({
    name: "@acme/nextly-plugin-greetings",
    version: "0.1.0",
    nextly: ">=0.0.2-alpha.63",
    dependsOn: {},
    enabled: opts.greeting !== "",
    contributes: {},
    setup(config) {
      return config;
    },
    init() {},
    destroy() {},
  });

export default defineConfig({
  collections: [Categories],
  singles: [],
  db: { schema: { extend: [({ schema }) => { schema.addTable(auditTrail); }] } },
});
`;

// ---------------------------------------------------------------------------
// Reading the compiler's answer
// ---------------------------------------------------------------------------

/**
 * `tsc --pretty false` diagnostics, split into ours and third-party.
 *
 * Ours is any file outside `node_modules` (the project and the check files)
 * and any file inside one of our packages. A continuation line belongs to the
 * diagnostic above it. A summary line such as `Found 3 errors` is not a
 * diagnostic.
 */
export function classifyDiagnostics(output, ourNames) {
  const all = diagnosticsIn(output);
  const isOurs = diagnostic => {
    const owner = /node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(
      diagnostic.file
    )?.[1];
    return owner === undefined || ourNames.has(owner);
  };
  return {
    ours: all.filter(isOurs),
    thirdParty: all.filter(diagnostic => !isOurs(diagnostic)),
  };
}

/** Every diagnostic in compiler output, in order, each with its continuation lines. */
function diagnosticsIn(output) {
  const found = [];
  let current;
  for (const line of output.split("\n")) {
    const match = /^(.+?)\(\d+,\d+\): error TS\d+:/.exec(line);
    if (match)
      found.push(
        (current = { file: match[1].replaceAll("\\", "/"), text: line })
      );
    else current = continued(current, line);
  }
  return found;
}

/** `current` with `line` appended when it is an indented continuation; otherwise the diagnostic has ended. */
function continued(current, line) {
  if (!current || !/^\s+\S/.test(line)) return undefined;
  current.text += `\n${line}`;
  return current;
}

/**
 * The declarations a run should have opened and did not, by path inside the
 * project. `--listFiles` prints every file the program read; a declaration of
 * ours missing from it was never checked, whatever the diagnostics say.
 */
export function unread(expected, listed) {
  const read = new Set(
    listed.split("\n").map(line => line.trim().replaceAll("\\", "/"))
  );
  return expected.filter(path => ![...read].some(file => file.endsWith(path)));
}

// ---------------------------------------------------------------------------
// Running it
// ---------------------------------------------------------------------------

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    status: result.status,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
  };
}

/** Thrown when the run could not ask the question, as opposed to getting an answer. */
class CouldNotAsk extends Error {}

function mustRun(command, args, cwd, what) {
  const result = run(command, args, cwd);
  if (result.status !== 0) {
    throw new CouldNotAsk(
      `${what} failed (exit ${result.status}):\n${result.output.slice(-4000)}`
    );
  }
  return result.output;
}

/**
 * A scaffolded project's manifest with every Nextly package pointed at its
 * tarball: each one already there, plus `added`, as dependencies, and all of
 * them as npm `overrides`, so a package's own Nextly dependencies resolve to
 * the tarballs too rather than to the registry.
 */
export function pointAtTarballs(manifest, tarballs, added = []) {
  const spec = name => `file:${tarballs.get(name)}`;
  const pointed = ranges =>
    Object.fromEntries(
      Object.entries(ranges).map(([name, range]) => [
        name,
        tarballs.has(name) ? spec(name) : range,
      ])
    );
  const next = structuredClone(manifest);
  for (const field of ["dependencies", "devDependencies"]) {
    if (next[field]) next[field] = pointed(next[field]);
  }
  const notDev = added.filter(
    name => next.devDependencies?.[name] === undefined
  );
  next.dependencies = {
    ...next.dependencies,
    ...Object.fromEntries(notDev.map(name => [name, spec(name)])),
  };
  next.overrides = {
    ...next.overrides,
    ...Object.fromEntries([...tarballs.keys()].map(name => [name, spec(name)])),
  };
  return next;
}

/**
 * Scaffolds `template` with the packed CLI, from this checkout's templates.
 * The CLI would otherwise download the blog template from GitHub, which is
 * main's copy rather than the one under review, and a fetch that can time out.
 */
function scaffold(work, cliTarball, template, name) {
  mustRun(
    "npm",
    [
      "exec",
      "--yes",
      `--package=${cliTarball}`,
      "--",
      "create-nextly-app",
      name,
      "--template",
      template,
      "--local-template",
      TEMPLATES,
      "--yes",
      "--skip-install",
    ],
    work,
    `scaffolding the ${template} template`
  );
  return join(work, name);
}

/** The compiler configurations a project is checked under, written beside its own. */
function writeConfigs(project) {
  const own = parseJsonc(readFileSync(join(project, "tsconfig.json"), "utf8"));
  const include = [...(own.include ?? []), "consumer-types.check.ts"];
  writeFileSync(
    join(project, "tsconfig.consumer.json"),
    JSON.stringify({ extends: "./tsconfig.json", include }, null, 2)
  );
  writeFileSync(
    join(project, "tsconfig.consumer.declarations.json"),
    JSON.stringify(
      {
        extends: "./tsconfig.json",
        include,
        compilerOptions: { skipLibCheck: false },
      },
      null,
      2
    )
  );
  writeFileSync(
    join(project, "tsconfig.consumer.nodenext.json"),
    JSON.stringify(
      {
        compilerOptions: {
          module: "nodenext",
          moduleResolution: "nodenext",
          target: "es2022",
          strict: true,
          noEmit: true,
          // Resolution only, as attw checks it: whether each subpath resolves
          // under Node's own rules. Whether the declarations themselves are
          // sound is the "declarations checked" leg's question, under the
          // bundler resolution a Next.js app uses.
          skipLibCheck: true,
          types: ["node"],
        },
        files: ["consumer-types.check.mts", "consumer-types.check.cts"],
      },
      null,
      2
    )
  );
}

/**
 * A project depending on every published package, as package-smoke installs
 * them together, with the scaffolded app's own compiler settings and type
 * packages. It is a project of its own rather than the scaffolded app with
 * everything added: the app pins its own direct dependencies, and the question
 * here is what each published declaration resolves to, not whether every
 * package can join one particular app.
 */
function everyPackageProject(work, scaffolded, names, tarballs) {
  const dir = join(work, "consumer-everything");
  mkdirSync(dir, { recursive: true });
  const app = JSON.parse(
    readFileSync(join(scaffolded, "package.json"), "utf8")
  );
  const typePackages = Object.fromEntries(
    Object.entries({ ...app.dependencies, ...app.devDependencies }).filter(
      ([name]) => name.startsWith("@types/")
    )
  );
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify(
      {
        name: "consumer-everything",
        private: true,
        type: "module",
        dependencies: Object.fromEntries(
          names.map(name => [name, `file:${tarballs.get(name)}`])
        ),
        devDependencies: typePackages,
      },
      null,
      2
    )
  );
  // The app's settings, without what only the app itself has: its path
  // aliases, its editor plugin and its file list.
  const settings = {
    ...parseJsonc(readFileSync(join(scaffolded, "tsconfig.json"), "utf8"))
      .compilerOptions,
  };
  for (const appOnly of ["paths", "plugins", "incremental"])
    delete settings[appOnly];
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: settings, include: [] }, null, 2)
  );
  return dir;
}

const LEGS = [
  { name: "as scaffolded", config: "tsconfig.consumer.json" },
  {
    name: "declarations checked",
    config: "tsconfig.consumer.declarations.json",
  },
  { name: "nodenext", config: "tsconfig.consumer.nodenext.json" },
];

// The projects checked, in the order they run. The verdict names them from
// here, so a project added to the run is named in its ok line too.
const PROJECT_NAMES = ["blog app", "plugin template", "every package"];

/** The command line: the tarball folder, the TypeScript versions, and the work folder, made. */
function parseArgs(args) {
  const option = (flag, fallback) => {
    const at = args.indexOf(flag);
    return at === -1 ? fallback : args[at + 1];
  };
  const tarballDir = option("--tarballs");
  if (!tarballDir) {
    console.error(
      "usage: node scripts/consumer-types.mjs --tarballs <dir> [--typescript a,b,c] [--work <dir>]"
    );
    process.exit(2);
  }
  const versions = option("--typescript", DEFAULT_TYPESCRIPT.join(","))
    .split(",")
    .filter(Boolean);
  const work = resolve(
    option("--work", mkdtempSync(join(tmpdir(), "consumer-types-")))
  );
  mkdirSync(work, { recursive: true });
  return { tarballDir, versions, work };
}

/** The three projects, scaffolded, pointed at the tarballs, given their check files and installed. */
function prepareProjects(packages, tarballs, work) {
  const cli = tarballs.get("create-nextly-app");
  if (!cli)
    throw new CouldNotAsk("no create-nextly-app tarball to scaffold with");
  const app = scaffold(work, cli, "blog", "consumer-app");
  const plugin = scaffold(work, cli, "plugin", "consumer-plugin");
  const everything = everyPackageProject(
    work,
    app,
    [...tarballs.keys()],
    tarballs
  );
  const projects = [
    { name: PROJECT_NAMES[0], dir: app, everything: false },
    { name: PROJECT_NAMES[1], dir: plugin, everything: false },
    { name: PROJECT_NAMES[2], dir: everything, everything: true },
  ];
  const subpaths = packages.flatMap(typedSubpaths);
  for (const project of projects) prepareProject(project, tarballs, subpaths);
  return projects;
}

function prepareProject(project, tarballs, subpaths) {
  const manifestPath = join(project.dir, "package.json");
  const manifest = pointAtTarballs(
    JSON.parse(readFileSync(manifestPath, "utf8")),
    tarballs
  );
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  // A scaffolded project is checked as its own code; the every-package
  // project carries the imports of every subpath and the documented usage.
  const reachable = project.everything ? subpaths : [];
  const check = project.everything
    ? `${typeImportsSource(reachable, "esm")}${USAGE_SOURCE}`
    : "export {};\n";
  writeFileSync(join(project.dir, "consumer-types.check.ts"), check);
  writeFileSync(
    join(project.dir, "consumer-types.check.mts"),
    typeImportsSource(reachable, "esm")
  );
  writeFileSync(
    join(project.dir, "consumer-types.check.cts"),
    typeImportsSource(reachable, "cjs")
  );
  writeConfigs(project.dir);
  mustRun(
    "npm",
    ["install", "--no-audit", "--no-fund", "--loglevel=error"],
    project.dir,
    `installing the ${project.name}`
  );
}

/** Installs one TypeScript version in a folder of its own, and returns its `tsc` once it reports that version. */
function installTypeScript(work, version) {
  const home = join(work, `typescript-${version}`);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, "package.json"), "{}");
  mustRun(
    "npm",
    [
      "install",
      "--no-audit",
      "--no-fund",
      "--loglevel=error",
      `typescript@${version}`,
    ],
    home,
    `installing TypeScript ${version}`
  );
  const tsc = join(home, "node_modules", ".bin", "tsc");
  const reported = mustRun(tsc, ["-v"], home, `TypeScript ${version}`).trim();
  if (!reported.endsWith(version))
    throw new CouldNotAsk(`asked for TypeScript ${version}, ran ${reported}`);
  return tsc;
}

/** One compiler run: its failures and notes, or CouldNotAsk when it failed without saying why. */
function checkLeg(tsc, project, leg, context) {
  const label = `TypeScript ${context.version}, ${project.name}, ${leg.name}`;
  const result = run(
    tsc,
    ["-p", leg.config, "--pretty", "false", "--listFiles"],
    project.dir
  );
  if (result.status !== 0 && !/error TS\d+/.test(result.output)) {
    throw new CouldNotAsk(
      `${label} exited ${result.status} with no diagnostics:\n${result.output.slice(-2000)}`
    );
  }
  const { ours, thirdParty } = classifyDiagnostics(
    result.output,
    context.ourNames
  );
  return {
    failures: [
      ...ours.map(diagnostic => `${label}: ${diagnostic.text}`),
      ...unreadFailures(project, leg, context, result.output, label),
    ],
    notes:
      thirdParty.length > 0
        ? [
            `${label}: ${thirdParty.length} diagnostic(s) in third-party declarations (not ours, not gated)`,
          ]
        : [],
  };
}

/** The declarations the every-package project's bundler-resolved legs should have read and did not. */
function unreadFailures(project, leg, context, listed, label) {
  if (!project.everything || leg.name === "nodenext") return [];
  return unread(context.expectedRead, listed).map(
    path => `${label}: never read ${path}, so its types went unchecked`
  );
}

/** Every failure and note, from the manifests and from each version, project and leg. */
function checkPackages(packages, versions, work) {
  const tarballs = new Map(packages.map(pkg => [pkg.name, pkg.path]));
  // The manifests first: they need no install, and a missing declaration is
  // reported by its path rather than as whatever the compiler makes of it.
  const failures = packages.flatMap(pkg => manifestProblems(pkg));
  const notes = [];
  const projects = prepareProjects(packages, tarballs, work);
  const expectedRead = packages.flatMap(pkg =>
    typedSubpaths(pkg)
      .filter(subpath => subpath.import)
      .map(
        subpath =>
          `node_modules/${pkg.name}/${subpath.import.replace(/^\.\//, "")}`
      )
  );
  const context = { ourNames: new Set(tarballs.keys()), expectedRead };
  for (const version of versions) {
    const tsc = installTypeScript(work, version);
    for (const project of projects) {
      for (const leg of LEGS) {
        const result = checkLeg(tsc, project, leg, { ...context, version });
        failures.push(...result.failures);
        notes.push(...result.notes);
      }
    }
  }
  return { failures, notes };
}

/** Prints the verdict line, then each failure, and returns the exit status. */
function printVerdict(failures, packageCount, versions) {
  const typescript = versions.join(", ");
  if (failures.length === 0) {
    console.log(
      `consumer-types: ok - ${packageCount} package(s), checked by TypeScript ${typescript}, in ${PROJECT_NAMES.join(", ")}`
    );
    return 0;
  }
  console.log(
    `consumer-types: FAIL - ${failures.length} problem(s) across ${packageCount} package(s) and TypeScript ${typescript}`
  );
  for (const failure of failures) console.log(`  ${failure}`);
  return 1;
}

/** Reports a run that could not ask its question, and exits; any other error is rethrown. */
function couldNotCheck(error) {
  if (!(error instanceof CouldNotAsk)) throw error;
  console.log(
    `consumer-types: COULD NOT CHECK - ${error.message.split("\n")[0]}`
  );
  console.log(error.message);
  process.exit(1);
}

function main() {
  const { tarballDir, versions, work } = parseArgs(process.argv.slice(2));
  const packages = readdirSync(tarballDir)
    .filter(file => file.endsWith(".tgz"))
    .map(file => readTarball(resolve(tarballDir, file)));
  let outcome;
  try {
    outcome = checkPackages(packages, versions, work);
  } catch (error) {
    couldNotCheck(error);
  }
  const status = printVerdict(outcome.failures, packages.length, versions);
  for (const note of outcome.notes) console.log(`  note: ${note}`);
  console.log(`  work: ${work}`);
  process.exit(status);
}

if (process.argv[1] && basename(process.argv[1]) === "consumer-types.mjs")
  main();
