/**
 * The bundled packages' licences ship once, in `dist/THIRD-PARTY-NOTICES`, and
 * the chunks carry no licence banners of their own.
 *
 * The build drops each module's `@license` banner, so every package whose
 * code it bundles must be in the notices file instead: one notice per package,
 * with its own licence text. Checked first on packages made for each case,
 * then on the real build, against the build's own record of which modules
 * each chunk holds (`dist/bundle-modules.json`).
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  NOTICES_FILE,
  packageDirOf,
  packageFileOf,
  thirdPartyNotices,
} from "./third-party-notices.mjs";

const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

const made = [];
afterEach(() => {
  for (const dir of made.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

/** A `node_modules` holding packages made of these files, by package name. */
function packages(byName) {
  const root = join(mkdtempSync(join(tmpdir(), "nx-notices-")), "node_modules");
  made.push(dirname(root));
  for (const [name, files] of Object.entries(byName)) {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(root, name), { recursive: true });
      writeFileSync(join(root, name, file), text);
    }
  }
  return root;
}

const manifest = (name, extra = {}) =>
  JSON.stringify({ name, version: "1.2.3", license: "MIT", ...extra });

describe("packageDirOf", () => {
  it("reads a package's directory from a bundled module's path", () => {
    expect(
      packageDirOf("/r/node_modules/.pnpm/a@1/node_modules/a/dist/x.js")
    ).toBe("/r/node_modules/.pnpm/a@1/node_modules/a");
    expect(packageDirOf("/r/node_modules/@s/b/lib/y.mjs")).toBe(
      "/r/node_modules/@s/b"
    );
    expect(packageDirOf("/r/packages/admin/src/index.ts")).toBeNull();
  });

  it("reads a Windows path, whose separators are backslashes, the same way", () => {
    expect(packageDirOf("D:\\r\\node_modules\\@s\\b\\lib\\y.mjs")).toBe(
      "D:/r/node_modules/@s/b"
    );
  });
});

// The build's record of its chunks names a package's module by this, so the
// record reads alike on every system: a Windows build that kept its
// backslashes named every package's module by its path from the admin
// (`../../node_modules/...`), and the record then held no package at all.
describe("packageFileOf", () => {
  it("reads a module's path from where its package starts, with `/` on every system", () => {
    expect(
      packageFileOf("/r/node_modules/.pnpm/a@1/node_modules/a/dist/x.js")
    ).toBe("a/dist/x.js");
    expect(
      packageFileOf(
        "D:\\r\\node_modules\\.pnpm\\b@1\\node_modules\\@s\\b\\lib\\y.mjs"
      )
    ).toBe("@s/b/lib/y.mjs");
    expect(packageFileOf("/r/packages/admin/src/index.ts")).toBeNull();
    expect(packageFileOf("D:\\r\\packages\\admin\\src\\a.ts")).toBeNull();
  });
});

describe("thirdPartyNotices", () => {
  it("writes one notice per package, with its licence text, sorted by name", () => {
    const root = packages({
      zed: { "package.json": manifest("zed"), LICENSE: "Zed licence text" },
      "@s/abc": {
        "package.json": manifest("@s/abc", { license: "ISC" }),
        "LICENSE.md": "Abc licence text",
      },
    });
    const notices = thirdPartyNotices([
      join(root, "zed/dist/a.js"),
      join(root, "zed/dist/b.js"),
      join(root, "@s/abc/index.js"),
    ]);
    expect(notices).toContain("Packages: @s/abc, zed");
    expect(notices.match(/^zed@1\.2\.3 \(MIT\)$/gm)).toHaveLength(1);
    expect(notices).toContain("@s/abc@1.2.3 (ISC)\n\nAbc licence text");
    expect(notices.indexOf("@s/abc@")).toBeLessThan(notices.indexOf("zed@"));
  });

  it("names a package's declared licence, author and source when it ships no licence file", () => {
    const root = packages({
      bare: {
        "package.json": manifest("bare", {
          author: { name: "Ada" },
          repository: { url: "https://example.com/bare" },
        }),
      },
    });
    expect(thirdPartyNotices([join(root, "bare/x.js")])).toContain(
      "declares the MIT licence, by Ada, with its source at https://example.com/bare."
    );
  });

  it("leaves out the package's own source and anything that is not a package", () => {
    const root = packages({ nested: { "file.js": "" } });
    expect(
      thirdPartyNotices([
        "/r/packages/admin/src/a.ts",
        join(root, "nested/file.js"),
      ])
    ).toContain("Packages: \n");
  });
});

describe("the admin's build", () => {
  const chunks = readdirSync(DIST, {
    recursive: true,
    encoding: "utf8",
  }).filter(file => file.endsWith(".mjs"));
  const notices = readFileSync(join(DIST, NOTICES_FILE), "utf8");
  const record = JSON.parse(
    readFileSync(join(DIST, "bundle-modules.json"), "utf8")
  );

  it("carries no licence banners in its chunks", () => {
    expect(
      chunks.filter(file =>
        /@license|\/\*!/.test(readFileSync(join(DIST, file), "utf8"))
      )
    ).toEqual([]);
  });

  it("names in its notices every package whose code it bundles", () => {
    const listed = new Set(/^Packages: (.*)$/m.exec(notices)[1].split(", "));
    const bundled = new Set(
      Object.values(record.chunks)
        .flat()
        .filter(
          module =>
            !module.startsWith("src/") &&
            !module.startsWith("../") &&
            !module.startsWith("virtual:")
        )
        .map(module => {
          const parts = module.split("/");
          return parts[0].startsWith("@")
            ? `${parts[0]}/${parts[1]}`
            : parts[0];
        })
    );
    expect(bundled.size).toBeGreaterThan(10);
    expect([...bundled].filter(name => !listed.has(name))).toEqual([]);
  });
});
