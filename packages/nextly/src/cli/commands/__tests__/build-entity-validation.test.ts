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
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

describe("nextly build refuses a field type no plugin offers", () => {
  it("fails on a token nothing registered", async () => {
    // The `define*` validators defer an unknown token because the config
    // bundle is evaluated before any plugin registers its types. `loadConfig`
    // has registered them by the time the command runs, so this is the first
    // point the question is answerable — and unasked, the command would emit
    // primitive fallback types for a schema production boot then refuses.
    stubConfig({
      collections: [
        { slug: "posts", fields: [{ name: "body", type: "no-such-type" }] },
      ],
      singles: [],
    });

    const { logger, lines } = createCaptureLogger();
    const context: CommandContext = { logger, options: {}, cwd: "/tmp" };
    const exitSpy = stubExit();

    await expect(runBuild({}, context)).rejects.toBeInstanceOf(NextlyError);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(lines.join("\n")).toContain("no-such-type");
  });

  it("fails on a type offered only on another surface", async () => {
    // Registration alone is not authorization: a type that opted into `users`
    // is not a collection field, and accepting it here would generate a column
    // for a field the entries surface will not accept.
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "@acme/ratings/admin#Input",
      surfaces: ["users"],
    });

    stubConfig({
      collections: [
        { slug: "posts", fields: [{ name: "score", type: "rating" }] },
      ],
      singles: [],
    });

    const { logger, lines } = createCaptureLogger();
    const context: CommandContext = { logger, options: {}, cwd: "/tmp" };
    const exitSpy = stubExit();

    await expect(runBuild({}, context)).rejects.toBeInstanceOf(NextlyError);
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(lines.join("\n")).toContain("rating");
  });

  it("accepts a type that did opt into this surface", async () => {
    // The refusals above are specific to a type the entries surface does not
    // accept, so a type that did opt in has to stay accepted — otherwise the
    // gate would reject every contributed collection field rather than the
    // wrong-surface ones it exists to catch.
    registerFieldType({
      type: "rating",
      storage: "number",
      component: "@acme/ratings/admin#Input",
      surfaces: ["entries"],
    });

    stubConfig({
      collections: [
        { slug: "posts", fields: [{ name: "score", type: "rating" }] },
      ],
      singles: [],
    });

    const { logger } = createCaptureLogger();
    const context: CommandContext = { logger, options: {}, cwd: "/tmp" };
    const exitSpy = stubExit();

    await runBuild({ zod: false, types: false }, context);
    expect(exitSpy).not.toHaveBeenCalled();
  });
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

  it("narrows PermissionSlug in a build with no collections", async () => {
    // A singles-only project is exactly what the schema gate now builds for,
    // and it is where the names matter most: without them the written file
    // declares `PermissionSlug` as bare `string`, so a deployment build widens
    // what a development run had narrowed.
    const cwd = mkdtempSync(join(tmpdir(), "nextly-build-"));
    try {
      stubConfig({
        collections: [],
        singles: [
          { slug: "homepage", fields: [{ name: "title", type: "text" }] },
        ],
        typescript: { outputFile: "nextly-types.ts" },
      });

      const { logger, lines } = createCaptureLogger();
      const context: CommandContext = { logger, options: {}, cwd };

      // `generateAllFiles` resolves output against `options.cwd`, not the
      // command context, so the temp directory has to be passed here.
      await runBuild({ zod: false, cwd }, context);

      const report = lines.join("\n");
      expect(report).not.toContain("No schema defined in config");
      const written = readFileSync(join(cwd, "nextly-types.ts"), "utf-8");
      expect(written).toContain('"read-homepage"');
      expect(written).not.toMatch(/PermissionSlug\s*=\s*string\s*;/);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
