import { expect, test } from "@playwright/test";
import { readdirSync, readFileSync } from "node:fs";
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

/** Every spec file this config runs. */
function specs(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory())
      return entry.name === "production" ? [] : specs(path);
    return entry.name.endsWith(".spec.ts") ? [path] : [];
  });
}

test("every spec that writes shared state holds its lock", () => {
  const files = specs(TESTS);
  // Read before judged: an empty list would pass with nothing checked.
  expect(files.length).toBeGreaterThan(50);
  const unlocked = files.flatMap(file => {
    const source = readFileSync(file, "utf8");
    return WRITERS.filter(
      ({ writes, lock }) => writes(source) && !source.includes(`LOCK.${lock}`)
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
