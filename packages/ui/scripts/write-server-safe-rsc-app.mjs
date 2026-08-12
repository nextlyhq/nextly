/**
 * Write a minimal Next.js app that imports every server-safe subpath from a Server Component.
 *
 * The other server-safe checks in this package read code: the directive guard looks for a
 * `"use client"` banner, and the artifact gate compares what each built file reaches against an
 * allow-list. Both are models of what Next.js does with these packages, and a model only answers
 * for the cases it was taught. This asks the real toolchain instead — the app it writes is built by
 * the Next.js and React versions a consumer installs, on the Node the job runs.
 *
 * The assertion is the BUILD SUCCEEDING. An App Router page is prerendered at build time, so every
 * module it imports is evaluated in a real server render. A module whose body reads `document`, or
 * that leaves the render unable to complete, fails the build naming the file. Nothing here has to
 * recognise the spelling of that read for it to happen, which is the whole reason this exists
 * rather than a longer list of globals to probe for.
 *
 * The subpaths are DERIVED from the export map rather than written down. A hand-written list makes
 * a new server-safe subpath silently uncovered, which is the failure this check would be least
 * likely to notice — it would keep passing, on the entries someone remembered.
 *
 * Deriving covers one direction only, and the other one matters just as much: a subpath RECLASSIFIED
 * as client code leaves this list, and a shrinking derived list agrees with itself and reports a
 * pass over less than it did yesterday. What stops that is `src/ui-surface.test.ts`, which compares
 * the same derived set against the subpaths STABILITY.md names in prose, in both directions. The
 * enumerated side lives there, where a deletion is loud, and the derived side lives here, where an
 * addition is free.
 *
 * Usage: node scripts/write-server-safe-rsc-app.mjs <directory>
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { publishedEntries } from "./published-entries.mjs";

const target = process.argv[2];
if (target === undefined) {
  console.error(
    "Usage: node scripts/write-server-safe-rsc-app.mjs <directory>. The directory is where the " +
      "app is written; it is created if it does not exist."
  );
  process.exit(1);
}

const serverSafe = publishedEntries().filter(entry => entry.serverSafe);

// An empty list would write an app that imports nothing and builds cleanly, reporting a pass for
// having checked no entry point at all.
if (serverSafe.length === 0) {
  console.error(
    "No server-safe subpaths were derived from the export map, so the generated app would assert " +
      "nothing."
  );
  process.exit(1);
}

/** The bare specifier a consumer writes for a subpath: `./color` is imported as `<pkg>/color`. */
const specifier = subpath =>
  subpath === "." ? "@nextlyhq/ui" : `@nextlyhq/ui/${subpath.slice(2)}`;

// A NAMESPACE import, so this holds whatever each subpath exports without naming any binding. The
// alternative is a list of names per subpath, which is the hand-written list this file exists to
// avoid, one level down.
const imports = serverSafe
  .map((entry, index) => `import * as entry${index} from "${specifier(entry.subpath)}";`)
  .join("\n");

// Every namespace is READ, and the result is rendered. An import whose binding is never used is
// removable, and a bundler that removes it leaves the module unevaluated — the page would build
// green having imported nothing. Counting the exports forces the namespace object to exist, and
// rendering the count keeps the expression from being dropped as dead.
const reads = serverSafe
  .map(
    (entry, index) =>
      `  { subpath: ${JSON.stringify(entry.subpath)}, exports: Object.keys(entry${index}).length },`
  )
  .join("\n");

const page = `${imports}

// No "use client" banner: this file is a Server Component, which is the environment the subpaths
// above claim to support.
const imported = [
${reads}
];

export default function Page() {
  return (
    <main>
      {imported.map(entry => (
        <p key={entry.subpath}>
          {entry.subpath}: {entry.exports} exports
        </p>
      ))}
    </main>
  );
}
`;

const layout = `export const metadata = { title: "server-safe subpaths" };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`;

// Written here rather than in the workflow, so the whole app is one generated artifact and the CI
// step is an install and a build. A manifest split across a YAML heredoc is a second place for the
// app's shape to live, and it drifts from this file the first time either changes.
const manifest = {
  name: "server-safe-rsc-smoke",
  private: true,
  version: "0.0.0",
  type: "module",
};

mkdirSync(join(target, "app"), { recursive: true });
writeFileSync(join(target, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(join(target, "app", "page.jsx"), page);
writeFileSync(join(target, "app", "layout.jsx"), layout);

console.log(
  `Wrote a Server Component importing ${serverSafe.length} server-safe subpaths ` +
    `(${serverSafe.map(entry => entry.subpath).join(", ")}) to ${target}.`
);
