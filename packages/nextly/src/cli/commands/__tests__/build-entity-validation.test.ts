/**
 * `nextly build` is the gate that stops an invalid declaration reaching
 * production, so what it declines to validate is what CI cannot catch.
 *
 * Two properties are pinned here. Singles and field groups are validated at all —
 * the command used to run the comprehensive validators over collections only.
 * And they are validated even when a project defines no collections, because
 * the "nothing to build" shortcut returns before the later validation step and
 * a project can be made entirely of singles and field groups.
 */
import { describe, it, expect, vi, afterEach } from "vitest";

import {
  clearFieldTypes,
  registerFieldType,
} from "../../../domains/schema/field-types/field-type-registry";
import { NextlyError } from "../../../errors/nextly-error";
import type { CommandContext } from "../../program";
import type { LoadConfigResult } from "../../utils/config-loader";
import type { Logger } from "../../utils/logger";
import { runBuild } from "../build";

const loadConfig = vi.hoisted(() => vi.fn());
vi.mock("../../utils/config-loader", () => ({ loadConfig }));

/** Capture-only logger: records every line so assertions can read the report. */
function createCaptureLogger(): { logger: Logger; lines: string[] } {
  const lines: string[] = [];
  const record = (message: string): void => {
    lines.push(message);
  };
  const logger: Logger = {
    debug: record,
    info: record,
    warn: record,
    error: record,
    success: record,
    newline: () => undefined,
    divider: () => undefined,
    header: record,
    item: record,
    keyValue: () => undefined,
    table: () => undefined,
    spinner: (message: string) => {
      record(message);
      return { stop: () => undefined };
    },
    setOptions: () => undefined,
    getOptions: () => ({}),
  };
  return { logger, lines };
}

/** A type whose own rules refuse a policy that would admit no value at all. */
function registerDocument(): void {
  registerFieldType({
    type: "document",
    storage: "json",
    component: "@acme/docs/admin#DocumentInput",
    surfaces: ["entries", "singles", "components"],
    validateOptions(field) {
      const policy = field.policy;
      if (policy === null || typeof policy !== "object") return true;
      const kinds = (policy as { kinds?: unknown }).kinds;
      return Array.isArray(kinds) && kinds.length === 0
        ? [{ path: "policy.kinds", message: "policy.kinds must name a kind" }]
        : true;
    },
  });
}

const badField = { name: "body", type: "document", policy: { kinds: [] } };

/**
 * The command exits the process; throwing keeps the test alive at that point.
 * NextlyError rather than a bare Error because this package requires it.
 */
function stubExit(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(process, "exit").mockImplementation(() => {
    throw NextlyError.internal("process.exit");
  });
}

function stubConfig(config: Record<string, unknown>): void {
  loadConfig.mockResolvedValue({
    config,
    configPath: "/tmp/nextly.config.ts",
    dependencies: [],
  } as unknown as LoadConfigResult);
}

afterEach(() => {
  clearFieldTypes();
  vi.restoreAllMocks();
  loadConfig.mockReset();
});

describe("nextly build validates every entity kind", () => {
  it("fails a single-only project whose declaration its field type rejects", async () => {
    registerDocument();
    stubConfig({
      collections: [],
      singles: [{ slug: "homepage", fields: [badField] }],
    });

    const { logger, lines } = createCaptureLogger();
    const context: CommandContext = { logger, options: {}, cwd: "/tmp" };
    const exitSpy = stubExit();

    await expect(runBuild({}, context)).rejects.toBeInstanceOf(NextlyError);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(lines.join("\n")).toContain("policy.kinds must name a kind");
    // Not the "no collections, nothing to do" path: that reported success.
    expect(lines.join("\n")).not.toContain("Add collections to your");
  });

  it("fails a field-group-only project the same way", async () => {
    registerDocument();
    stubConfig({
      collections: [],
      fieldGroups: [{ slug: "hero", fields: [badField] }],
    });

    const { logger, lines } = createCaptureLogger();
    const context: CommandContext = { logger, options: {}, cwd: "/tmp" };
    const exitSpy = stubExit();

    await expect(runBuild({}, context)).rejects.toBeInstanceOf(NextlyError);

    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(lines.join("\n")).toContain("policy.kinds must name a kind");
  });

  it("builds a project whose only schema is singles", async () => {
    registerDocument();
    stubConfig({
      collections: [],
      singles: [
        { slug: "homepage", fields: [{ name: "body", type: "document" }] },
      ],
    });

    const { logger, lines } = createCaptureLogger();
    const context: CommandContext = { logger, options: {}, cwd: "/tmp" };
    const exitSpy = stubExit();

    // Generation is switched off: what this pins is the gate, and the stub
    // config carries no output paths for the generators to write to.
    await runBuild({ zod: false, types: false }, context);

    expect(exitSpy).not.toHaveBeenCalled();
    // The absence of collections is still worth saying, but it no longer stops
    // the build: the single's types are exactly what this run has to write.
    expect(lines.join("\n")).toContain("No collections defined in config");
    expect(lines.join("\n")).not.toContain("Add collections to your");
  });
});
