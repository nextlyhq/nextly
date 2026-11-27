import { describe, expect, it } from "vitest";

import {
  PLAN_ANSWER_ORDER,
  PLAN_VERSION,
  answerApplies,
  resolvePlan,
  type PlanAnswers,
  type PlanEnvironment,
  type SetupPlan,
} from "../plan";

// The machine the run is on, as the installer would detect it: two coding
// tools found, launched through pnpm, git installed, outside a repository.
const ENV: PlanEnvironment = {
  detectedCodingTools: ["cursor", "claude-code"],
  detectedPackageManager: "pnpm",
  gitAvailable: true,
  insideGitRepository: false,
};

/**
 * A person pressing Enter at every question, in the questions' order: each
 * question shown takes the answer pre-selected from the answers before it,
 * and a question not shown is never answered. This walks the questions
 * independently of how `resolvePlan` fills its gaps, so a default that
 * depended on a later answer, or on the order answers were filled, would
 * make the two differ.
 */
function pressEnterThroughout(
  given: PlanAnswers,
  env: PlanEnvironment
): PlanAnswers {
  const answers: PlanAnswers = { ...given };
  for (const key of PLAN_ANSWER_ORDER) {
    if (answers[key] !== undefined) continue;
    if (!answerApplies(key, answers)) continue;
    const preselected = resolvePlan(answers, env) as Partial<
      Record<keyof PlanAnswers, unknown>
    >;
    Object.assign(answers, { [key]: preselected[key] });
  }
  return answers;
}

describe("the default plan", () => {
  it("is the Website start, not sure where it runs, for a run that answered nothing (--yes)", () => {
    expect(resolvePlan({}, ENV)).toEqual({
      version: PLAN_VERSION,
      start: "website",
      host: "unsure",
      db: "sqlite",
      features: ["page-builder", "seo", "forms"],
      languages: ["en"],
      images: "local",
      agents: ["claude-code", "cursor"],
      agentRules: "yes",
      packageManager: "pnpm",
      git: true,
    } satisfies SetupPlan);
  });

  const starts = ["website", "blank", "plugin"] as const;
  const hosts = ["unsure", "vercel", "server"] as const;

  for (const start of starts) {
    for (const host of hosts) {
      it(`for ${start} on ${host} equals pressing Enter at every question`, () => {
        const given: PlanAnswers = { start, host };
        expect(resolvePlan(given, ENV)).toEqual(
          resolvePlan(pressEnterThroughout(given, ENV), ENV)
        );
      });
    }
  }

  it("gives Vercel PostgreSQL and Vercel Blob", () => {
    const plan = resolvePlan({ host: "vercel" }, ENV);
    expect(plan.start).toBe("website");
    if (plan.start === "plugin") throw new Error("a site plan was expected");
    expect(plan.db).toBe("postgres");
    expect(plan.images).toBe("vercel-blob");
  });

  for (const host of ["unsure", "server"] as const) {
    it(`gives ${host} SQLite and the project's folder`, () => {
      const plan = resolvePlan({ start: "blank", host }, ENV);
      if (plan.start === "plugin") throw new Error("a site plan was expected");
      expect(plan.db).toBe("sqlite");
      expect(plan.images).toBe("local");
    });
  }

  it("ticks Page Builder, SEO and Forms for Website, and nothing for Blank", () => {
    const website = resolvePlan({ start: "website" }, ENV);
    const blank = resolvePlan({ start: "blank" }, ENV);
    if (website.start === "plugin" || blank.start === "plugin") {
      throw new Error("site plans were expected");
    }
    expect(website.features).toEqual(["page-builder", "seo", "forms"]);
    expect(blank.features).toEqual([]);
  });

  for (const host of hosts) {
    it(`for Plugin holds only its SQLite development app, whatever else was given (${host})`, () => {
      const plan = resolvePlan(
        {
          start: "plugin",
          host,
          db: "mysql",
          features: ["seo"],
          languages: ["en", "fr"],
          images: "s3",
        },
        ENV
      );
      expect(plan).toEqual({
        version: PLAN_VERSION,
        start: "plugin",
        db: "sqlite",
        agents: ["claude-code", "cursor"],
        agentRules: "yes",
        packageManager: "pnpm",
        git: true,
      });
      for (const key of ["host", "features", "languages", "images"]) {
        expect(plan).not.toHaveProperty(key);
      }
    });
  }

  it("pre-ticks the coding tools found on this computer, and none when none is found", () => {
    expect(
      resolvePlan({}, { ...ENV, detectedCodingTools: ["codex"] }).agents
    ).toEqual(["codex"]);
    const none = resolvePlan({}, { ...ENV, detectedCodingTools: [] });
    expect(none.agents).toEqual([]);
    // The rules question is asked only when a tool is ticked.
    expect(none).not.toHaveProperty("agentRules");
  });

  it("uses the package manager the installer was run with", () => {
    expect(
      resolvePlan({}, { ...ENV, detectedPackageManager: "bun" }).packageManager
    ).toBe("bun");
  });

  it("makes a git repository only outside one, and only where git is installed", () => {
    expect(resolvePlan({}, ENV).git).toBe(true);
    expect(resolvePlan({}, { ...ENV, insideGitRepository: true }).git).toBe(
      false
    );
    expect(resolvePlan({}, { ...ENV, gitAvailable: false }).git).toBe(false);
  });

  it("keeps an answer given over its default", () => {
    const plan = resolvePlan(
      {
        host: "vercel",
        db: "sqlite",
        images: "local",
        features: [],
        agents: [],
        packageManager: "npm",
        git: false,
      },
      ENV
    );
    expect(plan).toMatchObject({
      db: "sqlite",
      images: "local",
      features: [],
      agents: [],
      packageManager: "npm",
      git: false,
    });
  });
});

describe("languages", () => {
  it("are English alone unless More than one language is ticked", () => {
    const plan = resolvePlan({ languages: ["en", "fr"] }, ENV);
    if (plan.start === "plugin") throw new Error("a site plan was expected");
    expect(plan.languages).toEqual(["en"]);
  });

  it("put English first, always, and keep the rest in the order chosen", () => {
    const plan = resolvePlan(
      {
        features: ["languages"],
        languages: ["fr", "ur", "en", "fr"],
      },
      ENV
    );
    if (plan.start === "plugin") throw new Error("a site plan was expected");
    expect(plan.languages).toEqual(["en", "fr", "ur"]);
  });
});

describe("one plan from every way in", () => {
  // The same project, handed over by each front end in its own shape.
  // The questions hand over every answer they showed, in order, including
  // the ones left at their pre-selection.
  const fromPrompts: PlanAnswers = {
    start: "website",
    host: "vercel",
    db: "postgres",
    features: ["seo", "page-builder", "languages"],
    languages: ["en", "ar"],
    images: "vercel-blob",
    agents: ["codex"],
    agentRules: "no",
    packageManager: "pnpm",
    git: true,
  };
  // Flags hand over only what was typed; the rest is left to the defaults.
  const fromFlags: PlanAnswers = {
    host: "vercel",
    features: ["page-builder", "seo", "languages"],
    languages: ["ar"],
    agents: ["codex"],
    agentRules: "no",
  };
  // A preset holds every answer, read back from its JSON file, where sets
  // may come back in any order.
  const fromPreset: PlanAnswers = JSON.parse(
    JSON.stringify({
      start: "website",
      host: "vercel",
      db: "postgres",
      features: ["languages", "seo", "page-builder"],
      languages: ["en", "ar"],
      images: "vercel-blob",
      agents: ["codex"],
      agentRules: "no",
      packageManager: "pnpm",
      git: true,
    })
  );

  it("is the same plan from the questions, the flags and a preset", () => {
    const plans = [fromPrompts, fromFlags, fromPreset].map(answers =>
      resolvePlan(answers, ENV)
    );
    expect(plans[1]).toEqual(plans[0]);
    expect(plans[2]).toEqual(plans[0]);
    expect(plans[0]).toMatchObject({
      features: ["page-builder", "seo", "languages"],
      languages: ["en", "ar"],
    });
  });
});

describe("answers outside the plan's lists", () => {
  it("are refused, naming the answer and what it may be", () => {
    const answers = JSON.parse('{"db":"postgresql"}') as PlanAnswers;
    expect(() => resolvePlan(answers, ENV)).toThrow(
      /db.*"postgresql".*sqlite, postgres, mysql/
    );
  });

  it("are refused inside a list too", () => {
    const answers = JSON.parse('{"features":["blog"]}') as PlanAnswers;
    expect(() => resolvePlan(answers, ENV)).toThrow(/features.*"blog"/);
  });

  it("refuse a language that is not a language code", () => {
    const answers: PlanAnswers = {
      features: ["languages"],
      languages: ["en", "../etc"],
    };
    expect(() => resolvePlan(answers, ENV)).toThrow(/languages.*"\.\.\/etc"/);
  });
});
