import { describe, expect, it } from "vitest";

import {
  formatPlanWarning,
  planWarnings,
  resolvePlan,
  type PlanAnswers,
  type PlanEnvironment,
} from "../plan";

const ENV: PlanEnvironment = {
  detectedCodingTools: [],
  detectedPackageManager: "npm",
  gitAvailable: false,
  insideGitRepository: false,
};

// The byte every escape sequence starts with: colour, cursor movement or
// erase.
const ESCAPE = String.fromCharCode(27);

function warningsFor(answers: PlanAnswers) {
  return planWarnings(resolvePlan(answers, ENV));
}

describe("a combination that will break", () => {
  it("warns for SQLite on Vercel", () => {
    expect(warningsFor({ host: "vercel", db: "sqlite" })).toEqual([
      {
        code: "sqlite-on-vercel",
        message:
          "SQLite on Vercel loses data on every deploy. Pick PostgreSQL or MySQL.",
      },
    ]);
  });

  it("warns for images kept in the project's folder on Vercel", () => {
    expect(warningsFor({ host: "vercel", images: "local" })).toEqual([
      {
        code: "local-images-on-vercel",
        message:
          "On Vercel, images in the project folder are lost on every deploy. Pick Vercel Blob or S3.",
      },
    ]);
  });

  it("gives both warnings, in the order the questions come, when both hold", () => {
    expect(
      warningsFor({ host: "vercel", db: "sqlite", images: "local" }).map(
        w => w.code
      )
    ).toEqual(["sqlite-on-vercel", "local-images-on-vercel"]);
  });

  it("warns when the connection test found tables, saying whether they look like a Nextly site", () => {
    const plan = resolvePlan({ db: "postgres" }, ENV);
    expect(planWarnings(plan, { existingTables: "nextly" })).toEqual([
      {
        code: "database-has-tables",
        message: "This database already holds a Nextly site's tables.",
      },
    ]);
    expect(planWarnings(plan, { existingTables: "other" })).toEqual([
      {
        code: "database-has-tables",
        message:
          "This database already holds tables that don't look like a Nextly site.",
      },
    ]);
  });

  it("says nothing of tables for a database the test found empty, or never tested", () => {
    const plan = resolvePlan({ db: "postgres" }, ENV);
    expect(planWarnings(plan)).toEqual([]);
    expect(planWarnings(plan, {})).toEqual([]);
  });
});

describe("a plan with nothing that will break", () => {
  it("has no warning, on Vercel with its defaults or anywhere else", () => {
    expect(warningsFor({ host: "vercel" })).toEqual([]);
    expect(warningsFor({})).toEqual([]);
    expect(warningsFor({ start: "plugin" })).toEqual([]);
  });

  it("has none for images left for later, which the questions don't warn of", () => {
    expect(warningsFor({ host: "vercel", images: "later" })).toEqual([]);
  });
});

describe("warnings never stop a run", () => {
  it("still gives a whole plan for every combination that will break", () => {
    // resolvePlan returns; it does not throw or refuse the answers.
    const plan = resolvePlan(
      { host: "vercel", db: "sqlite", images: "local" },
      ENV
    );
    expect(plan).toMatchObject({
      host: "vercel",
      db: "sqlite",
      images: "local",
    });
  });

  for (const terminal of [true, false]) {
    it(`prints each warning as a line ${terminal ? "with" : "without"} a terminal`, () => {
      const warnings = planWarnings(
        resolvePlan({ host: "vercel", db: "sqlite", images: "local" }, ENV),
        { existingTables: "other" }
      );
      expect(warnings).toHaveLength(3);
      for (const warning of warnings) {
        const line = formatPlanWarning(warning, { terminal });
        expect(line).toContain(warning.message);
        expect(line).not.toContain("\n");
        // A terminal gets the warning colour; anything else gets plain
        // text that a log or an agent reads as written.
        expect(line.includes(ESCAPE)).toBe(terminal);
      }
    });
  }

  it("labels a warning in plain text where no colour can show it", () => {
    expect(
      formatPlanWarning(
        { code: "sqlite-on-vercel", message: "Pick PostgreSQL." },
        { terminal: false }
      )
    ).toBe("Warning: Pick PostgreSQL.");
  });
});
