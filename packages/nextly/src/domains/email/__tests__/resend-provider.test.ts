/**
 * Tests for the Resend email provider adapter.
 *
 * The adapter posts to Resend's REST API with `fetch`, so these assert the
 * REQUEST ITSELF — url, auth header, and JSON body keys. That is deliberate:
 * the previous suite mocked the SDK and could only prove which arguments the
 * SDK received, never what went on the wire. A wrong wire key (`replyTo` for
 * `reply_to`, a Buffer where base64 is required) is exactly the failure an SDK
 * mock cannot see, because the SDK was the thing translating it.
 *
 * Covers:
 * - Successful send → returns success + messageId
 * - Request shape: url, bearer auth, recipient list, optional fields
 * - Resend error body → throws with provider prefix
 * - Network exception → re-throws with provider prefix
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createResendProvider } from "../services/providers/resend-provider";

const BASE_OPTIONS = {
  to: "recipient@example.com",
  from: "App <noreply@example.com>",
  subject: "Hello",
  html: "<p>Hello World</p>",
};

/** The parsed JSON body of the single `fetch` call made. */
function sentBody(): Record<string, unknown> {
  const mockFetch = vi.mocked(globalThis.fetch);
  const init = mockFetch.mock.calls[0][1];
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

function okResponse(id = "msg_abc123") {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ id }),
  } as unknown as Response;
}

describe("createResendProvider", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns success and messageId on a successful send", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse());

    const adapter = createResendProvider({ apiKey: "re_test_key" });
    const result = await adapter.send(BASE_OPTIONS);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("msg_abc123");
  });

  it("posts to Resend's send endpoint with bearer auth", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse());

    const adapter = createResendProvider({ apiKey: "re_test_key" });
    await adapter.send(BASE_OPTIONS);

    const [url, init] = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer re_test_key",
      "Content-Type": "application/json",
    });
  });

  it("sends the recipient as a list, which the REST API requires", async () => {
    // The SDK accepted a bare string and wrapped it. Passing a string straight
    // through to the API would be rejected, and no SDK-level mock could catch
    // that, because wrapping was the SDK's job.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse());

    const adapter = createResendProvider({ apiKey: "re_test_key" });
    await adapter.send(BASE_OPTIONS);

    expect(sentBody().to).toEqual(["recipient@example.com"]);
  });

  it("omits optional fields entirely rather than sending them null", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse());

    const adapter = createResendProvider({ apiKey: "re_test_key" });
    await adapter.send(BASE_OPTIONS);

    const body = sentBody();
    expect(body).not.toHaveProperty("reply_to");
    expect(body).not.toHaveProperty("cc");
    expect(body).not.toHaveProperty("bcc");
    expect(body).not.toHaveProperty("attachments");
    expect(body).not.toHaveProperty("text");
  });

  it("sends reply-to under the snake_case wire key", async () => {
    // Guards the one-word difference that silently drops the header: the SDK
    // took `replyTo`, the REST API reads `reply_to`.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse());

    const adapter = createResendProvider({ apiKey: "re_test_key" });
    await adapter.send({ ...BASE_OPTIONS, replyTo: "reply@example.com" });

    const body = sentBody();
    expect(body.reply_to).toBe("reply@example.com");
    expect(body).not.toHaveProperty("replyTo");
  });

  it("forwards text, cc and bcc when supplied", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse());

    const adapter = createResendProvider({ apiKey: "re_test_key" });
    await adapter.send({
      ...BASE_OPTIONS,
      text: "Hello World",
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
    });

    const body = sentBody();
    expect(body.text).toBe("Hello World");
    expect(body.cc).toEqual(["cc@example.com"]);
    expect(body.bcc).toEqual(["bcc@example.com"]);
  });

  it("throws a provider-prefixed error when Resend returns an error body", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      json: async () => ({
        statusCode: 403,
        name: "invalid_api_key",
        message: "Invalid API key",
      }),
    } as unknown as Response);

    const adapter = createResendProvider({ apiKey: "re_bad_key" });

    await expect(adapter.send(BASE_OPTIONS)).rejects.toThrow(
      "Resend provider error: HTTP 403: Invalid API key"
    );
  });

  it("falls back to the status line when the error body is not JSON", async () => {
    // A gateway or proxy failure returns a status with no Resend envelope. The
    // adapter must still report something an operator can act on rather than
    // failing while trying to parse the failure.
    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      json: async () => {
        throw new Error("Unexpected token < in JSON");
      },
    } as unknown as Response);

    const adapter = createResendProvider({ apiKey: "re_test_key" });

    await expect(adapter.send(BASE_OPTIONS)).rejects.toThrow(
      "Resend provider error: HTTP 502: Bad Gateway"
    );
  });

  it("throws a provider-prefixed error when the request itself fails", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(
      new Error("ECONNREFUSED")
    );

    const adapter = createResendProvider({ apiKey: "re_test_key" });

    await expect(adapter.send(BASE_OPTIONS)).rejects.toThrow(
      "Resend provider error: ECONNREFUSED"
    );
  });

  it("sends one request per send() call", async () => {
    vi.mocked(globalThis.fetch)
      .mockResolvedValueOnce(okResponse("id1"))
      .mockResolvedValueOnce(okResponse("id2"));

    const adapter = createResendProvider({ apiKey: "re_test_key" });
    const r1 = await adapter.send(BASE_OPTIONS);
    const r2 = await adapter.send(BASE_OPTIONS);

    expect(r1.messageId).toBe("id1");
    expect(r2.messageId).toBe("id2");
    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(2);
  });
});

describe("Resend adapter — endpoint resolution", () => {
  const ORIGINAL_BASE = process.env.RESEND_BASE_URL;
  const ORIGINAL_UA = process.env.RESEND_USER_AGENT;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    delete process.env.RESEND_BASE_URL;
    delete process.env.RESEND_USER_AGENT;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_BASE === undefined) delete process.env.RESEND_BASE_URL;
    else process.env.RESEND_BASE_URL = ORIGINAL_BASE;
    if (ORIGINAL_UA === undefined) delete process.env.RESEND_USER_AGENT;
    else process.env.RESEND_USER_AGENT = ORIGINAL_UA;
  });

  async function sendOnce() {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse());
    await createResendProvider({ apiKey: "re_k" }).send(BASE_OPTIONS);
    return vi.mocked(globalThis.fetch).mock.calls[0];
  }

  it("defaults to the public Resend host", async () => {
    const [url] = await sendOnce();
    expect(url).toBe("https://api.resend.com/emails");
  });

  it("routes through RESEND_BASE_URL when set", async () => {
    // A capture server or egress proxy. Hardcoding the public host does not
    // fail loudly here -- the send succeeds against the wrong endpoint -- so
    // this is the only thing standing between the override and silent bypass.
    process.env.RESEND_BASE_URL = "https://mail-proxy.internal";
    const [url] = await sendOnce();
    expect(url).toBe("https://mail-proxy.internal/emails");
  });

  it("tolerates a trailing slash on the override", async () => {
    process.env.RESEND_BASE_URL = "https://mail-proxy.internal/";
    const [url] = await sendOnce();
    expect(url).toBe("https://mail-proxy.internal/emails");
  });

  it("ignores a blank override rather than building a bare path", async () => {
    process.env.RESEND_BASE_URL = "   ";
    const [url] = await sendOnce();
    expect(url).toBe("https://api.resend.com/emails");
  });

  it("reads the override per call, not once at import", async () => {
    // Capturing the value at module load makes it unchangeable for the process,
    // which breaks a test that sets it between cases and a serverless runtime
    // that populates the environment after the module graph is warm.
    const [firstUrl] = await sendOnce();
    expect(firstUrl).toBe("https://api.resend.com/emails");

    vi.mocked(globalThis.fetch).mockReset();
    process.env.RESEND_BASE_URL = "https://second.example";
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(okResponse());
    await createResendProvider({ apiKey: "re_k" }).send(BASE_OPTIONS);
    expect(vi.mocked(globalThis.fetch).mock.calls[0][0]).toBe(
      "https://second.example/emails"
    );
  });

  it("sends no User-Agent header by default", async () => {
    const [, init] = await sendOnce();
    expect(init?.headers).not.toHaveProperty("User-Agent");
  });

  it("forwards RESEND_USER_AGENT when set", async () => {
    process.env.RESEND_USER_AGENT = "acme-mailer/2.1";
    const [, init] = await sendOnce();
    expect(init?.headers).toMatchObject({ "User-Agent": "acme-mailer/2.1" });
  });
});
