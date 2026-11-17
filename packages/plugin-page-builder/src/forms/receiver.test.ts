/**
 * The receiver, with every part it reaches stood in for: what reaches the
 * provider or the "Send to" address, what is refused before anything is
 * read, and where the visitor is sent back to.
 *
 * Against a real database, through core's own request handler and limiter:
 * `__tests__/form-receiver.integration.test.ts`.
 */
import type { BlockNode } from "@nextlyhq/blocks-engine";
import type {
  FormAcceptResult,
  FormDescription,
  FormPost,
  FormProvider,
  FormUnavailable,
} from "@nextlyhq/plugin-sdk/blocks";
import { describe, expect, it, vi } from "vitest";

import type { CheckedAnswer } from "./answers";
import type { DefiningDocument } from "./defining-document";
import type { Delivery } from "./deliver";
import {
  FORM_SEND_RULE,
  FORM_SENDS_PER_MINUTE,
  MOST_POST_BYTES,
  MOST_POST_FIELDS,
  receiveFormPost,
  type ReceiverDeps,
} from "./receiver";
import { FORM_SEND_LIMITS } from "./route";

/** A simple form node, as a published page stores it. */
function simpleForm(overrides: Partial<BlockNode> = {}): BlockNode {
  return {
    id: "f1",
    type: "core/form",
    version: 1,
    props: {
      action: "https://hooks.example.com/contact?key=secret",
      fields: [
        { label: "Name", name: "name", required: true },
        { label: "Email", name: "email", type: "email", required: true },
        { label: "Message", name: "message", type: "textarea" },
      ],
    },
    ...overrides,
  };
}

/**
 * A limiter that counts as the declared rule does: a window of
 * `FORM_SEND_LIMITS[FORM_SEND_RULE]` per key, on a clock the test holds.
 */
function windowLimiter(clientKey: string | null = "203.0.113.9") {
  const rule = FORM_SEND_LIMITS[FORM_SEND_RULE];
  if (rule?.type !== "window") throw new Error("the send rule is a window");
  const [{ max, perMs }] = rule.windows;
  const counted = new Map<string, number[]>();
  let now = 0;
  const reserve = vi.fn<NonNullable<ReceiverDeps["limits"]>["reserve"]>(
    async ([entry]) => {
      const key = `${entry.rule}:${entry.key}`;
      const recent = (counted.get(key) ?? []).filter(at => at > now - perMs);
      if (recent.length >= max) {
        return {
          status: "refused",
          retryAfterMs: recent[0] + perMs - now,
          refusedBy: [entry.rule],
          entries: [],
        };
      }
      counted.set(key, [...recent, now]);
      return {
        status: "admitted",
        reservation: { id: "r", at: now, entries: [], epochs: [] },
      };
    }
  );
  return {
    limits: { reserve, clientKey: () => clientKey },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

/** The receiver's parts, each recording what reached it. */
function parts(found: BlockNode | null = simpleForm()) {
  const delivered: { address: string; answers: readonly CheckedAnswer[] }[] =
    [];
  const logged: unknown[][] = [];
  const read: {
    document: DefiningDocument;
    nodeId: string;
    locale?: string;
  }[] = [];
  const providers = new Map<string, FormProvider>();
  const { limits, advance } = windowLimiter();
  const deps: ReceiverDeps = {
    readNode: vi.fn(async (document, nodeId, locale) => {
      read.push({ document, nodeId, locale });
      return found;
    }),
    provider: id => providers.get(id),
    limits,
    deliver: vi.fn(async (address, answers): Promise<Delivery> => {
      delivered.push({ address, answers });
      return { ok: true };
    }),
    logger: {
      warn: (...args: unknown[]) => {
        logged.push(args);
      },
    },
  };
  return { deps, delivered, logged, read, providers, limits, advance };
}

/** A urlencoded post from the page, with the hidden fields a form carries. */
function post(
  fields: Record<string, string | string[]>,
  init: { headers?: Record<string, string> } = {}
): Request {
  const body = new URLSearchParams();
  const all = {
    _form: "page:p1",
    _node: "f1",
    _return: "/contact",
    _hp: "",
    ...fields,
  };
  for (const [name, value] of Object.entries(all)) {
    for (const each of Array.isArray(value) ? value : [value]) {
      body.append(name, each);
    }
  }
  return new Request("https://site.example/admin/api/plugins/forms/send", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "sec-fetch-site": "same-origin",
      ...init.headers,
    },
    body: body.toString(),
  });
}

/** Where a `303` sends the visitor. */
function location(response: Response): string | null {
  expect(response.status).toBe(303);
  return response.headers.get("location");
}

const ANSWERS = {
  name: "Ada Lovelace",
  email: "ada@example.com",
  message: "Unique-answer-7f3c",
};

describe("a simple form's send", () => {
  it("passes the answers on once, in the form's order, and comes back to say so", async () => {
    const { deps, delivered, read } = parts();
    const response = await receiveFormPost(post(ANSWERS), deps);

    expect(location(response)).toBe("/contact#form-f1-sent");
    expect(read).toEqual([
      { document: { kind: "page", id: "p1" }, nodeId: "f1", locale: undefined },
    ]);
    expect(delivered).toEqual([
      {
        address: "https://hooks.example.com/contact?key=secret",
        answers: [
          { name: "name", values: ["Ada Lovelace"] },
          { name: "email", values: ["ada@example.com"] },
          { name: "message", values: ["Unique-answer-7f3c"] },
        ],
      },
    ]);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("trims fields the form does not have, and the receiver's own", async () => {
    const { deps, delivered } = parts();
    await receiveFormPost(
      post({ ...ANSWERS, admin: "yes", "address-to": "evil@example.com" }),
      deps
    );

    const names = delivered[0]?.answers.map(answer => answer.name);
    expect(names).toEqual(["name", "email", "message"]);
  });

  it("refuses answers the form's own fields refuse, and sends nothing", async () => {
    const { deps, delivered } = parts();
    const missing = await receiveFormPost(
      post({ name: "Ada", email: "" }),
      deps
    );
    const malformed = await receiveFormPost(
      post({ name: "Ada", email: "not-an-email" }),
      deps
    );

    expect(location(missing)).toBe("/contact#form-f1-invalid");
    expect(location(malformed)).toBe("/contact#form-f1-invalid");
    expect(delivered).toEqual([]);
  });

  it("never takes the address from the post", async () => {
    const { deps, delivered } = parts();
    await receiveFormPost(
      post({ ...ANSWERS, action: "https://evil.example/", _action: "x" }),
      deps
    );

    expect(delivered.map(each => each.address)).toEqual([
      "https://hooks.example.com/contact?key=secret",
    ]);
  });

  it("has nowhere to send without a stored address, or with a bound one", async () => {
    for (const node of [
      simpleForm({ props: { ...simpleForm().props, action: "" } }),
      simpleForm({
        bindings: { action: { source: "entry", path: "email" } as never },
      }),
    ]) {
      const { deps, delivered } = parts(node);
      const response = await receiveFormPost(post(ANSWERS), deps);

      expect(location(response)).toBe("/contact#form-f1-error");
      expect(delivered).toEqual([]);
    }
  });

  it("logs a failed send by its outcome and host, never its answers or path", async () => {
    const { deps, logged } = parts();
    deps.deliver = async () => ({ ok: false, reason: "answered", status: 500 });
    const response = await receiveFormPost(post(ANSWERS), deps);

    expect(location(response)).toBe("/contact#form-f1-error");
    expect(logged.length).toBe(1);
    const said = JSON.stringify(logged);
    expect(said).toContain("hooks.example.com");
    for (const value of [...Object.values(ANSWERS), "key=secret", "/contact"]) {
      expect(said).not.toContain(value);
    }
  });
});

describe("the spam trap", () => {
  it("answers a filled trap as a success and reaches nothing", async () => {
    const { deps, delivered, read, limits } = parts();
    const response = await receiveFormPost(
      post({ ...ANSWERS, _hp: "https://spam.example" }),
      deps
    );

    expect(location(response)).toBe("/contact#form-f1-sent");
    expect(read).toEqual([]);
    expect(limits.reserve).not.toHaveBeenCalled();
    expect(delivered).toEqual([]);
  });

  it("answers the same way a real success is answered", async () => {
    const spam = await receiveFormPost(
      post({ ...ANSWERS, _hp: "x" }),
      parts().deps
    );
    const real = await receiveFormPost(post(ANSWERS), parts().deps);

    expect(spam.status).toBe(real.status);
    expect(location(spam)).toBe(location(real));
    expect([...spam.headers].sort()).toEqual([...real.headers].sort());
  });

  it("reaches no provider either", async () => {
    const { deps, providers } = parts(
      simpleForm({ props: { form: { provider: "acme", ref: "contact" } } })
    );
    const accept = vi.fn();
    providers.set("acme", { ...fakeProvider(), accept });
    await receiveFormPost(post({ email: "a@b.co", _hp: "filled" }), deps);

    expect(accept).not.toHaveBeenCalled();
  });
});

describe("which form a post names", () => {
  it("refuses a node the published document does not hold", async () => {
    // A draft-only block reads as absent from the published document.
    const { deps, delivered } = parts(null);
    const response = await receiveFormPost(post(ANSWERS), deps);

    expect(location(response)).toBe("/contact#form-f1-error");
    expect(delivered).toEqual([]);
  });

  it("refuses a node that is not a form", async () => {
    const { deps, delivered } = parts({
      id: "f1",
      type: "core/heading",
      version: 1,
      props: { action: "https://hooks.example.com/" },
    });
    const response = await receiveFormPost(post(ANSWERS), deps);

    expect(location(response)).toBe("/contact#form-f1-error");
    expect(delivered).toEqual([]);
  });

  it("refuses a document reference it cannot read, before any read", async () => {
    for (const reference of [
      "",
      "page",
      "page:",
      "post:p1",
      "page:p1:x",
      "layout:l1:sidebar",
    ]) {
      const { deps, read } = parts();
      const response = await receiveFormPost(
        post({ ...ANSWERS, _form: reference }),
        deps
      );
      expect(location(response), reference).toBe("/contact#form-f1-error");
      expect(read, reference).toEqual([]);
    }
  });

  it("reads each kind of document a form is defined in", async () => {
    const references: [string, DefiningDocument][] = [
      ["page:p1", { kind: "page", id: "p1" }],
      ["template:t1", { kind: "template", id: "t1" }],
      ["component:c1", { kind: "component", id: "c1" }],
      ["layout:l1:header", { kind: "layout", id: "l1", area: "header" }],
    ];
    for (const [reference, document] of references) {
      const { deps, read } = parts();
      await receiveFormPost(post({ ...ANSWERS, _form: reference }), deps);
      expect(read.map(each => each.document)).toEqual([document]);
    }
  });

  it("reads the page in the language it was sent from", async () => {
    const { deps, read } = parts();
    await receiveFormPost(post({ ...ANSWERS, _locale: "de" }), deps);
    await receiveFormPost(post({ ...ANSWERS, _locale: "../x" }), deps);

    expect(read.map(each => each.locale)).toEqual(["de", undefined]);
  });

  it("answers a read that fails as a failed send", async () => {
    const { deps, delivered } = parts();
    deps.readNode = async () => {
      throw new Error("database down");
    };
    const response = await receiveFormPost(post(ANSWERS), deps);

    expect(location(response)).toBe("/contact#form-f1-error");
    expect(delivered).toEqual([]);
  });
});

describe("where the visitor is sent back to", () => {
  it.each([
    ["//evil.example/path", "/"],
    ["https://evil.example/", "/"],
    ["/\\evil.example", "/"],
    // Normalized by the URL parser into `//evil.example/path`.
    ["/a/..//evil.example/path", "/"],
    ["/./\\evil.example", "/"],
    ["javascript:alert(1)", "/"],
    ["contact", "/"],
    ["/ok\nLocation: https://evil.example", "/"],
    ["", "/"],
  ])("a forged return %j goes to %j", async (forged, expected) => {
    const response = await receiveFormPost(
      post({ ...ANSWERS, _return: forged }),
      parts().deps
    );
    expect(location(response)).toBe(`${expected}#form-f1-sent`);
  });

  it("keeps a same-site path and its query, and replaces its fragment", async () => {
    const response = await receiveFormPost(
      post({ ...ANSWERS, _return: "/en/contact?from=footer#old" }),
      parts().deps
    );
    expect(location(response)).toBe("/en/contact?from=footer#form-f1-sent");
  });

  it("names a repeated form's item in the fragment", async () => {
    const response = await receiveFormPost(
      post({ ...ANSWERS, _item: "3" }),
      parts().deps
    );
    expect(location(response)).toBe("/contact#form-f1-3-sent");
  });
});

describe("what is refused before anything is read", () => {
  it("refuses a post larger than the cap, whatever its length claims", async () => {
    const huge = "x".repeat(MOST_POST_BYTES + 1);
    for (const request of [
      post({ ...ANSWERS, message: huge }),
      // A body larger than it says: read in chunks and stopped at the cap.
      new Request("https://site.example/send", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(`message=${huge}`));
            controller.close();
          },
        }),
        duplex: "half",
      } as RequestInit),
    ]) {
      const { deps, read, delivered, limits } = parts();
      const response = await receiveFormPost(request, deps);
      expect(response.status).toBe(413);
      expect(read).toEqual([]);
      expect(limits.reserve).not.toHaveBeenCalled();
      expect(delivered).toEqual([]);
    }
  });

  it("refuses a post with too many fields", async () => {
    const extra = Object.fromEntries(
      Array.from({ length: MOST_POST_FIELDS }, (_, index) => [`x${index}`, "1"])
    );
    const { deps, read, delivered } = parts();
    const response = await receiveFormPost(
      post({ ...ANSWERS, ...extra }),
      deps
    );

    expect(location(response)).toBe("/contact#form-f1-error");
    expect(read).toEqual([]);
    expect(delivered).toEqual([]);
  });

  it("refuses a body that is not a form's", async () => {
    const response = await receiveFormPost(
      new Request("https://site.example/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(ANSWERS),
      }),
      parts().deps
    );
    expect(response.status).toBe(415);
  });

  it("refuses a post another site's page made the browser send", async () => {
    const { deps, read } = parts();
    const response = await receiveFormPost(
      post(ANSWERS, { headers: { "sec-fetch-site": "cross-site" } }),
      deps
    );
    expect(response.status).toBe(403);
    expect(read).toEqual([]);
    // From this site's other address, it goes on.
    const sameSite = await receiveFormPost(
      post(ANSWERS, { headers: { "sec-fetch-site": "same-site" } }),
      parts().deps
    );
    expect(location(sameSite)).toBe("/contact#form-f1-sent");
  });

  it("reads a browser's multipart post, whose boundary has capitals", async () => {
    // Written out by hand, as Chrome sends it: the boundary is compared
    // exactly, so a receiver changing its case could read no field at all.
    const boundary = "----WebKitFormBoundaryAbCdEf123";
    const part = (name: string, value: string) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const body =
      part("_form", "page:p1") +
      part("_node", "f1") +
      part("_return", "/contact") +
      part("name", ANSWERS.name) +
      part("email", ANSWERS.email) +
      `--${boundary}--\r\n`;
    const { deps, delivered } = parts();
    const response = await receiveFormPost(
      new Request("https://site.example/send", {
        method: "POST",
        headers: {
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        body,
      }),
      deps
    );
    expect(location(response)).toBe("/contact#form-f1-sent");
    expect(delivered[0]?.answers.slice(0, 2)).toEqual([
      { name: "name", values: ["Ada Lovelace"] },
      { name: "email", values: ["ada@example.com"] },
    ]);
  });

  it("reads a multipart post the same way, passing on no file", async () => {
    const body = new FormData();
    for (const [name, value] of Object.entries({
      _form: "page:p1",
      _node: "f1",
      _return: "/contact",
      ...ANSWERS,
    })) {
      body.append(name, value);
    }
    body.append("name", new Blob(["file"]), "x.txt");
    const { deps, delivered } = parts();
    const response = await receiveFormPost(
      new Request("https://site.example/send", { method: "POST", body }),
      deps
    );
    expect(location(response)).toBe("/contact#form-f1-sent");
    expect(delivered[0]?.answers[0]).toEqual({
      name: "name",
      values: ["Ada Lovelace"],
    });
  });
});

describe("sends per visitor address", () => {
  it("are declared as ten a minute", () => {
    expect(FORM_SENDS_PER_MINUTE).toBe(10);
    expect(FORM_SEND_LIMITS[FORM_SEND_RULE]).toEqual({
      type: "window",
      windows: [{ max: 10, perMs: 60_000 }],
    });
  });

  it("refuse the eleventh in a minute, sending nothing, and admit again after it", async () => {
    const { deps, delivered, advance } = parts();
    for (let send = 1; send <= 10; send += 1) {
      const response = await receiveFormPost(post(ANSWERS), deps);
      expect(location(response), `send ${send}`).toBe("/contact#form-f1-sent");
      advance(1000);
    }
    const eleventh = await receiveFormPost(post(ANSWERS), deps);

    expect(location(eleventh)).toBe("/contact#form-f1-error");
    expect(Number(eleventh.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(delivered.length).toBe(10);

    advance(60_000);
    expect(location(await receiveFormPost(post(ANSWERS), deps))).toBe(
      "/contact#form-f1-sent"
    );
  });

  it("are counted by the visitor's address, and shared when it cannot be read", async () => {
    const { deps, limits } = parts();
    await receiveFormPost(post(ANSWERS), deps);
    expect(limits.reserve).toHaveBeenLastCalledWith([
      { rule: FORM_SEND_RULE, key: "203.0.113.9" },
    ]);

    const unread = parts();
    unread.deps = {
      ...unread.deps,
      limits: { ...unread.limits, clientKey: () => null },
    };
    await receiveFormPost(post(ANSWERS), unread.deps);
    expect(unread.limits.reserve).toHaveBeenLastCalledWith([
      { rule: FORM_SEND_RULE, key: "unresolved-address" },
    ]);
  });

  it("refuse every send while the limit cannot be checked", async () => {
    for (const limits of [
      undefined,
      {
        reserve: async () => ({ status: "unavailable" as const }),
        clientKey: () => "203.0.113.9",
      },
      {
        reserve: async () => {
          throw new Error("store down");
        },
        clientKey: () => "203.0.113.9",
      },
    ]) {
      const { deps, delivered } = parts();
      const response = await receiveFormPost(post(ANSWERS), {
        ...deps,
        limits,
      });
      expect(location(response)).toBe("/contact#form-f1-error");
      expect(delivered).toEqual([]);
    }
  });

  it("apply to a provider's forms too, before the provider's own", async () => {
    const { deps, providers, advance } = parts(
      simpleForm({ props: { form: { provider: "acme", ref: "contact" } } })
    );
    const accept = vi.fn(
      async (): Promise<FormAcceptResult> => ({ kind: "sent" })
    );
    providers.set("acme", { ...fakeProvider(), accept });
    for (let send = 0; send < 11; send += 1) {
      await receiveFormPost(post({ email: "a@b.co" }), deps);
      advance(1);
    }
    expect(accept).toHaveBeenCalledTimes(10);
  });
});

/** A provider with one published form, `contact`, taking an email. */
function fakeProvider(overrides: Partial<FormProvider> = {}): FormProvider {
  const description: FormDescription = {
    ref: "contact",
    title: "Contact",
    fields: [{ name: "email", label: "Email", kind: "email", required: true }],
    submitText: "Send",
    afterSending: { kind: "message", message: "Thanks." },
    encoding: "urlencoded",
  };
  return {
    id: "acme",
    label: "Acme",
    list: async () => [],
    describe: async (ref): Promise<FormDescription | FormUnavailable> =>
      ref === "contact" ? description : { unavailable: "missing" },
    accept: async () => ({ kind: "sent" }),
    ...overrides,
  };
}

describe("a form picked from a provider", () => {
  const picked = simpleForm({
    props: {
      form: { provider: "acme", ref: "contact" },
      // A simple form's address left on the block is never used for it.
      action: "https://hooks.example.com/",
    },
  });

  it("hands the provider only the fields it describes, with the request", async () => {
    const { deps, providers, delivered } = parts(picked);
    const accept = vi.fn(
      async (): Promise<FormAcceptResult> => ({ kind: "sent" })
    );
    const describe = vi.fn(fakeProvider().describe);
    providers.set("acme", fakeProvider({ accept, describe }));
    const request = post({ email: "a@b.co", other: "dropped", _locale: "de" });
    const response = await receiveFormPost(request, deps);

    expect(location(response)).toBe("/contact#form-f1-sent");
    expect(describe).toHaveBeenCalledWith("contact", {
      access: { as: "public" },
      locale: "de",
    });
    const [ref, sent] = accept.mock.calls[0] as unknown as [string, FormPost];
    expect(ref).toBe("contact");
    expect([...sent.answers]).toEqual([["email", ["a@b.co"]]]);
    expect(sent.locale).toBe("de");
    expect(sent.request).toBe(request);
    expect(delivered).toEqual([]);
  });

  it("shows each outcome the provider gives", async () => {
    const cases: [FormAcceptResult | Error, string][] = [
      [{ kind: "sent" }, "/contact#form-f1-sent"],
      [
        { kind: "invalid", issues: [{ field: "email", message: "No." }] },
        "/contact#form-f1-invalid",
      ],
      [{ kind: "closed" }, "/contact#form-f1-closed"],
      [{ kind: "failed" }, "/contact#form-f1-error"],
      [new Error("provider broke"), "/contact#form-f1-error"],
      [
        { kind: "sent", afterSending: { kind: "page", href: "/thanks?x=1" } },
        "/thanks?x=1",
      ],
      [
        {
          kind: "sent",
          afterSending: { kind: "page", href: "/x/..//evil.example/" },
        },
        "/contact#form-f1-sent",
      ],
      [
        {
          kind: "sent",
          afterSending: { kind: "page", href: "https://evil.example/" },
        },
        "/contact#form-f1-sent",
      ],
    ];
    for (const [result, expected] of cases) {
      const { deps, providers } = parts(picked);
      providers.set(
        "acme",
        fakeProvider({
          accept: async () => {
            if (result instanceof Error) throw result;
            return result;
          },
        })
      );
      const response = await receiveFormPost(post({ email: "a@b.co" }), deps);
      expect(location(response), JSON.stringify(result)).toBe(expected);
    }
  });

  it("sends the visitor where the form itself says when the provider names nowhere", async () => {
    const { deps, providers } = parts(picked);
    const described = fakeProvider();
    providers.set(
      "acme",
      fakeProvider({
        describe: async ref => {
          const description = await described.describe(ref, {
            access: { as: "public" },
          });
          return "unavailable" in description
            ? description
            : {
                ...description,
                afterSending: { kind: "page", href: "/thanks" },
              };
        },
        accept: async () => ({ kind: "sent" }),
      })
    );
    const response = await receiveFormPost(post({ email: "a@b.co" }), deps);
    expect(location(response)).toBe("/thanks");
  });

  it("asks nothing of a provider whose form is closed or gone", async () => {
    for (const [unavailable, expected] of [
      ["closed", "/contact#form-f1-closed"],
      ["missing", "/contact#form-f1-error"],
    ] as const) {
      const { deps, providers } = parts(picked);
      const accept = vi.fn();
      providers.set(
        "acme",
        fakeProvider({ describe: async () => ({ unavailable }), accept })
      );
      const response = await receiveFormPost(post({ email: "a@b.co" }), deps);
      expect(location(response)).toBe(expected);
      expect(accept).not.toHaveBeenCalled();
    }
  });

  it("fails, and never falls back to the block's own fields, when the provider is not installed", async () => {
    const { deps, delivered } = parts(picked);
    const response = await receiveFormPost(post({ email: "a@b.co" }), deps);

    expect(location(response)).toBe("/contact#form-f1-error");
    expect(delivered).toEqual([]);
  });
});

describe("the block's own fields, as it draws them", () => {
  it("refuses a Dropdown's or a Choice's answer that is not one of its options", async () => {
    const { deps, delivered } = parts(
      simpleForm({
        props: {
          action: "https://hooks.example.com/in",
          fields: [
            { label: "Size", type: "select", options: ["S", "M"] },
            { label: "Visit", type: "radio", options: ["Today", "Later"] },
          ],
        },
      })
    );
    const refused = await receiveFormPost(post({ size: "XL" }), deps);
    expect(location(refused)).toBe("/contact#form-f1-invalid");
    const alsoRefused = await receiveFormPost(post({ visit: "Never" }), deps);
    expect(location(alsoRefused)).toBe("/contact#form-f1-invalid");
    expect(delivered).toEqual([]);

    const accepted = await receiveFormPost(
      post({ size: "M", visit: "Later" }),
      deps
    );
    expect(location(accepted)).toBe("/contact#form-f1-sent");
    expect(delivered[0]?.answers).toEqual([
      { name: "size", values: ["M"] },
      { name: "visit", values: ["Later"] },
    ]);
  });

  it("reads the names it sends from the labels, as the form draws them", async () => {
    const { deps, delivered } = parts(
      simpleForm({
        props: {
          action: "https://hooks.example.com/in",
          fields: [{ label: "Your email", type: "email", required: true }],
        },
      })
    );
    await receiveFormPost(post({ "your-email": "ada@example.com" }), deps);
    expect(delivered[0]?.answers).toEqual([
      { name: "your-email", values: ["ada@example.com"] },
    ]);
  });
});

describe("after sending, as the block chose", () => {
  const goTo = (props: Record<string, unknown>): BlockNode =>
    simpleForm({
      props: {
        ...simpleForm().props,
        afterSending: "page",
        ...props,
      },
    });

  it("sends the visitor to the page a simple form names", async () => {
    const { deps } = parts(goTo({ href: "/thanks?from=contact" }));
    expect(location(await receiveFormPost(post(ANSWERS), deps))).toBe(
      "/thanks?from=contact"
    );
  });

  it("sends the visitor to an address the author wrote, on another site too", async () => {
    const { deps } = parts(goTo({ href: "https://example.org/thanks" }));
    expect(location(await receiveFormPost(post(ANSWERS), deps))).toBe(
      "https://example.org/thanks"
    );
  });

  it("finds a page of the site picked by its entry, in the page's language", async () => {
    const { deps } = parts(
      goTo({ entryCollection: "pages", entryId: "p9", href: "/stale" })
    );
    const asked: unknown[] = [];
    const withAddress: ReceiverDeps = {
      ...deps,
      entryAddress: async (...args) => {
        asked.push(args);
        return "/de/danke";
      },
    };
    expect(
      location(
        await receiveFormPost(post({ ...ANSWERS, _locale: "de" }), withAddress)
      )
    ).toBe("/de/danke");
    // Told the page the visitor sent from, so the address is formed in the
    // way that page's own was.
    expect(asked).toEqual([["pages", "p9", "de", "/contact"]]);
  });

  it("shows the message where the page it names cannot be followed", async () => {
    for (const props of [
      { href: "javascript:alert(1)" },
      { href: "//evil.example/" },
      { entryCollection: "pages", entryId: "gone" },
      {},
    ]) {
      const { deps } = parts(goTo(props));
      const response = await receiveFormPost(post(ANSWERS), {
        ...deps,
        entryAddress: async () => null,
      });
      expect(location(response), JSON.stringify(props)).toBe(
        "/contact#form-f1-sent"
      );
    }
  });

  it("goes nowhere before the answers are passed on", async () => {
    const { deps } = parts(goTo({ href: "/thanks" }));
    const failing: ReceiverDeps = {
      ...deps,
      deliver: async () => ({ ok: false, reason: "status", status: 500 }),
    };
    expect(location(await receiveFormPost(post(ANSWERS), failing))).toBe(
      "/contact#form-f1-error"
    );
  });

  it("overrides a provider form's own setting with the block's", async () => {
    const thanksPage = fakeProvider({
      describe: async () => ({
        ref: "contact",
        title: "Contact",
        fields: [{ name: "email", label: "Email", kind: "email" }],
        submitText: "Send",
        afterSending: { kind: "page", href: "/form-own-page" },
        encoding: "urlencoded",
      }),
    });
    const picked = (props: Record<string, unknown>): BlockNode =>
      simpleForm({
        props: { form: { provider: "acme", ref: "contact" }, ...props },
      });
    const cases: [Record<string, unknown>, string][] = [
      [{}, "/form-own-page"],
      [{ afterSending: "form" }, "/form-own-page"],
      [{ afterSending: "message" }, "/contact#form-f1-sent"],
      [{ afterSending: "page", href: "/block-page" }, "/block-page"],
    ];
    for (const [props, expected] of cases) {
      const { deps, providers } = parts(picked(props));
      providers.set("acme", thanksPage);
      const response = await receiveFormPost(post({ email: "a@b.co" }), deps);
      expect(location(response), JSON.stringify(props)).toBe(expected);
    }
  });
});

describe("the language a page was sent from", () => {
  it("is read from its path's language segment, where it has one", async () => {
    const { languageOfPage } = await import("./route");
    expect(languageOfPage("de", "/de/kontakt")).toEqual({
      locale: "de",
      fromSegment: true,
    });
    // The default language, served without a segment, forms no prefix.
    expect(languageOfPage("en", "/contact")).toEqual({
      locale: "en",
      fromSegment: false,
    });
    expect(languageOfPage(undefined, "/de/kontakt")).toEqual({
      fromSegment: false,
    });
  });
});

describe("a provider's form that takes a file", () => {
  it("is refused plainly, never sent on without its file", async () => {
    const withFile = fakeProvider({
      describe: async () => ({
        ref: "contact",
        title: "Contact",
        fields: [
          { name: "email", label: "Email", kind: "email" },
          { name: "cv", label: "CV", kind: "file" },
        ],
        submitText: "Send",
        afterSending: { kind: "message", message: "Thanks." },
        encoding: "multipart",
      }),
      accept: vi.fn(async () => ({ kind: "sent" as const })),
    });
    const { deps, providers } = parts(
      simpleForm({ props: { form: { provider: "acme", ref: "contact" } } })
    );
    providers.set("acme", withFile);
    const response = await receiveFormPost(post({ email: "a@b.co" }), deps);

    expect(response.status).toBe(422);
    expect(await response.text()).toBe(
      "This form needs JavaScript to send a file."
    );
    expect(withFile.accept).not.toHaveBeenCalled();
  });
});
