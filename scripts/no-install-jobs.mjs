/**
 * Which scripts a workflow runs WITHOUT installing dependencies, and whether each one can.
 *
 * A job that never installs runs straight after checkout with Node and nothing else, so every module
 * a script it starts imports — all the way down that script's import graph — must be a Node builtin.
 * Two jobs are like that: the CI gate, which has to report even when the install every other job
 * depends on is what failed, and the scheduled repository-metadata check, which observes repository
 * settings no file check can see.
 *
 * Neither property is visible to a pull request. A scheduled job never runs on one, and pull-request
 * CI installs dependencies before anything else, so an npm import added three files away from either
 * job passes every check on its own pull request and fails afterwards, on `main`, attributed to
 * whatever commit happens to be at the tip when the job next runs.
 *
 * The population is DERIVED from the workflow files rather than listed: a job that stops installing
 * is covered the day it changes, and one that starts installing is released from the rule the same
 * day. Imports are read with TypeScript's parser rather than a pattern, because a pattern reads an
 * import quoted in a comment or a string as a real one, and a guard that fails on a correct file
 * teaches people to delete it.
 *
 * @module no-install-jobs
 */

import { isBuiltin } from "node:module";
import { dirname, join, normalize } from "node:path";

import ts from "typescript";

import {
  jobLocalActions,
  jobSteps,
  workflowSteps,
} from "./workflow-run-blocks.mjs";

/** A command that installs a project's dependencies. */
const INSTALL = /(^|[\s;&|(])(pnpm|npm|yarn)\s+(install|ci|i)(\s|$)/;

/** A `node` invocation, capturing the file it starts. */
const NODE_ENTRY = /\bnode\s+(?:-\S+\s+)*(\S+?\.(?:mjs|cjs|js))\b/g;

/** A step script's lines that execute, without its shell comments. */
function executableLines(block) {
  return block.split("\n").filter(line => !line.trim().startsWith("#"));
}

/**
 * Whether any of these step scripts installs dependencies.
 *
 * @param {{block: string}[]} steps
 * @returns {boolean}
 */
export function installsDependencies(steps) {
  return steps.some(step =>
    executableLines(step.block).some(line => INSTALL.test(line))
  );
}

/**
 * Every file these step scripts start with `node`, in order, once each.
 *
 * @param {{block: string}[]} steps
 * @returns {string[]}
 */
export function nodeEntries(steps) {
  const entries = new Set();
  for (const step of steps) {
    for (const line of executableLines(step.block)) {
      for (const match of line.matchAll(NODE_ENTRY)) entries.add(match[1]);
    }
  }
  return [...entries];
}

/** Whether a local composite action installs dependencies. Unreadable counts as not installing. */
function actionInstalls(directory, readAction) {
  const text = readAction(directory);
  return text !== null && installsDependencies(workflowSteps(text));
}

/**
 * The scripts each job in a workflow starts without having installed dependencies.
 *
 * An action this cannot read is treated as NOT installing, so its job is checked rather than
 * excused: a guard that skips what it could not examine reports exactly as a clean result does.
 *
 * @param {string} text the workflow file's contents
 * @param {(directory: string) => string|null} readAction a local action's definition, or null
 * @returns {{job: string, entries: string[]}[]}
 */
export function noInstallEntries(text, readAction) {
  const actions = jobLocalActions(text);
  const found = [];
  for (const [job, steps] of jobSteps(text)) {
    if (installsDependencies(steps)) continue;
    if ((actions.get(job) ?? []).some(dir => actionInstalls(dir, readAction))) continue;
    const entries = nodeEntries(steps);
    if (entries.length > 0) found.push({ job, entries });
  }
  return found;
}

/** Record a node's module specifier, if it names one, as followable or not. */
function collectSpecifier(node, source, found) {
  const declares = ts.isImportDeclaration(node) || ts.isExportDeclaration(node);
  if (declares && node.moduleSpecifier !== undefined) {
    if (ts.isStringLiteral(node.moduleSpecifier)) found.literal.push(node.moduleSpecifier.text);
    return;
  }
  const dynamic =
    ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword;
  if (!dynamic) return;
  const [argument] = node.arguments;
  if (argument !== undefined && ts.isStringLiteralLike(argument)) found.literal.push(argument.text);
  else found.unresolvable.push(node.getText(source));
}

/**
 * Every module specifier a file names: the literal ones a static walk can follow, and the calls to
 * `import()` whose argument it cannot.
 *
 * @param {string} fileName
 * @param {string} text
 * @returns {{literal: string[], unresolvable: string[]}}
 */
export function moduleSpecifiers(fileName, text) {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const found = { literal: [], unresolvable: [] };
  const visit = node => {
    collectSpecifier(node, source, found);
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

/**
 * What an entry's static import graph reaches that Node alone cannot load.
 *
 * Relative specifiers are followed through `read`; a bare one must be a builtin. Whatever the walk
 * cannot settle is reported rather than passed over — a file that cannot be read, or an `import()`
 * with no literal argument — because an unexamined import and a clean one look identical otherwise.
 *
 * @param {string} entry repository-relative path of the file a job starts
 * @param {(path: string) => string} read a file's contents, throwing when it does not exist
 * @returns {{files: string[], offenders: string[]}}
 */
export function nonBuiltinImports(entry, read) {
  const files = new Set();
  const offenders = [];
  const walk = file => {
    if (files.has(file)) return;
    files.add(file);
    const text = readOrReport(file, read, offenders);
    if (text === null) return;
    const { literal, unresolvable } = moduleSpecifiers(file, text);
    for (const call of unresolvable) offenders.push(`${file}: ${call} names no literal module`);
    for (const specifier of literal) {
      if (specifier.startsWith(".")) walk(normalize(join(dirname(file), specifier)));
      else if (!isBuiltin(specifier)) offenders.push(`${file} imports ${specifier}`);
    }
  };
  walk(entry);
  return { files: [...files], offenders };
}
