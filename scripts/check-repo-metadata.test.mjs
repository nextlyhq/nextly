import { describe, expect, it } from "vitest";

import {
  checkRepoMetadata,
  fetchRepoMetadata,
  isPermanentStatus,
  retryDelayMs,
  strictDescriptionMatch,
  verificationRequired,
} from "./check-repo-metadata.mjs";

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

  it("fires on a topic with the category embedded in a longer tag", () => {
    // Topics share the classifier with npm keywords, so this is caught for the same
    // reason `nextjs-app-framework` is caught as a keyword.
    expect(
      run({ description: GOOD_DESCRIPTION, topics: [...goodTopics, "nextjs-app-framework"] })
    ).toContain("topic-forbidden");
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

describe("drift is advisory where it cannot be acted on", () => {
  const drifted = { description: "Something else entirely.", topics: goodTopics };
  const findingsFor = strictDescription =>
    checkRepoMetadata({
      metadata: drifted,
      expectedDescription: GOOD_DESCRIPTION,
      strictDescription,
    }).findings;

  it("marks a description mismatch advisory when the setting cannot be changed", () => {
    // A pull request cannot edit one global repository setting, and a fork author cannot
    // edit it at all. Failing their build on it would be a red on a correct change.
    const drift = findingsFor(false).find(f => f.check === "about-matches-package");
    expect(drift.advisory).toBe(true);
  });

  it("blocks on the same mismatch where the setting can be brought into line", () => {
    const drift = findingsFor(true).find(f => f.check === "about-matches-package");
    expect(drift.advisory).toBeFalsy();
  });

  it("never makes a category finding advisory", () => {
    // These are absolute claims about what the project is, not a comparison against a
    // value the branch is allowed to move, so a pull request does not get a pass on them.
    const { findings } = checkRepoMetadata({
      metadata: { description: "The app framework for Next.js.", topics: ["framework"] },
      expectedDescription: GOOD_DESCRIPTION,
      strictDescription: false,
    });
    const category = findings.filter(f => f.check !== "about-matches-package");
    expect(category.length).toBeGreaterThan(0);
    expect(category.every(f => !f.advisory)).toBe(true);
  });

  it("blocks by default, so a caller that forgets the flag gets the strict answer", () => {
    const drift = checkRepoMetadata({
      metadata: drifted,
      expectedDescription: GOOD_DESCRIPTION,
    }).findings.find(f => f.check === "about-matches-package");
    expect(drift.advisory).toBeFalsy();
  });
});

describe("strictDescriptionMatch", () => {
  it("is lenient on a pull request whatever the ref says", () => {
    expect(
      strictDescriptionMatch(
        { GITHUB_EVENT_NAME: "pull_request", GITHUB_REF_NAME: "main" },
        "main"
      )
    ).toBe(false);
  });

  it("is strict on the default branch, where the setting can be brought into line", () => {
    expect(
      strictDescriptionMatch({ GITHUB_EVENT_NAME: "schedule", GITHUB_REF_NAME: "main" }, "main")
    ).toBe(true);
    expect(
      strictDescriptionMatch({ GITHUB_EVENT_NAME: "push", GITHUB_REF_NAME: "main" }, "main")
    ).toBe(true);
  });

  it("is lenient on a manual run against a branch that has not landed", () => {
    // A dispatch can target any ref. A branch that legitimately moved the package
    // description is in the same position a pull request is, and failing it would file an
    // issue for a mismatch that is expected.
    expect(
      strictDescriptionMatch(
        { GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF_NAME: "task/rename" },
        "main"
      )
    ).toBe(false);
    expect(
      strictDescriptionMatch(
        { GITHUB_EVENT_NAME: "schedule", GITHUB_REF_NAME: "task/rename" },
        "main"
      )
    ).toBe(false);
  });

  it("is strict on a laptop, where someone ran the check deliberately", () => {
    expect(strictDescriptionMatch({}, "main")).toBe(true);
  });

  it("keeps the stricter answer when the default branch is unknown", () => {
    expect(strictDescriptionMatch({ GITHUB_REF_NAME: "main" }, null)).toBe(true);
  });
});

describe("retryDelayMs", () => {
  const headers = entries => ({ get: name => entries[name] ?? null });

  it("waits the interval a secondary limit named", () => {
    expect(retryDelayMs(headers({ "retry-after": "60" }), 1)).toBe(60_000);
  });

  it("waits until a primary limit resets", () => {
    const now = 1_000_000_000_000;
    const reset = String(now / 1000 + 45);
    expect(retryDelayMs(headers({ "x-ratelimit-reset": reset }), 1, now)).toBe(45_000);
  });

  it("prefers retry-after when both are present", () => {
    const now = 1_000_000_000_000;
    expect(
      retryDelayMs(
        headers({ "retry-after": "5", "x-ratelimit-reset": String(now / 1000 + 900) }),
        1,
        now
      )
    ).toBe(5_000);
  });

  it("backs off on its own when GitHub named no interval", () => {
    expect(retryDelayMs(headers({}), 1)).toBe(1_000);
    expect(retryDelayMs(undefined, 2)).toBe(2_000);
  });

  it("ignores a reset already in the past", () => {
    const now = 1_000_000_000_000;
    expect(retryDelayMs(headers({ "x-ratelimit-reset": String(now / 1000 - 10) }), 3, now)).toBe(
      3_000
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
    // about the metadata. 403 is not in this list: it means two different things and the
    // headers are what separate them, which the "403 is two different answers" suite covers.
    expect(isPermanentStatus(429)).toBe(false);
    expect(isPermanentStatus(500)).toBe(false);
    expect(isPermanentStatus(502)).toBe(false);
  });

  it("does not call a success permanent", () => {
    expect(isPermanentStatus(200)).toBe(false);
    expect(isPermanentStatus(304)).toBe(false);
  });
});

describe("403 is two different answers", () => {
  const headers = entries => ({ get: name => entries[name] ?? null });

  it("is transient when the quota is exhausted", () => {
    expect(isPermanentStatus(403, headers({ "x-ratelimit-remaining": "0" }))).toBe(false);
  });

  it("is transient when a secondary limit asks us to wait", () => {
    expect(isPermanentStatus(403, headers({ "retry-after": "60" }))).toBe(false);
  });

  it("is permanent when the credential simply may not read the repository", () => {
    // Reading the status alone would call this a moment to try again, forever.
    expect(isPermanentStatus(403, headers({ "x-ratelimit-remaining": "4999" }))).toBe(true);
  });

  it("is permanent when there are no headers to consult", () => {
    expect(isPermanentStatus(403, undefined)).toBe(true);
  });
});

describe("verificationRequired", () => {
  it("is true for the runs whose only purpose is to observe the setting", () => {
    expect(verificationRequired({ GITHUB_EVENT_NAME: "schedule" })).toBe(true);
    expect(verificationRequired({ GITHUB_EVENT_NAME: "workflow_dispatch" })).toBe(true);
  });

  it("is false where an unreachable API should not turn the run red", () => {
    expect(verificationRequired({ GITHUB_EVENT_NAME: "pull_request" })).toBe(false);
    expect(verificationRequired({ GITHUB_EVENT_NAME: "push" })).toBe(false);
    expect(verificationRequired({})).toBe(false);
  });
});

describe("fetchRepoMetadata", () => {
  const ok = body => ({ ok: true, json: async () => body });
  const bad = (status, entries = {}) => ({
    ok: false,
    status,
    headers: { get: name => entries[name] ?? null },
  });
  const noWait = async () => {};

  it("sends the token when one is offered", async () => {
    let seen;
    await fetchRepoMetadata("o", "r", {
      fetchImpl: async (_url, init) => {
        seen = init.headers;
        return ok({ description: "d", topics: [] });
      },
      env: { GITHUB_TOKEN: "t0ken" },
      delay: noWait,
    });
    expect(seen.authorization).toBe("Bearer t0ken");
  });

  it("stays unauthenticated when there is no token, so a laptop needs none", async () => {
    let seen;
    await fetchRepoMetadata("o", "r", {
      fetchImpl: async (_url, init) => {
        seen = init.headers;
        return ok({ description: "d", topics: [] });
      },
      env: {},
      delay: noWait,
    });
    expect(seen.authorization).toBeUndefined();
  });

  it("retries a transient failure and succeeds", async () => {
    let calls = 0;
    const metadata = await fetchRepoMetadata("o", "r", {
      fetchImpl: async () => {
        calls += 1;
        return calls === 1 ? bad(503) : ok({ description: "d", topics: ["cms"] });
      },
      env: {},
      delay: noWait,
    });
    expect(calls).toBe(2);
    expect(metadata).toEqual({ description: "d", topics: ["cms"], defaultBranch: null });
  });

  it("does not retry a permanent failure", async () => {
    // A 404 is the same answer every time, and retrying it only delays the report.
    let calls = 0;
    await expect(
      fetchRepoMetadata("o", "r", {
        fetchImpl: async () => {
          calls += 1;
          return bad(404);
        },
        env: {},
        delay: noWait,
      })
    ).rejects.toMatchObject({ permanent: true });
    expect(calls).toBe(1);
  });

  it("sleeps for the interval GitHub named rather than its own backoff", async () => {
    // Reading retry-after to classify the failure and then waiting a second anyway spends
    // every attempt inside a window GitHub already said would not clear.
    const waits = [];
    let calls = 0;
    await fetchRepoMetadata("o", "r", {
      fetchImpl: async () => {
        calls += 1;
        return calls === 1
          ? bad(403, { "retry-after": "30" })
          : ok({ description: "d", topics: [] });
      },
      env: {},
      delay: async ms => {
        waits.push(ms);
      },
    });
    expect(waits).toEqual([30_000]);
  });

  it("stops rather than sleeping through a window longer than the run should live", async () => {
    // An hour-long primary limit is not something to hold a runner open for; the honest
    // report is that this run could not verify the metadata.
    let calls = 0;
    const waits = [];
    await expect(
      fetchRepoMetadata("o", "r", {
        fetchImpl: async () => {
          calls += 1;
          return bad(403, { "retry-after": "3600" });
        },
        env: {},
        delay: async ms => {
          waits.push(ms);
        },
      })
    ).rejects.toMatchObject({ permanent: false });
    expect(calls).toBe(1);
    expect(waits).toEqual([]);
  });

  it("carries the default branch, so strictness has a ref to compare against", async () => {
    const metadata = await fetchRepoMetadata("o", "r", {
      fetchImpl: async () => ok({ description: "d", topics: [], default_branch: "main" }),
      env: {},
      delay: noWait,
    });
    expect(metadata.defaultBranch).toBe("main");
  });

  it("gives up after the last attempt and reports the failure as transient", async () => {
    let calls = 0;
    await expect(
      fetchRepoMetadata("o", "r", {
        fetchImpl: async () => {
          calls += 1;
          return bad(403, { "x-ratelimit-remaining": "0" });
        },
        env: {},
        delay: noWait,
      })
    ).rejects.toMatchObject({ permanent: false });
    expect(calls).toBe(3);
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
