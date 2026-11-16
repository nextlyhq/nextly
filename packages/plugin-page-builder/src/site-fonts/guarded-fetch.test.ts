import { NextlyError } from "@nextlyhq/plugin-sdk";
import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchFromCatalogue, type CatalogueFetchRules } from "./guarded-fetch";

const API = new URL("https://api.fontsource.org");
const FILES = new URL("https://cdn.jsdelivr.net");

const WOFF2 = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 1, 2, 3]);

const MESSAGES = {
  refused: "refused message",
  unanswered: "unanswered message",
};

function rules(over: Partial<CatalogueFetchRules> = {}): CatalogueFetchRules {
  return {
    allowed: [API, FILES],
    allowLoopback: false,
    maxBytes: 1024,
    timeoutMs: 1000,
    expect: "woff2",
    messages: MESSAGES,
    ...over,
  };
}

function font(body: BodyInit = WOFF2, headers: HeadersInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "font/woff2", ...headers },
  });
}

/** The public message and reason of what a call threw. */
async function refusal(
  work: Promise<unknown>
): Promise<{ message: string; reason: unknown }> {
  try {
    await work;
  } catch (error) {
    if (!NextlyError.is(error)) throw error;
    return {
      message: error.publicMessage,
      reason: (error.logContext as { reason?: unknown } | undefined)?.reason,
    };
  }
  throw new Error("the call did not refuse");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchFromCatalogue", () => {
  it("fetches an allowed file, never following a redirect on its own", async () => {
    const fetch = vi.fn(async () => font());
    const bytes = await fetchFromCatalogue(
      fetch,
      "https://cdn.jsdelivr.net/fontsource/fonts/inter@5.3.0/latin-400-normal.woff2",
      rules()
    );
    expect([...bytes]).toEqual([...WOFF2]);
    expect(fetch).toHaveBeenCalledTimes(1);
    const init = fetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.redirect).toBe("manual");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["plain http", "http://cdn.jsdelivr.net/f.woff2"],
    ["another host", "https://fonts.gstatic.com/f.woff2"],
    ["an address", "https://127.0.0.1/f.woff2"],
    ["a name and password", "https://me:pw@cdn.jsdelivr.net/f.woff2"],
    ["another port", "https://cdn.jsdelivr.net:8443/f.woff2"],
    ["a look-alike host", "https://cdn.jsdelivr.net.example.com/f.woff2"],
  ])("refuses %s without asking the network", async (_case, url) => {
    const fetch = vi.fn(async () => font());
    const answer = await refusal(fetchFromCatalogue(fetch, url, rules()));
    expect(answer.message).toBe(MESSAGES.refused);
    expect(answer.reason).toBe("host-not-allowed");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reaches plain http on localhost only where loopback is allowed", async () => {
    const local = new URL("http://localhost:4567");
    const url = "http://localhost:4567/f.woff2";
    const fetch = vi.fn(async () => font());
    await expect(
      fetchFromCatalogue(fetch, url, rules({ allowed: [local] }))
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
    await fetchFromCatalogue(
      fetch,
      url,
      rules({ allowed: [local], allowLoopback: true })
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a redirect that leaves the allowed hosts, and does not follow it", async () => {
    const fetch = vi.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: "https://evil.example.com/f.woff2" },
        })
    );
    const answer = await refusal(
      fetchFromCatalogue(fetch, "https://cdn.jsdelivr.net/f.woff2", rules())
    );
    expect(answer.reason).toBe("redirect-not-allowed");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("follows a redirect within the allowed hosts at most twice", async () => {
    let hops = 0;
    const fetch = vi.fn(async () => {
      hops += 1;
      return new Response(null, {
        status: 301,
        headers: { location: `/hop-${String(hops)}.woff2` },
      });
    });
    const answer = await refusal(
      fetchFromCatalogue(fetch, "https://cdn.jsdelivr.net/f.woff2", rules())
    );
    expect(answer.reason).toBe("too-many-redirects");
    expect(fetch).toHaveBeenCalledTimes(3);

    const twice = vi
      .fn<() => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "/a.woff2" } })
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 302, headers: { location: "/b.woff2" } })
      )
      .mockResolvedValueOnce(font());
    await fetchFromCatalogue(
      twice,
      "https://cdn.jsdelivr.net/f.woff2",
      rules()
    );
    expect(twice).toHaveBeenCalledTimes(3);
    expect(twice.mock.calls.at(-1)?.[0]).toBe(
      "https://cdn.jsdelivr.net/b.woff2"
    );
  });

  it("refuses a file larger than the cap by its stated length, before reading it", async () => {
    const body = new ReadableStream<Uint8Array>({
      pull: () => {
        throw new Error("the body was read");
      },
    });
    const fetch = vi.fn(async () => font(body, { "content-length": "4096" }));
    const answer = await refusal(
      fetchFromCatalogue(fetch, "https://cdn.jsdelivr.net/f.woff2", rules())
    );
    expect(answer.reason).toBe("too-large");
  });

  it("refuses a file larger than the cap as it streams, whatever its length says", async () => {
    const chunk = new Uint8Array(400);
    chunk.set(WOFF2);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull: controller => {
        sent += 1;
        controller.enqueue(chunk);
      },
    });
    const fetch = vi.fn(async () => font(body, { "content-length": "10" }));
    const answer = await refusal(
      fetchFromCatalogue(fetch, "https://cdn.jsdelivr.net/f.woff2", rules())
    );
    expect(answer.reason).toBe("too-large");
    expect(sent).toBeLessThan(10);
  });

  it("refuses an answer that is not a font by its type", async () => {
    const fetch = vi.fn(async () =>
      font(WOFF2, { "content-type": "text/html" })
    );
    const answer = await refusal(
      fetchFromCatalogue(fetch, "https://cdn.jsdelivr.net/f.woff2", rules())
    );
    expect(answer.message).toBe(MESSAGES.refused);
    expect(answer.reason).toBe("wrong-type");
  });

  it("refuses a font type whose bytes are not a woff2 file", async () => {
    const fetch = vi.fn(async () =>
      font(new Uint8Array([0x47, 0x49, 0x46, 0x38, 0, 0]))
    );
    const answer = await refusal(
      fetchFromCatalogue(fetch, "https://cdn.jsdelivr.net/f.woff2", rules())
    );
    expect(answer.reason).toBe("not-woff2");
  });

  it("says the catalogue did not answer for a status other than 200", async () => {
    const fetch = vi.fn(async () => new Response("down", { status: 503 }));
    const answer = await refusal(
      fetchFromCatalogue(fetch, "https://cdn.jsdelivr.net/f.woff2", rules())
    );
    expect(answer.message).toBe(MESSAGES.unanswered);
    expect(answer.reason).toBe("status");
  });

  it("gives up when the catalogue takes longer than the time allowed", async () => {
    vi.useFakeTimers();
    const fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        })
    );
    const pending = refusal(
      fetchFromCatalogue(fetch, "https://cdn.jsdelivr.net/f.woff2", rules())
    );
    await vi.advanceTimersByTimeAsync(1001);
    const answer = await pending;
    expect(answer.message).toBe(MESSAGES.unanswered);
    expect(answer.reason).toBe("timeout");
  });

  it("reads a json answer from the catalogue's api", async () => {
    const fetch = vi.fn(async () => Response.json([{ id: "inter" }]));
    const bytes = await fetchFromCatalogue(
      fetch,
      "https://api.fontsource.org/v1/fonts?type=google",
      rules({ expect: "json" })
    );
    expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual([
      { id: "inter" },
    ]);
  });
});
