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

describe("where a database is", () => {
  it.each(DATABASE_PLACE_FIXTURES.map(fixture => [fixture.name, fixture]))(
    "%s",
    (_name, fixture) => {
      expect(databasePlace(fixture)).toBe(fixture.place);
    }
  );

  it("covers every local form and every live one the rule names", () => {
    // A fixture list that lost a side would pass the loop above with fewer cases.
    const places = DATABASE_PLACE_FIXTURES.map(fixture => fixture.place);
    expect(places.filter(place => place === "local").length).toBeGreaterThan(9);
    expect(places.filter(place => place === "live").length).toBeGreaterThan(9);
  });

  it.each(["development", "test", "production"])(
    "reads no mode: a remote database is live and a local one local under NODE_ENV=%s",
    mode => {
      vi.stubEnv("NODE_ENV", mode);
      const env = { NODE_ENV: mode };
      expect(
        databasePlace({ url: "postgresql://sam:secret@db.example.com:5432/app", env })
      ).toBe("live");
      expect(
        databasePlace({ url: "postgresql://sam:secret@127.0.0.1:5432/app", env })
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
    });
    expect(placeOf(address)).toBe("live");
  });
});
