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
    const judged =
      installed ??
      (declared !== undefined ? lowestVersionIn(declared) : undefined);
    if (judged === undefined || satisfiesRange(judged, supported)) continue;
    const floor = lowestVersionIn(supported);
    // Every supported range names a floor; a range without one would leave
    // nothing to compare, and the version is then reported as too new.
    const direction =
      floor !== undefined && compareVersions(judged, floor) < 0
        ? "too-old"
        : "too-new";
    problems.push({ name, installed, declared, supported, direction });
  }
  return problems;
}

const LABEL: Record<SupportedPackage, string> = {
  next: "Next.js",
  react: "React",
  "react-dom": "React",
};

const major = (version: string): number => Number(version.split(".")[0]);

/** The one step that brings `problem` into range, as a sentence and a command. */
function fix(problem: FrameworkVersionProblem, pm: PackageManager): string {
  const add = ADD_COMMAND[pm];
  const floor = lowestVersionIn(problem.supported) ?? problem.supported;
  const supportedMajor = major(floor);
  const found =
    problem.installed ?? lowestVersionIn(problem.declared ?? "") ?? floor;
  const label = LABEL[problem.name];
  const isNext = problem.name === "next";

  if (problem.direction === "too-new") {
    const install = isNext
      ? `next@${supportedMajor}`
      : `react@${supportedMajor} react-dom@${supportedMajor}`;
    return (
      `This release of Nextly supports ${label} up to the ${supportedMajor}.x line. ` +
      `Install ${label} ${supportedMajor}, or wait for a Nextly release that supports ${label} ${major(found)}:\n` +
      `    ${add} ${install}`
    );
  }
  // Across a major, Next.js's codemod moves the app and its React together
  // and rewrites the APIs the major changed; within the major a plain
  // install is enough. The codemod takes an exact version (or "major", a
  // dist tag), not a bare major, so it is given the reviewed release.
  if (isNext && major(found) < supportedMajor) {
    return (
      `Upgrade Next.js to ${REVIEWED_VERSIONS.next} with its codemod:\n` +
      `    npx @next/codemod@latest upgrade ${REVIEWED_VERSIONS.next}`
    );
  }
  const install = isNext
    ? `next@${problem.supported}`
    : `react@${SUPPORTED_RANGES.react} react-dom@${SUPPORTED_RANGES["react-dom"]}`;
  return `Upgrade ${label} to ${problem.supported}:\n    ${add} ${install}`;
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
