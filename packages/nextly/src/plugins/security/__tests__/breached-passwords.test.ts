/**
 * The breached-password check a plugin asks for with `breached: true`.
 *
 * Only a 20-bit prefix of the password's SHA-1 leaves the process, a range
 * service is reached only over `https` and asked for padded answers, and a
 * source that fails or never answers leaves the password unchecked rather
 * than refused or vouched for.
 */
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { BreachedPasswordsConfig } from "../../../shared/types/config";
import { breachedPasswordsWarnings } from "../breached-passwords";
import { createPasswordHelper } from "../password-helper";

const PASSWORD = "a password that is long enough";
const SHA1 = createHash("sha1").update(PASSWORD).digest("hex").toUpperCase();
const PREFIX = SHA1.slice(0, 5);
const SUFFIX = SHA1.slice(5);

/** A fetch that records each request and answers with `body`. */
function recordingFetch(body: string, status = 200) {
  const requests: Array<{ url: string; headers: Record<string, string> }> = [];
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    requests.push({
      url,
      headers: Object.fromEntries(new Headers(init.headers).entries()),
    });
    return new Response(body, { status });
  });
  return { fetch, requests };
}

function check(
  breachedPasswords: BreachedPasswordsConfig | undefined,
  fetch?: (url: string, init: RequestInit) => Promise<Response>
) {
  return createPasswordHelper({
    breachedPasswords,
    logger: { warn: vi.fn() },
    fetch,
  }).check(PASSWORD, { breached: true });
}

describe("asking the site's source", () => {
  it("refuses a password the source reports", async () => {
    const range = vi.fn(async () => [
      "0000000000000000000000000000000000A",
      SUFFIX,
    ]);
    expect(await check({ source: { range } })).toEqual({
      ok: false,
      reason: "breached",
    });
    expect(range).toHaveBeenCalledWith(PREFIX);
  });

  it("passes a password the source does not report", async () => {
    const range = async () => ["0000000000000000000000000000000000A"];
    expect(await check({ source: { range } })).toEqual({
      ok: true,
      breachedCheck: "passed",
    });
  });

  it("leaves the password unchecked when the source fails", async () => {
    const range = async (): Promise<readonly string[]> => {
      throw new Error("the list is offline");
    };
    expect(await check({ source: { range } })).toEqual({
      ok: true,
      breachedCheck: "unavailable",
    });
  });

  it.each([
    ["an entry that is not a string", [null, SUFFIX]],
    ["one string rather than a list", SUFFIX],
    ["no list at all", { entries: [SUFFIX] }],
  ])(
    "leaves the password unchecked when the source answers %s",
    async (_, answer) => {
      // A source written in JavaScript, or one passing on a provider's decoded
      // answer, can hand back anything its type says it will not.
      const range = (async () => answer) as unknown as () => Promise<
        readonly string[]
      >;
      expect(await check({ source: { range } })).toEqual({
        ok: true,
        breachedCheck: "unavailable",
      });
    }
  );

  it("leaves the password unchecked when the source never answers in time", async () => {
    const range = () => new Promise<readonly string[]>(() => {});
    const started = performance.now();
    expect(await check({ source: { range }, timeoutMs: 50 })).toEqual({
      ok: true,
      breachedCheck: "unavailable",
    });
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("does not ask at all unless the plugin asks for the check", async () => {
    const range = vi.fn(async () => [SUFFIX]);
    const result = await createPasswordHelper({
      breachedPasswords: { source: { range } },
      logger: { warn: vi.fn() },
    }).check(PASSWORD);
    expect(result).toEqual({ ok: true, breachedCheck: "skipped" });
    expect(range).not.toHaveBeenCalled();
  });
});

describe("a range service over https", () => {
  it("receives only the 20-bit prefix, and the request for padded answers", async () => {
    const { fetch, requests } = recordingFetch(`${SUFFIX}:12\r\n`);
    expect(
      await check({ source: { url: "https://ranges.example/range/" } }, fetch)
    ).toEqual({ ok: false, reason: "breached" });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(`https://ranges.example/range/${PREFIX}`);
    expect(requests[0]?.headers["add-padding"]).toBe("true");
    expect(requests[0]?.headers["user-agent"]).toMatch(/^Nextly\//);
    const sent = JSON.stringify(requests);
    expect(sent).not.toContain(SUFFIX);
    expect(sent).not.toContain(PASSWORD);
  });

  it("puts the prefix in the path of an address that carries a query string", async () => {
    const { fetch, requests } = recordingFetch("");
    await check(
      { source: { url: "https://ranges.example/range?token=site-key" } },
      fetch
    );
    expect(requests[0]?.url).toBe(
      `https://ranges.example/range/${PREFIX}?token=site-key`
    );
  });

  it("asks Have I Been Pwned's public address when nothing is configured", async () => {
    const { fetch, requests } = recordingFetch("");
    await check(undefined, fetch);
    expect(requests[0]?.url).toBe(
      `https://api.pwnedpasswords.com/range/${PREFIX}`
    );
  });

  it("never counts a padding entry, whose count is 0, as a match", async () => {
    const { fetch } = recordingFetch(`${SUFFIX}:0\r\n${"A".repeat(35)}:3\r\n`);
    expect(
      await check({ source: { url: "https://ranges.example/range" } }, fetch)
    ).toEqual({ ok: true, breachedCheck: "passed" });
  });

  it("leaves the password unchecked on an error status, a failure or no answer in time", async () => {
    const failing = vi.fn(async () => {
      throw new Error("connection refused");
    });
    const silent = vi.fn(() => new Promise<Response>(() => {}));
    const source = { source: { url: "https://ranges.example/range" } };
    expect(await check(source, recordingFetch("", 503).fetch)).toEqual({
      ok: true,
      breachedCheck: "unavailable",
    });
    expect(await check(source, failing)).toEqual({
      ok: true,
      breachedCheck: "unavailable",
    });
    expect(await check({ ...source, timeoutMs: 50 }, silent)).toEqual({
      ok: true,
      breachedCheck: "unavailable",
    });
  });
});

describe("a range service that is not https", () => {
  it("is sent nothing, and every check answers unchecked", async () => {
    const { fetch, requests } = recordingFetch(`${SUFFIX}:12`);
    expect(
      await check({ source: { url: "http://ranges.example/range" } }, fetch)
    ).toEqual({ ok: true, breachedCheck: "unavailable" });
    expect(requests).toHaveLength(0);
  });

  it("is named in the warning boot logs; an https source is not", () => {
    expect(
      breachedPasswordsWarnings({
        source: { url: "http://ranges.example/range" },
      }).join("\n")
    ).toMatch(/not an https address/);
    expect(
      breachedPasswordsWarnings({
        source: { url: "https://ranges.example/range" },
      })
    ).toEqual([]);
    expect(breachedPasswordsWarnings(undefined)).toEqual([]);
  });
});

describe("an answer that is not a range", () => {
  it("leaves the password unchecked when a 200 carries something else", async () => {
    const source = { source: { url: "https://ranges.example/range" } };
    for (const body of [
      "<html><body>Service temporarily unavailable</body></html>",
      "not a range at all",
      // A suffix with no count: a range service always gives one.
      `${"B".repeat(35)}\r\n`,
    ]) {
      expect(await check(source, recordingFetch(body).fetch)).toEqual({
        ok: true,
        breachedCheck: "unavailable",
      });
    }
  });

  it("leaves the password unchecked when the site's list answers with something else", async () => {
    const range = async () => ["not a suffix"];
    expect(await check({ source: { range } })).toEqual({
      ok: true,
      breachedCheck: "unavailable",
    });
  });
});

describe("a configured time limit", () => {
  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY, 1e9, 1.5])(
    "outside its bounds (%s) is named at boot and replaced by the default",
    async timeoutMs => {
      expect(
        breachedPasswordsWarnings({
          source: "pwned-passwords",
          timeoutMs,
        }).join("\n")
      ).toMatch(/timeoutMs must be a whole number/);
      // A source that answers in 20 ms is answered, as under the default wait;
      // a timer clamped to a millisecond would have given up first.
      const range = () =>
        new Promise<readonly string[]>(resolve =>
          setTimeout(() => resolve([SUFFIX]), 20)
        );
      expect(await check({ source: { range }, timeoutMs })).toEqual({
        ok: false,
        reason: "breached",
      });
    }
  );
});
