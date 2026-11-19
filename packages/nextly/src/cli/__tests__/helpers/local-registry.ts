/**
 * A package registry inside the test process: an HTTP server that answers
 * the two requests a package manager makes of one, a package's document
 * (its versions and dist-tags) and a version's tarball.
 *
 * The packages it serves are made here, each a `package.json` and nothing
 * else, so an install takes a moment and touches no network. A test says
 * which releases exist and which tag names which, and can make one tarball
 * fail to download, which is how a registry fails part-way through an
 * install.
 *
 * Allocated per test and closed by it (`close`).
 */
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

/** One package the registry serves: its versions, and the tags naming them. */
export interface RegistryPackage {
  name: string;
  versions: readonly string[];
  /** A dist-tag and the version it names: `{ alpha: "0.0.2-alpha.2" }`. */
  tags: Readonly<Record<string, string>>;
  /** Extra `package.json` fields of every version, such as `scripts`. */
  manifest?: Readonly<Record<string, unknown>>;
}

export interface LocalRegistry {
  /** The registry's address, with no trailing slash: `http://127.0.0.1:41873`. */
  url: string;
  /** Every tarball request served or refused since the start, as `name@version`. */
  downloads: string[];
  /** Makes every later download of this tarball answer 500; `undefined` lifts it. */
  failDownloadOf: (spec: string | undefined) => void;
  close: () => Promise<void>;
}

/** A 512-byte tar header for a regular file. */
function tarHeader(path: string, size: number): Buffer {
  const header = Buffer.alloc(512);
  const field = (value: string, offset: number, length: number) => {
    header.write(value.padEnd(length, "\0").slice(0, length), offset, "latin1");
  };
  field(path, 0, 100);
  field("0000644\0", 100, 8);
  field("0000000\0", 108, 8);
  field("0000000\0", 116, 8);
  field(`${size.toString(8).padStart(11, "0")}\0`, 124, 12);
  field("00000000000\0", 136, 12);
  // The checksum is taken with its own field read as spaces.
  field("        ", 148, 8);
  field("0", 156, 1);
  field("ustar\0", 257, 6);
  field("00", 263, 2);
  const sum = header.reduce((total, byte) => total + byte, 0);
  field(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
  return header;
}

/** A package tarball holding `package/package.json` alone. */
function tarballOf(manifest: Record<string, unknown>): Buffer {
  const body = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  const padding = Buffer.alloc((512 - (body.length % 512)) % 512);
  return gzipSync(
    Buffer.concat([
      tarHeader("package/package.json", body.length),
      body,
      padding,
      // Two empty blocks end an archive.
      Buffer.alloc(1024),
    ])
  );
}

/** `@scope/name` and `name` alike, as the last part of a tarball's file name. */
const baseName = (name: string) => name.split("/").pop() ?? name;

/** Starts a registry serving `packages` on a free local port. */
export async function startLocalRegistry(
  packages: readonly RegistryPackage[]
): Promise<LocalRegistry> {
  const downloads: string[] = [];
  let failing: string | undefined;
  const byName = new Map(packages.map(pkg => [pkg.name, pkg]));

  const manifestOf = (pkg: RegistryPackage, version: string) => ({
    name: pkg.name,
    version,
    ...pkg.manifest,
  });

  const server: Server = createServer((request, response) => {
    const address = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    const path = decodeURIComponent(
      (request.url ?? "/").split("?")[0] ?? "/"
    ).replace(/^\/+/, "");
    const send = (status: number, body: Buffer | string, type: string) => {
      response.writeHead(status, { "content-type": type });
      response.end(body);
    };

    // `<name>/-/<base>-<version>.tgz`: one version's tarball.
    const tarball = /^(.+)\/-\/[^/]+-(\d[^/]*)\.tgz$/.exec(path);
    if (tarball) {
      const [, name = "", version = ""] = tarball;
      const pkg = byName.get(name);
      downloads.push(`${name}@${version}`);
      if (!pkg?.versions.includes(version)) {
        send(404, "{}", "application/json");
        return;
      }
      if (failing === `${name}@${version}`) {
        send(500, "the registry could not serve this file", "text/plain");
        return;
      }
      send(
        200,
        tarballOf(manifestOf(pkg, version)),
        "application/octet-stream"
      );
      return;
    }

    // `<name>`: the package's document.
    const pkg = byName.get(path);
    if (!pkg) {
      send(404, JSON.stringify({ error: "Not found" }), "application/json");
      return;
    }
    const versions = Object.fromEntries(
      pkg.versions.map(version => {
        const file = tarballOf(manifestOf(pkg, version));
        return [
          version,
          {
            ...manifestOf(pkg, version),
            dist: {
              tarball: `${address}/${pkg.name}/-/${baseName(pkg.name)}-${version}.tgz`,
              shasum: createHash("sha1").update(file).digest("hex"),
              integrity: `sha512-${createHash("sha512").update(file).digest("base64")}`,
            },
          },
        ];
      })
    );
    send(
      200,
      JSON.stringify({
        name: pkg.name,
        "dist-tags": pkg.tags,
        versions,
        time: Object.fromEntries(
          pkg.versions.map(version => [version, "2026-01-01T00:00:00.000Z"])
        ),
      }),
      "application/json"
    );
  });

  await new Promise<void>(resolve => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    downloads,
    failDownloadOf: spec => {
      failing = spec;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close(error => (error ? reject(error) : resolve()));
      }),
  };
}
