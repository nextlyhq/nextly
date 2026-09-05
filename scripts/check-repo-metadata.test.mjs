import { describe, expect, it } from "vitest";

import { checkRepoMetadata } from "./check-repo-metadata.mjs";

/**
 * Metadata is injected rather than fetched. The network is not the subject, and a test that
 * reached GitHub would fail offline and pass or fail depending on when it ran.
 */
const GOOD_DESCRIPTION =
  "Nextly is an open-source CMS and visual page builder for Next.js. Model content, build pages, localize, version and release from your own stack.";

const goodTopics = [
  "cms",
  "headless-cms",
  "page-builder",
  "nextjs",
  "content-platform",
  "typescript",
];

const run = (metadata, expectedDescription = GOOD_DESCRIPTION) =>
  checkRepoMetadata({ metadata, expectedDescription }).findings.map(f => f.check);

describe("about-retired-category", () => {
  it("fires when the About line names the retired category", () => {
    expect(
      run({ description: "The open-source app framework for Next.js.", topics: goodTopics })
    ).toContain("about-retired-category");
  });

  it("catches the hyphenated spelling too", () => {
    expect(
      run({ description: "An app-framework for Next.js.", topics: goodTopics })
    ).toContain("about-retired-category");
  });

  it("does not fire on the current descriptor", () => {
    expect(run({ description: GOOD_DESCRIPTION, topics: goodTopics })).not.toContain(
      "about-retired-category"
    );
  });
});

describe("about-matches-package", () => {
  it("fires when About drifts from the package description", () => {
    expect(
      run({ description: "Something else entirely.", topics: goodTopics })
    ).toContain("about-matches-package");
  });

  it("does not fire when they agree", () => {
    expect(run({ description: GOOD_DESCRIPTION, topics: goodTopics })).not.toContain(
      "about-matches-package"
    );
  });
});

describe("topics", () => {
  it("fires on a forbidden topic", () => {
    expect(
      run({ description: GOOD_DESCRIPTION, topics: [...goodTopics, "app-framework"] })
    ).toContain("topic-forbidden");
  });

  it("fires on the bare 'framework' topic, which is the word the repositioning turned on", () => {
    expect(
      run({ description: GOOD_DESCRIPTION, topics: [...goodTopics, "framework"] })
    ).toContain("topic-forbidden");
  });

  it("fires once per missing required topic, naming which", () => {
    const { findings } = checkRepoMetadata({
      metadata: { description: GOOD_DESCRIPTION, topics: ["cms", "nextjs"] },
      expectedDescription: GOOD_DESCRIPTION,
    });
    const missing = findings.filter(f => f.check === "topic-missing");
    expect(missing).toHaveLength(3);
    expect(missing.map(f => f.message).join(" ")).toContain("page-builder");
    expect(missing.map(f => f.message).join(" ")).toContain("content-platform");
  });

  it("passes clean metadata with nothing to report", () => {
    expect(run({ description: GOOD_DESCRIPTION, topics: goodTopics })).toHaveLength(0);
  });
});

describe("the live repository's current state", () => {
  it("is exactly what this check was written to catch", () => {
    // The values read from the GitHub API on 6 September, kept as a fixture so the check has a
    // known-answer case that does not depend on the network or on the settings being left wrong.
    const asFoundToday = {
      description:
        "Nextly is the open-source, type-safe app framework for Next.js. Define content with TypeScript or build it visually in the admin. Auth, RBAC, media, hooks, plugins.",
      topics: [
        "admin-dashboard",
        "app-framework",
        "cms",
        "content-management",
        "drizzle-orm",
        "framework",
        "headless-cms",
        "monorepo",
        "mysql",
        "nextjs",
        "nodejs",
        "open-source",
        "postgresql",
        "react",
        "sqlite",
        "type-safe",
        "typescript",
      ],
    };
    const checks = run(asFoundToday);
    expect(checks).toContain("about-retired-category");
    expect(checks).toContain("about-matches-package");
    expect(checks.filter(c => c === "topic-forbidden")).toHaveLength(2);
    expect(checks.filter(c => c === "topic-missing")).toHaveLength(2);
  });
});
