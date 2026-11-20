/**
 * `generate:types` given a configuration it cannot generate from: it writes
 * nothing and reports every problem, whether the problem is in one entity
 * (a slug with a space, a field named twice, a type nothing offers) or
 * between two whose names would give one generated type.
 *
 * Run in-process through the program the `nextly` binary runs, with the
 * configuration's bundle stubbed, as the command-wide validation test does:
 * everything under test runs after it.
 */
import {
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearConfigCache } from "../../utils/config-loader";

const exported = vi.hoisted(() => ({ config: {} as unknown }));

vi.mock("../../utils/config-bundler", () => ({
  bundleAndRequire: async () => ({
    mod: { default: exported.config },
    dependencies: [],
  }),
}));

vi.mock("../../../route-handler/auth-handler", () => ({
  setBootedConfig: () => undefined,
}));

const { createProgram } = await import("../../program");

/** Thrown in place of `process.exit`, so the command's end can be observed in-process. */
class Exited extends Error {
  constructor(readonly status: number | undefined) {
    super(`exited ${String(status)}`);
  }
}

let dir: string;

beforeEach(() => {
  dir = realpathSync(mkdtempSync(join(tmpdir(), "nextly-types-invalid-")));
  clearConfigCache();
  vi.stubEnv("CI", "");
  vi.stubEnv("NO_COLOR", "1");
  vi.stubEnv("DB_DIALECT", "sqlite");
  vi.stubEnv("DATABASE_URL", `file:${join(dir, "site.db")}`);
  writeFileSync(join(dir, "nextly.config.ts"), "export default {};\n");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  clearConfigCache();
  process.exitCode = undefined;
  rmSync(dir, { recursive: true, force: true });
});

/** What `nextly generate:types` ends with in `dir`: its exit status, and its output. */
async function generate(): Promise<{
  status: number | undefined;
  output: string;
}> {
  const written: string[] = [];
  clearConfigCache();
  const home = process.cwd();
  const keep = (chunk: unknown) => {
    written.push(String(chunk));
    return true;
  };
  vi.spyOn(process.stderr, "write").mockImplementation(keep);
  vi.spyOn(process.stdout, "write").mockImplementation(keep);
  vi.spyOn(console, "error").mockImplementation((...parts: unknown[]) => {
    written.push(`${parts.map(String).join(" ")}\n`);
  });
  vi.spyOn(console, "log").mockImplementation((...parts: unknown[]) => {
    written.push(`${parts.map(String).join(" ")}\n`);
  });
  let firstExit: number | undefined;
  let exited = false;
  vi.spyOn(process, "exit").mockImplementation(code => {
    const status = typeof code === "number" ? code : undefined;
    if (!exited) {
      exited = true;
      firstExit = status;
    }
    throw new Exited(status);
  });
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  process.exitCode = undefined;
  let status: number | undefined;
  try {
    await createProgram()
      .exitOverride()
      .parseAsync(["node", "nextly", "generate:types", "--cwd", dir]);
    status = typeof process.exitCode === "number" ? process.exitCode : 0;
  } catch (error) {
    if (!(error instanceof Exited)) throw error;
    status = error.status;
  } finally {
    vi.restoreAllMocks();
    process.chdir(home);
  }
  return { status: exited ? firstExit : status, output: written.join("") };
}

/** Every file left in the project besides its configuration, at any depth. */
function writtenFiles(): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter(entry => entry.isFile())
    .map(entry =>
      join(entry.parentPath, entry.name)
        .slice(dir.length + 1)
        .replaceAll("\\", "/")
    )
    .filter(file => file !== "nextly.config.ts");
}

describe("generate:types with an invalid configuration", () => {
  it("reports every problem of a slug with a space, a field named twice and an unknown type, and writes nothing", async () => {
    exported.config = {
      collections: [
        { slug: "Blog Posts", fields: [{ name: "title", type: "text" }] },
        {
          slug: "notes",
          fields: [
            { name: "body", type: "text" },
            { name: "body", type: "text" },
            { name: "score", type: "acme-rating" },
          ],
        },
      ],
    };

    const ran = await generate();

    expect(ran.status).toBe(1);
    expect(ran.output).toContain("CONFIG_INVALID");
    expect(ran.output).toMatch(/3 problems/);
    expect(ran.output).toContain("Blog Posts");
    expect(ran.output).toContain("acme-rating");
    // The identifier that slug would have made is never written.
    expect(ran.output).not.toContain("Blog postsSchema");
    expect(writtenFiles()).toEqual([]);
  });

  it("refuses a collection and a field group whose names give one generated type, naming both and the type, and writes nothing", async () => {
    // Distinct slugs, distinct tables: `seo` as a field group is named
    // `SeoFieldGroup`, which is also the name the collection
    // `seo-field-group` is given.
    exported.config = {
      collections: [
        {
          slug: "seo-field-group",
          fields: [{ name: "title", type: "text" }],
        },
      ],
      fieldGroups: [
        { slug: "seo", fields: [{ name: "summary", type: "text" }] },
      ],
    };

    const ran = await generate();

    expect(ran.status).toBe(1);
    expect(ran.output).toContain("CONFIG_INVALID");
    expect(ran.output).toContain("seo-field-group");
    expect(ran.output).toContain("'seo'");
    expect(ran.output).toContain("SeoFieldGroup");
    // Neither is renamed: no file is written at all.
    expect(writtenFiles()).toEqual([]);
  });

  it("reports two addresses with one table name once, by the address rule alone", async () => {
    exported.config = {
      collections: [
        { slug: "blog-posts", fields: [{ name: "title", type: "text" }] },
        { slug: "blog_posts", fields: [{ name: "title", type: "text" }] },
      ],
    };

    const ran = await generate();

    expect(ran.status).toBe(1);
    expect(ran.output).toContain("SLUG_DUPLICATE");
    expect(ran.output).toMatch(/1 problem\b/);
    expect(ran.output).not.toContain("GENERATED_TYPE_NAME_COLLISION");
    expect(writtenFiles()).toEqual([]);
  });
});
