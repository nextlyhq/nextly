// F10 PR 3 — NDJSONChannel unit tests.
// The channel appends one JSON line per event to a configured file,
// creates the parent dir on first write, and self-disables on
// permission errors so we don't spam the operator's terminal.

import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NDJSONChannel } from "../channels/ndjson.js";
import type { MigrationNotificationEvent } from "../types.js";

const baseEvent: MigrationNotificationEvent = {
  ts: "2026-04-29T18:00:00.000Z",
  source: "ui",
  status: "success",
  scope: { kind: "collection", slug: "posts" },
  summary: { added: 1, removed: 0, renamed: 0, changed: 0 },
  durationMs: 320,
  journalId: "id-1",
};

let tmp = "";

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "ndjson-test-"));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe("NDJSONChannel", () => {
  it("name is 'ndjson'", () => {
    const ch = new NDJSONChannel({ filePath: join(tmp, "x.log") });
    expect(ch.name).toBe("ndjson");
  });

  it("creates the log directory on first write", async () => {
    const logPath = join(tmp, ".nextly", "logs", "migrations.log");
    const ch = new NDJSONChannel({ filePath: logPath });

    await ch.write(baseEvent);

    const contents = readFileSync(logPath, "utf8");
    expect(contents).toContain('"journalId":"id-1"');
    expect(contents.endsWith("\n")).toBe(true);
  });

  it("appends successive events as separate lines", async () => {
    const logPath = join(tmp, ".nextly", "logs", "migrations.log");
    const ch = new NDJSONChannel({ filePath: logPath });

    await ch.write(baseEvent);
    await ch.write({ ...baseEvent, journalId: "id-2" });

    const lines = readFileSync(logPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toMatchObject({ journalId: "id-1" });
    expect(JSON.parse(lines[1])).toMatchObject({ journalId: "id-2" });
  });

  it("each line is valid JSON parseable into the original event shape", async () => {
    const logPath = join(tmp, "log.jsonl");
    const ch = new NDJSONChannel({ filePath: logPath });

    await ch.write(baseEvent);

    const line = readFileSync(logPath, "utf8").trim();
    const parsed = JSON.parse(line) as MigrationNotificationEvent;
    expect(parsed).toEqual(baseEvent);
  });

  it("disables itself after a permission error and stops calling fs", async () => {
    // Force EACCES by creating a read-only parent dir.
    const readOnly = join(tmp, "readonly");
    mkdirSync(readOnly, { mode: 0o555 });
    const logPath = join(readOnly, "logs", "migrations.log");

    const warn = vi.fn();
    const ch = new NDJSONChannel({ filePath: logPath, logger: { warn } });

    // First write fails with EACCES → channel disables + warns once.
    await expect(ch.write(baseEvent)).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[notifications] ndjson channel disabled")
    );

    // Subsequent writes are no-ops (no warn spam).
    await ch.write(baseEvent);
    await ch.write(baseEvent);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never throws (failures swallowed locally as warn)", async () => {
    const readOnly = join(tmp, "readonly");
    mkdirSync(readOnly, { mode: 0o555 });
    const logPath = join(readOnly, "logs", "migrations.log");

    const ch = new NDJSONChannel({
      filePath: logPath,
      logger: { warn: () => {} },
    });

    await expect(ch.write(baseEvent)).resolves.toBeUndefined();
  });

  it("works without a logger (warn arg is optional)", async () => {
    const readOnly = join(tmp, "readonly");
    mkdirSync(readOnly, { mode: 0o555 });
    const logPath = join(readOnly, "logs", "migrations.log");

    const ch = new NDJSONChannel({ filePath: logPath });

    await expect(ch.write(baseEvent)).resolves.toBeUndefined();
  });
});
