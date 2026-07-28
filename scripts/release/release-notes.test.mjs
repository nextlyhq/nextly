import { describe, expect, it } from "vitest";

import {
  buildReleaseNotes,
  collectUniqueEntries,
  extractVersionSection,
  isDependencyBumpEntry,
  MAX_BODY_LENGTH,
  parseChangelogSection,
} from "./release-notes.mjs";

const VERSION = "0.0.2-alpha.43";
const REPO_URL = "https://github.com/nextlyhq/nextly";

/** A changeset entry as Changesets renders it, with a multi-paragraph body. */
const THEMING_ENTRY = `- [#368](${REPO_URL}/pull/368) Thanks [@author](https://github.com/author)! - The admin's design tokens now drive its appearance.

  Font weights work again across the admin.`;

const MIGRATE_ENTRY = `- [#361](${REPO_URL}/pull/361) Thanks [@author](https://github.com/author)! - \`nextly migrate\` can be run more than once.`;

/** The generated sibling-bump block every package in a fixed group receives. */
const DEPENDENCY_ENTRY = `- Updated dependencies [[\`648c7f4\`](${REPO_URL}/commit/648c7f4), [\`7d5a62d\`](${REPO_URL}/commit/7d5a62d)]:
  - nextly@${VERSION}
  - @nextlyhq/ui@${VERSION}`;

function changelog(title, sections) {
  return `# ${title}\n\n${sections}\n`;
}

/** A changelog whose current version carries the given entries, plus history. */
function changelogFor(title, entries) {
  return changelog(
    title,
    [
      `## ${VERSION}`,
      "",
      "### Patch Changes",
      "",
      entries.join("\n\n"),
      "",
      "## 0.0.2-alpha.42",
      "",
      "### Patch Changes",
      "",
      "- An older release entry that must not leak into these notes.",
    ].join("\n")
  );
}

describe("extractVersionSection", () => {
  it("returns only the requested version's body", () => {
    const section = extractVersionSection(
      changelogFor("nextly", [MIGRATE_ENTRY]),
      VERSION
    );

    expect(section).toContain("can be run more than once");
    expect(section).not.toContain("must not leak");
  });

  it("returns an empty string for a version the changelog does not have", () => {
    expect(
      extractVersionSection(changelogFor("nextly", [MIGRATE_ENTRY]), "9.9.9")
    ).toBe("");
  });
});

describe("parseChangelogSection", () => {
  it("keeps indented continuation lines with their entry", () => {
    const entries = parseChangelogSection(
      ["### Patch Changes", "", THEMING_ENTRY, "", MIGRATE_ENTRY].join("\n")
    );

    expect(entries).toHaveLength(2);
    expect(entries[0].heading).toBe("Patch Changes");
    expect(entries[0].text).toContain("Font weights work again");
    expect(entries[1].text).toContain("more than once");
  });

  it("does not split a dependency bump's nested package bullets", () => {
    const entries = parseChangelogSection(
      ["### Patch Changes", "", DEPENDENCY_ENTRY, "", MIGRATE_ENTRY].join("\n")
    );

    expect(entries).toHaveLength(2);
    expect(entries[0].text).toContain("- @nextlyhq/ui@");
    expect(entries[1].text).toContain("more than once");
  });

  it("tags entries with the change-type heading they sit under", () => {
    const entries = parseChangelogSection(
      [
        "### Minor Changes",
        "",
        MIGRATE_ENTRY,
        "",
        "### Patch Changes",
        "",
        THEMING_ENTRY,
      ].join("\n")
    );

    expect(entries.map(entry => entry.heading)).toEqual([
      "Minor Changes",
      "Patch Changes",
    ]);
  });
});

describe("isDependencyBumpEntry", () => {
  it("matches the generated sibling-bump block", () => {
    expect(isDependencyBumpEntry(DEPENDENCY_ENTRY)).toBe(true);
  });

  it("keeps prose that merely mentions updating dependencies", () => {
    expect(
      isDependencyBumpEntry(
        "- [#12](https://example.test/12) Thanks [@a](https://example.test)! - Updated dependencies are now installed by the CLI."
      )
    ).toBe(false);
  });
});

describe("collectUniqueEntries", () => {
  it("emits a shared changeset once across a fixed group", () => {
    const packages = [
      "nextly",
      "@nextlyhq/ui",
      "@nextlyhq/admin",
      "@nextlyhq/tsconfig",
    ].map(name => ({
      name,
      changelog: changelogFor(name, [
        THEMING_ENTRY,
        MIGRATE_ENTRY,
        DEPENDENCY_ENTRY,
      ]),
    }));

    const entries = collectUniqueEntries(packages, VERSION);

    expect(entries).toHaveLength(2);
    expect(entries[0].text).toContain("design tokens");
    expect(entries[1].text).toContain("more than once");
  });

  it("takes the union when packages carry different entries", () => {
    const packages = [
      { name: "nextly", changelog: changelogFor("nextly", [MIGRATE_ENTRY]) },
      {
        name: "@nextlyhq/ui",
        changelog: changelogFor("@nextlyhq/ui", [THEMING_ENTRY]),
      },
      {
        name: "@nextlyhq/admin",
        changelog: changelogFor("@nextlyhq/admin", [
          MIGRATE_ENTRY,
          THEMING_ENTRY,
        ]),
      },
    ];

    expect(collectUniqueEntries(packages, VERSION)).toHaveLength(2);
  });

  it("ignores a package with no section for the version", () => {
    const packages = [
      { name: "nextly", changelog: changelogFor("nextly", [MIGRATE_ENTRY]) },
      { name: "@nextlyhq/ui", changelog: "# @nextlyhq/ui\n" },
    ];

    expect(collectUniqueEntries(packages, VERSION)).toHaveLength(1);
  });
});

describe("buildReleaseNotes", () => {
  const lockstepPackages = [
    "nextly",
    "@nextlyhq/ui",
    "@nextlyhq/admin",
    "@nextlyhq/adapter-sqlite",
  ].map(name => ({
    name,
    changelog: changelogFor(name, [
      THEMING_ENTRY,
      MIGRATE_ENTRY,
      DEPENDENCY_ENTRY,
    ]),
  }));

  it("passes a small release through with every entry intact", () => {
    const notes = buildReleaseNotes({
      version: VERSION,
      packages: lockstepPackages,
      repoUrl: REPO_URL,
    });

    expect(notes).toContain(
      `Released 4 packages at \`${VERSION}\` in lockstep.`
    );
    expect(notes).toContain("## What's changed");
    expect(notes).toContain("### Patch Changes");
    expect(notes).toContain("design tokens");
    expect(notes).toContain("more than once");
    expect(notes).not.toContain("truncated");
  });

  it("prints each shared entry once rather than once per package", () => {
    const notes = buildReleaseNotes({
      version: VERSION,
      packages: lockstepPackages,
      repoUrl: REPO_URL,
    });

    expect(notes.split("design tokens now drive")).toHaveLength(2);
    expect(notes.split("can be run more than once")).toHaveLength(2);
  });

  it("drops the generated dependency bumps but lists every package", () => {
    const notes = buildReleaseNotes({
      version: VERSION,
      packages: lockstepPackages,
      repoUrl: REPO_URL,
    });

    expect(notes).not.toContain("Updated dependencies");
    expect(notes).toContain("## Packages");
    for (const pkg of lockstepPackages) {
      expect(notes).toContain(`- \`${pkg.name}\``);
    }
  });

  it("orders major, then minor, then patch changes", () => {
    const packages = [
      {
        name: "nextly",
        changelog: changelog(
          "nextly",
          [
            `## ${VERSION}`,
            "",
            "### Patch Changes",
            "",
            MIGRATE_ENTRY,
            "",
            "### Major Changes",
            "",
            THEMING_ENTRY,
          ].join("\n")
        ),
      },
    ];

    const notes = buildReleaseNotes({
      version: VERSION,
      packages,
      repoUrl: REPO_URL,
    });

    expect(notes.indexOf("### Major Changes")).toBeLessThan(
      notes.indexOf("### Patch Changes")
    );
  });

  it("truncates with a marker instead of exceeding the limit", () => {
    const bulky = Array.from(
      { length: 400 },
      (_, index) =>
        `- [#${index}](${REPO_URL}/pull/${index}) Thanks [@author](https://github.com/author)! - ${"x".repeat(2000)}`
    );
    const packages = [
      { name: "nextly", changelog: changelogFor("nextly", bulky) },
    ];

    const notes = buildReleaseNotes({
      version: VERSION,
      packages,
      repoUrl: REPO_URL,
    });

    expect(notes.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    expect(notes).toContain("Notes truncated");
    expect(notes).toContain(`[v${VERSION}](${REPO_URL}/tree/v${VERSION})`);
    expect(notes).toContain("- [#0]");
  });

  it("stays within the limit when a single entry is larger than the budget", () => {
    const packages = [
      {
        name: "nextly",
        changelog: changelogFor("nextly", [`- ${"x".repeat(5000)}`]),
      },
    ];

    const notes = buildReleaseNotes({
      version: VERSION,
      packages,
      repoUrl: REPO_URL,
      maxLength: 500,
    });

    expect(notes.length).toBeLessThanOrEqual(500);
  });

  it("keeps the whole package list when entries are truncated", () => {
    const bulky = Array.from(
      { length: 400 },
      (_, index) =>
        `- [#${index}](${REPO_URL}/pull/${index}) Thanks [@author](https://github.com/author)! - ${"x".repeat(2000)}`
    );
    const packages = lockstepPackages.map(pkg => ({
      ...pkg,
      changelog: changelogFor(pkg.name, bulky),
    }));

    const notes = buildReleaseNotes({
      version: VERSION,
      packages,
      repoUrl: REPO_URL,
    });

    expect(notes.length).toBeLessThanOrEqual(MAX_BODY_LENGTH);
    expect(notes).toContain("Notes truncated");
    expect(notes).toContain("## Packages");
    for (const pkg of packages) {
      expect(notes).toContain(`- \`${pkg.name}\``);
    }
  });

  it("keeps the package list when one entry is larger than the budget", () => {
    const packages = lockstepPackages.map(pkg => ({
      ...pkg,
      changelog: changelogFor(pkg.name, [`- ${"x".repeat(5000)}`]),
    }));

    const notes = buildReleaseNotes({
      version: VERSION,
      packages,
      repoUrl: REPO_URL,
      maxLength: 1000,
    });

    expect(notes.length).toBeLessThanOrEqual(1000);
    expect(notes).toContain("Notes truncated");
    expect(notes).toContain("## Packages");
    for (const pkg of packages) {
      expect(notes).toContain(`- \`${pkg.name}\``);
    }
    expect(notes).not.toContain("xxxxx");
  });

  it("puts the truncation marker before the package list", () => {
    const packages = lockstepPackages.map(pkg => ({
      ...pkg,
      changelog: changelogFor(pkg.name, [`- ${"x".repeat(5000)}`]),
    }));

    const notes = buildReleaseNotes({
      version: VERSION,
      packages,
      repoUrl: REPO_URL,
      maxLength: 1000,
    });

    expect(notes.indexOf("Notes truncated")).toBeGreaterThan(-1);
    expect(notes.indexOf("Notes truncated")).toBeLessThan(
      notes.indexOf("## Packages")
    );
  });

  // The intro tells the reader every package is listed below it. That sentence
  // and the list have to survive or fall together, at any cap.
  it("lists every package whenever the intro promises the list", () => {
    const packages = lockstepPackages.map(pkg => ({
      ...pkg,
      changelog: changelogFor(pkg.name, [`- ${"x".repeat(4000)}`]),
    }));

    for (const maxLength of [200, 400, 700, 1200, 5000, 20000]) {
      const notes = buildReleaseNotes({
        version: VERSION,
        packages,
        repoUrl: REPO_URL,
        maxLength,
      });

      expect(notes.length).toBeLessThanOrEqual(maxLength);
      if (!notes.includes("Every package below ships at this version.")) {
        continue;
      }
      for (const pkg of packages) {
        expect(notes).toContain(`- \`${pkg.name}\``);
      }
    }
  });

  // A cap smaller than the inventory itself cannot happen with a real train,
  // but the builder still has to return a bounded body rather than throw, loop,
  // or hand GitHub something it will reject.
  it("returns a bounded body when the package list alone exceeds the cap", () => {
    const packages = Array.from({ length: 17 }, (_, index) => ({
      name: `@nextlyhq/package-with-a-long-name-${index}`,
      changelog: changelogFor(`pkg-${index}`, [MIGRATE_ENTRY]),
    }));

    for (const maxLength of [1, 40, 120, 300]) {
      const notes = buildReleaseNotes({
        version: VERSION,
        packages,
        repoUrl: REPO_URL,
        maxLength,
      });

      expect(notes.length).toBeGreaterThan(0);
      expect(notes.length).toBeLessThanOrEqual(maxLength);
    }
  });

  it("keeps the package list last in an untruncated release", () => {
    const notes = buildReleaseNotes({
      version: VERSION,
      packages: lockstepPackages,
      repoUrl: REPO_URL,
    });

    expect(notes).not.toContain("Notes truncated");
    expect(notes.indexOf("## What's changed")).toBeLessThan(
      notes.indexOf("## Packages")
    );
    expect(notes.indexOf("design tokens")).toBeLessThan(
      notes.indexOf("## Packages")
    );
    expect(notes.trimEnd().endsWith("- `@nextlyhq/adapter-sqlite`")).toBe(true);
  });

  it("still names the version when no entries were recorded", () => {
    const packages = [{ name: "nextly", changelog: "# nextly\n" }];

    const notes = buildReleaseNotes({
      version: VERSION,
      packages,
      repoUrl: REPO_URL,
    });

    expect(notes).toContain("No changelog entries were recorded");
    expect(notes).toContain("- `nextly`");
  });
});
