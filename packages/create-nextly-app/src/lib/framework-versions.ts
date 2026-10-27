/**
 * Whether an existing app's Next.js, React and React DOM are ones this
 * release of Nextly supports, and what to change when they are not.
 *
 * Nextly is reviewed against one Next.js major and one React major
 * (`SUPPORTED_RANGES`). An app below the floor or on a newer major would
 * install Nextly and then fail at build or at run time, so adding Nextly to
 * it stops before anything is written, saying what was found and the way on.
 */
import path from "path";

import fs from "fs-extra";

import {
  REVIEWED_VERSIONS,
  SUPPORTED_RANGES,
  type SupportedPackage,
} from "../supported-versions";
import type { PackageManager } from "../types";
import {
  compareVersions,
  lowestVersionIn,
  satisfiesRange,
} from "../utils/version-range";

import {
  ADD_COMMAND,
  DEPENDENCY_FIELDS,
  installedVersion,
} from "./nextly-release";

/** A framework package an existing app has outside the supported range. */
export interface FrameworkVersionProblem {
  name: SupportedPackage;
  /** What Node.js would load, when the app has it installed. */
  installed?: string;
  /** The app's own package.json spec, when it declares the package. */
  declared?: string;
  /** The supported range it falls outside. */
  supported: string;
  /** The version judged outside it: the installed one, or the declared spec's lowest. */
  judged: string;
  /** Below the range's floor, or on a newer major than it covers. */
  direction: "too-old" | "too-new";
}

/** The first spec the app's package.json gives `name`, in field order. */
function declaredSpec(
  manifest: Record<string, unknown>,
  name: string
): string | undefined {
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (!deps || typeof deps !== "object") continue;
    const spec = (deps as Record<string, unknown>)[name];
    if (typeof spec === "string") return spec;
  }
  return undefined;
}

/**
 * Every supported framework package the app at `cwd` has outside its range.
 *
 * The version judged is the installed one, read from the `node_modules` Node
 * would load it from; with none installed, the lowest version the app's
 * package.json range admits, which is what an install could resolve to. A
 * package the app neither has installed nor declares in a form that names a
 * version (a dist-tag, `workspace:*`) is not judged.
 */
export async function frameworkVersionProblems(
  cwd: string
): Promise<FrameworkVersionProblem[]> {
  const manifest = (await fs
    .readJson(path.join(cwd, "package.json"))
    .catch(() => ({}))) as Record<string, unknown>;
  const problems: FrameworkVersionProblem[] = [];
  for (const name of Object.keys(SUPPORTED_RANGES) as SupportedPackage[]) {
    const supported = SUPPORTED_RANGES[name];
    const installed = await installedVersion(cwd, name);
    const declared = declaredSpec(manifest, name);
    const lowestDeclared =
      declared !== undefined ? lowestVersionIn(declared) : undefined;
    const floor = lowestVersionIn(supported);
    // A declaration whose lowest version is already past the supported major
    // is judged even when the installed copy is in range: the next install
    // reconciles to it, so the app is headed there. One that merely starts
    // lower (`^16.0.0` beside an installed 16.4.2) is left to the installed copy.
    const declaredTooNew =
      lowestDeclared !== undefined &&
      floor !== undefined &&
      compareVersions(lowestDeclared, floor) > 0 &&
      !satisfiesRange(lowestDeclared, supported);
    const judged = declaredTooNew
      ? lowestDeclared
      : (installed ?? lowestDeclared);
    if (judged === undefined || satisfiesRange(judged, supported)) continue;
    // Too new only on a later major than the range covers; anything else
    // outside it (below the floor, or a prerelease within the major) needs a
    // supported release of the same major. A range without a floor leaves
    // nothing to compare, and the version is then reported as too new.
    const direction =
      floor === undefined || major(judged) > major(floor)
        ? "too-new"
        : "too-old";
    problems.push({ name, installed, declared, supported, judged, direction });
  }
  return problems;
}

const LABEL: Record<SupportedPackage, string> = {
  next: "Next.js",
  react: "React",
  "react-dom": "React",
};

const major = (version: string): number => Number(version.split(".")[0]);

/** What `fix` reads from a problem: the supported major and the version found. */
function majorsOf(problem: FrameworkVersionProblem): {
  supportedMajor: number;
  foundMajor: number;
} {
  const floor = lowestVersionIn(problem.supported) ?? problem.supported;
  return { supportedMajor: major(floor), foundMajor: major(problem.judged) };
}

/** A version past the supported major: install that major, or wait for Nextly. */
function tooNewFix(problem: FrameworkVersionProblem, add: string): string {
  const { supportedMajor, foundMajor } = majorsOf(problem);
  const label = LABEL[problem.name];
  const install =
    problem.name === "next"
      ? `next@${supportedMajor}`
      : `react@${supportedMajor} react-dom@${supportedMajor}`;
  return (
    `This release of Nextly supports ${label} up to the ${supportedMajor}.x line. ` +
    `Install ${label} ${supportedMajor}, or wait for a Nextly release that supports ${label} ${foundMajor}:\n` +
    `    ${add} ${install}`
  );
}

/** A version below the supported floor: the codemod across a Next.js major, an install otherwise. */
function tooOldFix(problem: FrameworkVersionProblem, add: string): string {
  const { supportedMajor, foundMajor } = majorsOf(problem);
  // Across a major, Next.js's codemod moves the app and its React together
  // and rewrites the APIs the major changed; within the major a plain
  // install is enough. The codemod takes an exact version (or "major", a
  // dist tag), not a bare major, so it is given the reviewed release.
  if (problem.name === "next" && foundMajor < supportedMajor) {
    return (
      `Upgrade Next.js to ${REVIEWED_VERSIONS.next} with its codemod:\n` +
      `    npx @next/codemod@latest upgrade ${REVIEWED_VERSIONS.next}`
    );
  }
  const install =
    problem.name === "next"
      ? `next@${problem.supported}`
      : `react@${SUPPORTED_RANGES.react} react-dom@${SUPPORTED_RANGES["react-dom"]}`;
  return `Upgrade ${LABEL[problem.name]} to ${problem.supported}:\n    ${add} ${install}`;
}

/** The one step that brings `problem` into range, as a sentence and a command. */
function fix(problem: FrameworkVersionProblem, pm: PackageManager): string {
  const add = ADD_COMMAND[pm];
  return problem.direction === "too-new"
    ? tooNewFix(problem, add)
    : tooOldFix(problem, add);
}

/**
 * Why the run stopped: each package found, the range it falls outside, and
 * the change that brings it in. React and React DOM move together, so a
 * problem with both gives one command.
 */
export function frameworkVersionMessage(
  problems: readonly FrameworkVersionProblem[],
  pm: PackageManager
): string {
  const lines = problems.map(({ name, installed, declared, supported }) => {
    const parts = [
      installed !== undefined ? `installed ${installed}` : undefined,
      declared !== undefined ? `declared ${declared}` : undefined,
    ].filter(Boolean);
    return `  ${name}: ${parts.join(", ")}; supported ${supported}`;
  });
  const fixes = [...new Set(problems.map(problem => fix(problem, pm)))];
  return (
    "This app's Next.js or React is outside what this release of Nextly supports:\n" +
    `${lines.join("\n")}\n\n` +
    "Nothing was changed. Change the app as follows, then run create-nextly-app again:\n" +
    fixes.map(line => `  ${line}`).join("\n")
  );
}
