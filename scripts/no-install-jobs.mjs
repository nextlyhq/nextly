/**
 * The programs a workflow starts before it has installed any dependencies, and whether Node alone
 * can load each one.
 *
 * Until a job's install has run, it has Node and a checkout and nothing more, so every module a
 * program it starts imports — all the way down that program's import graph — must be a Node
 * builtin. Some jobs never install at all: the CI gate, which has to report even when the install
 * every other job depends on is what failed, and the scheduled repository-metadata check.
 *
 * A scheduled job never runs on a pull request, and a pull request's CI installs dependencies
 * before anything else, so an npm import added three files away from such a program passes every
 * check on its pull request and fails afterwards on `main`, attributed to whatever commit is at the
 * tip when the job next runs.
 *
 * ## What is read, and how
 *
 * Workflows and the local actions they use are read with a YAML parser, so a folded, quoted,
 * flow-style or continued `run:` is the same string here that it is to GitHub. Steps are taken in
 * the order they run: a composite action's steps in place of the step that uses it, a JavaScript
 * action's `pre` as the job starts and its `post` as it ends.
 *
 * A job leaves the dependency-free state at its first step that installs the repository's
 * dependencies and does nothing else, unconditionally, in the repository root. Everything before
 * that step is read, and nothing after it.
 *
 * Each script read is split into commands by `shell-commands.mjs`. A `node` command's arguments
 * are read with Node's own grammar, so an option's value is not taken for the script, and a module
 * an option preloads is walked like the script. A shell script in the repository, named by a
 * literal path, is read in turn.
 *
 * ## What is refused
 *
 * This guards `main` against a failure nothing before the merge can see, so whatever it cannot
 * settle it refuses, naming the step and the reason, rather than passing over it: a `node` command
 * with an argument that is not literal, an option it does not know, inline code or no script file;
 * the word `node` anywhere else; a package manager running scripts or installed binaries; a
 * directory change before a `node` command; `NODE_OPTIONS`; a program named only at run time,
 * unless the caller maps it to the repository file it is a copy of; an action it cannot read; and a
 * working directory that is not a fixed path inside the repository.
 *
 * Outside it: the code a remote action brings with it, which is that action's to load.
 *
 * Imports are read with TypeScript's parser rather than a pattern, because a pattern reads an
 * import quoted in a comment or a string as a real one, and a guard that fails on a correct file
 * teaches people to delete it.
 *
 * @module no-install-jobs
 */

import { isBuiltin } from "node:module";
import { posix } from "node:path";

import { load } from "js-yaml";
import ts from "typescript";

import { shellCommands } from "./shell-commands.mjs";

/**
 * @typedef {object} Repository
 * @property {(path: string) => string | null} readFile a file's contents, or null when it is absent
 * @property {Record<string, string>} [copies] programs a workflow stages at run time from one of
 *   the repository's own files, keyed by the word that runs them, valued by that file's path
 */

/**
 * @typedef {object} Start
 * @property {string} where the job and step, for a message a person can act on
 * @property {string} entry the repository path of the script Node starts
 * @property {({path: string} | {package: string})[]} preloads what Node loads before the script
 */

/**
 * @typedef {object} Refusal
 * @property {string} where
 * @property {string} reason
 */

/**
 * @typedef {{kind: "install", where: string}
 *   | {kind: "script", where: string, script: string, cwd: string}
 *   | ({kind: "start"} & Start)
 *   | ({kind: "refusal"} & Refusal)} JobEvent
 */

/** A package manager, and the subcommands with which it installs a project's dependencies. */
const INSTALLER = /^(?:pnpm|npm|yarn)$/;
const INSTALL = /^(?:install|ci|i)$/;

/** Install options whose value is the next word. */
const INSTALL_VALUES = new Set(["--filter", "-F"]);

/** Install options that put what they install somewhere other than the repository root. */
const INSTALL_ELSEWHERE = /^(?:--dir|-C|--prefix|--cwd|-g|--global|--location)(?:=|$)/;

const NODE_OPTIONS_REASON =
  "sets NODE_OPTIONS, which changes what every node command loads, and this reader does not follow it";

/**
 * Each job's steps as the events this check reads, in the order they run.
 *
 * @param {string} text a workflow file's contents
 * @param {Repository} repo
 * @returns {Map<string, JobEvent[]>} job id to its events
 */
export function jobSequences(text, repo) {
  const workflow = load(text) ?? {};
  const sequences = new Map();
  for (const [id, job] of Object.entries(workflow.jobs ?? {})) {
    const sequence = { before: [], steps: [], after: [] };
    const defaults =
      job.defaults?.run?.["working-directory"] ?? workflow.defaults?.run?.["working-directory"];
    const scope = { where: id, defaults, env: [workflow.env, job.env], actions: [], repo, sequence };
    readSteps(job.steps ?? [], scope);
    sequences.set(id, [...sequence.before, ...sequence.steps, ...sequence.after]);
  }
  return sequences;
}

function readSteps(steps, scope) {
  steps.forEach((step, index) => {
    const label = step.name ? `step ${index + 1} (${step.name})` : `step ${index + 1}`;
    readStep(step, { ...scope, where: `${scope.where} › ${label}` });
  });
}

function readStep(step, scope) {
  if (typeof step.run === "string") readRunStep(step, scope);
  else if (typeof step.uses === "string" && step.uses.startsWith("./")) {
    readLocalAction(step.uses, scope);
  }
}

function refusal(where, reason) {
  return { kind: "refusal", where, reason };
}

function readRunStep(step, scope) {
  const { steps } = scope.sequence;
  const cwd = workingDirectory(step, scope);
  if (isInstall(step)) steps.push({ kind: "install", where: scope.where });
  else if ("refusal" in cwd) steps.push(refusal(scope.where, cwd.refusal));
  else if ([...scope.env, step.env].some(env => env != null && Object.hasOwn(env, "NODE_OPTIONS"))) {
    steps.push(refusal(scope.where, NODE_OPTIONS_REASON));
  } else if (/\bnode\b/.test(step.shell ?? "")) {
    steps.push(refusal(scope.where, "runs its script as inline Node code; move it into a file"));
  } else {
    const script = withKnownPaths(step.run, scope);
    steps.push({ kind: "script", where: scope.where, script, cwd: cwd.path });
  }
}

/**
 * Whether a step installs the repository's dependencies, unconditionally, and does nothing else.
 *
 * Narrow on purpose. A condition, a tolerated failure, another directory, a package named on the
 * command line and a second command each describe a step after which the dependencies may still be
 * absent, so each keeps the job in the state this check reads rather than releasing it.
 */
function isInstall(step) {
  if (step.if !== undefined || step["continue-on-error"]) return false;
  if (step["working-directory"] !== undefined) return false;
  const commands = shellCommands(step.run);
  return commands.length === 1 && installsHere(commands[0].words);
}

function installsHere(words) {
  if (!words.every(word => word.literal)) return false;
  const [tool = "", subcommand = "", ...options] = words.map(word => word.text);
  if (!INSTALLER.test(tool) || !INSTALL.test(subcommand)) return false;
  for (let i = 0; i < options.length; i += 1) {
    if (INSTALL_ELSEWHERE.test(options[i])) return false;
    if (INSTALL_VALUES.has(options[i])) i += 1;
    else if (!options[i].startsWith("-")) return false;
  }
  return true;
}

/**
 * The repository path a step's script runs in.
 *
 * GitHub documents a composite action step's own `working-directory`, but not whether a job's
 * default reaches one, so a composite step naming none under a job that sets one is refused rather
 * than resolved either way.
 *
 * @returns {{path: string} | {refusal: string}}
 */
function workingDirectory(step, scope) {
  const own = step["working-directory"];
  const inAction = scope.actions.length > 0;
  if (own === undefined && inAction && scope.defaults !== undefined) {
    return {
      refusal:
        "is a composite action step without a working-directory of its own, under a job that " +
        "sets one, and which of the two it runs in is undocumented",
    };
  }
  return repositoryPath(own ?? (inAction ? undefined : scope.defaults) ?? ".", ".", "directory");
}

/**
 * A path inside the repository, from one written relative to `base`, or why it is not one.
 *
 * @returns {{path: string} | {refusal: string}}
 */
function repositoryPath(value, base, what) {
  if (typeof value !== "string" || value.includes("$")) {
    return { refusal: `names a ${what} that is not in the text: ${value}` };
  }
  const path = posix.normalize(posix.join(base, value));
  if (posix.isAbsolute(value) || path === ".." || path.startsWith("../")) {
    return { refusal: `names a ${what} outside the repository: ${value}` };
  }
  return { path };
}

/** The two runner paths a script can name whose value this reader knows. */
function withKnownPaths(script, scope) {
  const action = scope.actions.at(-1);
  const workspace = /\$\{\{\s*github\.workspace\s*\}\}|\$\{GITHUB_WORKSPACE\}|\$GITHUB_WORKSPACE\b/g;
  const actionPath = /\$\{\{\s*github\.action_path\s*\}\}|\$\{GITHUB_ACTION_PATH\}|\$GITHUB_ACTION_PATH\b/g;
  const text = script.replace(workspace, ".");
  return action === undefined ? text : text.replace(actionPath, action);
}

/**
 * A step using an action from this repository, read in its place.
 *
 * A composite action's steps are read as though the job had written them, so an install inside one
 * ends the dependency-free state and a script started inside one is checked. A JavaScript action's
 * `pre` runs as the job starts and its `post` as the job ends, so they are placed there.
 */
function readLocalAction(uses, scope) {
  const dir = posix.normalize(uses).replace(/\/$/, "");
  const { steps } = scope.sequence;
  if (scope.actions.includes(dir)) {
    steps.push(refusal(scope.where, `uses ./${dir} inside itself`));
    return;
  }
  const manifest = readManifest(dir, scope.repo);
  if (manifest === null) {
    steps.push(refusal(scope.where, `uses ./${dir}, whose action.yml cannot be read`));
    return;
  }
  const runs = manifest.runs ?? {};
  const inner = { ...scope, where: `${scope.where} › ./${dir}`, actions: [...scope.actions, dir] };
  if (runs.using === "composite") readSteps(runs.steps ?? [], inner);
  else if (/^node\d+$/.test(String(runs.using))) readJavaScriptAction(dir, runs, inner);
}

function readManifest(dir, repo) {
  for (const name of ["action.yml", "action.yaml"]) {
    const text = repo.readFile(posix.join(dir, name));
    if (text === null) continue;
    try {
      return load(text) ?? null;
    } catch {
      // A manifest that does not parse is refused by the caller, as one that cannot be read is.
      return null;
    }
  }
  return null;
}

function readJavaScriptAction(dir, runs, scope) {
  const { before, steps, after } = scope.sequence;
  for (const [key, events] of [["pre", before], ["main", steps], ["post", after]]) {
    if (typeof runs[key] !== "string") continue;
    const where = `${scope.where} (${key})`;
    const entry = repositoryPath(runs[key], dir, "script");
    events.push(
      "refusal" in entry
        ? refusal(where, entry.refusal)
        : { kind: "start", where, entry: entry.path, preloads: [] }
    );
  }
}

/** Words that come before the program a command runs: reserved words and the wrappers that exec it. */
const PREFIXES = new Set([
  "if", "then", "elif", "else", "while", "until", "do", "!", "{",
  "time", "exec", "nohup", "command", "builtin", "env", "sudo", "nice",
]);

/** An assignment word, `NAME=value`, whatever its value. */
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** Node's program name, alone or at the end of a path. */
const NODE_PROGRAM = /^(?:.*\/)?(?:node|nodejs)$/;

/** Node's name as a word inside some other text. */
const NODE_NAMED = /(?:^|[^\w$.-])(?:node|nodejs)(?![\w.-])/;

const DIRECTORY_CHANGES = new Set(["cd", "pushd", "popd"]);
const SHELLS = new Set(["bash", "sh", "zsh", "dash", "source", "."]);
const PACKAGE_RUNNERS = new Set(["npx", "pnpx", "bunx"]);
const PACKAGE_MANAGERS = new Set(["pnpm", "npm", "yarn", "corepack"]);

/** Package-manager subcommands that run neither the repository's scripts nor an installed package. */
const INERT_SUBCOMMANDS = new Set([
  "install", "i", "ci", "add", "audit", "view", "info", "show", "whoami", "config", "get", "set",
  "ls", "list", "why", "outdated", "store", "bin", "root", "prefix", "cache", "dist-tag", "ping",
  "help", "enable", "prepare", "use",
]);

/** Options a package manager takes before its subcommand whose value is the next word. */
const MANAGER_VALUES = new Set(["--filter", "-F", "--dir", "-C", "--prefix", "--cwd", "--workspace"]);

/** Options that make Node run something other than a script file. */
const NODE_RUNS_OTHER_CODE = new Set([
  "-e", "--eval", "-p", "--print", "-", "-i", "--interactive", "--run", "--test",
]);

/** Options after which Node prints something and exits without running anything. */
const NODE_EXITS = new Set(["-v", "--version", "-h", "--help", "--v8-options"]);

/** Options whose value is a module Node loads before the script. */
const NODE_PRELOADS = new Set(["-r", "--require", "--import", "--loader", "--experimental-loader"]);

/**
 * Node's own options that take a value, which may be written as the next word.
 *
 * `node --conditions development x.mjs` runs `x.mjs` with the condition set; so does `-C`. V8's
 * options, `--max-old-space-size` among them, take a value only after `=`, and an option written
 * with `=` is accepted whatever its name.
 */
const NODE_TAKES_VALUE = new Set([
  "-C", "--conditions", "--disable-warning", "--env-file", "--env-file-if-exists", "--input-type",
  "--redirect-warnings", "--diagnostic-dir", "--title", "--watch-path", "--report-dir",
  "--report-directory", "--report-filename", "--cpu-prof-dir", "--heap-prof-dir",
  "--unhandled-rejections", "--dns-result-order", "--localstorage-file", "--openssl-config",
  "--icu-data-dir",
]);

/** Node's options that take no value. */
const NODE_FLAGS = new Set([
  "-c", "--check", "--enable-source-maps", "--expose-gc", "--frozen-intrinsics", "--no-addons",
  "--no-deprecation", "--no-warnings", "--pending-deprecation", "--preserve-symlinks",
  "--preserve-symlinks-main", "--throw-deprecation", "--trace-deprecation", "--trace-exit",
  "--trace-uncaught", "--trace-warnings", "--watch", "--abort-on-uncaught-exception",
  "--experimental-vm-modules", "--experimental-strip-types", "--no-experimental-strip-types",
  "--experimental-transform-types", "--experimental-detect-module",
  "--no-experimental-detect-module", "--experimental-require-module",
  "--no-experimental-require-module",
]);

const MOVED = "after changing directory, which this reader does not follow; give the step a working-directory instead";

/**
 * Every program a workflow's jobs start before installing dependencies, and every place this
 * reader could not settle.
 *
 * @param {string} text a workflow file's contents
 * @param {Repository} repo
 * @returns {{starts: Start[], refusals: Refusal[]}}
 */
export function dependencyFreeStarts(text, repo) {
  const found = { starts: [], refusals: [] };
  for (const sequence of jobSequences(text, repo).values()) {
    const install = sequence.findIndex(event => event.kind === "install");
    for (const event of install === -1 ? sequence : sequence.slice(0, install)) {
      if (event.kind === "script") readScript(event, { repo, found, following: [] });
      else if (event.kind === "start") found.starts.push(startOf(event));
      else if (event.kind === "refusal") found.refusals.push({ where: event.where, reason: event.reason });
    }
  }
  return found;
}

function startOf({ where, entry, preloads }) {
  return { where, entry, preloads };
}

function refuse(state, reason) {
  state.found.refusals.push({ where: state.where, reason });
}

/** The programs a shell script starts, in the order it starts them. */
function readScript({ where, script, cwd }, context) {
  const state = { movedDirectory: false, ...context, where, cwd };
  for (const command of shellCommands(script)) readCommand(command, state);
}

function readCommand(command, state) {
  if (command.words.some(word => /^NODE_OPTIONS(?:=|$)/.test(word.text))) {
    refuse(state, NODE_OPTIONS_REASON);
    return;
  }
  const words = programWords(command.words);
  const [program] = words;
  if (program !== undefined && !program.literal) readRuntimeProgram(command, program, state);
  else if (program === undefined) residual(command, state);
  else if (NODE_PROGRAM.test(program.text)) readNodeCommand(words, state);
  else if (DIRECTORY_CHANGES.has(program.text)) state.movedDirectory = true;
  else if (SHELLS.has(program.text)) readShellCommand(command, words, state);
  else if (PACKAGE_RUNNERS.has(program.text) || PACKAGE_MANAGERS.has(program.text)) {
    readPackageManager(command, words, state);
  } else if (program.text.includes("/")) readPathCommand(command, words, state);
  else residual(command, state);
}

/** A command's words from the program it runs: assignments, reserved words and wrappers removed. */
function programWords(words) {
  let i = 0;
  while (
    i < words.length &&
    (ASSIGNMENT.test(words[i].text) || (words[i].literal && PREFIXES.has(words[i].text)))
  ) {
    i += 1;
  }
  return words.slice(i);
}

function readNodeCommand(words, state) {
  if (state.movedDirectory) return refuse(state, `starts Node ${MOVED}`);
  const parsed = nodeArguments(words.slice(1));
  if ("exits" in parsed) return undefined;
  if ("refusal" in parsed) return refuse(state, parsed.refusal);
  const entry = repositoryPath(parsed.entry, state.cwd, "script");
  if ("refusal" in entry) return refuse(state, entry.refusal);
  const preloads = [];
  for (const specifier of parsed.preloads) {
    const path = /^[./]/.test(specifier) ? repositoryPath(specifier, state.cwd, "preload") : null;
    if (path !== null && "refusal" in path) return refuse(state, path.refusal);
    preloads.push(path === null ? { package: specifier } : { path: path.path });
  }
  state.found.starts.push({ where: state.where, entry: entry.path, preloads });
  return undefined;
}

/**
 * The script a `node` command starts and the modules its options preload, read with Node's
 * grammar: `node [options] [--] <script> [arguments]`.
 *
 * @returns {{entry: string, preloads: string[]} | {refusal: string} | {exits: true}}
 */
function nodeArguments(words) {
  const preloads = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (!word.literal) return { refusal: `passes Node a word that is not in the text: ${word.text}` };
    if (word.text === "--") return scriptAt(words[i + 1], preloads);
    if (!word.text.startsWith("-")) return scriptAt(word, preloads);
    const option = readOption(words, i);
    if (!("last" in option)) return option;
    if (option.preload !== undefined) preloads.push(option.preload);
    i = option.last;
  }
  return { refusal: "starts Node without a script file" };
}

/** One option and the index of its last word, or why the command is not a script start. */
function readOption(words, i) {
  const text = words[i].text;
  const equals = text.indexOf("=");
  const name = equals === -1 ? text : text.slice(0, equals);
  const attached = equals === -1 ? undefined : text.slice(equals + 1);
  if (NODE_EXITS.has(name)) return { exits: true };
  if (NODE_RUNS_OTHER_CODE.has(name)) {
    return { refusal: `passes Node ${name}, so what runs is not a script file this reader can walk` };
  }
  if (!NODE_PRELOADS.has(name) && !NODE_TAKES_VALUE.has(name)) {
    if (attached !== undefined || NODE_FLAGS.has(name)) return { last: i };
    return {
      refusal:
        `passes Node ${name}, an option this reader does not know, so it cannot tell whether the ` +
        `next word is its value or the script; write it as ${name}=<value>, or add it to the ` +
        "options no-install-jobs.mjs knows",
    };
  }
  const next = words[i + 1];
  if (attached === undefined && (next === undefined || !next.literal)) {
    return { refusal: `passes Node ${name} without a value this reader can read` };
  }
  const last = attached === undefined ? i + 1 : i;
  const value = attached ?? next.text;
  return NODE_PRELOADS.has(name) ? { last, preload: value } : { last };
}

function scriptAt(word, preloads) {
  if (word === undefined) return { refusal: "starts Node without a script file" };
  if (!word.literal) return { refusal: `starts a script whose path is not in the text: ${word.text}` };
  if (!/\.[cm]?js$/.test(word.text)) {
    return { refusal: `starts ${word.text}, which is not a .mjs, .cjs or .js file this reader can walk` };
  }
  return { entry: word.text, preloads };
}

/** `bash file`, `bash -c '…'`, `bash <<EOF`, `source file`: the script it runs is read in turn. */
function readShellCommand(command, words, state) {
  const shell = words[0].text;
  const inline = words.findIndex(word => word.literal && /^-[A-Za-z]*c[A-Za-z]*$/.test(word.text));
  if (inline !== -1) {
    const body = words[inline + 1];
    if (body?.literal) readScript({ where: `${state.where} › ${shell} -c`, script: body.text, cwd: state.cwd }, state);
    else refuse(state, `runs ${shell} -c with a script that is not in the text`);
    return;
  }
  const file = words.slice(1).find(word => !word.text.startsWith("-"));
  if (file !== undefined) {
    followFile(file, "shell", state);
    return;
  }
  for (const body of command.heredocs) {
    readScript({ where: `${state.where} › ${shell} <<`, script: body, cwd: state.cwd }, state);
  }
}

/** A program the repository holds, named by a literal path, read as the kind given or detected. */
function followFile(word, kind, state) {
  if (!word.literal) return refuse(state, `runs a script whose path is not in the text: ${word.text}`);
  if (state.movedDirectory) return refuse(state, `runs ${word.text} ${MOVED}`);
  const path = repositoryPath(word.text, state.cwd, "script");
  if ("refusal" in path) return refuse(state, path.refusal);
  return readProgram(path.path, kind, state);
}

function readProgram(path, kind, state) {
  if (state.following.includes(path)) return;
  const text = state.repo.readFile(path);
  if (text === null) {
    refuse(state, `runs ${path}, which cannot be read`);
    return;
  }
  const actual = kind ?? programKind(path, text);
  if (actual === "node") state.found.starts.push({ where: state.where, entry: path, preloads: [] });
  else if (actual === "shell") {
    const following = [...state.following, path];
    readScript({ where: `${state.where} › ${path}`, script: text, cwd: state.cwd }, { ...state, following });
  } else if (NODE_NAMED.test(text)) {
    refuse(state, `runs ${path}, which names Node in a language this reader does not read`);
  }
}

function programKind(path, text) {
  const interpreter = /^#!(.*)/.exec(text)?.[1] ?? "";
  if (/\.[cm]?js$/.test(path) || /\bnode\b/.test(interpreter)) return "node";
  if (/\.(?:ba)?sh$/.test(path) || /\b(?:ba|z|da)?sh\b/.test(interpreter)) return "shell";
  return "other";
}

/** A program run by path. One outside the checkout, like a downloaded binary, is not opened. */
function readPathCommand(command, words, state) {
  const program = words[0].text;
  if (state.movedDirectory && !program.startsWith("/")) {
    refuse(state, `runs ${program} ${MOVED}`);
    return;
  }
  const path = repositoryPath(program, state.cwd, "program");
  if (!("refusal" in path) && state.repo.readFile(path.path) !== null) readProgram(path.path, null, state);
  residual(command, state);
}

/**
 * A program named by a word the shell expands at run time: followed when the caller maps that word
 * to the repository file it is a copy of, and refused otherwise.
 */
function readRuntimeProgram(command, program, state) {
  const copy = state.repo.copies?.[program.text];
  if (copy === undefined) {
    refuse(state, `runs ${program.text}, a program named only at run time, so this reader cannot tell whether it starts Node`);
    return;
  }
  readProgram(copy, null, state);
  residual(command, state);
}

/** A package manager's subcommand: its first word that is neither an option nor an option's value. */
function subcommandOf(words) {
  for (let i = 0; i < words.length; i += 1) {
    if (MANAGER_VALUES.has(words[i].text)) i += 1;
    else if (!words[i].text.startsWith("-")) return words[i];
  }
  return undefined;
}

function readPackageManager(command, words, state) {
  const [program, ...rest] = words;
  const subcommand = subcommandOf(rest);
  const inert =
    !PACKAGE_RUNNERS.has(program.text) &&
    (subcommand === undefined || (subcommand.literal && INERT_SUBCOMMANDS.has(subcommand.text)));
  if (inert) {
    residual(command, state);
    return;
  }
  const invocation = [program, subcommand].filter(Boolean).map(word => word.text).join(" ");
  refuse(
    state,
    `runs \`${invocation}\`, which starts the repository's scripts or an installed package, ` +
      "before this job has installed anything"
  );
}

/** Node named where this reader cannot tell whether it runs: an argument, a string, a here-document. */
function residual(command, state) {
  const texts = [...command.words.map(word => word.text), ...command.heredocs];
  const named = texts.find(text => NODE_NAMED.test(text));
  if (named === undefined) return;
  const at = named.search(NODE_NAMED);
  const excerpt = named.slice(Math.max(0, at - 30), at + 50).replace(/\s+/g, " ").trim();
  refuse(
    state,
    `names Node in \`${excerpt}\`, where this reader cannot tell whether it starts it; ` +
      "start the script as a `node <file>` command of its own"
  );
}

/** Record a node's module specifier, if it names one, as followable or not. */
function collectSpecifier(node, source, requires, found) {
  const declares = ts.isImportDeclaration(node) || ts.isExportDeclaration(node);
  if (declares && node.moduleSpecifier !== undefined) {
    if (ts.isStringLiteral(node.moduleSpecifier)) found.imports.push(node.moduleSpecifier.text);
    return;
  }
  const list = loaderCall(node, requires);
  if (list === null) return;
  const [argument] = node.arguments;
  if (argument !== undefined && ts.isStringLiteralLike(argument)) found[list].push(argument.text);
  else found.unresolvable.push(node.getText(source));
}

/** Which list a call asking Node's loader for a module belongs to, or null for any other node. */
function loaderCall(node, requires) {
  if (!ts.isCallExpression(node)) return null;
  const callee = node.expression;
  if (callee.kind === ts.SyntaxKind.ImportKeyword) return "imports";
  if (ts.isIdentifier(callee)) return requires.has(callee.text) ? "requires" : null;
  if (!ts.isPropertyAccessExpression(callee) || callee.name.text !== "resolve") return null;
  const target = callee.expression;
  if (ts.isIdentifier(target) && requires.has(target.text)) return "requires";
  const importMeta = ts.isMetaProperty(target) && target.keywordToken === ts.SyntaxKind.ImportKeyword;
  return importMeta ? "imports" : null;
}

/** The names a file calls `require` by: `require` itself, and each binding of `createRequire(…)`. */
function requireNames(source) {
  const names = new Set(["require"]);
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && isCreateRequire(node.initializer)) {
      names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

function isCreateRequire(node) {
  if (node === undefined || !ts.isCallExpression(node)) return false;
  const callee = node.expression;
  if (ts.isIdentifier(callee)) return callee.text === "createRequire";
  return ts.isPropertyAccessExpression(callee) && callee.name.text === "createRequire";
}

/**
 * Every module specifier a file names: what it imports, what it requires, and the loader calls
 * whose argument a static walk cannot follow.
 *
 * `require` counts under any name `createRequire` binds it to, which is how a module script reaches
 * CommonJS, and `require.resolve` and `import.meta.resolve` count as well, since resolving a package
 * that is not installed fails as loading it does.
 *
 * @param {string} fileName
 * @param {string} text
 * @returns {{imports: string[], requires: string[], unresolvable: string[]}}
 */
export function moduleSpecifiers(fileName, text) {
  const source = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const requires = requireNames(source);
  const found = { imports: [], requires: [], unresolvable: [] };
  const visit = node => {
    collectSpecifier(node, source, requires, found);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/** A file's contents, or null after recording that it could not be read. */
function readOrReport(file, read, offenders) {
  try {
    return read(file);
  } catch {
    offenders.push(`${file}: cannot be read`);
    return null;
  }
}

/** Whether a file exists to be read. */
function readable(file, read) {
  try {
    read(file);
    return true;
  } catch {
    // Not this form of the specifier; the caller tries the next.
    return false;
  }
}

/** The forms `require` tries for a relative specifier, in the order it tries them. */
const REQUIRE_FORMS = ["", ".js", ".json", "/index.js", "/index.json"];

/**
 * What an entry's static module graph reaches that Node alone cannot load.
 *
 * Relative specifiers are followed through `read` — an import at exactly the path it names, a
 * require through the forms `require` tries — and a bare one must be a builtin. Whatever the walk
 * cannot settle is reported rather than passed over: a file that cannot be read, or a loader call
 * with no literal argument, because an unexamined import and a clean one look identical otherwise.
 *
 * @param {string} entry repository-relative path of the file a job starts
 * @param {(path: string) => string} read a file's contents, throwing when it does not exist
 * @returns {{files: string[], offenders: string[]}}
 */
export function nonBuiltinImports(entry, read) {
  const files = new Set();
  const offenders = [];
  const follow = (file, specifier, forms) => {
    if (!specifier.startsWith(".")) {
      if (!isBuiltin(specifier)) offenders.push(`${file} imports ${specifier}`);
      return;
    }
    const base = posix.normalize(posix.join(posix.dirname(file), specifier));
    walk(forms.map(form => base + form).find(candidate => readable(candidate, read)) ?? base);
  };
  const walk = file => {
    if (files.has(file)) return;
    files.add(file);
    const text = readOrReport(file, read, offenders);
    if (text === null || file.endsWith(".json")) return;
    const { imports, requires, unresolvable } = moduleSpecifiers(file, text);
    for (const call of unresolvable) offenders.push(`${file}: ${call} names no literal module`);
    for (const specifier of imports) follow(file, specifier, [""]);
    for (const specifier of requires) follow(file, specifier, REQUIRE_FORMS);
  };
  walk(entry);
  return { files: [...files], offenders };
}

/**
 * Everything a start reaches that Node alone cannot load: its script's graph and each preload's.
 *
 * @param {Start} start
 * @param {(path: string) => string} read a file's contents, throwing when it does not exist
 * @returns {string[]}
 */
export function startOffenders(start, read) {
  const offenders = [...nonBuiltinImports(start.entry, read).offenders];
  for (const preload of start.preloads) {
    if ("path" in preload) offenders.push(...nonBuiltinImports(preload.path, read).offenders);
    else if (!isBuiltin(preload.package)) offenders.push(`${start.where} preloads ${preload.package}`);
  }
  return offenders;
}
