import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  AGENT_RULES,
  CODING_TOOLS,
  FEATURES,
  HOSTS,
  IMAGE_STORAGES,
  LANGUAGE_CODE,
  PLAN_DATABASES,
  PLAN_PACKAGE_MANAGERS,
  PLAN_VERSION,
  STARTS,
  resolvePlan,
  type PlanAnswers,
  type PlanEnvironment,
  type SetupDraft,
} from "../plan";

const PACKAGE_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCHEMA_PATH = path.join(PACKAGE_ROOT, "src/plan/setup-plan.schema.json");

// The schema as published: the file itself, not a copy built in the test.
const schemaJson: Record<string, unknown> = JSON.parse(
  readFileSync(SCHEMA_PATH, "utf8")
);
// zod reads the JSON Schema as written, so the plans below are checked by
// the published file's own rules.
const schema = z.fromJSONSchema(schemaJson);

const ENV: PlanEnvironment = {
  detectedCodingTools: ["claude-code"],
  detectedPackageManager: "yarn",
  gitAvailable: true,
  insideGitRepository: false,
};

// Every start, host, database, feature, image storage and coding tool at
// least once, with and without the rules question.
const ANSWER_SETS: PlanAnswers[] = [
  {},
  { start: "blank", host: "server", db: "mysql", images: "s3" },
  { host: "vercel", images: "uploadthing", agents: [] },
  {
    start: "website",
    host: "unsure",
    features: ["page-builder", "seo", "forms", "languages"],
    languages: ["en", "ur", "pt-BR"],
    images: "later",
    agents: ["claude-code", "cursor", "codex"],
    agentRules: "no",
    packageManager: "bun",
    git: false,
  },
  { start: "plugin" },
  { start: "plugin", agents: [], packageManager: "pnpm" },
];

describe("the plan's JSON Schema", () => {
  it("carries the plan's format version", () => {
    for (const answers of ANSWER_SETS) {
      expect(resolvePlan(answers, ENV).version).toBe(PLAN_VERSION);
    }
    expect(JSON.stringify(schemaJson)).toContain(
      `"version":{"const":${PLAN_VERSION}}`
    );
  });

  for (const [index, answers] of ANSWER_SETS.entries()) {
    it(`accepts the plan made from answer set ${index + 1}`, () => {
      const plan = JSON.parse(JSON.stringify(resolvePlan(answers, ENV)));
      const result = schema.safeParse(plan);
      expect(result.error).toBeUndefined();
    });
  }

  // Positive control for the checks above: the schema refuses plans that
  // break each of its rules, so its accepting the real ones means something.
  const sitePlan = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(resolvePlan({}, ENV)));
  const pluginPlan = (): Record<string, unknown> =>
    JSON.parse(JSON.stringify(resolvePlan({ start: "plugin" }, ENV)));
  const broken: Array<[string, () => unknown]> = [
    ["another format version", () => ({ ...sitePlan(), version: 2 })],
    ["the project name", () => ({ ...sitePlan(), projectName: "acme" })],
    [
      "a connection string",
      () => ({ ...sitePlan(), connectionString: "postgres://u:p@h/db" }),
    ],
    ["a database outside the list", () => ({ ...sitePlan(), db: "oracle" })],
    ["a feature twice", () => ({ ...sitePlan(), features: ["seo", "seo"] })],
    [
      "languages without English first",
      () => ({ ...sitePlan(), languages: ["fr", "en"] }),
    ],
    [
      "a missing answer",
      () => {
        const plan = sitePlan();
        delete plan.images;
        return plan;
      },
    ],
    ["a Plugin plan with a host", () => ({ ...pluginPlan(), host: "vercel" })],
    [
      "a Plugin plan on PostgreSQL",
      () => ({ ...pluginPlan(), db: "postgres" }),
    ],
    ["git as a word", () => ({ ...sitePlan(), git: "yes" })],
  ];
  for (const [what, make] of broken) {
    it(`refuses a plan with ${what}`, () => {
      expect(schema.safeParse(make()).success).toBe(false);
    });
  }

  it("lists exactly the values the plan's own lists hold", () => {
    // Every enum in the file, by the property it sits under.
    const enums = new Map<string, unknown[]>();
    JSON.stringify(schemaJson, (key, value: unknown) => {
      if (value && typeof value === "object" && "enum" in value) {
        const list = (value as { enum: unknown[] }).enum;
        enums.set(key, [...(enums.get(key) ?? []), ...list]);
      }
      return value;
    });
    const site = STARTS.filter(start => start !== "plugin");
    expect(enums.get("start")).toEqual(site);
    expect(enums.get("host")).toEqual([...HOSTS]);
    expect(enums.get("db")).toEqual([...PLAN_DATABASES]);
    expect(enums.get("images")).toEqual([...IMAGE_STORAGES]);
    expect(enums.get("agentRules")).toEqual([...AGENT_RULES]);
    expect(enums.get("packageManager")).toEqual([...PLAN_PACKAGE_MANAGERS]);
    // The items of the features and agents lists, defined once each.
    expect(enums.get("feature")).toEqual([...FEATURES]);
    expect(enums.get("codingTool")).toEqual([...CODING_TOOLS]);
  });

  it("checks language codes with the plan's own pattern", () => {
    expect(JSON.stringify(schemaJson)).toContain(
      JSON.stringify({ type: "string", pattern: LANGUAGE_CODE.source })
    );
  });

  it("is published with the package", () => {
    const manifest: {
      files: string[];
      exports: Record<string, unknown>;
    } = JSON.parse(
      readFileSync(path.join(PACKAGE_ROOT, "package.json"), "utf8")
    );
    const published = manifest.exports["./setup-plan.schema.json"];
    expect(published).toBe("./src/plan/setup-plan.schema.json");
    expect(manifest.files).toContain("src/plan/setup-plan.schema.json");
  });
});

describe("the serialized plan", () => {
  it("never holds the project name or the connection string", () => {
    const secret = "s3cret-pass";
    const draft: SetupDraft = {
      projectName: "acme-name",
      answers: { db: "postgres" },
      connectionString: `postgres://admin:${secret}@db.example.com:5432/acme`,
    };
    // A front end that hands everything it holds over as answers, the
    // name and the string included, still gets a plan without them.
    const careless = { ...draft.answers, ...draft } as PlanAnswers;
    for (const answers of [draft.answers, careless]) {
      const serialized = JSON.stringify(resolvePlan(answers, ENV));
      expect(serialized).not.toContain("acme-name");
      expect(serialized).not.toContain(secret);
      expect(serialized).not.toContain("db.example.com");
      expect(serialized).not.toMatch(/projectName|connectionString|name"/);
    }
  });
});
