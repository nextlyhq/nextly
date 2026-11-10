/**
 * A plugin verifies the webhooks it receives: in the common scheme, Standard
 * Webhooks, or in a provider's own, described by the plugin. Core reads the
 * delivery, checks its freshness, and compares every signature against every
 * secret in constant time; a scheme only says where things are and how one
 * secret signs.
 */
import { createHmac } from "node:crypto";
import * as crypto from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildSignatureHeaders } from "../../../domains/webhooks/signing";
import {
  createPluginReceivedWebhooks,
  standardWebhooks,
  verifyWebhookDelivery,
  type InboundWebhookScheme,
  type WebhookVerification,
} from "../inbound-webhooks";

vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

afterEach(() => {
  vi.mocked(crypto.timingSafeEqual).mockClear();
});

/** Standard Webhooks secrets: base64 key material, optionally `whsec_`. */
const SECRET = Buffer.from("current-key-material-0123456789").toString(
  "base64"
);
const OLD_SECRET = Buffer.from("previous-key-material-abcdefgh").toString(
  "base64"
);
const SIGNED_AT = 1_752_796_800;
const AT = new Date(SIGNED_AT * 1000);
const BODY = '{"type":"order.paid","id":"ord_1"}';

/** A delivery as a sender in the common scheme sends it. */
function standardDelivery(
  options: {
    body?: string;
    id?: string;
    timestamp?: number;
    secrets?: string[];
  } = {}
) {
  const body = options.body ?? BODY;
  const headers = buildSignatureHeaders({
    id: options.id ?? "msg_1",
    timestamp: String(options.timestamp ?? SIGNED_AT),
    body,
    secrets: options.secrets ?? [SECRET],
  });
  return {
    headers: new Headers(headers),
    bytes: new TextEncoder().encode(body),
  };
}

function hex(key: string, content: string): string {
  return createHmac("sha256", key).update(content).digest("hex");
}

/**
 * A provider that puts its timestamp in the signature header,
 * `t=<seconds>,v1=<hex>[,v1=<hex>]`, signs `"<t>.<body>"`, and uses the
 * secret string itself as the key.
 */
const timestamped: InboundWebhookScheme = {
  read({ headers, bytes }) {
    const header = headers.get("x-provider-signature");
    if (header === null) return null;
    const parts = header.split(",").map(part => part.split("="));
    const t = parts.find(([key]) => key === "t")?.[1];
    if (t === undefined || !/^\d+$/.test(t)) throw new Error("no timestamp");
    return {
      timestamp: Number(t),
      signed: Buffer.concat([Buffer.from(`${t}.`), bytes]),
      signatures: parts
        .filter(([key]) => key === "v1")
        .map(([, value]) => Buffer.from(value, "hex")),
    };
  },
  sign: (secret, signed) =>
    createHmac("sha256", secret).update(signed).digest(),
};

function timestampedDelivery(
  options: { body?: string; t?: number; secrets?: string[] } = {}
) {
  const body = options.body ?? BODY;
  const t = options.t ?? SIGNED_AT;
  const signatures = (options.secrets ?? ["provider-secret"]).map(
    secret => `v1=${hex(secret, `${t}.${body}`)}`
  );
  return {
    headers: new Headers({
      "x-provider-signature": [`t=${t}`, ...signatures].join(","),
    }),
    bytes: new TextEncoder().encode(body),
  };
}

/** A provider that signs the body alone, `sha256=<hex>`, with no time in it. */
const untimed: InboundWebhookScheme = {
  read({ headers, bytes }) {
    const header = headers.get("x-provider-signature-256");
    if (header === null) return null;
    if (!header.startsWith("sha256=")) throw new Error("unknown algorithm");
    return {
      timestamp: "none",
      signed: bytes,
      signatures: [Buffer.from(header.slice("sha256=".length), "hex")],
      deliveryId: headers.get("x-provider-delivery") ?? undefined,
    };
  },
  sign: (secret, signed) =>
    createHmac("sha256", secret).update(signed).digest(),
};

function untimedDelivery(options: { body?: string; secret?: string } = {}) {
  const body = options.body ?? BODY;
  return {
    headers: new Headers({
      "x-provider-signature-256": `sha256=${hex(options.secret ?? "provider-secret", body)}`,
      "x-provider-delivery": "dlv_9",
    }),
    bytes: new TextEncoder().encode(body),
  };
}

function reasonOf(result: WebhookVerification): string {
  return result.verified ? "verified" : result.reason;
}

describe("verifying an inbound webhook", () => {
  it("the common scheme: a valid delivery is verified, and its exact body handed back", () => {
    const result = verifyWebhookDelivery(
      standardDelivery(),
      { scheme: standardWebhooks, secrets: [SECRET] },
      AT
    );
    expect(result).toMatchObject({
      verified: true,
      body: BODY,
      deliveryId: "msg_1",
      timestamp: SIGNED_AT,
      freshness: "checked",
    });
    expect(result.verified && Buffer.from(result.bytes).toString()).toBe(BODY);
    // Beside a token that matches nothing, the real one still verifies.
    const sent = standardDelivery();
    const withJunk = {
      ...sent,
      headers: new Headers({
        ...Object.fromEntries(sent.headers),
        "webhook-signature": `v1,AAAA ${sent.headers.get("webhook-signature")}`,
      }),
    };
    expect(
      verifyWebhookDelivery(
        withJunk,
        { scheme: standardWebhooks, secrets: [SECRET] },
        AT
      ).verified
    ).toBe(true);
    // The `whsec_` form of the same key verifies too.
    expect(
      verifyWebhookDelivery(
        standardDelivery(),
        { scheme: standardWebhooks, secrets: [`whsec_${SECRET}`] },
        AT
      ).verified
    ).toBe(true);
  });

  it("the common scheme: a changed body, id or timestamp, or a wrong secret, is refused as a mismatch", () => {
    const sent = standardDelivery();
    const tampered = [
      { ...sent, bytes: new TextEncoder().encode('{"type":"order.refunded"}') },
      {
        ...sent,
        headers: new Headers({
          ...Object.fromEntries(sent.headers),
          "webhook-id": "msg_2",
        }),
      },
      {
        ...sent,
        headers: new Headers({
          ...Object.fromEntries(sent.headers),
          "webhook-timestamp": String(SIGNED_AT + 1),
        }),
      },
    ];
    for (const delivery of tampered) {
      expect(
        reasonOf(
          verifyWebhookDelivery(
            delivery,
            { scheme: standardWebhooks, secrets: [SECRET] },
            AT
          )
        )
      ).toBe("mismatch");
    }
    expect(
      reasonOf(
        verifyWebhookDelivery(
          sent,
          { scheme: standardWebhooks, secrets: [OLD_SECRET] },
          AT
        )
      )
    ).toBe("mismatch");
  });

  it("the common scheme: a delivery older or further ahead than the tolerance is refused as expired", () => {
    const options = { scheme: standardWebhooks, secrets: [SECRET] };
    const late = new Date((SIGNED_AT + 301) * 1000);
    const early = new Date((SIGNED_AT - 301) * 1000);
    expect(
      reasonOf(verifyWebhookDelivery(standardDelivery(), options, late))
    ).toBe("expired");
    expect(
      reasonOf(verifyWebhookDelivery(standardDelivery(), options, early))
    ).toBe("expired");
    // A clock that reads no time is no reason to call a delivery fresh.
    expect(
      reasonOf(
        verifyWebhookDelivery(standardDelivery(), options, new Date(Number.NaN))
      )
    ).toBe("expired");
    // At the tolerance itself it is still fresh.
    const edge = new Date((SIGNED_AT + 300) * 1000);
    expect(
      reasonOf(verifyWebhookDelivery(standardDelivery(), options, edge))
    ).toBe("verified");
    // A tolerance the plugin sets is the one used.
    expect(
      reasonOf(
        verifyWebhookDelivery(
          standardDelivery(),
          { ...options, toleranceSeconds: 600 },
          late
        )
      )
    ).toBe("verified");
  });

  it("a plugin's own scheme: valid, mismatch and expired", () => {
    const options = { scheme: timestamped, secrets: ["provider-secret"] };
    expect(
      verifyWebhookDelivery(timestampedDelivery(), options, AT)
    ).toMatchObject({
      verified: true,
      body: BODY,
      timestamp: SIGNED_AT,
      freshness: "checked",
    });
    expect(
      reasonOf(
        verifyWebhookDelivery(
          { ...timestampedDelivery(), bytes: new TextEncoder().encode("{}") },
          options,
          AT
        )
      )
    ).toBe("mismatch");
    expect(
      reasonOf(
        verifyWebhookDelivery(
          timestampedDelivery({ t: SIGNED_AT - 3600 }),
          options,
          AT
        )
      )
    ).toBe("expired");
  });

  it("a plugin's own scheme with no timestamp: valid and mismatch, and it must say so", () => {
    const options = { scheme: untimed, secrets: ["provider-secret"] };
    const result = verifyWebhookDelivery(untimedDelivery(), options, AT);
    expect(result).toMatchObject({
      verified: true,
      body: BODY,
      deliveryId: "dlv_9",
      // Not fresh: nothing said when it was sent, so a handler cannot take it
      // for a delivery checked against the tolerance.
      freshness: "unchecked",
    });
    expect(result.verified && result.timestamp).toBeUndefined();
    expect(
      reasonOf(
        verifyWebhookDelivery(
          untimedDelivery({ secret: "someone-else" }),
          options,
          AT
        )
      )
    ).toBe("mismatch");
    // A scheme that leaves the timestamp out, rather than saying "none", is
    // not taken as having none.
    const silent: InboundWebhookScheme = {
      ...untimed,
      read: delivery => {
        const read = untimed.read(delivery);
        if (read === null) return null;
        const { timestamp: _omitted, ...rest } = read;
        return rest as never;
      },
    };
    expect(
      reasonOf(
        verifyWebhookDelivery(
          untimedDelivery(),
          { ...options, scheme: silent },
          AT
        )
      )
    ).toBe("malformed");
  });

  it("compares in constant time: a wrong signature of the same length is a mismatch, and one of another length is a mismatch, not a throw", () => {
    const sent = standardDelivery();
    const real = sent.headers.get("webhook-signature")!.slice("v1,".length);
    const sameLength = Buffer.alloc(Buffer.from(real, "base64").length, 7);
    const sameLengthDelivery = {
      ...sent,
      headers: new Headers({
        ...Object.fromEntries(sent.headers),
        "webhook-signature": `v1,${sameLength.toString("base64")}`,
      }),
    };
    expect(
      reasonOf(
        verifyWebhookDelivery(
          sameLengthDelivery,
          { scheme: standardWebhooks, secrets: [SECRET] },
          AT
        )
      )
    ).toBe("mismatch");
    // The bytes of equal length were compared in constant time.
    expect(vi.mocked(crypto.timingSafeEqual)).toHaveBeenCalled();

    const shortDelivery = {
      ...sent,
      headers: new Headers({
        ...Object.fromEntries(sent.headers),
        "webhook-signature": "v1,AAAA",
      }),
    };
    expect(() =>
      verifyWebhookDelivery(
        shortDelivery,
        { scheme: standardWebhooks, secrets: [SECRET] },
        AT
      )
    ).not.toThrow();
    expect(
      reasonOf(
        verifyWebhookDelivery(
          shortDelivery,
          { scheme: standardWebhooks, secrets: [SECRET] },
          AT
        )
      )
    ).toBe("mismatch");
  });

  it("an empty signature never matches, even against a scheme whose signing gives nothing", () => {
    // `v1,A` is valid base64 for zero bytes.
    const sent = standardDelivery();
    const empty = {
      ...sent,
      headers: new Headers({
        ...Object.fromEntries(sent.headers),
        "webhook-signature": "v1,A",
      }),
    };
    const signsNothing: InboundWebhookScheme = {
      ...standardWebhooks,
      sign: () => new Uint8Array(),
    };
    expect(
      reasonOf(
        verifyWebhookDelivery(
          empty,
          { scheme: signsNothing, secrets: [SECRET] },
          AT
        )
      )
    ).toBe("mismatch");
  });

  it("rotation: old and new secrets both verify while both are listed; a removed one does not", () => {
    // The common scheme: signed with the old secret, or with both as a sender
    // signs through a rotation.
    const byOld = standardDelivery({ secrets: [OLD_SECRET] });
    const byBoth = standardDelivery({ secrets: [SECRET, OLD_SECRET] });
    const both = { scheme: standardWebhooks, secrets: [SECRET, OLD_SECRET] };
    expect(verifyWebhookDelivery(byOld, both, AT).verified).toBe(true);
    expect(verifyWebhookDelivery(standardDelivery(), both, AT).verified).toBe(
      true
    );
    expect(
      verifyWebhookDelivery(byBoth, { ...both, secrets: [SECRET] }, AT).verified
    ).toBe(true);
    expect(
      reasonOf(verifyWebhookDelivery(byOld, { ...both, secrets: [SECRET] }, AT))
    ).toBe("mismatch");

    // A plugin's own scheme the same way.
    const oldSigned = timestampedDelivery({ secrets: ["old-provider-secret"] });
    const own = {
      scheme: timestamped,
      secrets: ["provider-secret", "old-provider-secret"],
    };
    expect(verifyWebhookDelivery(oldSigned, own, AT).verified).toBe(true);
    expect(
      reasonOf(
        verifyWebhookDelivery(
          oldSigned,
          { ...own, secrets: ["provider-secret"] },
          AT
        )
      )
    ).toBe("mismatch");
  });

  it("expired, ahead and malformed timestamps are refused; an infinite or negative tolerance is refused", () => {
    const options = { scheme: standardWebhooks, secrets: [SECRET] };
    for (const timestamp of [
      // Headers trims surrounding spaces itself, as HTTP does.
      "1e9",
      "+1752796800",
      "0x10",
      "1752796800.5",
      "-5",
      "",
      "abc",
    ]) {
      const sent = standardDelivery();
      const delivery = {
        ...sent,
        headers: new Headers({
          ...Object.fromEntries(sent.headers),
          "webhook-timestamp": timestamp,
        }),
      };
      expect(reasonOf(verifyWebhookDelivery(delivery, options, AT))).toBe(
        "malformed"
      );
    }
    for (const toleranceSeconds of [Infinity, Number.NaN, -1]) {
      expect(() =>
        verifyWebhookDelivery(
          standardDelivery(),
          { ...options, toleranceSeconds },
          AT
        )
      ).toThrow(/toleranceSeconds/);
    }
    // Zero is allowed: only the very second it was signed.
    expect(
      verifyWebhookDelivery(
        standardDelivery(),
        { ...options, toleranceSeconds: 0 },
        AT
      ).verified
    ).toBe(true);
  });

  it("missing, malformed and secretless deliveries are not verified, each with its reason", () => {
    const options = { scheme: standardWebhooks, secrets: [SECRET] };
    const sent = standardDelivery();
    expect(
      reasonOf(
        verifyWebhookDelivery({ ...sent, headers: new Headers() }, options, AT)
      )
    ).toBe("missing");
    for (const signature of ["v2,whatever", "v1,@@@@", "v1,"]) {
      const delivery = {
        ...sent,
        headers: new Headers({
          ...Object.fromEntries(sent.headers),
          "webhook-signature": signature,
        }),
      };
      expect(reasonOf(verifyWebhookDelivery(delivery, options, AT))).toBe(
        "malformed"
      );
    }
    // A scheme that throws while reading is malformed, never verified.
    expect(
      reasonOf(
        verifyWebhookDelivery(
          {
            headers: new Headers({ "x-provider-signature-256": "md5=00" }),
            bytes: new Uint8Array(),
          },
          { scheme: untimed, secrets: ["provider-secret"] },
          AT
        )
      )
    ).toBe("malformed");
    for (const secrets of [[], [""]]) {
      expect(
        reasonOf(verifyWebhookDelivery(sent, { ...options, secrets }, AT))
      ).toBe("no-secret");
    }
    // A secret the scheme cannot use is passed over; a good one beside it
    // still verifies.
    expect(
      verifyWebhookDelivery(
        sent,
        { ...options, secrets: ["whsec_", SECRET] },
        AT
      ).verified
    ).toBe(true);
    expect(
      reasonOf(
        verifyWebhookDelivery(sent, { ...options, secrets: ["whsec_"] }, AT)
      )
    ).toBe("mismatch");
  });
});

describe("ctx.security.webhooks.verify", () => {
  const webhooks = createPluginReceivedWebhooks({ now: () => AT });

  function request(delivery: { headers: Headers; bytes: Uint8Array }) {
    return new Request("https://site.example/api/plugins/shop/webhooks", {
      method: "POST",
      headers: delivery.headers,
      // A copy over a plain ArrayBuffer, as a request body takes.
      body: new Uint8Array(delivery.bytes),
    });
  }

  it("verifies a request's exact bytes, and leaves the request readable", async () => {
    const req = request(standardDelivery());
    const result = await webhooks.verify(req, {
      scheme: standardWebhooks,
      secrets: [SECRET],
    });
    expect(result).toMatchObject({ verified: true, body: BODY });
    expect(await req.text()).toBe(BODY);
  });

  it("stops reading a body that streams past the limit, and leaves the request readable", async () => {
    let pulled = 0;
    const chunks = 100;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > chunks) controller.close();
        else controller.enqueue(new TextEncoder().encode("abcd"));
      },
    });
    const sent = standardDelivery();
    const req = new Request("https://site.example/api/plugins/shop/webhooks", {
      method: "POST",
      headers: sent.headers,
      body: stream,
      duplex: "half",
    } as RequestInit);
    const result = await webhooks.verify(req, {
      scheme: standardWebhooks,
      secrets: [SECRET],
      maxBytes: 16,
    });
    expect(reasonOf(result)).toBe("too-large");
    // Read no further than the chunk that passed the limit.
    expect(pulled).toBeLessThan(10);
    // The handler can still read the whole request.
    expect((await req.text()).length).toBe(chunks * 4);
  });

  it("a body over the limit is refused as too-large: 1 MiB, unless the call sets another", async () => {
    const options = { scheme: standardWebhooks, secrets: [SECRET] };
    const big = "x".repeat(1024 * 1024 + 1);
    expect(
      reasonOf(
        await webhooks.verify(request(standardDelivery({ body: big })), options)
      )
    ).toBe("too-large");
    const fits = "x".repeat(1024 * 1024);
    expect(
      reasonOf(
        await webhooks.verify(
          request(standardDelivery({ body: fits })),
          options
        )
      )
    ).toBe("verified");
    expect(
      reasonOf(
        await webhooks.verify(request(standardDelivery()), {
          ...options,
          maxBytes: 8,
        })
      )
    ).toBe("too-large");
    for (const maxBytes of [0, -1, Infinity, Number.NaN]) {
      await expect(
        webhooks.verify(request(standardDelivery()), { ...options, maxBytes })
      ).rejects.toThrow(/maxBytes/);
    }
  });
});
