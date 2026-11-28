/**
 * A MySQL socket written relative to the project, where paths are Windows
 * paths: resolved against the folder, the socket's path takes the folder's
 * drive and backslashes, so it does not start with `/` as other socket paths
 * do. It is still this machine's database, and it is named without a port.
 */
import { win32 } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("node:path", async importOriginal => {
  const actual = await importOriginal<typeof import("node:path")>();
  return { ...actual, ...actual.win32, default: actual.win32 };
});

const { databasePlace, readDatabaseAddress } = await import(
  "../database-place"
);
const { databaseTarget } = await import("../../../cli/database-target");

const FOLDER = "D:\\srv\\app";
const URL = "mysql://app@localhost/shop?socketPath=./run/mysql.sock";

describe("a relative MySQL socket on Windows paths", () => {
  it("is resolved to a path on the project's drive", () => {
    const address = readDatabaseAddress({ url: URL, folder: FOLDER });
    expect(address).toMatchObject({
      kind: "server",
      parts: { host: win32.resolve(FOLDER, "run/mysql.sock"), socket: true },
    });
  });

  it("is this machine's database", () => {
    expect(databasePlace({ url: URL, folder: FOLDER })).toBe("local");
  });

  it("is named by its path, with no port", () => {
    expect(databaseTarget({ url: URL, folder: FOLDER })).toMatchObject({
      target: `${win32.resolve(FOLDER, "run/mysql.sock")}/shop`,
      place: "local",
    });
  });
});
