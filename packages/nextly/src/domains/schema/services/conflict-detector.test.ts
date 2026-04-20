// Tests for ConflictDetector.
import { describe, expect, it } from "vitest";

import {
  ConflictDetector,
  formatConflictError,
  type Conflict,
} from "./conflict-detector.js";

describe("ConflictDetector", () => {
  it("detects same slug in both sources", () => {
    const d = new ConflictDetector();
    const conflicts = d.detect(
      [{ slug: "posts" }],
      [{ slug: "posts", createdAt: "2026-03-15T00:00:00Z" }]
    );
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]?.slug).toBe("posts");
    expect(conflicts[0]?.uiSource.createdAt).toBe("2026-03-15T00:00:00Z");
  });

  it("returns empty when no overlap", () => {
    const d = new ConflictDetector();
    expect(d.detect([{ slug: "users" }], [{ slug: "posts" }])).toEqual([]);
  });

  it("matches case-insensitively so Posts vs posts is a conflict", () => {
    const d = new ConflictDetector();
    const conflicts = d.detect([{ slug: "Posts" }], [{ slug: "posts" }]);
    expect(conflicts).toHaveLength(1);
  });

  it("reports multiple conflicts when many collections overlap", () => {
    const d = new ConflictDetector();
    const conflicts = d.detect(
      [{ slug: "posts" }, { slug: "users" }, { slug: "tags" }],
      [{ slug: "posts" }, { slug: "users" }, { slug: "media" }]
    );
    expect(conflicts.map(c => c.slug).sort()).toEqual(["posts", "users"]);
  });

  it("includes custom configPath in the conflict payload", () => {
    const d = new ConflictDetector();
    const conflicts = d.detect(
      [{ slug: "posts" }],
      [{ slug: "posts" }],
      "src/nextly.config.ts"
    );
    expect(conflicts[0]?.codeSource.configPath).toBe("src/nextly.config.ts");
  });
});

describe("formatConflictError", () => {
  it("produces a clear multi-line message pointing at promote/demote", () => {
    const conflicts: Conflict[] = [
      {
        slug: "posts",
        uiSource: { createdAt: "2026-03-15T00:00:00Z" },
        codeSource: { configPath: "nextly.config.ts" },
      },
    ];
    const output = formatConflictError(conflicts);
    expect(output).toContain("'posts' exists in both");
    expect(output).toContain("nextly db:sync --promote");
    expect(output).toContain("nextly db:sync --demote");
  });
});
