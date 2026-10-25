import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { configuredLocks } from "./support/configured-locks";
import { CLAIMED_DOCUMENT_LOCKS, documentsToFree } from "./support/test";

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

/**
 * Whether a spec opens a single's form, which claims the document: an admin
 * path that starts with the single, not the Schema Builder's route for it.
 */
function opensSingle(source: string, slug: string): boolean {
  return new RegExp(`["'\`]/singles/${slug}(?![a-z-])`).test(source);
}

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
      opensSingle(source, "homepage") ||
      (source.includes("singles/homepage") && /\.patch\(/.test(source)),
  },
  {
    lock: "siteSettings",
    what: "opens the site-settings form, which claims it",
    writes: source => opensSingle(source, "site-settings"),
  },
  {
    lock: "landingPage",
    what: "opens the landing-page form, which claims it",
    writes: source => opensSingle(source, "landing-page"),
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
  // The whole suite whichever server this run uses, so the dev server's own
  // specs are held too, and its JSON on stdout: a JSON output file named in
  // the environment would take it, leaving only "Listing tests" here.
  const env: NodeJS.ProcessEnv = { ...process.env, E2E_SERVER: "dev" };
  delete env.E2E_DEV_SPECS_ONLY;
  delete env.PLAYWRIGHT_JSON_OUTPUT_FILE;
  const listed = execFileSync(
    process.execPath,
    [cli, "test", "--list", "--reporter=json"],
    {
      cwd: join(TESTS, ".."),
      encoding: "utf8",
      env,
      maxBuffer: 64 * 1024 * 1024,
    }
  );
  const { suites } = JSON.parse(listed) as { suites: { file: string }[] };
  const self = fileURLToPath(import.meta.url);
  return [...new Set(suites.map(suite => join(TESTS, suite.file)))].filter(
    file => file !== self
  );
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
    WRITERS.find(w => w.lock === "siteSettings")?.writes(
      'await gotoAdmin(page, "/singles/site-settings");'
    )
  ).toBe(true);
  // The Schema Builder's route for a single is not its form.
  expect(
    WRITERS.find(w => w.lock === "homepage")?.writes(
      'path: "/builder/singles/homepage",'
    )
  ).toBe(false);
  expect(
    WRITERS.find(w => w.lock === "landingPage")?.writes(
      'await gotoAdmin(page, "/singles/landing-page");'
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

test("a file holding a claimed document's lock frees it before it starts", () => {
  // Every such file of this suite, read the way the suite's `test` reads it,
  // so a file added with one of these locks is held to it without being named.
  const files = suiteFiles();
  for (const lock of CLAIMED_DOCUMENT_LOCKS) {
    const holders = files.filter(file =>
      configuredLocks(readFileSync(file, "utf8"), file).has(lock)
    );
    expect(holders.length, `files holding LOCK.${lock}`).toBeGreaterThan(0);
    expect(
      holders.filter(
        file =>
          !documentsToFree(readFileSync(file, "utf8"), file).includes(lock)
      ),
      `files holding LOCK.${lock} that do not free it`
    ).toEqual([]);
  }
  // And a file without one of these locks frees nothing.
  expect(
    documentsToFree(
      "test.describe.configure({ lock: [LOCK.dashboard] });\n",
      "a.spec.ts"
    )
  ).toEqual([]);
});
