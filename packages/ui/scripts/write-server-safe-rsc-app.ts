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
 * Usage, from this package's directory:
 *   tsx scripts/write-server-safe-rsc-app.ts <directory>            write the app
 *   tsx scripts/write-server-safe-rsc-app.ts --verify <directory>   check what the build produced
 *
 * Through `tsx` rather than `node`, because the lowest supported Node cannot execute TypeScript
 * directly. That is also how the workflow invokes it.
 *
 * The two modes share this file, and therefore share ONE derivation of the subpath list. Split
 * across a generator and a separate verifier, the verifier is free to check a different set to the
 * one that was written, and it would report a pass over whichever set it had.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { publishedEntries } from "./published-entries.js";

const verifying = process.argv[2] === "--verify";
const target = verifying ? process.argv[3] : process.argv[2];
if (target === undefined) {
  console.error(
    "Usage: tsx scripts/write-server-safe-rsc-app.ts [--verify] <directory>. The directory is " +
      "where the app is written; it is created if it does not exist."
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

/**
 * The file a BUILD-TIME render writes, and nothing else does.
 *
 * `next build` exits 0 for a route it classifies as dynamic too, where the render is deferred to
 * the first request. Reading the exit code alone would then report that the module bodies ran when
 * they had only been compiled, and a future release changing how a route is classified would
 * weaken this check without touching it.
 */
const PRERENDERED = join(target, ".next", "server", "app", "index.html");

/**
 * The file the CommonJS probe writes as its LAST act, and nothing else does.
 *
 * A module calling `process.exit(0)` while it initializes ends that probe with a success status
 * before its assertions, its remaining subpaths, or its final log ever run — so the exit code
 * alone reports a pass for the one defect that stops the check happening at all. Reaching the end
 * is the only thing that produces this.
 */
const SENTINEL = "require-check.done";

if (verifying) {
  if (!existsSync(PRERENDERED)) {
    console.error(
      `${PRERENDERED} does not exist, so the route was compiled but never rendered at build time. ` +
        `A server-safe entry point is only proven by a render that actually ran.`
    );
    process.exit(1);
  }
  const html = readFileSync(PRERENDERED, "utf8");

  // Matched on ATTRIBUTES rather than on the visible text. React separates adjacent expressions in
  // a text node with `<!-- -->` comments, so the rendered prose reads `./utils<!-- -->: <!-- -->1`
  // and a literal search for what the page appears to say finds nothing.
  const missing = [];
  const empty = [];
  for (const entry of serverSafe) {
    const quoted = entry.subpath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // The ELEMENT is located first, then its attributes are read independently. Requiring the two
    // attributes to be adjacent and in order made this depend on how React happens to serialize a
    // tag, which is not part of any contract it publishes — a reordering or an inserted attribute
    // would fail a build whose page is correct, and a required check that reds on a correct build
    // costs more than the case it was guarding.
    const element = html.match(
      new RegExp(`<[a-zA-Z][a-zA-Z0-9-]*\\s[^>]*data-subpath="${quoted}"[^>]*>`)
    );
    if (element === null) {
      missing.push(entry.subpath);
      continue;
    }
    const exported = element[0].match(/data-exports="(\d+)"/);
    // A namespace with no bindings means the import resolved to something empty, which renders the
    // same as a real module and would otherwise read as a pass. An element carrying the subpath but
    // no count is the same absence of evidence.
    if (exported === null || Number(exported[1]) === 0)
      empty.push(entry.subpath);
  }

  if (missing.length > 0 || empty.length > 0) {
    if (missing.length > 0) {
      console.error(
        `The prerendered page does not report ${missing.join(", ")}, so ${missing.length === 1 ? "that subpath was" : "those subpaths were"} ` +
          `not imported by the Server Component that was built.`
      );
    }
    if (empty.length > 0) {
      console.error(
        `${empty.join(", ")} rendered with no exports, so the import resolved to an empty module.`
      );
    }
    process.exit(1);
  }

  // The CommonJS probe ran to completion. Checked here rather than by its own exit status, which
  // an artifact can set to 0 from inside the very import being checked.
  const sentinel = join(target, SENTINEL);
  if (!existsSync(sentinel)) {
    console.error(
      `${sentinel} does not exist, so the CommonJS probe did not reach the end of its run. An ` +
        `artifact that ends the process while it initializes would end a consumer's the same way.`
    );
    process.exit(1);
  }
  const reached = Number(readFileSync(sentinel, "utf8").trim());
  if (reached !== serverSafe.length) {
    console.error(
      `The CommonJS probe recorded ${reached} subpaths where ${serverSafe.length} are declared ` +
        `server-safe, so the two halves of this check are reading different sets.`
    );
    process.exit(1);
  }

  console.log(
    `Prerendered at build time, reporting all ${serverSafe.length} server-safe subpaths ` +
      `(${serverSafe.map(entry => entry.subpath).join(", ")}), and the CommonJS probe completed.`
  );
  process.exit(0);
}

/** The bare specifier a consumer writes for a subpath: `./color` is imported as `<pkg>/color`. */
const specifier = (subpath: string): string =>
  subpath === "." ? "@nextlyhq/ui" : `@nextlyhq/ui/${subpath.slice(2)}`;

// A NAMESPACE import, so this holds whatever each subpath exports without naming any binding. The
// alternative is a list of names per subpath, which is the hand-written list this file exists to
// avoid, one level down.
const imports = serverSafe
  .map(
    (entry, index) =>
      `import * as entry${index} from "${specifier(entry.subpath)}";`
  )
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
        // The attributes are what the verifier reads. Rendered text is separated by React comment
        // markers between adjacent expressions, so an attribute is the stable form.
        <p
          key={entry.subpath}
          data-subpath={entry.subpath}
          data-exports={entry.exports}
        >
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

// The export map publishes BOTH module systems, and only one of them is reachable from the page
// above: a static `import` resolves each subpath's `import` condition, so the `.cjs` targets are
// built, published, and never evaluated. Their wrappers are generated separately and can differ.
//
// Requiring them is not a simulation of a consumer, it is what a CommonJS consumer does — the same
// installed package, through the same export map's `require` condition, on the same Node. A `.cjs`
// file inside a `"type": "module"` package is CommonJS regardless of the manifest.
const requireCheck = `const assert = require("node:assert");
const { writeFileSync } = require("node:fs");
const { join } = require("node:path");

const subpaths = ${JSON.stringify(
  serverSafe.map(entry => specifier(entry.subpath)),
  null,
  2
)};

for (const subpath of subpaths) {
  const loaded = require(subpath);
  // A namespace with no bindings loads exactly like a real module and would otherwise pass.
  assert.ok(
    loaded && typeof loaded === "object" && Object.keys(loaded).length > 0,
    \`\${subpath} resolved through the require condition but exported nothing\`
  );
}

// Written LAST, and the workflow requires it. A module calling \`process.exit(0)\` while it
// initializes ends this process with a success status before the assertion above, the remaining
// subpaths, or this line ever run — so the exit code alone reports a pass for the one defect that
// stops the check from happening at all. Only reaching the end can produce this file.
writeFileSync(join(__dirname, "${SENTINEL}"), \`\${subpaths.length}\\n\`);

console.log(\`Required \${subpaths.length} server-safe subpaths through the CommonJS condition.\`);
`;

mkdirSync(join(target, "app"), { recursive: true });
writeFileSync(
  join(target, "package.json"),
  `${JSON.stringify(manifest, null, 2)}\n`
);
writeFileSync(join(target, "app", "page.jsx"), page);
writeFileSync(join(target, "app", "layout.jsx"), layout);
writeFileSync(join(target, "require-check.cjs"), requireCheck);

console.log(
  `Wrote a Server Component importing ${serverSafe.length} server-safe subpaths ` +
    `(${serverSafe.map(entry => entry.subpath).join(", ")}) to ${target}.`
);
