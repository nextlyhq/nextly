#!/usr/bin/env node
/**
 * Installs the skills for people building with Nextly from this checkout with
 * the real `skills` installer, the way the coding-agents guide tells people to,
 * and fails unless what it installed is exactly the skills in `skills/`.
 *
 * `check-agent-contract` holds the rule that makes this true: every SKILL.md
 * outside `skills/` carries the installer's `metadata.internal: true`, which
 * hides it. But that check reads files. It cannot see what the installer does
 * with the flag, so a release that read it differently, or searched folders it
 * did not before, would offer contributor skills while every file stayed
 * correct. This runs the installer itself, at a pinned release, and reads both
 * what it reports and what it wrote.
 *
 * Exit status: 0 when the installed skills are exactly `skills/`, 1 when they
 * differ, 2 when the installer could not be run or its answer not read. "Could
 * not ask" is not "the answer is no", and neither is a pass.
 */
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CLAUDE_COPY,
  SKILLS_HOME,
  USER_SKILLS_HOME,
  userSkillSeparation,
} from "./agent-skills.mjs";
import { isCliEntry } from "./cli-entry.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The installer release this runs. Pinned, never floating, so a new release
 * cannot change the verdict between two runs of one commit: move it on
 * purpose, and say why in the change that moves it. 1.7.2 was the current
 * release when this check was written, and its `--json` output is what
 * `installedSkills` reads.
 */
export const INSTALLER = "skills@1.7.2";

/** The coding-agents guide, whose install command this runs. */
export const GUIDE = "docs/guides/coding-agents.mdx";

/**
 * The source the guide's command installs from: this repository at the
 * release the reader fills in. This check runs the command against the
 * checkout instead, so it holds the source to that one spelling rather than
 * pass while the guide sends people somewhere else. `create-nextly-app`'s
 * test of the update command holds the same text to the command the CLI
 * prints.
 */
export const GUIDE_SOURCE = "nextlyhq/nextly#v<version>";

/**
 * The arguments the guide's install command passes after its source, read
 * from the guide itself, so the check runs whatever the guide tells people to
 * run: change its agents or its install mode there and this follows. Quotes
 * the shell would remove are removed. Null when the guide holds no such
 * command, or more than one, since then which one people run is unknown, or
 * when its source is not {@link GUIDE_SOURCE}.
 *
 * @param {string} text the guide's text
 * @returns {string[] | null}
 */
export function guideArguments(text) {
  const commands = [...text.matchAll(/^npx skills add '([^']+)' (.+)$/gm)];
  if (commands.length !== 1 || commands[0][1] !== GUIDE_SOURCE) return null;
  return commands[0][2]
    .trim()
    .split(/\s+/)
    .map(arg => arg.replace(/^'(.*)'$/, "$1"));
}

/**
 * The folders the guide's command installs into, which are the same two this
 * repository keeps its own skills in: the shared `.agents/skills/` and the
 * Claude Code copy in `.claude/skills/`.
 */
const INSTALLED_HOMES = [SKILLS_HOME, CLAUDE_COPY];

/**
 * The installer's `--json` report, read into one entry per skill. Null when
 * the output is not the array of `{ name, status }` it prints, so a changed
 * format is reported as unreadable rather than read as no skills.
 *
 * @param {string | undefined} stdout absent when the installer never started
 * @returns {{ name: string, status: string }[] | null}
 */
export function installedSkills(stdout) {
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const entries = parsed.filter(
    entry =>
      typeof entry?.name === "string" && typeof entry?.status === "string"
  );
  return entries.length === parsed.length
    ? entries.map(({ name, status }) => ({ name, status }))
    : null;
}

/**
 * How what was installed differs from `skills/`, one line per difference,
 * empty when they agree. The installer's report and the folders it wrote are
 * each compared, since either could be wrong without the other.
 *
 * @param {{ expected: string[], reported: { name: string, status: string }[], written: Record<string, string[]> }} found
 * @returns {string[]}
 */
export function installerFindings({ expected, reported, written }) {
  const empty = `${USER_SKILLS_HOME}/ holds no skills, so there was nothing to compare the installer with`;
  return [
    ...(expected.length === 0 ? [empty] : []),
    ...reported
      .filter(entry => entry.status !== "installed")
      .map(
        ({ name, status }) =>
          `${name}: the installer reported "${status}", not "installed"`
      ),
    ...setDifferences(
      "the installer reported",
      reported.map(entry => entry.name),
      expected
    ),
    ...Object.entries(written).flatMap(([home, names]) =>
      setDifferences(`${home}/ holds`, names, expected)
    ),
  ];
}

/** Each name one side has and the other lacks, worded for the side that has it. */
function setDifferences(label, actual, expected) {
  return [
    ...actual
      .filter(name => !expected.includes(name))
      .map(name => `${label} ${name}, which is not in ${USER_SKILLS_HOME}/`),
    ...expected
      .filter(name => !actual.includes(name))
      .map(name => `${label} no ${name}, which ${USER_SKILLS_HOME}/ holds`),
  ];
}

/** The skill folders one installed home holds, by name. */
function foldersIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
}

/**
 * Runs the guide's command in `project`, with `args` from the guide, aimed at
 * this checkout instead of the repository on GitHub, and with `--json` added
 * so its report can be read. INSTALL_INTERNAL_SKILLS would show the
 * contributor skills on purpose, so it is removed; telemetry is off, since
 * this is no real install.
 */
function runInstaller(base, project, args) {
  const env = {
    ...process.env,
    CI: "1",
    DISABLE_TELEMETRY: "1",
    DO_NOT_TRACK: "1",
  };
  delete env.INSTALL_INTERNAL_SKILLS;
  return spawnSync(
    "npx",
    ["--yes", INSTALLER, "add", base, ...args, "--json"],
    {
      cwd: project,
      env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 300_000,
    }
  );
}

/**
 * What the installer reported, or null when its run gave no answer this can
 * read. The report is read whatever the exit status, since a failed install
 * still names the skill that failed; but a non-zero exit with every skill
 * reported installed is a failure the report does not explain.
 */
export function reportOf(run) {
  const reported = installedSkills(run.stdout);
  const unexplained =
    run.status !== 0 && reported?.every(entry => entry.status === "installed");
  return reported === null || unexplained ? null : reported;
}

/** Says the installer could not be asked, and why, as exit status 2. */
function notChecked(why, stderr = "") {
  console.error(`skills installer: NOT CHECKED — ${why}`);
  if (stderr) console.error(stderr.slice(-2000));
  return 2;
}

/** Why a run that {@link reportOf} could not read gave no answer. */
function unanswered(run) {
  return run.error
    ? `${INSTALLER} could not start (${run.error.message})`
    : `${INSTALLER} exited ${run.status}, and printed no report this reads that explains it`;
}

/** Prints the verdict, first so a reader's `head` cannot cut it off, and returns the exit status. */
function verdict(findings, expected) {
  if (findings.length === 0) {
    console.log(
      `skills installer: OK — ${INSTALLER} installed exactly ${USER_SKILLS_HOME}/ (${expected.join(", ")}) into ${INSTALLED_HOMES.join(" and ")}`
    );
    return 0;
  }
  console.error(
    `skills installer: FAIL — ${INSTALLER} did not install exactly ${USER_SKILLS_HOME}/`
  );
  console.error(findings.map(finding => `  ${finding}`).join("\n"));
  console.error(
    `\nA skill outside ${USER_SKILLS_HOME}/ needs \`metadata: internal: true\` in its frontmatter, ` +
      `or belongs in ${USER_SKILLS_HOME}/ if people building with Nextly need it.`
  );
  return 1;
}

function main(base = root) {
  const args = guideArguments(readFileSync(join(base, GUIDE), "utf8"));
  if (args === null) {
    return notChecked(
      `${GUIDE} does not hold exactly one \`npx skills add '${GUIDE_SOURCE}'\` command to run`
    );
  }
  // The skills in `skills/`, as the repository's skill check reads them.
  const expected = [...userSkillSeparation(base).user].sort();
  const project = mkdtempSync(join(tmpdir(), "skills-installer-"));
  try {
    writeFileSync(
      join(project, "package.json"),
      '{ "name": "skills-installer-check", "private": true }\n'
    );
    const run = runInstaller(base, project, args);
    const reported = reportOf(run);
    if (reported === null) return notChecked(unanswered(run), run.stderr);
    const written = Object.fromEntries(
      INSTALLED_HOMES.map(home => [home, foldersIn(join(project, home))])
    );
    return verdict(
      installerFindings({ expected, reported, written }),
      expected
    );
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

if (isCliEntry(import.meta.url)) process.exit(main());
