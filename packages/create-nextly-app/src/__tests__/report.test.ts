/**
 * The one report an existing-app run ends with, across every step, the env
 * files included. (The env files had a printer of their own; its cases, a
 * file left alone with the line to add and the warnings, are the first case
 * here.)
 */
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it, vi } from "vitest";

const log = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  message: vi.fn(),
}));
vi.mock("@clack/prompts", () => ({ log }));

import { generateEnv } from "../generators/env";
import { generateIntoExistingApp } from "../generators/existing-app";
import { readMediaRouteTemplates } from "../generators/media-routes";
import { reportGeneratedFiles } from "../generators/report";
import { readEnvKeys } from "../utils/env-file";

describe("reportGeneratedFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("says what every step wrote, extended and left alone, and why", () => {
    reportGeneratedFiles(
      [
        { written: ["nextly.config.ts"], changed: [], skipped: [] },
        {
          written: [],
          changed: [
            {
              path: "next.config.ts",
              added: ["serverExternalPackages: nextly"],
            },
          ],
          skipped: [
            {
              path: "app/admin/[[...params]]/layout.tsx",
              why: "the app already has one",
              toAdd: "export default function Layout() {}",
            },
          ],
        },
      ],
      ["NEXTLY_SECRET in .env is shorter than 32 characters."]
    );

    expect(log.info).toHaveBeenCalledWith("Wrote nextly.config.ts");
    expect(log.info).toHaveBeenCalledWith(
      "Updated next.config.ts: serverExternalPackages: nextly"
    );
    expect(log.warn).toHaveBeenCalledWith(
      "Left app/admin/[[...params]]/layout.tsx as it was: the app already has one"
    );
    expect(log.message).toHaveBeenCalledWith(
      "export default function Layout() {}"
    );
    expect(log.warn).toHaveBeenCalledWith(
      "NEXTLY_SECRET in .env is shorter than 32 characters."
    );
  });

  it("prints nothing for a run that did nothing", () => {
    reportGeneratedFiles([{ written: [], changed: [], skipped: [] }]);

    expect(log.info).not.toHaveBeenCalled();
    expect(log.warn).not.toHaveBeenCalled();
  });

  // The run's whole report, from real steps: what it prints must never hold
  // an env value, the generated secret above all. Paths, keys and packages
  // only.
  it("never prints an env value, the generated secret included", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nextly-report-"));
    try {
      await writeFile(
        join(dir, "package.json"),
        '{"dependencies":{"next":"16.0.0"}}\n'
      );
      await writeFile(join(dir, "next.config.ts"), "export default {};\n");
      await mkdir(join(dir, "app"));
      // A .env the app has, so the env step reports a change, not a write.
      await writeFile(join(dir, ".env"), "MINE=kept\n");
      const info = {
        isNextJs: true,
        isAppRouter: true,
        hasTypescript: true,
        packageManager: "npm" as const,
        nextVersion: "16.0.0",
        srcDir: false,
        appDir: "app",
      };
      const database = {
        type: "postgresql" as const,
        adapter: "@nextlyhq/adapter-postgres",
        databaseDriver: "pg",
        connectionUrl: "postgresql://app:S3cr3tPassw0rd@db.internal:5432/app",
        envExample: "postgresql://user:password@localhost:5432/nextly",
      };
      const templates = await readMediaRouteTemplates(
        join(
          dirname(fileURLToPath(import.meta.url)),
          "..",
          "..",
          "..",
          "..",
          "templates"
        )
      );

      const reported = await generateIntoExistingApp(
        dir,
        "blank",
        info,
        database,
        templates
      );
      const env = await generateEnv(dir, database);
      reportGeneratedFiles([...reported, env.files], env.warnings);

      const secret =
        readEnvKeys(await readFile(join(dir, ".env"), "utf8")).defined.get(
          "NEXTLY_SECRET"
        ) ?? "";
      expect(secret.length).toBeGreaterThanOrEqual(32);
      const printed = [
        ...log.info.mock.calls,
        ...log.warn.mock.calls,
        ...log.message.mock.calls,
      ]
        .map(([line]: [string]) => line)
        .join("\n");
      // The control: the report did name the env change.
      expect(printed).toMatch(/Updated \.env: .*NEXTLY_SECRET/);
      expect(printed).not.toContain(secret);
      expect(printed).not.toContain("S3cr3tPassw0rd");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
