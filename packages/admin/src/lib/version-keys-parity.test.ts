/**
 * The keys the admin sends with a save are the server's own.
 *
 * Read from what the server tells a client that sent none: the refusal of a
 * bulk update without versions names each key it takes. Its module is loaded
 * at run time, by a path the type checker doesn't follow: it imports the
 * server's database code, which the admin's bundle must never reach. A rename
 * on the server fails here rather than leaving every admin save sending a key
 * the server ignores.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import {
  DOCUMENT_OVERWRITE_KEY,
  DOCUMENT_REVS_KEY,
  DOCUMENT_VERSION_KEY,
  STALE_VERSION_CODE,
  STALE_VERSION_STATUS,
} from "./document-version";

// Joined from this file's own folder: the bundler rewrites a
// `new URL(path, import.meta.url)` into a URL it serves.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, "../../../nextly/src");
const SERVER_STALE_VERSION = path.join(
  SERVER,
  "domains/versions/stale-version.ts"
);
const SERVER_ERROR_CODES = path.join(SERVER, "errors/error-codes.ts");

describe("the keys the admin sends with a save", () => {
  let server: {
    version: unknown;
    overwrite: unknown;
    revs: unknown;
    staleStatus: unknown;
  };
  beforeAll(async () => {
    const stale = (await import(/* @vite-ignore */ SERVER_STALE_VERSION)) as {
      versionRequiredFor: (bulk: "ids") => {
        publicData?: Record<string, unknown>;
      };
    };
    const keys = stale.versionRequiredFor("ids").publicData ?? {};
    const codes = (await import(/* @vite-ignore */ SERVER_ERROR_CODES)) as {
      NEXTLY_ERROR_STATUS: Record<string, unknown>;
    };
    server = {
      version: keys.versionKey,
      overwrite: keys.overwriteKey,
      revs: keys.revsKey,
      staleStatus: codes.NEXTLY_ERROR_STATUS[STALE_VERSION_CODE],
    };
  }, 60_000);

  it("are the server's own", () => {
    expect({
      version: DOCUMENT_VERSION_KEY,
      overwrite: DOCUMENT_OVERWRITE_KEY,
      revs: DOCUMENT_REVS_KEY,
      staleStatus: STALE_VERSION_STATUS,
    }).toEqual(server);
  });
});
