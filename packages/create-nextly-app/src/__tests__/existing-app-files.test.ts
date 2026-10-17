/**
 * Adding Nextly to an existing app never replaces a file the app already has,
 * and says what it wrote, what it extended and what it left alone.
 *
 * Against real temporary directories, because the defects were about what
 * lands on disk: a nextly.config.ts or admin route already there stopped the
 * whole run, and the admin layout was written over whatever the app had.
 */
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import fsExtra from "fs-extra";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { generateIntoExistingApp } from "../generators/existing-app";
import type { DatabaseConfig, ProjectInfo } from "../types";

const templates = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "..",
  "templates"
);

const projectInfo: ProjectInfo = {
  isNextJs: true,
  isAppRouter: true,
  hasTypescript: true,
  packageManager: "npm",
  nextVersion: "16.0.0",
  srcDir: false,
  appDir: "app",
};

const sqlite: DatabaseConfig = {
  type: "sqlite",
  adapter: "@nextlyhq/adapter-sqlite",
  databaseDriver: "better-sqlite3",
  connectionUrl: "file:./data/nextly.db",
  envExample: "file:./data/nextly.db",
};

/** Every file Nextly writes into an app with no src folder, besides the env files. */
const NEXTLY_FILES = [
  "nextly.config.ts",
  "app/admin/api/[[...params]]/route.ts",
  "app/admin/[[...params]]/page.tsx",
  "app/admin/[[...params]]/layout.tsx",
  "app/admin/api/media/[[...path]]/route.ts",
  "app/api/media/[[...path]]/route.ts",
  "app/api/health/route.ts",
  "instrumentation.ts",
  "types/generated/.gitkeep",
  "types/generated/nextly-types.ts",
];

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nextly-existing-"));
  await writeFile(
    join(dir, "package.json"),
    '{"dependencies":{"next":"16.0.0"}}\n'
  );
  await writeFile(join(dir, "next.config.ts"), "export default {};\n");
  await mkdir(join(dir, "app"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const run = () =>
  generateIntoExistingApp(dir, "blank", projectInfo, sqlite, templates);

const marker = (file: string) => `// the app's own ${file}\n`;

async function seed(files: readonly string[]): Promise<void> {
  for (const file of files) {
    await mkdir(dirname(join(dir, file)), { recursive: true });
    await writeFile(join(dir, file), marker(file));
  }
}

describe("adding Nextly to an existing app", () => {
  // The control: on an app with none of them, every one is written. Without
  // it, a path no step writes would pass the next case by absence.
  it("writes each of Nextly's files into an app that has none", async () => {
    await run();

    for (const file of NEXTLY_FILES) {
      expect(existsSync(join(dir, file)), file).toBe(true);
    }
  });

  it("leaves every one the app already has byte for byte, and says so", async () => {
    await seed(NEXTLY_FILES);

    const reported = await run();

    const skipped = reported.flatMap(files => files.skipped.map(s => s.path));
    for (const file of NEXTLY_FILES) {
      expect(await readFile(join(dir, file), "utf8"), file).toBe(marker(file));
      // A route is reported by the file, or by the folder already answering it.
      expect(
        skipped.some(left => left === file || file.startsWith(`${left}/`)),
        file
      ).toBe(true);
    }
    expect(reported.flatMap(files => files.written)).toEqual([]);
  });

  // The page and its layout are separate files: an app with only a layout
  // there kept losing it.
  it("keeps an admin layout the app has when the page is missing", async () => {
    await seed(["app/admin/[[...params]]/layout.tsx"]);

    await run();

    expect(
      await readFile(join(dir, "app/admin/[[...params]]/layout.tsx"), "utf8")
    ).toBe(marker("app/admin/[[...params]]/layout.tsx"));
    expect(existsSync(join(dir, "app/admin/[[...params]]/page.tsx"))).toBe(
      true
    );
  });

  // A folder on a file's path that is a link would take the write wherever
  // the link points, maybe outside the project; the exclusive create guards
  // only the file's own name.
  it.each(["app/admin", "types/generated"])(
    "writes nothing through %s when it is a symbolic link",
    async folder => {
      const outside = await mkdtemp(join(tmpdir(), "nextly-outside-"));
      try {
        await mkdir(dirname(join(dir, folder)), { recursive: true });
        await symlink(outside, join(dir, folder));

        const reported = await run();

        expect(await readdir(outside)).toEqual([]);
        const skipped = reported.flatMap(files =>
          files.skipped.map(s => s.path)
        );
        expect(skipped.some(left => left.startsWith(folder))).toBe(true);
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    }
  );

  // An app keeping its code in src/ writes instrumentation.ts there too, so a
  // linked src/ must stop that write as well as the others.
  it("writes nothing, instrumentation included, through a linked src/ folder", async () => {
    const outside = await mkdtemp(join(tmpdir(), "nextly-outside-"));
    try {
      await symlink(outside, join(dir, "src"));

      await generateIntoExistingApp(
        dir,
        "blank",
        { ...projectInfo, srcDir: true, appDir: "src/app" },
        sqlite,
        templates
      );

      expect(await readdir(outside)).toEqual([]);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  // A folder that cannot be looked at is not known not to be a link, so
  // nothing is written there, and that is said; the run goes on.
  it("writes nothing under a folder it cannot look into, and says so", async () => {
    const realLstat = fsExtra.lstat.bind(fsExtra);
    const spy = vi.spyOn(fsExtra, "lstat").mockImplementation((async (
      p: string
    ) => {
      if (String(p).endsWith(join("app", "admin"))) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return realLstat(p);
    }) as typeof fsExtra.lstat);
    let reported;
    try {
      reported = await run();
    } finally {
      spy.mockRestore();
    }
    expect(existsSync(join(dir, "app/admin/[[...params]]/page.tsx"))).toBe(
      false
    );
    expect(reported.flatMap(files => files.skipped)).toContainEqual(
      expect.objectContaining({
        path: "app/admin/[[...params]]/page.tsx",
        why: expect.stringMatching(/^app cannot be read/),
      })
    );
    // The media routes under app/admin stop there too, whatever their own
    // checks would find.
    expect(
      existsSync(join(dir, "app/admin/api/media/[[...path]]/route.ts"))
    ).toBe(false);
  });

  // A project reached through a symbolic link is the app's own choice: every
  // file is judged below the root alike, so the config is written with the
  // routes that import it, not skipped while they are written.
  it("writes every file into a project reached through a symbolic link", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "nextly-via-"));
    try {
      const linked = join(elsewhere, "app-link");
      await symlink(dir, linked);

      await generateIntoExistingApp(
        linked,
        "blank",
        projectInfo,
        sqlite,
        templates
      );

      for (const file of NEXTLY_FILES) {
        expect(existsSync(join(dir, file)), file).toBe(true);
      }
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });

  it("reports what it wrote and what it extended", async () => {
    const reported = await run();

    const written = reported.flatMap(files => files.written);
    expect(written).toEqual(expect.arrayContaining([...NEXTLY_FILES]));
    expect(reported.flatMap(files => files.changed)).toContainEqual(
      expect.objectContaining({ path: "next.config.ts" })
    );
  });
});
