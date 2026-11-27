/**
 * Databases whose place is known, for every test that asks where a database
 * is: the CLI's rule and a running site's start-up role read the same
 * fixtures, so the two can be held to the same answer for each.
 *
 * Each names the URL as a project's `.env` would hold it, the environment
 * the driver reads beside it, and the answer.
 */
import type { DatabaseAddressInput, DatabasePlace } from "../database-place";

export interface DatabasePlaceFixture extends DatabaseAddressInput {
  /** What the database is, as a test names it. */
  name: string;
  place: DatabasePlace;
}

export const DATABASE_PLACE_FIXTURES: readonly DatabasePlaceFixture[] = [
  // On this machine.
  { name: "a SQLite file", url: "file:./data/nextly.db", place: "local" },
  {
    name: "a SQLite file named by its ending",
    url: "./app.sqlite",
    place: "local",
  },
  {
    name: "an in-memory SQLite database",
    url: "file::memory:",
    place: "local",
  },
  {
    name: "a PostgreSQL Unix socket (host parameter)",
    url: "postgresql://app@/shop?host=/var/run/postgresql",
    place: "local",
  },
  {
    name: "a PostgreSQL Unix socket (PGHOST)",
    url: "postgresql:///shop",
    env: { PGHOST: "/var/run/postgresql" },
    place: "local",
  },
  {
    name: "a MySQL Unix socket",
    url: "mysql://app@localhost/shop?socketPath=/tmp/mysql.sock",
    place: "local",
  },
  {
    name: "localhost",
    url: "postgresql://app:pw@localhost:5432/shop",
    place: "local",
  },
  {
    name: "LOCALHOST in capitals",
    url: "mysql://app:pw@LOCALHOST:3306/shop",
    place: "local",
  },
  {
    name: "127.0.0.1",
    url: "postgresql://app:pw@127.0.0.1:5432/shop",
    place: "local",
  },
  {
    name: "another loopback address",
    url: "postgresql://app:pw@127.0.0.2:5432/shop",
    place: "local",
  },
  { name: "::1", url: "postgresql://app:pw@[::1]:5432/shop", place: "local" },
  {
    name: "an IPv4 loopback written as IPv6",
    url: "postgresql://app:pw@[::ffff:127.0.0.1]:5432/shop",
    place: "local",
  },
  {
    name: "host.docker.internal",
    url: "mysql://app:pw@host.docker.internal:3306/shop",
    place: "local",
  },
  {
    name: "no host, so the driver's localhost",
    url: "postgresql:///shop",
    place: "local",
  },

  // Anywhere else.
  {
    name: "a remote host",
    url: "postgresql://sam:secret@db.prod.neon.tech:5432/app",
    place: "live",
  },
  {
    name: "a private network address (10.0.0.5)",
    url: "postgresql://app:pw@10.0.0.5:5432/shop",
    place: "live",
  },
  {
    name: "a private network address (172.17.0.2)",
    url: "mysql://app:pw@172.17.0.2:3306/shop",
    place: "live",
  },
  {
    name: "a Docker Compose service name",
    url: "postgresql://app:pw@db:5432/shop",
    place: "live",
  },
  {
    name: "a name that only starts like localhost",
    url: "postgresql://app:pw@localhost.example.com:5432/shop",
    place: "live",
  },
  {
    name: "a host parameter naming another server",
    url: "postgresql://app:pw@localhost:5432/shop?host=db.prod.neon.tech",
    place: "live",
  },
  {
    name: "no host, PGHOST naming another server",
    url: "postgresql:///shop",
    env: { PGHOST: "db.prod.neon.tech" },
    place: "live",
  },
  {
    name: "an address that cannot be read",
    url: "postgresql://app:p/w@localhost:5432/shop",
    place: "live",
  },
  {
    name: "a URL no dialect reads",
    url: "mongodb://localhost/shop",
    place: "live",
  },
  { name: "no URL", url: undefined, place: "live" },
];
