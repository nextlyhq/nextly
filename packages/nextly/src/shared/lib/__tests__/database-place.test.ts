/**
 * Where a database is: on this machine only for a SQLite database, a Unix
 * socket, `localhost`, a loopback address or `host.docker.internal`; live
 * for every other address, whatever mode the process runs in.
 *
 * What would separate the rule from a plausible broken one:
 * - a private address or a short service name counted as local (the wide
 *   rule this one replaced);
 * - a host matched by its start (`localhost.example.com`);
 * - the URL's host read while a `host` parameter or `PGHOST` sends the
 *   driver elsewhere;
 * - an unreadable address, or none, taken as local;
 * - `NODE_ENV` read at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { databasePlace, placeOf, readDatabaseAddress } from "../database-place";

import { DATABASE_PLACE_FIXTURES } from "./database-place-fixtures";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Every form the rule names, on this machine or not, and its answer. */
const REQUIRED_PLACE: Record<string, "local" | "live"> = {
  "a SQLite file": "local",
  "an in-memory SQLite database": "local",
  "a PostgreSQL Unix socket (host parameter)": "local",
  "a PostgreSQL Unix socket (PGHOST)": "local",
  "a MySQL Unix socket": "local",
  localhost: "local",
  "127.0.0.1": "local",
  "::1": "local",
  "host.docker.internal": "local",
  "a remote host": "live",
  "a private network address (10.0.0.5)": "live",
  "a private network address (172.17.0.2)": "live",
  "a Docker Compose service name": "live",
  "an address that cannot be read": "live",
  "no URL": "live",
};
const REQUIRED = Object.keys(REQUIRED_PLACE);

describe("where a database is", () => {
  it.each(DATABASE_PLACE_FIXTURES.map(fixture => [fixture.name, fixture]))(
    "%s",
    (_name, fixture) => {
      expect(databasePlace(fixture)).toBe(fixture.place);
    }
  );

  it("covers every form the rule names, each with its answer", () => {
    // Named one by one, so a list that lost any form fails here rather than
    // passing the loop above with one case fewer.
    const named = new Map(
      DATABASE_PLACE_FIXTURES.map(fixture => [fixture.name, fixture.place])
    );
    expect(
      Object.fromEntries(REQUIRED.map(name => [name, named.get(name)]))
    ).toEqual(
      Object.fromEntries(REQUIRED.map(name => [name, REQUIRED_PLACE[name]]))
    );
  });

  it.each(["development", "test", "production"])(
    "reads no mode: a remote database is live and a local one local under NODE_ENV=%s",
    mode => {
      vi.stubEnv("NODE_ENV", mode);
      const env = { NODE_ENV: mode };
      expect(
        databasePlace({
          url: "postgresql://sam:secret@db.example.com:5432/app",
          env,
        })
      ).toBe("live");
      expect(
        databasePlace({
          url: "postgresql://sam:secret@127.0.0.1:5432/app",
          env,
        })
      ).toBe("local");
    }
  );

  it("reads the server's address as its driver will, and nothing secret", () => {
    const address = readDatabaseAddress({
      url: "postgresql://app:pw@db.example.com:5432/shop?sslmode=require",
    });
    expect(address).toEqual({
      kind: "server",
      dialect: "postgresql",
      parts: { host: "db.example.com", port: "5432", database: "shop" },
      disagrees: false,
    });
    expect(placeOf(address)).toBe("live");
  });
});
