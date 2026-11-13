/**
 * The notices of the third-party packages the admin's build bundles, as one
 * file shipped beside the chunks (`dist/THIRD-PARTY-NOTICES`).
 *
 * A package's licence travels with its code. The bundler would otherwise keep
 * each module's `@license` banner in the chunk that holds it: `lucide-react`
 * alone repeats one per icon, about 32 KB of the shipped total. The build
 * drops the banners (`comments.legal: false` in `tsdown.config.ts`) and writes
 * every bundled package's licence here once instead, read from the package
 * itself, so the notice is the package's own text and not a summary of it.
 *
 * @module scripts/third-party-notices
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The file the notices are written to, beside the chunks. */
export const NOTICES_FILE = "THIRD-PARTY-NOTICES";

/** A licence file's name, as packages spell it. */
const LICENCE_FILE = /^(licen[cs]e|copying|notice)(\.(md|txt|markdown))?$/i;

/**
 * The directory of the package a bundled module belongs to, from the module's
 * path: what follows the last `node_modules/`, one segment, or two for a
 * scoped name. Null for a module outside any package.
 */
export function packageDirOf(moduleId) {
  const file = moduleId.replace(/^\0/, "").split("\\").join("/");
  const at = file.lastIndexOf("/node_modules/");
  if (at === -1) return null;
  const rest = file.slice(at + "/node_modules/".length).split("/");
  const segments = rest[0]?.startsWith("@") ? 2 : 1;
  if (rest.length <= segments) return null;
  return (
    file.slice(0, at + "/node_modules/".length) +
    rest.slice(0, segments).join("/")
  );
}

/** One package's notice: its name, version and licence, then its licence text. */
function noticeOf(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  const files = readdirSync(dir)
    .filter(name => LICENCE_FILE.test(name))
    .sort();
  const texts = files.map(name => readFileSync(join(dir, name), "utf8").trim());
  const licence =
    typeof manifest.license === "string" ? manifest.license : "see below";
  const author =
    typeof manifest.author === "string"
      ? manifest.author
      : manifest.author?.name;
  const repository =
    typeof manifest.repository === "string"
      ? manifest.repository
      : manifest.repository?.url;
  return {
    name: manifest.name,
    text: [
      `${manifest.name}@${manifest.version} (${licence})`,
      ...(texts.length > 0
        ? texts
        : [
            [
              `The package ships no licence file. Its package.json declares the ${licence} licence`,
              author ? `, by ${author}` : "",
              repository ? `, with its source at ${repository}` : "",
              ".",
            ].join(""),
          ]),
    ].join("\n\n"),
  };
}

/**
 * The notices file for the packages whose modules the build bundled, sorted
 * by name, one notice per package however many of its modules were bundled.
 * A directory with no `package.json` is not a package root and is skipped.
 */
export function thirdPartyNotices(moduleIds) {
  const dirs = new Set(
    moduleIds
      .map(packageDirOf)
      .filter(dir => dir !== null && existsSync(join(dir, "package.json")))
  );
  const notices = [...dirs]
    .map(noticeOf)
    .sort((a, b) => a.name.localeCompare(b.name));
  const names = [...new Set(notices.map(notice => notice.name))];
  const header = [
    "Third-party notices for @nextlyhq/admin",
    "",
    "The admin's browser build includes code from the packages below. Each is",
    "listed with its version and licence, followed by its licence text as the",
    "package publishes it.",
    "",
    `Packages: ${names.join(", ")}`,
  ].join("\n");
  const rule = `\n\n${"-".repeat(72)}\n\n`;
  return `${[header, ...notices.map(notice => notice.text)].join(rule)}\n`;
}
