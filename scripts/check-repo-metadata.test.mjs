import { describe, expect, it } from "vitest";

import { checkRepoMetadata, isPermanentStatus } from "./check-repo-metadata.mjs";

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

/**
 * The same call with no default for the description, because `run`'s default is applied to an
 * explicit `undefined` — which silently substituted a valid description into the very tests
 * written to prove an absent one is caught.
 */
const runWithDescription = (metadata, expectedDescription) =>
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

  it("fires on the plural spellings a hand-written list missed", () => {
    // The forbidden topics used to be listed here rather than derived from the shared tag
    // pattern, and the list held only the singular forms — so these two passed a check that
    // rejects the very same strings as npm keywords.
    for (const topic of ["frameworks", "app-frameworks", "App-Framework"]) {
      expect(run({ description: GOOD_DESCRIPTION, topics: [...goodTopics, topic] })).toContain(
        "topic-forbidden"
      );
    }
  });

  it("does not fire on topics that merely contain the word", () => {
    expect(
      run({
        description: GOOD_DESCRIPTION,
        topics: [...goodTopics, "framework-agnostic", "page-builder"],
      })
    ).not.toContain("topic-forbidden");
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

describe("description-source-missing", () => {
  it("fires when the package has no description to compare against", () => {
    for (const expected of [undefined, "", "   "]) {
      expect(
        runWithDescription({ description: "anything at all", topics: goodTopics }, expected)
      ).toContain("description-source-missing");
    }
  });

  it("reports the missing source rather than a drift it cannot judge", () => {
    // Reporting both would state a mismatch against a value that does not exist.
    const checks = runWithDescription(
      { description: "anything at all", topics: goodTopics },
      undefined
    );
    expect(checks).not.toContain("about-matches-package");
  });

  it("does not fire when the package has a description", () => {
    expect(run({ description: GOOD_DESCRIPTION, topics: goodTopics })).not.toContain(
      "description-source-missing"
    );
  });
});

describe("isPermanentStatus", () => {
  it("treats a repository that cannot be read as permanent", () => {
    // A stale OWNER or a renamed repository returns 404, and calling that transient would
    // leave the check green forever without examining any metadata.
    expect(isPermanentStatus(404)).toBe(true);
    expect(isPermanentStatus(401)).toBe(true);
    expect(isPermanentStatus(410)).toBe(true);
  });

  it("treats rate limiting and server errors as transient", () => {
    // An unauthenticated call from CI hits the rate limit routinely, and it says nothing
    // about the metadata.
    expect(isPermanentStatus(403)).toBe(false);
    expect(isPermanentStatus(429)).toBe(false);
    expect(isPermanentStatus(500)).toBe(false);
    expect(isPermanentStatus(502)).toBe(false);
  });

  it("does not call a success permanent", () => {
    expect(isPermanentStatus(200)).toBe(false);
    expect(isPermanentStatus(304)).toBe(false);
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
