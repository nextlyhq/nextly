/**
 * Every program a workflow starts before installing dependencies imports only Node builtins.
 *
 * The unit cases pin the reader and the walker against the ways each could pass while broken: a
 * step read in the wrong order, a script hidden in an action or a folded block, an option's value
 * taken for the script, a require the walk never follows. The last block applies them to the real
 * workflows, which is the check itself.
 *
 * @module no-install-jobs.test
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  dependencyFreeStarts,
  jobSequences,
  nonBuiltinImports,
  startOffenders,
} from "./no-install-jobs.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

/** A repository holding exactly these files. */
const repoOf = (files = {}, copies = undefined) => ({ readFile: file => files[file] ?? null, copies });

/** A workflow with one job, `check`, whose steps are these YAML lines. */
const jobWith = (...steps) =>
  ["jobs:", "  check:", "    steps:", ...steps.map(line => `      ${line}`)].join("\n");

/** A composite action whose steps are these YAML lines. */
const compositeWith = (...steps) =>
  ["runs:", "  using: composite", "  steps:", ...steps.map(line => `    ${line}`)].join("\n");

const read = (text, files, copies) => dependencyFreeStarts(text, repoOf(files, copies));
const entriesOf = found => found.starts.map(start => start.entry);

/** A reader over in-memory files that throws for a missing one, as `readFileSync` does. */
const readerOf = files => file => {
  if (!(file in files)) throw new Error(`no such file: ${file}`);
  return files[file];
};

describe("the install that ends the dependency-free state", () => {
  it("reads the steps before a job's install, and none after it", () => {
    const found = read(
      jobWith(
        "- run: node scripts/before.mjs",
        "- run: pnpm install --frozen-lockfile",
        "- run: node scripts/after.mjs"
      )
    );

    expect(entriesOf(found)).toEqual(["scripts/before.mjs"]);
    expect(found.refusals).toEqual([]);
  });

  it.each([
    ["a condition", ["- if: github.event_name == 'push'", "  run: pnpm install"]],
    ["a tolerated failure", ["- continue-on-error: true", "  run: pnpm install"]],
    ["another working directory", ["- working-directory: tools", "  run: pnpm install"]],
    ["a second command", ["- run: pnpm install && echo installed"]],
    ["a package named on the command line", ["- run: npm install /tmp/tarballs/app.tgz"]],
    ["a global install", ["- run: npm install --global"]],
    ["a directory option", ["- run: pnpm install --dir=tools"]],
    ["an option that only writes the lockfile", ["- run: pnpm install --lockfile-only"]],
    ["npm's lockfile-only option", ["- run: npm install --package-lock-only"]],
    ["an option that skips development dependencies", ["- run: pnpm install --prod"]],
    ["a dry run", ["- run: npm ci --dry-run"]],
  ])("does not end it at an install with %s", (_what, install) => {
    const found = read(jobWith(...install, "- run: node scripts/after.mjs"));

    expect(entriesOf(found)).toEqual(["scripts/after.mjs"]);
  });

  it("ends it at an install filtered to part of the workspace", () => {
    const found = read(
      jobWith(
        "- run: pnpm install --frozen-lockfile --filter @nextlyhq/ui...",
        "- run: node scripts/after.mjs"
      )
    );

    expect(found).toEqual({ starts: [], refusals: [] });
  });

  it("reads every step of a job that never installs", () => {
    const found = read(jobWith("- run: node scripts/a.mjs", "- run: node scripts/b.mjs"));

    expect(entriesOf(found)).toEqual(["scripts/a.mjs", "scripts/b.mjs"]);
  });
});

describe("local actions", () => {
  it("reads a script a composite action starts, at the step using the action", () => {
    const files = {
      ".github/actions/delegate/action.yml": compositeWith(
        "- run: node scripts/delegated.mjs",
        "  shell: bash"
      ),
    };

    expect(read(jobWith("- uses: ./.github/actions/delegate"), files).starts).toEqual([
      {
        where: "check › step 1 › ./.github/actions/delegate › step 1",
        entry: "scripts/delegated.mjs",
        preloads: [],
      },
    ]);
  });

  it("follows an action used inside another action", () => {
    const files = {
      ".github/actions/outer/action.yml": compositeWith("- uses: ./.github/actions/inner"),
      ".github/actions/inner/action.yml": compositeWith(
        "- run: node scripts/inner.mjs",
        "  shell: bash"
      ),
    };

    expect(entriesOf(read(jobWith("- uses: ./.github/actions/outer"), files))).toEqual([
      "scripts/inner.mjs",
    ]);
  });

  it("ends the state at an install inside an action, as at one in the job", () => {
    const files = {
      ".github/actions/setup/action.yml": compositeWith(
        "- run: node scripts/in-action.mjs",
        "  shell: bash",
        "- run: pnpm install --frozen-lockfile",
        "  shell: bash"
      ),
    };
    const found = read(
      jobWith("- uses: ./.github/actions/setup", "- run: node scripts/after.mjs"),
      files
    );

    expect(entriesOf(found)).toEqual(["scripts/in-action.mjs"]);
  });

  it("starts a JavaScript action's pre with the job, though the step using it follows the install", () => {
    const files = {
      ".github/actions/js/action.yml": [
        "runs:",
        "  using: node24",
        "  pre: dist/pre.mjs",
        "  main: dist/main.mjs",
        "  post: dist/post.mjs",
      ].join("\n"),
    };
    const found = read(
      jobWith("- run: pnpm install --frozen-lockfile", "- uses: ./.github/actions/js"),
      files
    );

    expect(entriesOf(found)).toEqual([".github/actions/js/dist/pre.mjs"]);
  });

  it("refuses an action it cannot read, rather than passing over it", () => {
    expect(read(jobWith("- uses: ./.github/actions/missing")).refusals).toEqual([
      {
        where: "check › step 1",
        reason: "uses ./.github/actions/missing, whose action.yml cannot be read",
      },
    ]);
  });
});

describe("the forms a run: script is written in", () => {
  it.each([
    ["folded", ["- run: >-", "    node", "    scripts/gate.mjs"]],
    ["folded, keeping its newline", ["- run: >", "    node scripts/gate.mjs"]],
    ["literal", ["- run: |", "    node scripts/gate.mjs"]],
    ["flow-style", ["- { run: node scripts/gate.mjs }"]],
    ["quoted across lines", ['- run: "node', '    scripts/gate.mjs"']],
    ["plain across lines", ["- run: node", "    scripts/gate.mjs"]],
  ])("reads a %s script", (_form, step) => {
    expect(entriesOf(read(jobWith(...step)))).toEqual(["scripts/gate.mjs"]);
  });
});

describe("a node command's arguments", () => {
  it.each([
    "node --conditions development scripts/a.mjs",
    "node -C development scripts/a.mjs",
    "node --conditions=development scripts/a.mjs",
    "node --max-old-space-size=4096 scripts/a.mjs",
    "node --enable-source-maps scripts/a.mjs --json",
    "node -- scripts/a.mjs",
    "exec node scripts/a.mjs",
    "NAME=value node scripts/a.mjs",
  ])("finds the script in `%s`", command => {
    const found = read(jobWith(`- run: ${command}`));

    expect(found.refusals).toEqual([]);
    expect(entriesOf(found)).toEqual(["scripts/a.mjs"]);
  });

  it("records the modules an option preloads, and walks each one", () => {
    const found = read(jobWith("- run: node -r ./tools/setup.cjs --import tsx scripts/a.mjs"));
    const files = {
      "scripts/a.mjs": 'import { join } from "node:path";\n',
      "tools/setup.cjs": 'require("dotenv");\n',
    };

    expect(found.starts).toEqual([
      {
        where: "check › step 1",
        entry: "scripts/a.mjs",
        preloads: [{ path: "tools/setup.cjs" }, { package: "tsx" }],
      },
    ]);
    expect(startOffenders(found.starts[0], readerOf(files))).toEqual([
      "tools/setup.cjs imports dotenv",
      "check › step 1 preloads tsx",
    ]);
  });

  it.each([
    ["inline code", "node -e \"import('js-yaml')\"", "passes Node -e, so what runs is not a script file"],
    ["an option it does not know", "node --unknown-flag scripts/a.mjs", "an option this reader does not know"],
    ["a script path the shell expands", 'node "$SCRIPT"', "not in the text"],
    ["a file it cannot walk", "node scripts/a.ts", "not a .mjs, .cjs or .js file"],
    ["a package script", "node --run build", "passes Node --run, so what runs is not a script file"],
    ["no script at all", "node", "without a script file"],
  ])("refuses %s", (_what, command, reason) => {
    const found = read(jobWith(`- run: ${command}`));

    expect(found.starts).toEqual([]);
    expect(found.refusals).toHaveLength(1);
    expect(found.refusals[0].reason).toContain(reason);
  });

  it("lets a node command that only prints its version through", () => {
    expect(read(jobWith("- run: node --version"))).toEqual({ starts: [], refusals: [] });
  });
});

describe("working directories", () => {
  it("resolves a script against the step's working directory", () => {
    const found = read(jobWith("- working-directory: tools", "  run: node check.mjs"));

    expect(entriesOf(found)).toEqual(["tools/check.mjs"]);
  });

  it("resolves it against the job's default, and against the workflow's", () => {
    const job = ["jobs:", "  check:", "    defaults:", "      run:", "        working-directory: tools"];
    const workflow = ["defaults:", "  run:", "    working-directory: tools", "jobs:", "  check:"];
    const steps = ["    steps:", "      - run: node check.mjs"];

    expect(entriesOf(read([...job, ...steps].join("\n")))).toEqual(["tools/check.mjs"]);
    expect(entriesOf(read([...workflow, ...steps].join("\n")))).toEqual(["tools/check.mjs"]);
  });

  it.each([
    ["an expression", ["- working-directory: ${{ inputs.dir }}", "  run: node check.mjs"], "not in the text"],
    ["a path outside the repository", ["- working-directory: ../elsewhere", "  run: node check.mjs"], "outside the repository"],
    ["a directory change before node", ["- run: cd tools && node check.mjs"], "after changing directory"],
  ])("refuses %s", (_what, steps, reason) => {
    const found = read(jobWith(...steps));

    expect(found.starts).toEqual([]);
    expect(found.refusals.map(refusal => refusal.reason)).toEqual([expect.stringContaining(reason)]);
  });

  it("refuses a composite action's step with no directory of its own, under a job that sets one", () => {
    const files = {
      ".github/actions/a/action.yml": compositeWith("- run: node scripts/a.mjs", "  shell: bash"),
    };
    const workflow = [
      "jobs:",
      "  check:",
      "    defaults:",
      "      run:",
      "        working-directory: tools",
      "    steps:",
      "      - uses: ./.github/actions/a",
    ].join("\n");

    expect(read(workflow, files)).toEqual({
      starts: [],
      refusals: [
        {
          where: "check › step 1 › ./.github/actions/a › step 1",
          reason: expect.stringContaining("undocumented"),
        },
      ],
    });
  });
});

describe("the shell around a node command", () => {
  it("finds node in a command substitution, and in a script run with bash -c or a here-document", () => {
    const found = read(
      jobWith(
        "- run: |",
        '    report=$(node scripts/a.mjs "$SUBJECT" 2>&1)',
        "    bash -c 'node scripts/b.mjs'",
        "    bash <<'EOF'",
        "    node scripts/c.mjs",
        "    EOF"
      )
    );

    expect(found.refusals).toEqual([]);
    expect(entriesOf(found)).toEqual(["scripts/a.mjs", "scripts/b.mjs", "scripts/c.mjs"]);
  });

  it("reads a shell script the repository holds, run by its path", () => {
    const files = { ".github/scripts/check.sh": "#!/usr/bin/env bash\nnode scripts/c.mjs\n" };
    const found = read(
      jobWith('- run: echo "run=$(.github/scripts/check.sh)" >> "$GITHUB_OUTPUT"'),
      files
    );

    expect(found).toEqual({
      starts: [
        { where: "check › step 1 › .github/scripts/check.sh", entry: "scripts/c.mjs", preloads: [] },
      ],
      refusals: [],
    });
  });

  it("does not read a comment as a command", () => {
    const found = read(jobWith("- run: |", "    # node scripts/a.mjs runs in the other job", "    echo ok"));

    expect(found).toEqual({ starts: [], refusals: [] });
  });

  it.each([
    ["an argument", ["- run: xargs node < list.txt"]],
    ["a string", ['- run: echo "node is ready"']],
    ["an assignment", ["- run: RUNTIME=node"]],
    ["a here-document", ["- run: |", "    cat <<'EOF' > run.sh", "    node scripts/a.mjs", "    EOF"]],
  ])("refuses node named in %s, where it cannot tell whether it runs", (_where, steps) => {
    const found = read(jobWith(...steps));

    expect(found.starts).toEqual([]);
    expect(found.refusals.map(refusal => refusal.reason)).toEqual([expect.stringContaining("names Node")]);
  });

  it.each([
    ["on the command", ["- run: NODE_OPTIONS=--import=tsx node scripts/a.mjs"]],
    ["by export", ["- run: |", "    export NODE_OPTIONS=--import=tsx", "    node scripts/a.mjs"]],
    ["in the step's environment", ["- env:", "    NODE_OPTIONS: --import=tsx", "  run: node scripts/a.mjs"]],
  ])("refuses NODE_OPTIONS set %s", (_how, steps) => {
    const reasons = read(jobWith(...steps)).refusals.map(refusal => refusal.reason);

    expect(reasons).toContainEqual(expect.stringContaining("NODE_OPTIONS"));
  });

  it.each([
    ["pnpm run check:metadata", "pnpm run"],
    ["pnpm --filter @nextlyhq/ui exec tsx scripts/node-matrix.ts", "pnpm exec"],
    ["npx tsx scripts/a.ts", "npx tsx"],
    ["yarn build", "yarn build"],
  ])("refuses `%s`, which runs code nothing has installed", (command, invocation) => {
    const found = read(jobWith(`- run: ${command}`));

    expect(found.refusals.map(refusal => refusal.reason)).toEqual([
      expect.stringContaining(`\`${invocation}\``),
    ]);
  });

  it.each(["npm install -g npm@11.18.0", "pnpm audit --json", "pnpm --version"])(
    "lets `%s` through, which runs nothing from the repository",
    command => {
      expect(read(jobWith(`- run: ${command}`))).toEqual({ starts: [], refusals: [] });
    }
  );

  it("refuses a program named at run time, and follows it once mapped to the file it copies", () => {
    const workflow = jobWith("- run: |", '    "$TOOLING/run.sh" status');
    const files = { ".github/scripts/run.sh": "node scripts/d.mjs\n" };

    expect(read(workflow, files).refusals).toEqual([
      { where: "check › step 1", reason: expect.stringContaining("named only at run time") },
    ]);
    expect(read(workflow, files, { "$TOOLING/run.sh": ".github/scripts/run.sh" })).toEqual({
      starts: [
        { where: "check › step 1 › .github/scripts/run.sh", entry: "scripts/d.mjs", preloads: [] },
      ],
      refusals: [],
    });
  });
});

describe("nonBuiltinImports", () => {
  const readFile = readerOf({
    "scripts/entry.mjs": 'import { x } from "./middle.mjs";\nimport { join } from "node:path";\n',
    "scripts/middle.mjs": 'export { x } from "./leaf.mjs";\n',
    "scripts/leaf.mjs": 'import yaml from "js-yaml";\nexport const x = yaml;\n',
    "scripts/clean.mjs": 'import { readFileSync } from "node:fs";\nimport { b } from "./cycle.mjs";\n',
    "scripts/cycle.mjs": 'import { readFileSync } from "fs";\nexport { b } from "./clean.mjs";\n',
    "scripts/entry.cjs": 'const lib = require("./lib");\nconst data = require("./data.json");\n',
    "scripts/lib.js": 'module.exports = require("js-yaml");\n',
    "scripts/data.json": '{ "name": "data" }\n',
    "scripts/module-require.cjs": 'const yaml = module.require("js-yaml");\n',
    "scripts/created.mjs":
      'import { createRequire } from "node:module";\nconst load = createRequire(import.meta.url);\nload("js-yaml");\n',
    "scripts/dynamic.mjs": 'const name = "js-yaml";\nawait import(name);\n',
    "scripts/esm-extensionless.mjs": 'import lib from "./lib";\n',
    "scripts/typed.mjs": '/** @typedef {import("js-yaml").Schema} Schema */\nexport const x = 1;\n',
  });

  it("finds an npm import two files down, through a re-export", () => {
    expect(nonBuiltinImports("scripts/entry.mjs", readFile).offenders).toEqual([
      "scripts/leaf.mjs imports js-yaml",
    ]);
  });

  it("passes a graph of builtins, prefixed or not, and terminates on a cycle", () => {
    const { files: reached, offenders } = nonBuiltinImports("scripts/clean.mjs", readFile);

    expect(offenders).toEqual([]);
    expect(reached.sort()).toEqual(["scripts/clean.mjs", "scripts/cycle.mjs"]);
  });

  it("follows a relative require through the forms require tries", () => {
    const { files: reached, offenders } = nonBuiltinImports("scripts/entry.cjs", readFile);

    expect(offenders).toEqual(["scripts/lib.js imports js-yaml"]);
    expect(reached.sort()).toEqual(["scripts/data.json", "scripts/entry.cjs", "scripts/lib.js"]);
  });

  it.each([
    ["module.require in a CommonJS entry", "scripts/module-require.cjs"],
    ["a require function createRequire returned", "scripts/created.mjs"],
  ])("finds an npm package loaded through %s", (_how, entry) => {
    expect(nonBuiltinImports(entry, readFile).offenders).toEqual([`${entry} imports js-yaml`]);
  });

  it("reports a module named only at run time instead of passing over it", () => {
    expect(nonBuiltinImports("scripts/dynamic.mjs", readFile).offenders).toEqual([
      "scripts/dynamic.mjs: loads a module named at run time, which a static walk cannot follow",
    ]);
  });

  it("does not count a type-only import, which is erased before Node runs anything", () => {
    expect(nonBuiltinImports("scripts/typed.mjs", readFile).offenders).toEqual([]);
  });

  it("follows an ES module import only at the path it names, as Node does", () => {
    expect(nonBuiltinImports("scripts/esm-extensionless.mjs", readFile).offenders).toEqual([
      "scripts/lib: cannot be read",
    ]);
  });

  it("reports a relative import it cannot read", () => {
    expect(nonBuiltinImports("scripts/absent.mjs", readFile).offenders).toEqual([
      "scripts/absent.mjs: cannot be read",
    ]);
  });
});

describe("what a job's defaults and a wrapping step change", () => {
  it.each([
    ["the job's", ["jobs:", "  check:", "    defaults:", "      run:", "        shell: node {0}", "    steps:", '      - run: import "js-yaml";']],
    ["the workflow's", ["defaults:", "  run:", "    shell: node {0}", "jobs:", "  check:", "    steps:", '      - run: import "js-yaml";']],
  ])("refuses a script %s default shell runs as Node code", (_whose, lines) => {
    const found = read(lines.join("\n"));

    expect(found.refusals.map(refusal => refusal.reason)).toEqual([
      expect.stringContaining("inline Node code"),
    ]);
  });

  it("keeps a composite action step's own shell, which a job's default does not reach", () => {
    const files = {
      ".github/actions/a/action.yml": compositeWith("- run: node scripts/a.mjs", "  shell: bash"),
    };
    const workflow = ["jobs:", "  check:", "    defaults:", "      run:", "        shell: node {0}", "    steps:", "      - uses: ./.github/actions/a"];

    expect(entriesOf(read(workflow.join("\n"), files))).toEqual(["scripts/a.mjs"]);
  });

  it.each([
    ["a condition", "  if: false"],
    ["a tolerated failure", "  continue-on-error: true"],
  ])("does not end it at an install inside an action whose step has %s", (_what, guard) => {
    const files = {
      ".github/actions/setup/action.yml": compositeWith(
        "- run: pnpm install --frozen-lockfile",
        "  shell: bash"
      ),
    };
    const found = read(
      jobWith("- uses: ./.github/actions/setup", guard, "- run: node scripts/after.mjs"),
      files
    );

    expect(entriesOf(found)).toEqual(["scripts/after.mjs"]);
  });

  it("does not end it at an install in a job's default directory", () => {
    const workflow = [
      "jobs:",
      "  check:",
      "    defaults:",
      "      run:",
      "        working-directory: tools",
      "    steps:",
      "      - run: npm ci",
      "      - working-directory: .",
      "        run: node scripts/after.mjs",
    ];

    expect(entriesOf(read(workflow.join("\n")))).toEqual(["scripts/after.mjs"]);
  });
});

describe("the other ways a node command is spelled or configured", () => {
  it.each([
    "node --env-file=.env scripts/a.mjs",
    "node --env-file .env scripts/a.mjs",
    "node --env-file-if-exists=.env scripts/a.mjs",
  ])("refuses `%s`, whose file can set NODE_OPTIONS", command => {
    const found = read(jobWith(`- run: ${command}`));

    expect(found.starts).toEqual([]);
    expect(found.refusals.map(refusal => refusal.reason)).toEqual([
      expect.stringContaining("NODE_OPTIONS"),
    ]);
  });

  it("starts Windows' node.exe, by name or by path, on a Windows runner", () => {
    const workflow = [
      "jobs:",
      "  check:",
      "    runs-on: windows-latest",
      "    steps:",
      "      - run: node.exe scripts/check.mjs",
      "      - run: '\"C:\\Program Files\\nodejs\\node.exe\" scripts/other.mjs'",
    ];
    const found = read(workflow.join("\n"));

    expect(found.refusals).toEqual([]);
    expect(entriesOf(found)).toEqual(["scripts/check.mjs", "scripts/other.mjs"]);
  });

  it("refuses node.exe named where it cannot tell whether it runs", () => {
    const found = read(jobWith("- run: xargs node.exe < list.txt"));

    expect(found.refusals.map(refusal => refusal.reason)).toEqual([
      expect.stringContaining("names Node"),
    ]);
  });
});

describe("the shell a step runs under, and what a step using an action passes it", () => {
  it.each(["nodejs {0}", "Node {0}", "/usr/local/bin/node {0}", "node.exe {0}"])(
    "refuses a script whose shell is `%s`, which runs it as Node code",
    shell => {
      const found = read(jobWith(`- shell: ${shell}`, '  run: import "js-yaml";'));

      expect(found.refusals.map(refusal => refusal.reason)).toEqual([
        expect.stringContaining("inline Node code"),
      ]);
    }
  );

  it("refuses NODE_OPTIONS passed to a composite action by the step using it", () => {
    const files = {
      ".github/actions/a/action.yml": compositeWith("- run: node scripts/a.mjs", "  shell: bash"),
    };
    const found = read(
      jobWith("- uses: ./.github/actions/a", "  env:", "    NODE_OPTIONS: --require=missing"),
      files
    );

    expect(found.starts).toEqual([]);
    expect(found.refusals.map(refusal => refusal.reason)).toEqual([
      expect.stringContaining("NODE_OPTIONS"),
    ]);
  });

  it("refuses NODE_OPTIONS passed to a JavaScript action by the step using it", () => {
    const files = {
      ".github/actions/js/action.yml": ["runs:", "  using: node24", "  main: dist/main.mjs"].join("\n"),
    };
    const found = read(
      jobWith("- uses: ./.github/actions/js", "  env:", "    NODE_OPTIONS: --import=tsx"),
      files
    );

    expect(found.starts).toEqual([]);
    expect(found.refusals.map(refusal => refusal.reason)).toEqual([
      expect.stringContaining("NODE_OPTIONS"),
    ]);
  });

  it("reads a JavaScript action's post when the step using it comes before the install", () => {
    const files = {
      ".github/actions/js/action.yml": [
        "runs:",
        "  using: node24",
        "  main: dist/main.mjs",
        "  post: dist/post.mjs",
      ].join("\n"),
    };
    const found = read(
      jobWith("- uses: ./.github/actions/js", "- run: pnpm install --frozen-lockfile"),
      files
    );

    expect(entriesOf(found)).toEqual([
      ".github/actions/js/dist/main.mjs",
      ".github/actions/js/dist/post.mjs",
    ]);
  });

  it("follows a shell script a step feeds to bash on its input", () => {
    const files = { ".github/scripts/run.sh": "node scripts/c.mjs\n" };

    expect(read(jobWith("- run: bash < .github/scripts/run.sh"), files)).toEqual({
      starts: [
        { where: "check › step 1 › .github/scripts/run.sh", entry: "scripts/c.mjs", preloads: [] },
      ],
      refusals: [],
    });
  });

  it("refuses a script fed to bash from a path the shell expands", () => {
    const found = read(jobWith('- run: bash < "$SCRIPT"'));

    expect(found.refusals.map(refusal => refusal.reason)).toEqual([
      expect.stringContaining("not in the text"),
    ]);
  });
});

describe("the real workflows", () => {
  const workflowDir = path.join(ROOT, ".github", "workflows");
  const workflows = readdirSync(workflowDir).filter(name => /\.ya?ml$/.test(name)).sort();
  const readRepo = relative => readFileSync(path.join(ROOT, relative), "utf8");
  const readFile = relative => {
    try {
      return readRepo(relative);
    } catch {
      // Absent. The reader decides what that means where it asked for the file.
      return null;
    }
  };

  /**
   * Programs a workflow runs from a path it builds at run time, mapped to the repository file each
   * one is a copy of. `nextly-review-bot.yml` writes `.github/scripts/review-bot-gh.sh` from the
   * base branch into the runner's temporary directory and runs it from there.
   */
  const COPIES = {
    "${RUNNER_TEMP}/nextly-review-bot/review-bot-gh.sh": ".github/scripts/review-bot-gh.sh",
  };

  const readAll = copies =>
    workflows.map(file => {
      const text = readRepo(path.join(".github", "workflows", file));
      const found = dependencyFreeStarts(text, { readFile, copies });
      const place = item => ({ ...item, where: `${file} ${item.where}` });
      return { starts: found.starts.map(place), refusals: found.refusals.map(place) };
    });
  const population = readAll(COPIES);
  const starts = population.flatMap(result => result.starts);
  const ciSequences = jobSequences(readRepo(path.join(".github", "workflows", "ci.yml")), { readFile });

  /**
   * A FLOOR, not the population. Every assertion below iterates what the workflows actually run;
   * this exists so a reader that silently found nothing cannot satisfy them by leaving nothing to
   * iterate.
   */
  const AT_LEAST = ["scripts/ci-gate.mjs", "scripts/check-repo-metadata.mjs"];

  it("reads every step before an install without refusing any", () => {
    expect(population.flatMap(result => result.refusals)).toEqual([]);
  });

  it("finds the scripts known to run without an install", () => {
    const entries = starts.map(start => start.entry);

    for (const expected of AT_LEAST) expect(entries, expected).toContain(expected);
  });

  it("does not mistake an installing job for one that runs without installing", () => {
    // The other direction. A reader that stopped recognising installs would put every job's
    // scripts in the population, and the check would start failing on correct files.
    expect(starts.map(start => start.entry)).not.toContain("scripts/release/check-changesets.mjs");
  });

  it("needs each runtime copy it is given: without the map, each one is refused", () => {
    const reasons = readAll({}).flatMap(result => result.refusals.map(refusal => refusal.reason));

    for (const program of Object.keys(COPIES)) {
      expect(reasons, program).toContainEqual(expect.stringContaining(program));
    }
  });

  it("reads the folded commands in the real ci.yml as the single line GitHub runs", () => {
    const scripts = [...ciSequences.values()]
      .flat()
      .filter(event => event.kind === "script")
      .map(event => event.script);

    expect(scripts).toContainEqual(
      expect.stringContaining("pnpm -r --filter '@nextlyhq/*' --filter 'nextly' --filter 'create-nextly-app'")
    );
    expect(scripts).toContainEqual(expect.stringContaining("--reporter=verbose scripts/cli-entry.test.mjs"));
  });

  it("reads the composite action the real changes job uses, in place", () => {
    const places = ciSequences.get("changes").map(event => event.where);

    expect(places).toContainEqual(expect.stringContaining("› ./.github/actions/superseded-on-main ›"));
  });

  it.each(starts.map(start => [start.where, start.entry, start]))(
    "%s starts %s, which imports only Node builtins",
    (_where, _entry, start) => {
      expect(
        startOffenders(start, readRepo),
        "this runs before the job installs any dependencies, so Node alone loads this whole " +
          "import graph. Import a dependency-free module instead, or install before this step."
      ).toEqual([]);
    }
  );
});
