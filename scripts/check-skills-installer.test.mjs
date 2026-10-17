/**
 * The installer check's reading and comparison. Running the installer itself
 * needs the network, so it is watched in its own CI job; what is decided here
 * is whether a given report and set of folders pass.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  GUIDE,
  INSTALLER,
  guideArguments,
  installedSkills,
  installerFindings,
  reportOf,
} from "./check-skills-installer.mjs";

const SCRIPT = fileURLToPath(
  new URL("./check-skills-installer.mjs", import.meta.url)
);
const ROOT = join(dirname(SCRIPT), "..");

const installed = names => names.map(name => ({ name, status: "installed" }));
const both = names => ({ ".agents/skills": names, ".claude/skills": names });

describe("reading the installer's report", () => {
  it("reads one entry per skill from its --json output", () => {
    const stdout = JSON.stringify([
      {
        name: "nextly-install",
        status: "installed",
        path: "/p/.claude/skills/nextly-install",
        agents: ["Codex"],
      },
      { name: "nextly-deploy", status: "failed", error: "no space" },
    ]);
    expect(installedSkills(stdout)).toEqual([
      { name: "nextly-install", status: "installed" },
      { name: "nextly-deploy", status: "failed" },
    ]);
  });

  // A changed format must read as "could not tell", never as "installed nothing".
  it("is null for output that is not that report", () => {
    expect(installedSkills("Found 4 skills")).toBeNull();
    expect(installedSkills('{ "skills": [] }')).toBeNull();
    expect(installedSkills('[{ "skill": "nextly-install" }]')).toBeNull();
    expect(
      installedSkills(
        '[{ "name": "nextly-install", "status": "installed" }, 3]'
      )
    ).toBeNull();
  });
});

describe("comparing what was installed with skills/", () => {
  const expected = ["nextly-deploy", "nextly-install"];

  it("passes when the report and both folders are exactly skills/", () => {
    expect(
      installerFindings({
        expected,
        reported: installed(expected),
        written: both(expected),
      })
    ).toEqual([]);
  });

  it("names a contributor skill the installer offered, in the report and in each folder", () => {
    const offered = [...expected, "derived-checks"];
    expect(
      installerFindings({
        expected,
        reported: installed(offered),
        written: both(offered),
      })
    ).toEqual([
      "the installer reported derived-checks, which is not in skills/",
      ".agents/skills/ holds derived-checks, which is not in skills/",
      ".claude/skills/ holds derived-checks, which is not in skills/",
    ]);
  });

  it("names a user skill that was left out", () => {
    expect(
      installerFindings({
        expected,
        reported: installed(["nextly-install"]),
        written: both(expected),
      })
    ).toEqual(["the installer reported no nextly-deploy, which skills/ holds"]);
  });

  // The report alone could claim a skill the installer never wrote.
  it("reads the folders as well as the report", () => {
    const written = {
      ".agents/skills": expected,
      ".claude/skills": ["nextly-install"],
    };
    expect(
      installerFindings({ expected, reported: installed(expected), written })
    ).toEqual([".claude/skills/ holds no nextly-deploy, which skills/ holds"]);
  });

  it("refuses a skill the installer reported as anything but installed", () => {
    const reported = [
      { name: "nextly-install", status: "installed" },
      { name: "nextly-deploy", status: "failed" },
    ];
    expect(
      installerFindings({ expected, reported, written: both(expected) })
    ).toEqual([
      'nextly-deploy: the installer reported "failed", not "installed"',
    ]);
  });

  // With nothing to compare, agreement would be two empty sets matching.
  it("refuses an empty skills/ even when the installer installed nothing", () => {
    expect(
      installerFindings({ expected: [], reported: [], written: both([]) })
    ).toEqual([
      "skills/ holds no skills, so there was nothing to compare the installer with",
    ]);
  });
});

describe("the installer it runs", () => {
  it("is one exact release, never a range or a tag", () => {
    expect(INSTALLER).toMatch(/^skills@\d+\.\d+\.\d+$/);
  });
});

describe("reading the command from the guide", () => {
  it("takes the arguments after the source, without the quotes the shell removes", () => {
    const text =
      "Install:\n\n```bash\nnpx skills add 'nextlyhq/nextly#v<version>' --skill '*' --agent claude-code codex --copy -y\n```\n";
    expect(guideArguments(text)).toEqual([
      "--skill",
      "*",
      "--agent",
      "claude-code",
      "codex",
      "--copy",
      "-y",
    ]);
  });

  // Which command people run is unknown then, so nothing is run in its place.
  it("is null for a guide with no such command, or two", () => {
    const one = "npx skills add 'a#v1' --skill '*'";
    expect(guideArguments("no command here")).toBeNull();
    expect(guideArguments(`${one}\n${one}\n`)).toBeNull();
  });

  it("finds the command in the guide as it stands", () => {
    expect(guideArguments(readFileSync(join(ROOT, GUIDE), "utf8"))).toContain(
      "--skill"
    );
  });
});

describe("reading the installer's run", () => {
  const report = entries => JSON.stringify(entries);

  // A failed install still names the skill that failed, which is the answer.
  it("reads the report of a run that failed", () => {
    const run = {
      status: 1,
      stdout: report([{ name: "nextly-install", status: "failed" }]),
    };
    expect(reportOf(run)).toEqual([
      { name: "nextly-install", status: "failed" },
    ]);
  });

  it("gives no answer for a failed run that reports every skill installed, or prints no report", () => {
    expect(
      reportOf({
        status: 1,
        stdout: report([{ name: "nextly-install", status: "installed" }]),
      })
    ).toBeNull();
    expect(reportOf({ status: 1, stdout: "" })).toBeNull();
    expect(
      reportOf({ status: null, error: new Error("spawn npx ENOENT") })
    ).toBeNull();
  });
});

describe("the command itself", () => {
  /*
   * Run as CI runs it, with an `npx` first on the PATH that exits 127 and
   * prints nothing, so it must say it could not check and exit 2. A module
   * whose entry guard never fired would exit 0 having printed nothing, which
   * a green job could not tell from a pass. The stand-in is a shell script,
   * which Windows does not run by that name.
   */
  it.skipIf(process.platform === "win32")(
    "runs from the command line and reports an installer that gave no answer",
    () => {
      const bin = mkdtempSync(join(tmpdir(), "skills-installer-path-"));
      try {
        writeFileSync(join(bin, "npx"), "#!/bin/sh\nexit 127\n", {
          mode: 0o755,
        });
        const run = spawnSync(process.execPath, [SCRIPT], {
          cwd: ROOT,
          env: {
            ...process.env,
            PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
          },
          encoding: "utf8",
        });
        expect(run.stderr).toContain(
          `skills installer: NOT CHECKED — ${INSTALLER} exited 127`
        );
        expect(run.status).toBe(2);
      } finally {
        rmSync(bin, { recursive: true, force: true });
      }
    }
  );
});
