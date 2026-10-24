import { parseSource, walk } from "@nextlyhq/module-specifiers/parse-source";
import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Every spec that writes shared state holds that state's lock
 * (`support/locks.ts`).
 *
 * Two workers run two spec files at once, and a lock keeps apart only the files
 * that name it: a writer added without one runs beside the specs that hold it,
 * and the failure lands on whichever spec reads the state, naming neither. So
 * the writes that are easy to recognise are recognised here, and a spec making
 * one without the lock fails this test rather than a test somewhere else.
 *
 * Recognised by what the source does, so it errs towards asking for a lock: a
 * spec that only reads the layout and deletes a post also has to hold the
 * dashboard lock, which costs it parallelism, never correctness. Readers that
 * assert shared state as a whole need the lock too, and no pattern finds those:
 * the guide in `support/locks.ts` is for them.
 */

const TESTS = dirname(fileURLToPath(import.meta.url));

/** What writes each piece of shared state, as it appears in a spec's source. */
const WRITERS: {
  lock: string;
  writes: (source: string) => boolean;
  what: string;
}[] = [
  {
    lock: "dashboard",
    what: "writes the dashboard layout",
    writes: source =>
      source.includes("dashboard/layout") &&
      /request\.(put|delete)\(/.test(source),
  },
  {
    lock: "homepage",
    what: "edits the homepage",
    writes: source =>
      /\bopenEditorWith\(/.test(source) ||
      (source.includes("singles/homepage") && /\.patch\(/.test(source)),
  },
  {
    lock: "schema",
    what: "creates a collection at runtime",
    writes: source => /\bcreateRuntimeCollection\(/.test(source),
  },
  {
    lock: "ownServer",
    what: "starts its own dev server",
    writes: source => source.includes("playground-dev-server"),
  },
];

/**
 * Every test file this config runs, as Playwright itself resolves them: its
 * own `--list`, so the files match whatever `testMatch` and `testIgnore` say,
 * `.test.ts` files and every other suffix included. This file is left out:
 * its self-tests spell writes as strings, and it writes nothing.
 */
function suiteFiles(): string[] {
  const require = createRequire(import.meta.url);
  const cli = join(
    dirname(require.resolve("@playwright/test/package.json")),
    "cli.js"
  );
  const listed = execFileSync(
    process.execPath,
    [cli, "test", "--list", "--reporter=json"],
    { cwd: join(TESTS, ".."), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
  );
  const { suites } = JSON.parse(listed) as { suites: { file: string }[] };
  const self = fileURLToPath(import.meta.url);
  return [...new Set(suites.map(suite => join(TESTS, suite.file)))].filter(
    file => file !== self
  );
}

/**
 * The locks a spec actually configures: each `LOCK.<name>` in the `lock` array
 * of a `test.describe.configure({ ... })` call, read from the parsed source.
 * Not the constant appearing anywhere: an import, a comment or a configure call
 * that was never written would otherwise pass while Playwright schedules the
 * file with no lock at all.
 */
function configuredLocks(source: string, file: string): Set<string> {
  const { program } = parseSource(source, file);
  const locks = new Set<string>();
  walk(program, node => {
    if (node.type !== "CallExpression") return;
    const callee = source.slice(node.callee.start, node.callee.end);
    if (callee !== "test.describe.configure") return;
    for (const name of lockNames(node.arguments[0])) locks.add(name);
  });
  return locks;
}

/** The node types `lockNames` reads, as oxc names them. */
type Parsed = Parameters<Parameters<typeof walk>[1]>[0];

/** The `LOCK.<name>` names in the `lock` array of a configure call's options. */
function lockNames(options: Parsed | undefined): string[] {
  if (options?.type !== "ObjectExpression") return [];
  return options.properties.flatMap(property =>
    property.type === "Property" &&
    property.key.type === "Identifier" &&
    property.key.name === "lock" &&
    property.value.type === "ArrayExpression"
      ? property.value.elements.flatMap(lockMember)
      : []
  );
}

/** The name in one `LOCK.<name>` element, or none for anything else. */
function lockMember(element: Parsed | null): string[] {
  if (element?.type !== "MemberExpression") return [];
  const { object, property } = element;
  return object.type === "Identifier" &&
    object.name === "LOCK" &&
    property.type === "Identifier"
    ? [property.name]
    : [];
}

test("every spec that writes shared state holds its lock", () => {
  const files = suiteFiles();
  // Read before judged: an empty list would pass with nothing checked.
  expect(files.length).toBeGreaterThan(50);
  const unlocked = files.flatMap(file => {
    const source = readFileSync(file, "utf8");
    const held = configuredLocks(source, file);
    return WRITERS.filter(
      ({ writes, lock }) => writes(source) && !held.has(lock)
    ).map(
      ({ lock, what }) =>
        `${relative(TESTS, file)} ${what} without LOCK.${lock}`
    );
  });
  expect(unlocked).toEqual([]);
});

test("recognises each kind of write it is there for", () => {
  // Each rule against a source that makes the write: a rule that matched
  // nothing would leave its lock unenforced while this file stayed green.
  expect(
    WRITERS.find(w => w.lock === "dashboard")?.writes(
      'page.request.put("/admin/api/dashboard/layout")'
    )
  ).toBe(true);
  expect(
    WRITERS.find(w => w.lock === "dashboard")?.writes(
      'page.request.get("/admin/api/dashboard/layout")'
    )
  ).toBe(false);
  expect(
    WRITERS.find(w => w.lock === "homepage")?.writes(
      "await openEditorWith(page, NODES)"
    )
  ).toBe(true);
  expect(
    WRITERS.find(w => w.lock === "schema")?.writes(
      "await createRuntimeCollection(api, slug)"
    )
  ).toBe(true);
  expect(
    WRITERS.find(w => w.lock === "ownServer")?.writes(
      'from "../support/playground-dev-server"'
    )
  ).toBe(true);
});

test("reads the locks a spec configures, not the constant anywhere", () => {
  const read = (source: string) => [...configuredLocks(source, "a.spec.ts")];
  // The constant imported and named, but no lock configured: Playwright holds none.
  expect(
    read(`import { LOCK } from "./support/locks";\n// takes LOCK.dashboard\n`)
  ).toEqual([]);
  expect(
    read(`// test.describe.configure({ lock: [LOCK.dashboard] });\n`)
  ).toEqual([]);
  expect(
    read(
      `test.describe.configure({ mode: "serial", lock: [LOCK.usersRoles, LOCK.email] });\n`
    )
  ).toEqual(["usersRoles", "email"]);
});
