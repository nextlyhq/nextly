// F10 PR 3 — TerminalChannel unit tests.
// The channel writes a boxed multi-line summary to a stdout-like
// writer. ASCII-only borders for portability across Windows + CI logs.

import { describe, expect, it } from "vitest";

import { TerminalChannel } from "../channels/terminal";
import type { MigrationNotificationEvent } from "../types";

const success: MigrationNotificationEvent = {
  ts: "2026-04-29T18:00:00.000Z",
  source: "code",
  status: "success",
  scope: { kind: "collection", slug: "posts" },
  summary: { added: 1, removed: 0, renamed: 1, changed: 0 },
  durationMs: 320,
  journalId: "id-1",
};

const successNoChanges: MigrationNotificationEvent = {
  ts: "2026-04-29T18:00:00.000Z",
  source: "code",
  status: "success",
  scope: { kind: "collection", slug: "posts" },
  summary: { added: 0, removed: 0, renamed: 0, changed: 0 },
  durationMs: 80,
  journalId: "id-2",
};

const failed: MigrationNotificationEvent = {
  ts: "2026-04-29T18:00:00.000Z",
  source: "ui",
  status: "failed",
  scope: { kind: "collection", slug: "posts" },
  durationMs: 120,
  journalId: "id-3",
  error: { message: "NOT NULL constraint failed" },
};

const freshPush: MigrationNotificationEvent = {
  ts: "2026-04-29T18:00:00.000Z",
  source: "code",
  status: "success",
  scope: { kind: "fresh-push" },
  summary: { added: 5, removed: 0, renamed: 0, changed: 0 },
  durationMs: 200,
  journalId: "id-4",
};

describe("TerminalChannel", () => {
  it("name is 'terminal'", () => {
    expect(new TerminalChannel().name).toBe("terminal");
  });

  it("prints a boxed success summary with collection slug + counts", async () => {
    const lines: string[] = [];
    const ch = new TerminalChannel({
      writer: chunk => {
        lines.push(chunk);
      },
    });

    await ch.write(success);

    const all = lines.join("");
    expect(all).toContain("posts");
    expect(all).toContain("1 added");
    expect(all).toContain("1 renamed");
    expect(all).toContain("320ms");
    // Box-drawing: at least three lines (top border, content, bottom).
    expect(all.split("\n").length).toBeGreaterThanOrEqual(3);
  });

  it("prints 'no changes' when summary is all zeros", async () => {
    const lines: string[] = [];
    const ch = new TerminalChannel({ writer: c => lines.push(c) });

    await ch.write(successNoChanges);

    expect(lines.join("")).toContain("no changes");
  });

  it("prints a failure box with error message", async () => {
    const lines: string[] = [];
    const ch = new TerminalChannel({ writer: c => lines.push(c) });

    await ch.write(failed);

    const all = lines.join("");
    expect(all).toContain("posts");
    expect(all).toContain("FAILED");
    expect(all).toContain("NOT NULL constraint failed");
  });

  it("renders fresh-push scope without slug", async () => {
    const lines: string[] = [];
    const ch = new TerminalChannel({ writer: c => lines.push(c) });

    await ch.write(freshPush);

    const all = lines.join("");
    expect(all).toContain("fresh-push");
    expect(all).toContain("5 added");
  });

  it("distinguishes ui vs code source in the meta line", async () => {
    const uiLines: string[] = [];
    const codeLines: string[] = [];

    await new TerminalChannel({ writer: c => uiLines.push(c) }).write({
      ...success,
      source: "ui",
    });
    await new TerminalChannel({ writer: c => codeLines.push(c) }).write({
      ...success,
      source: "code",
    });

    expect(uiLines.join("")).toContain("ui");
    expect(codeLines.join("")).toContain("hmr");
  });

  it("box width adapts to the longest content line", async () => {
    const lines: string[] = [];
    const ch = new TerminalChannel({ writer: c => lines.push(c) });

    const longSlug: MigrationNotificationEvent = {
      ...success,
      scope: {
        kind: "collection",
        slug: "extremely_long_collection_name_for_testing_box_width",
      },
    };
    await ch.write(longSlug);

    // Every visible line in the box should have equal length (top
    // border == content lines == bottom border) once the box renders.
    const out = lines.join("").trim().split("\n");
    const widths = new Set(out.map(l => l.length));
    expect(widths.size).toBe(1);
  });
});
