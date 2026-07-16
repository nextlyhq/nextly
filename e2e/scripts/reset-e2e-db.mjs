// Empties the browser suite's database before the server opens it.
//
// Runs from the webServer command rather than globalSetup, which Playwright
// starts only once the server is already up and holding the file.
//
// Deletes by an exact allow-list of names. The suite's whole licence to delete
// things rests on it never being pointed at a database anyone wanted, and a
// glob here — or a path assembled from an env var — is how that stops being
// true.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(HERE, "..", "..", "apps", "playground", "data");

// sqlite in WAL mode keeps two sidecar files. Leaving them behind restores
// pages from the previous run into a database meant to be empty.
const FILES = ["e2e.db", "e2e.db-shm", "e2e.db-wal"];

const DEV_DB = "nextly.db";

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  for (const name of FILES) {
    if (name.includes(DEV_DB)) {
      throw new Error(`Refusing to delete the development database: ${name}`);
    }
    await fs.rm(path.join(DATA_DIR, name), { force: true });
  }

  console.log(`[e2e] Reset ${path.join(DATA_DIR, FILES[0])}`);
}

await main();
