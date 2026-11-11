/**
 * Fetching one of the site's pages as a crawler: every hop held to the site's
 * own addresses and to public network addresses, the connection made to the
 * very address that was checked, and every fetch stopped at 10 seconds, 5 MB
 * or 5 redirects.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { gzipSync } from "node:zlib";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchAs,
  LIMITS,
  nodeTransport,
  type Resolve,
  type Transport,
  type TransportRequest,
} from "../fetch";

const GOOGLEBOT = "Googlebot/2.1 (+http://www.google.com/bot.html)";

/** Servers started by a test, closed after it. */
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      server =>
        new Promise<void>(resolve => {
          server.closeAllConnections();
          server.close(() => resolve());
        })
    )
  );
});

/** A server on this machine answering with `handle`; its origin. */
async function serve(
  handle: (req: IncomingMessage, res: ServerResponse) => void
): Promise<string> {
  const server = createServer(handle);
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** A transport answering each address from `pages`, recording each request. */
function scripted(
  pages: Record<string, { status: number; headers?: Record<string, string> }>
): Transport & { asked: TransportRequest[] } {
  const asked: TransportRequest[] = [];
  const transport = (request: TransportRequest) => {
    asked.push(request);
    const page = pages[request.url.href] ?? { status: 404 };
    return Promise.resolve({
      kind: "answer" as const,
      status: page.status,
      headers: page.headers ?? {},
      body: `<title>${request.url.pathname}</title>`,
    });
  };
  return Object.assign(transport, { asked });
}

/** A resolver answering each name from `answers`. */
function resolving(answers: Record<string, string[]>): Resolve {
  return name =>
    Promise.resolve(
      (answers[name] ?? []).map(address => ({
        address,
        family: address.includes(":") ? (6 as const) : (4 as const),
      }))
    );
}

const SITE = ["https://rext.ai"];
const PUBLIC = { "rext.ai": ["93.184.216.34"] };

describe("the limits", () => {
  it("are 10 seconds, 5 MB and 5 redirects", () => {
    expect(LIMITS).toEqual({
      timeoutMs: 10_000,
      maxBytes: 5 * 1024 * 1024,
      maxRedirects: 5,
    });
  });
});

describe("fetching a page as a crawler", () => {
  it("reads the page as the crawler, following a redirect on the site", async () => {
    let agent: string | undefined;
    const origin = await serve((req, res) => {
      agent = req.headers["user-agent"];
      if (req.url === "/old") {
        res.writeHead(301, { location: "/new" }).end();
        return;
      }
      res
        .writeHead(200, { "content-type": "text/html", age: "120" })
        .end("<title>New</title>");
    });
    const fetched = await fetchAs(new URL(`${origin}/old`), GOOGLEBOT, {
      origins: [origin],
    });
    expect(fetched).toMatchObject({
      kind: "received",
      status: 200,
      url: `${origin}/new`,
      redirects: [`${origin}/new`],
      html: "<title>New</title>",
      headers: { age: "120" },
    });
    expect(agent).toBe(GOOGLEBOT);
  });

  it("refuses a redirect to another site, and never asks it", async () => {
    const transport = scripted({
      "https://rext.ai/pricing": {
        status: 302,
        headers: { location: "https://evil.example/steal" },
      },
    });
    const fetched = await fetchAs(
      new URL("https://rext.ai/pricing"),
      GOOGLEBOT,
      {
        origins: SITE,
        resolve: resolving({ ...PUBLIC, "evil.example": ["93.184.216.35"] }),
        transport,
      }
    );
    expect(fetched).toMatchObject({
      kind: "failed",
      reason: "other-site",
      message:
        "It redirected to https://evil.example/steal. That address is on another site, evil.example. Only rext.ai addresses can be checked.",
    });
    expect(transport.asked.map(request => request.url.href)).toEqual([
      "https://rext.ai/pricing",
    ]);
  });

  it.each([
    ["http://127.0.0.1/admin", "other-site"],
    ["http://169.254.169.254/latest/meta-data/", "other-site"],
    ["https://rext.ai:8443/", "port"],
    ["https://user:secret@rext.ai/", "credentials"],
    ["file:///etc/passwd", "scheme"],
  ])("refuses a redirect to %s (%s)", async (location, reason) => {
    const transport = scripted({
      "https://rext.ai/": { status: 307, headers: { location } },
    });
    const fetched = await fetchAs(new URL("https://rext.ai/"), GOOGLEBOT, {
      origins: SITE,
      resolve: resolving(PUBLIC),
      transport,
    });
    expect(fetched).toMatchObject({ kind: "failed", reason });
    expect(transport.asked).toHaveLength(1);
  });

  it("refuses a redirect to a page of the site whose name resolves to a private address", async () => {
    const origins = ["https://rext.ai", "https://intranet.rext.ai"];
    const transport = scripted({
      "https://rext.ai/": {
        status: 301,
        headers: { location: "https://intranet.rext.ai/" },
      },
    });
    const fetched = await fetchAs(new URL("https://rext.ai/"), GOOGLEBOT, {
      origins,
      resolve: resolving({ ...PUBLIC, "intranet.rext.ai": ["10.0.0.5"] }),
      transport,
    });
    expect(fetched).toMatchObject({ kind: "failed", reason: "private" });
    expect(transport.asked).toHaveLength(1);
  });

  it.each([
    [["127.0.0.1"]],
    [["10.1.2.3"]],
    [["169.254.169.254"]],
    [["::1"]],
    [["93.184.216.34", "192.168.0.10"]],
  ])(
    "refuses a site whose name resolves to %j, and connects nowhere",
    async answers => {
      const transport = scripted({});
      const fetched = await fetchAs(new URL("https://rext.ai/"), GOOGLEBOT, {
        origins: SITE,
        resolve: resolving({ "rext.ai": answers }),
        transport,
      });
      expect(fetched).toMatchObject({
        kind: "failed",
        reason: "private",
        message:
          "rext.ai points to an address inside a private network, so it can't be checked.",
      });
      expect(transport.asked).toHaveLength(0);
    }
  );

  it("connects to the address it checked, even where the name's answer changes after", async () => {
    // A name that answers a public address when checked and a private one
    // on any later lookup: the connection must go to what was checked.
    const answers = ["93.184.216.34", "127.0.0.1"];
    const resolve = vi.fn<Resolve>(() =>
      Promise.resolve([{ address: answers.shift() ?? "127.0.0.1", family: 4 }])
    );
    const transport = scripted({ "https://rext.ai/": { status: 200 } });
    const fetched = await fetchAs(new URL("https://rext.ai/"), GOOGLEBOT, {
      origins: SITE,
      resolve,
      transport,
    });
    expect(fetched).toMatchObject({ kind: "received", status: 200 });
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(transport.asked.map(request => request.ip)).toEqual([
      "93.184.216.34",
    ]);
  });

  it("follows 5 redirects and stops at the sixth", async () => {
    const origin = await serve((req, res) => {
      const at = Number(req.url?.slice(1) ?? "0");
      if (at < 6) res.writeHead(302, { location: `/${at + 1}` }).end();
      else res.writeHead(200).end("<title>Six</title>");
    });
    const five = await fetchAs(new URL(`${origin}/1`), GOOGLEBOT, {
      origins: [origin],
    });
    expect(five).toMatchObject({ kind: "received", url: `${origin}/6` });
    const six = await fetchAs(new URL(`${origin}/0`), GOOGLEBOT, {
      origins: [origin],
    });
    expect(six).toMatchObject({
      kind: "failed",
      reason: "too-many-redirects",
      message: "It redirected more than 5 times, so the check stopped.",
    });
  });

  it("stops a fetch that takes longer than its time", async () => {
    const origin = await serve(() => {
      // Never answers.
    });
    const started = Date.now();
    const fetched = await fetchAs(new URL(`${origin}/`), GOOGLEBOT, {
      origins: [origin],
      limits: { ...LIMITS, timeoutMs: 300 },
    });
    expect(fetched).toMatchObject({
      kind: "failed",
      reason: "too-slow",
      message:
        "The page didn't answer within 0.3 seconds, so the check stopped.",
    });
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("stops a page larger than its size, however it is sent", async () => {
    const origin = await serve((req, res) => {
      if (req.url === "/zipped") {
        // Small on the wire, large once unpacked.
        res
          .writeHead(200, { "content-encoding": "gzip" })
          .end(gzipSync(Buffer.alloc(50_000, 32)));
        return;
      }
      if (req.url === "/declared") {
        res.writeHead(200, { "content-length": "50000" });
        res.write("<title>");
        return;
      }
      // Sent in pieces with no declared length.
      res.writeHead(200);
      for (let piece = 0; piece < 50; piece++) res.write("x".repeat(1_000));
      res.end();
    });
    const limits = { ...LIMITS, maxBytes: 10_000 };
    for (const path of ["/zipped", "/declared", "/streamed"]) {
      const fetched = await fetchAs(new URL(`${origin}${path}`), GOOGLEBOT, {
        origins: [origin],
        limits,
      });
      expect(fetched, path).toMatchObject({
        kind: "failed",
        reason: "too-large",
        message:
          "The page is larger than 0.01 MB, so the check stopped reading it.",
      });
    }
    const small = await fetchAs(new URL(`${origin}/zipped`), GOOGLEBOT, {
      origins: [origin],
      limits: { ...LIMITS, maxBytes: 60_000 },
    });
    expect(small).toMatchObject({ kind: "received", status: 200 });
  });

  it("says when the site's name has no address", async () => {
    const fetched = await fetchAs(new URL("https://rext.ai/"), GOOGLEBOT, {
      origins: SITE,
      resolve: resolving({}),
      transport: scripted({}),
    });
    expect(fetched).toMatchObject({
      kind: "failed",
      reason: "no-answer",
      message:
        "rext.ai has no address in DNS, so the page couldn't be fetched.",
    });
  });
});

describe("the connection", () => {
  it("goes to the address it is given, never looking the name up again", async () => {
    let host: string | undefined;
    const origin = await serve((req, res) => {
      host = req.headers.host;
      res.writeHead(200).end("<title>Pinned</title>");
    });
    const port = new URL(origin).port;
    // `.invalid` never resolves: only the pinned address can be reached.
    const answer = await nodeTransport({
      url: new URL(`http://pinned.invalid:${port}/`),
      ip: "127.0.0.1",
      family: 4,
      headers: { "user-agent": GOOGLEBOT },
      signal: AbortSignal.timeout(5_000),
      maxBytes: 1_000,
    });
    expect(answer).toMatchObject({ kind: "answer", status: 200 });
    expect(host).toBe(`pinned.invalid:${port}`);
  });
});
