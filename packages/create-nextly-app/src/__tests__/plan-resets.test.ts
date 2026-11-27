import { describe, expect, it } from "vitest";

import {
  changeAnswer,
  resolvePlan,
  type PlanEnvironment,
  type SetupDraft,
} from "../plan";

const ENV: PlanEnvironment = {
  detectedCodingTools: [],
  detectedPackageManager: "npm",
  gitAvailable: true,
  insideGitRepository: false,
};

// A run part-way through: every answer moved off its default, and a
// connection string typed for the database chosen.
const DRAFT: SetupDraft = {
  projectName: "acme",
  answers: {
    start: "website",
    host: "server",
    db: "mysql",
    features: ["seo"],
    images: "s3",
    agents: ["cursor"],
    agentRules: "no",
    packageManager: "pnpm",
    git: false,
  },
  connectionString: "mysql://root:secret@localhost:3306/acme",
};

describe("changing where it runs", () => {
  it("resets the database and images to the new host's defaults", () => {
    const next = changeAnswer(DRAFT, "host", "vercel");
    expect(next.answers.host).toBe("vercel");
    expect(next.answers.db).toBeUndefined();
    expect(next.answers.images).toBeUndefined();
    expect(resolvePlan(next.answers, ENV)).toMatchObject({
      db: "postgres",
      images: "vercel-blob",
    });
  });

  it("keeps every answer that does not depend on it", () => {
    const next = changeAnswer(DRAFT, "host", "vercel");
    expect(next.projectName).toBe("acme");
    expect(next.answers).toMatchObject({
      start: "website",
      features: ["seo"],
      agents: ["cursor"],
      agentRules: "no",
      packageManager: "pnpm",
      git: false,
    });
  });

  it("clears the connection string when the database it was for is reset", () => {
    expect(changeAnswer(DRAFT, "host", "vercel").connectionString).toBe(
      undefined
    );
  });

  it("keeps the connection string when the reset lands on the same database", () => {
    const onPostgres: SetupDraft = {
      answers: { host: "server", db: "postgres" },
      connectionString: "postgres://localhost:5432/acme",
    };
    // On Vercel the database's default is PostgreSQL, the database the
    // string was typed for.
    const next = changeAnswer(onPostgres, "host", "vercel");
    expect(next.answers.db).toBeUndefined();
    expect(next.connectionString).toBe("postgres://localhost:5432/acme");
  });
});

describe("changing the start", () => {
  it("resets the features to the new start's defaults", () => {
    const toBlank = changeAnswer(
      { answers: { start: "website", features: ["page-builder"] } },
      "start",
      "blank"
    );
    expect(toBlank.answers.features).toBeUndefined();
    expect(resolvePlan(toBlank.answers, ENV)).toMatchObject({ features: [] });

    const toWebsite = changeAnswer(
      { answers: { start: "blank", features: [] } },
      "start",
      "website"
    );
    expect(resolvePlan(toWebsite.answers, ENV)).toMatchObject({
      features: ["page-builder", "seo", "forms"],
    });
  });

  it("keeps where it runs, the database and its string", () => {
    const next = changeAnswer(DRAFT, "start", "blank");
    expect(next.answers).toMatchObject({ host: "server", db: "mysql" });
    expect(next.connectionString).toBe(DRAFT.connectionString);
  });
});

describe("changing the database", () => {
  it("clears the connection string held beside the plan", () => {
    const next = changeAnswer(DRAFT, "db", "postgres");
    expect(next.answers.db).toBe("postgres");
    expect(next.connectionString).toBeUndefined();
    expect(next.answers.images).toBe("s3");
  });
});

describe("an answer given again unchanged", () => {
  it("resets nothing", () => {
    expect(changeAnswer(DRAFT, "host", "server")).toEqual(DRAFT);
    expect(changeAnswer(DRAFT, "db", "mysql")).toEqual(DRAFT);
    expect(changeAnswer(DRAFT, "start", "website")).toEqual(DRAFT);
  });

  it("counts a set chosen in another order as unchanged", () => {
    const draft: SetupDraft = { answers: { features: ["seo", "forms"] } };
    expect(changeAnswer(draft, "features", ["forms", "seo"])).toEqual(draft);
  });
});

describe("an answer nothing depends on", () => {
  it("changes only itself", () => {
    const next = changeAnswer(DRAFT, "images", "uploadthing");
    expect(next).toEqual({
      ...DRAFT,
      answers: { ...DRAFT.answers, images: "uploadthing" },
    });
  });
});

describe("a change", () => {
  it("leaves the draft it was given untouched", () => {
    const before = JSON.parse(JSON.stringify(DRAFT));
    changeAnswer(DRAFT, "host", "vercel");
    changeAnswer(DRAFT, "start", "blank");
    changeAnswer(DRAFT, "db", "sqlite");
    expect(DRAFT).toEqual(before);
  });
});
