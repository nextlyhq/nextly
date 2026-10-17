/**
 * The installer check's reading and comparison. Running the installer itself
 * needs the network, so it is watched in its own CI job; what is decided here
 * is whether a given report and set of folders pass.
 */
import { describe, expect, it } from "vitest";

import {
  INSTALLER,
  installedSkills,
  installerFindings,
} from "./check-skills-installer.mjs";

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
