import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  createPinnedLookup,
  ExternalUrlError,
  safeFetch,
  SafeFetchError,
  validateExternalUrl,
} from "./validate-external-url";

// Record the options passed to node:http.request so a test can prove safeFetch
// supplies the pinned `lookup` (the ESM namespace can't be spied directly).
const { requestCalls } = vi.hoisted(() => ({
  requestCalls: [] as Array<Record<string, unknown>>,
}));

vi.mock("node:http", async importOriginal => {
  const actual = await importOriginal<typeof import("node:http")>();
  return {
    ...actual,
    request(
      url: string | URL,
      options: import("node:http").RequestOptions,
      callback?: (res: import("node:http").IncomingMessage) => void
    ) {
      requestCalls.push(options as Record<string, unknown>);
      return actual.request(url, options, callback);
    },
  };
});

// ---------------------------------------------------------------------------
// createPinnedLookup — the core DNS-rebinding defense. It must always yield the
// pinned address regardless of the hostname the connection asks to resolve.
// ---------------------------------------------------------------------------

describe("createPinnedLookup", () => {
  it("returns the pinned address in (address, family) form when `all` is falsy", () => {
    const lookup = createPinnedLookup("93.184.216.34", 4);
    let result: { address: unknown; family: unknown } | undefined;
    lookup("example.com", { all: false }, (err, address, family) => {
      expect(err).toBeNull();
      result = { address, family };
    });
    expect(result).toEqual({ address: "93.184.216.34", family: 4 });
  });

  it("returns the pinned address in array form when `all` is true", () => {
    const lookup = createPinnedLookup("2606:2800:220:1:248:1893:25c8:1946", 6);
    let result: unknown;
    lookup("example.com", { all: true }, (err, address) => {
      expect(err).toBeNull();
      result = address;
    });
    expect(result).toEqual([
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  });

  it("ignores the requested hostname (rebinding cannot change the target)", () => {
    // Even if a hostile resolver hands back a private IP for the hostname at
    // connect time, the pinned lookup answers with the vetted address only.
    const lookup = createPinnedLookup("93.184.216.34", 4);
    let address: unknown;
    lookup("attacker-rebind.internal", { all: false }, (_e, addr) => {
      address = addr;
    });
    expect(address).toBe("93.184.216.34");
  });
});

// ---------------------------------------------------------------------------
// validateExternalUrl — the pre-connect gate (no network for literal IPs).
// ---------------------------------------------------------------------------

describe("validateExternalUrl", () => {
  it("rejects the cloud-metadata IP", async () => {
    await expect(
      validateExternalUrl("https://169.254.169.254/latest/meta-data/")
    ).rejects.toBeInstanceOf(ExternalUrlError);
  });

  it("rejects a private RFC1918 literal", async () => {
    await expect(
      validateExternalUrl("https://10.1.2.3/")
    ).rejects.toBeInstanceOf(ExternalUrlError);
  });

  it("rejects a cloud-metadata hostname before DNS", async () => {
    await expect(
      validateExternalUrl("https://metadata.google.internal/")
    ).rejects.toBeInstanceOf(ExternalUrlError);
  });

  it("rejects plain http by default", async () => {
    await expect(
      validateExternalUrl("http://93.184.216.34/")
    ).rejects.toBeInstanceOf(ExternalUrlError);
  });

  it("accepts a public IP literal and pins it", async () => {
    const validated = await validateExternalUrl("https://93.184.216.34/path");
    expect(validated.pinnedIp).toBe("93.184.216.34");
    expect(validated.family).toBe(4);
  });

  it("allows loopback + http only under allowLocalhost", async () => {
    const validated = await validateExternalUrl("http://127.0.0.1:8080/", {
      allowLocalhost: true,
    });
    expect(validated.pinnedIp).toBe("127.0.0.1");
    await expect(
      validateExternalUrl("http://127.0.0.1:8080/")
    ).rejects.toBeInstanceOf(ExternalUrlError);
  });

  it("rejects an IPv4-mapped IPv6 loopback literal (URL hex-normalized)", async () => {
    // new URL normalizes [::ffff:127.0.0.1] to ::ffff:7f00:1; the mapped IPv4
    // (127.0.0.1) must still be caught by the private-IP denylist.
    await expect(
      validateExternalUrl("https://[::ffff:127.0.0.1]/")
    ).rejects.toBeInstanceOf(ExternalUrlError);
  });

  it("rejects an IPv4-mapped IPv6 private literal", async () => {
    await expect(
      validateExternalUrl("https://[::ffff:10.0.0.1]/")
    ).rejects.toBeInstanceOf(ExternalUrlError);
  });
});

// ---------------------------------------------------------------------------
// safeFetch — end-to-end against a loopback server (allowLocalhost).
// ---------------------------------------------------------------------------

interface Harness {
  base: string;
  /** Total requests the server actually received. */
  hits(): number;
  /** Requests received per path. */
  pathHits(path: string): number;
}

let server: Server | undefined;

afterEach(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = undefined;
  }
});

async function startServer(
  handler: (
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    counters: { total: number; byPath: Map<string, number> }
  ) => void
): Promise<Harness> {
  const counters = { total: 0, byPath: new Map<string, number>() };
  server = createServer((req, res) => {
    counters.total += 1;
    const path = req.url ?? "/";
    counters.byPath.set(path, (counters.byPath.get(path) ?? 0) + 1);
    handler(req, res, counters);
  });
  await new Promise<void>(resolve => server!.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}`,
    hits: () => counters.total,
    pathHits: p => counters.byPath.get(p) ?? 0,
  };
}

const local = { allowLocalhost: true } as const;

describe("safeFetch", () => {
  it("fetches a 200 response body over the pinned socket", async () => {
    const h = await startServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("hello world");
    });
    const response = await safeFetch(`${h.base}/`, local);
    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(await response.text()).toBe("hello world");
    expect(response.headers.get("content-type")).toBe("text/plain");
  });

  it("forwards method, headers, and body", async () => {
    const h = await startServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        res.writeHead(201, { "x-echo-auth": req.headers.authorization ?? "" });
        res.end(`${req.method}:${Buffer.concat(chunks).toString()}`);
      });
    });
    const response = await safeFetch(`${h.base}/submit`, {
      ...local,
      method: "POST",
      headers: { authorization: "Bearer t0ken", "content-type": "text/plain" },
      body: "payload-body",
    });
    expect(response.status).toBe(201);
    expect(await response.text()).toBe("POST:payload-body");
    expect(response.headers.get("x-echo-auth")).toBe("Bearer t0ken");
  });

  it("decodes a gzip-encoded response body", async () => {
    // node:http returns raw wire bytes; safeFetch must inflate to match fetch.
    const { gzipSync } = await import("node:zlib");
    const h = await startServer((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(gzipSync(Buffer.from("compressed payload")));
    });
    const response = await safeFetch(`${h.base}/`, local);
    expect(await response.text()).toBe("compressed payload");
    // The wire content-encoding/-length describe the compressed bytes; after
    // decoding they would misdescribe the returned body, so they are dropped.
    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
  });

  it("reports an over-cap decompressed body as response-too-large", async () => {
    const { gzipSync } = await import("node:zlib");
    // Small on the wire, but inflates to 4000 bytes; the 1000-byte cap trips
    // the zlib maxOutputLength guard, which must classify as response-too-large.
    const wire = gzipSync(Buffer.alloc(4000, 0x61));
    const h = await startServer((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end(wire);
    });
    await expect(
      safeFetch(`${h.base}/`, { ...local, maxResponseBytes: 1000 })
    ).rejects.toMatchObject({
      name: "SafeFetchError",
      reason: "response-too-large",
    });
  });

  it("does not fail an empty body that carries a content-encoding", async () => {
    // Inflating zero bytes throws; an empty encoded 2xx must stay a success.
    const h = await startServer((_req, res) => {
      res.writeHead(200, { "content-encoding": "gzip" });
      res.end();
    });
    const response = await safeFetch(`${h.base}/`, local);
    expect(response.ok).toBe(true);
    expect(await response.text()).toBe("");
  });

  it("strips a caller-supplied Host header (no vhost override)", async () => {
    // A forwarded Host could route to an internal vhost behind the validated
    // public IP; it must be derived from the URL, not the caller's headers.
    let receivedHost: string | undefined;
    const h = await startServer((req, res) => {
      receivedHost = req.headers.host;
      res.writeHead(200);
      res.end("ok");
    });
    const port = new URL(h.base).port;
    await safeFetch(`${h.base}/`, {
      ...local,
      headers: { Host: "evil.internal", "x-keep": "1" },
    });
    expect(receivedHost).toBe(`127.0.0.1:${port}`);
  });

  it("frames fixed-length bodies with content-length, never chunked", async () => {
    let contentLength: string | undefined;
    let transferEncoding: string | undefined;
    const h = await startServer((req, res) => {
      contentLength = req.headers["content-length"];
      transferEncoding = req.headers["transfer-encoding"];
      req.on("data", () => {});
      req.on("end", () => {
        res.writeHead(200);
        res.end("ok");
      });
    });
    // A wrongly-cased, wrong-value caller Content-Length must be overridden
    // with the real byte length, and no chunked encoding may be sent.
    await safeFetch(`${h.base}/`, {
      ...local,
      method: "POST",
      headers: { "Content-Length": "999" },
      body: "hello",
    });
    expect(contentLength).toBe("5");
    expect(transferEncoding).toBeUndefined();
  });

  it("decodes stacked content-encodings (br, gzip)", async () => {
    const { gzipSync, brotliCompressSync } = await import("node:zlib");
    // Encodings listed in apply order: br first, then gzip -> wire = gzip(br(x)).
    const wire = gzipSync(brotliCompressSync(Buffer.from("stacked payload")));
    const h = await startServer((_req, res) => {
      res.writeHead(200, { "content-encoding": "br, gzip" });
      res.end(wire);
    });
    const response = await safeFetch(`${h.base}/`, local);
    expect(await response.text()).toBe("stacked payload");
  });

  it("does not follow redirects (returns the 3xx as-is)", async () => {
    const h = await startServer((req, res) => {
      if (req.url === "/redirect") {
        res.writeHead(302, { location: "/target" });
        res.end();
        return;
      }
      res.writeHead(200);
      res.end("target reached");
    });
    const response = await safeFetch(`${h.base}/redirect`, local);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/target");
    // The redirect target must never be contacted.
    expect(h.pathHits("/target")).toBe(0);
  });

  it("rejects an over-large response body", async () => {
    const h = await startServer((_req, res) => {
      res.writeHead(200);
      res.end(Buffer.alloc(5000, 0x61));
    });
    await expect(
      safeFetch(`${h.base}/big`, { ...local, maxResponseBytes: 1000 })
    ).rejects.toMatchObject({
      name: "SafeFetchError",
      reason: "response-too-large",
    });
  });

  it("rejects when the overall deadline elapses", async () => {
    const h = await startServer((_req, _res) => {
      // Never respond; hold the connection open until teardown.
    });
    await expect(
      safeFetch(`${h.base}/slow`, { ...local, timeoutMs: 60 })
    ).rejects.toMatchObject({ name: "SafeFetchError", reason: "timeout" });
  });

  it("wires the pinned lookup into the underlying request (not global fetch)", async () => {
    // Directly proves safeFetch supplies a custom lookup that yields the
    // validated address: the suite would otherwise pass even if safeFetch
    // reverted to global fetch or dropped the lookup (which reopens rebinding).
    requestCalls.length = 0;
    const h = await startServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    const response = await safeFetch(`${h.base}/`, local);
    expect(response.status).toBe(200);
    expect(requestCalls).toHaveLength(1);
    const lookup = requestCalls[0].lookup;
    expect(typeof lookup).toBe("function");
    const pinnedLookup = lookup as (
      hostname: string,
      options: { all?: boolean },
      callback: (err: Error | null, address: string, family: number) => void
    ) => void;
    const pinned = await new Promise<{ address: string; family: number }>(
      resolve =>
        pinnedLookup(
          "anything.example",
          { all: false },
          (_e, address, family) => resolve({ address, family })
        )
    );
    expect(pinned).toEqual({ address: "127.0.0.1", family: 4 });
  });

  it("rejects a private IP before connecting (never dials the server)", async () => {
    const h = await startServer((_req, res) => {
      res.writeHead(200);
      res.end("should not be reached");
    });
    // http protocol allowed, but loopback is a non-public IP without
    // allowLocalhost, so validation must refuse before any socket opens.
    await expect(
      safeFetch(`${h.base}/`, { allowedProtocols: ["http:"] })
    ).rejects.toBeInstanceOf(ExternalUrlError);
    expect(h.hits()).toBe(0);
  });
});
