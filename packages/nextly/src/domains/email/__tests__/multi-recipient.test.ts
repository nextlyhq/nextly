/**
 * Sending one email to several `to` addresses.
 *
 * Every surface a caller sends through — the email service, which is what a
 * plugin's `ctx.services.email` is a facade of, the Direct API and both REST
 * send routes — hands the whole list to the provider, or refuses the send
 * before the provider is contacted when the list cannot be delivered whole.
 * An adapter that declares it takes several `to` addresses gets one message;
 * any other adapter gets one message per address, with `cc` and `bcc` on the
 * first only.
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { NextlyError } from "../../../errors";
import {
  FilterSeams,
  getFilterRegistry,
  resetFilterRegistry,
} from "../../../filters";
import { methodFacade } from "../../../plugins/service-facade";
import type { EmailTemplateRecord } from "../../../schemas/email-templates/types";
import type { Logger } from "../../../shared/types";
import type { EmailProviderService } from "../services/email-provider-service";
import { EmailService } from "../services/email-service";
import type { EmailTemplateService } from "../services/email-template-service";
import { DEFAULT_APP_NAME, renderTemplate } from "../services/render-template";
import {
  RESEND_MAX_TO,
  createResendProvider,
} from "../services/providers/resend-provider";
import {
  SENDLAYER_MAX_TO,
  createSendLayerProvider,
} from "../services/providers/sendlayer-provider";
import {
  SMTP_MAX_TO,
  createSmtpProvider,
} from "../services/providers/smtp-provider";
import { firstAddress } from "../services/recipients";
import type { EmailProviderAdapter } from "../types";

vi.mock("../../../lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!",
    DB_DIALECT: "sqlite",
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

// The REST routes resolve the service from the container after booting; both
// are replaced so the route runs against the service built here.
const containerGet = vi.hoisted(() => vi.fn());
vi.mock("../../../di", () => ({ container: { get: containerGet } }));
vi.mock("../../../init", () => ({
  getCachedNextly: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../auth/middleware", () => ({
  requireAuthentication: vi.fn().mockResolvedValue({ userId: "user-1" }),
  isErrorResponse: vi.fn().mockReturnValue(false),
}));

// One registered kind of person, so a send naming one gets past the check
// that the kind exists and reaches the recipient rules under test.
vi.mock("../../../plugins/principals/registry", async importActual => {
  const actual =
    await importActual<typeof import("../../../plugins/principals/registry")>();
  return {
    ...actual,
    getPrincipalKind: (kind: string) =>
      kind === "accounts:account" ? { kind } : actual.getPrincipalKind(kind),
  };
});

const mockSendMail = vi.hoisted(() => vi.fn());
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail: mockSendMail })) },
}));

import { POST as postSend } from "../../../api/email-send";
import { POST as postSendTemplate } from "../../../api/email-send-template";
import { createEmailNamespace } from "../../../direct-api/namespaces/email";
import type { NextlyContext } from "../../../direct-api/namespaces/context";

const logger: Logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

function makeDb(): DrizzleAdapter {
  return {
    dialect: "sqlite" as const,
    getDrizzle: () => ({}) as never,
    getCapabilities: () => ({ dialect: "sqlite" as const }) as never,
    connect: async () => {},
    disconnect: async () => {},
    executeQuery: async () => [],
    transaction: async <T>(fn: (tx: never) => Promise<T>) => fn({} as never),
  } as unknown as DrizzleAdapter;
}

const TEMPLATE = {
  id: "t-1",
  name: "Alert",
  slug: "alert",
  subject: "Alert",
  htmlContent: "<p>alert</p>",
  plainTextContent: null,
  variables: null,
  useLayout: false,
  isActive: true,
  providerId: null,
  attachments: null,
  preheader: null,
  kind: "template",
  layoutId: null,
  fromOverride: null,
  replyTo: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  description: null,
  owner: { kind: "site" },
  overridden: false,
  ownerChanged: false,
  setInCode: false,
} satisfies EmailTemplateRecord;

/** A service that sends through `adapter`, and every surface over it. */
function build(adapter: EmailProviderAdapter) {
  const providerService = {
    getProviderDecrypted: vi.fn(),
    getDefaultProviderDecrypted: vi.fn().mockResolvedValue({
      id: "p1",
      type: "resend",
      fromEmail: "no-reply@test.local",
      fromName: null,
      configuration: { apiKey: "k" },
      isActive: true,
    }),
  } as unknown as EmailProviderService;
  const templateService = {
    getTemplateBySlug: vi.fn().mockResolvedValue(TEMPLATE),
    resolveForSend: vi
      .fn()
      .mockResolvedValue({ template: TEMPLATE, preferCode: false }),
    getLayout: vi.fn(),
    renderStored: vi.fn((template, data) =>
      renderTemplate(template, null, data, { appName: DEFAULT_APP_NAME })
    ),
  } as unknown as EmailTemplateService;
  const recorded: Array<Record<string, unknown>> = [];
  const deliveries = {
    recordAll: vi.fn(async (rows: Array<Record<string, unknown>>) => {
      recorded.push(...rows);
    }),
  };

  const service = new EmailService(
    makeDb(),
    logger,
    providerService,
    templateService,
    undefined,
    undefined,
    deliveries as never
  );
  (service as unknown as { createAdapterFromRecord: unknown })[
    "createAdapterFromRecord"
  ] = () => adapter;
  containerGet.mockReturnValue(service);

  return {
    service,
    plugin: methodFacade(service, ["send", "sendWithTemplate"] as const),
    direct: createEmailNamespace({
      emailSendService: service,
    } as unknown as NextlyContext),
    recorded,
  };
}

function mockAdapter(maxToPerMessage?: number) {
  // Numbered, never built from the address: an id carrying a recipient is
  // withheld from the result, which is a different property from this file's.
  let sent = 0;
  const send = vi
    .fn<EmailProviderAdapter["send"]>()
    .mockImplementation(() =>
      Promise.resolve({ success: true, messageId: `m-${++sent}` })
    );
  const adapter: EmailProviderAdapter =
    maxToPerMessage === undefined ? { send } : { maxToPerMessage, send };
  return { adapter, send };
}

function post(path: string, body: unknown): Request {
  return new Request(`http://x${path}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/** The validation entry a refusal carries, whichever surface raised it. */
async function refusal(
  attempt: () => Promise<unknown>
): Promise<{ path: string; code: string }> {
  const error = await attempt().then(
    () => undefined,
    (thrown: unknown) => thrown
  );
  expect(error).toBeInstanceOf(NextlyError);
  const entry = (error as NextlyError).publicData as {
    errors: Array<{ path: string; code: string }>;
  };
  return entry.errors[0];
}

/** The validation entry of a refused REST send. */
async function restRefusal(
  response: Response
): Promise<{ path: string; code: string }> {
  expect(response.status).toBe(400);
  const body = (await response.json()) as {
    error: { data: { errors: Array<{ path: string; code: string }> } };
  };
  return body.error.data.errors[0];
}

const A = "a@example.com";
const B = "b@example.com";
const C = "c@example.com";

beforeEach(() => {
  vi.clearAllMocks();
  resetFilterRegistry();
});

describe("several `to` addresses reach the provider", () => {
  it("as one message for an adapter that declares it takes several", async () => {
    const { adapter, send } = mockAdapter(10);
    const { service } = build(adapter);

    const result = await service.send({
      to: [A, B, C],
      subject: "Hi",
      html: "<p>x</p>",
      cc: ["cc@example.com"],
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({
      to: A,
      toList: [A, B, C],
      cc: ["cc@example.com"],
    });
    expect(result).toEqual({ success: true, messageId: "m-1" });
  });

  it("as one message per address, cc and bcc on the first, for an adapter written to the earlier contract", async () => {
    const { adapter, send } = mockAdapter();
    const { service } = build(adapter);

    const result = await service.send({
      to: [A, B, C],
      subject: "Hi",
      html: "<p>x</p>",
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
    });

    const calls = send.mock.calls.map(([options]) => options);
    expect(calls.map(options => options.to)).toEqual([A, B, C]);
    // No message carries a list the adapter never declared it reads.
    for (const options of calls) expect(options).not.toHaveProperty("toList");
    // Each copied address receives the email once.
    expect(calls.map(options => options.cc)).toEqual([
      ["cc@example.com"],
      undefined,
      undefined,
    ]);
    expect(calls.map(options => options.bcc)).toEqual([
      ["bcc@example.com"],
      undefined,
      undefined,
    ]);
    expect(result).toEqual({ success: true, messageId: "m-1" });
  });

  it("reports a split send unsuccessful when any of its messages failed", async () => {
    const { adapter, send } = mockAdapter();
    send.mockImplementation(options =>
      options.to === B
        ? Promise.reject(new Error("relay refused"))
        : Promise.resolve({ success: true, messageId: "m-ok" })
    );
    const { service } = build(adapter);

    const result = await service.send({
      to: [A, B, C],
      subject: "Hi",
      html: "<p>x</p>",
    });

    // The later recipient is still sent to: one failure does not cost the
    // others their email.
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.success).toBe(false);
  });

  it("records a delivery record for every recipient", async () => {
    const { adapter } = mockAdapter();
    const { service, recorded } = build(adapter);

    await service.send({
      to: [A, B],
      subject: "Hi",
      html: "<p>x</p>",
      cc: ["cc@example.com"],
    });

    expect(
      recorded.map(row => [row.to, row.recipientKind, row.status])
    ).toEqual([
      [A, "to", "sent"],
      ["cc@example.com", "cc", "sent"],
      [B, "to", "sent"],
    ]);
  });

  it("sends a one-recipient message exactly as before, with no list", async () => {
    // Through an adapter that DOES declare several: the one-address shape is
    // the one every adapter has always been handed.
    const { adapter, send } = mockAdapter(10);
    const { service } = build(adapter);

    await service.send({ to: A, subject: "Hi", html: "<p>x</p>" });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe(A);
    expect(send.mock.calls[0][0]).not.toHaveProperty("toList");
  });

  it("sends a copied address that is also a `to` only its own message, when split", async () => {
    const { adapter, send } = mockAdapter();
    const { service, recorded } = build(adapter);

    await service.send({
      to: [A, B],
      subject: "Hi",
      html: "<p>x</p>",
      cc: [B, "cc@example.com"],
    });

    const calls = send.mock.calls.map(([options]) => options);
    expect(calls.map(options => [options.to, options.cc])).toEqual([
      [A, ["cc@example.com"]],
      [B, undefined],
    ]);
    expect(recorded.filter(row => row.to === B)).toHaveLength(1);
  });

  it("hands every split message to the provider before any after-send action runs", async () => {
    // An action that never settles. Awaited per message, it would keep every
    // recipient after the first from being sent to.
    getFilterRegistry().addAction(
      FilterSeams.EmailAfterSend,
      () => new Promise<void>(() => {})
    );
    const { adapter, send } = mockAdapter();
    const { service } = build(adapter);

    void service.send({ to: [A, B, C], subject: "Hi", html: "<p>x</p>" });

    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  });

  it("refuses more than 100 `to` addresses through any provider", async () => {
    // The adapter takes one `to` per message, so without the ceiling this
    // would be 101 provider calls from one request.
    const { adapter, send } = mockAdapter();
    const { service } = build(adapter);
    const to = Array.from({ length: 101 }, (_, i) => `r${i}@example.com`);

    const error = await service
      .send({ to, subject: "Hi", html: "<p>x</p>" })
      .catch((thrown: unknown) => thrown);

    expect(JSON.stringify((error as NextlyError).publicData)).toContain(
      "at most 100"
    );
    expect(send).not.toHaveBeenCalled();
    // The control: 100 is sent.
    await service.send({
      to: to.slice(0, 100),
      subject: "Hi",
      html: "<p>x</p>",
    });
    expect(send).toHaveBeenCalledTimes(100);
  });

  it("reads a comma-joined string of addresses as the list it names", async () => {
    // SMTP sent such a string to every address in it before `to` took a list.
    const { adapter, send } = mockAdapter(10);
    const { service } = build(adapter);

    await service.send({ to: `${A}, ${B}`, subject: "Hi", html: "<p>x</p>" });

    expect(send.mock.calls[0][0]).toMatchObject({ to: A, toList: [A, B] });
  });

  it("keeps a display name with a comma in it as one address", async () => {
    const { adapter, send } = mockAdapter(10);
    const { service } = build(adapter);

    await service.send({
      to: '"Doe, Jane" <jane@example.com>',
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(send.mock.calls[0][0].to).toBe('"Doe, Jane" <jane@example.com>');
    expect(send.mock.calls[0][0]).not.toHaveProperty("toList");
  });

  it.each([
    "a@@example.com",
    "a b@example.com",
    "a@exa mple.com",
    ".user@example.com",
    "user.@example.com",
    "user..name@example.com",
    "user@example..com",
    "user@.example.com",
    "@example.com",
    "a@",
  ])(
    "refuses %s, and sends dev@localhost and a display-name form",
    async address => {
      const { adapter, send } = mockAdapter(10);
      const { service } = build(adapter);

      const error = await service
        .send({ to: address, subject: "Hi", html: "<p>x</p>" })
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(NextlyError);
      expect(send).not.toHaveBeenCalled();
      await service.send({
        to: ["dev@localhost", "Ann <ann@example.com>"],
        subject: "Hi",
        html: "<p>x</p>",
      });
      expect(send).toHaveBeenCalledTimes(1);
    }
  );

  it.each([
    "o'brien@example.com",
    '"Joe,Smith"@example.com',
    "user@[192.0.2.1]",
    "Ann <o'brien@example.com>",
  ])("sends %s, a form RFC 5321 allows", async address => {
    const { adapter, send } = mockAdapter(10);
    const { service } = build(adapter);

    await service.send({ to: address, subject: "Hi", html: "<p>x</p>" });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0].to).toBe(address);
  });

  it("gives each split message's email.afterSend that message's recipients", async () => {
    const captured: Array<Record<string, unknown>> = [];
    getFilterRegistry().addAction(
      FilterSeams.EmailAfterSend,
      (value: Record<string, unknown>) => {
        captured.push(value);
      }
    );
    const { adapter } = mockAdapter();
    const { service } = build(adapter);

    await service.send({
      to: [A, B],
      cc: ["cc@example.com"],
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(captured.map(value => [value.to, value.recipients])).toEqual([
      [
        A,
        [
          { address: A, kind: "to" },
          { address: "cc@example.com", kind: "cc" },
        ],
      ],
      [B, [{ address: B, kind: "to" }]],
    ]);
  });

  it("splits a list of display-name addresses, so every one is sent to", async () => {
    // Read as one entry, only the last mailbox would be checked and counted,
    // and here it would be dropped as a duplicate of the first entry.
    const { adapter, send } = mockAdapter(10);
    const { service } = build(adapter);

    await service.send({
      to: [B, "Ann <ann@example.com>, Bob <b@example.com>"],
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(send.mock.calls[0][0].toList).toEqual([B, "Ann <ann@example.com>"]);
  });

  it("refuses a list with a part that is not an address", async () => {
    const { adapter, send } = mockAdapter(10);
    const { service } = build(adapter);

    const error = await service
      .send({
        to: "Ann <ann@example.com>, not-an-address",
        subject: "Hi",
        html: "<p>x</p>",
      })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(NextlyError);
    expect(send).not.toHaveBeenCalled();
  });

  it("renders for the first address of a comma-joined string, not the whole string", () => {
    expect(firstAddress(`${A}, ${B}`)).toBe(A);
    expect(firstAddress([B, A])).toBe(B);
    expect(firstAddress(A)).toBe(A);
  });

  it.each([
    '"Victim\r\nBcc: attacker@example.com" <user@example.com>',
    "user@example.com\nBcc: attacker@example.com",
    '"Tab\there" <user@example.com>',
  ])("refuses an address with a control character in it: %j", async address => {
    // Each would let the value write a header of its own at an adapter that
    // puts it in the message unescaped.
    const { adapter, send } = mockAdapter(10);
    const { service } = build(adapter);

    const error = await service
      .send({ to: address, subject: "Hi", html: "<p>x</p>" })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(NextlyError);
    expect(send).not.toHaveBeenCalled();
  });

  it("returns a split send's result when an action and the registry's own reporting both fail", async () => {
    getFilterRegistry().setLogger({
      error: () => {
        throw new Error("log transport down");
      },
    });
    let actions = 0;
    getFilterRegistry().addAction(FilterSeams.EmailAfterSend, () => {
      actions++;
      throw new Error("action failed");
    });
    const { adapter, send } = mockAdapter();
    const { service } = build(adapter);

    const result = await service.send({
      to: [A, B],
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ success: true, messageId: "m-1" });
    // Each message's actions still ran.
    expect(actions).toBe(2);
  });

  it("sends the same address once when it is listed twice", async () => {
    const { adapter, send } = mockAdapter();
    const { service } = build(adapter);

    await service.send({
      to: [A, "A@Example.com"],
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(send).toHaveBeenCalledTimes(1);
  });

  it("through every surface", async () => {
    const { adapter, send } = mockAdapter(10);
    const { plugin, direct } = build(adapter);

    await plugin.send({ to: [A, B], subject: "Hi", html: "<p>x</p>" });
    await plugin.sendWithTemplate("alert", [A, B], {});
    await direct.send({ to: [A, B], subject: "Hi", html: "<p>x</p>" });
    await direct.sendWithTemplate({ to: [A, B], template: "alert" });
    const rest = await postSend(
      post("/api/email/send", { to: [A, B], subject: "Hi", html: "<p>x</p>" })
    );
    const restTemplate = await postSendTemplate(
      post("/api/email/send-with-template", { to: [A, B], template: "alert" })
    );

    expect(rest.status).toBe(200);
    expect(restTemplate.status).toBe(200);
    expect(send.mock.calls.map(([options]) => options.toList)).toEqual(
      Array(6).fill([A, B])
    );
  });
});

describe("a send that cannot be delivered whole is refused before the provider", () => {
  type Refusal = { path: string; code: string };
  const surfaces = (
    adapter: EmailProviderAdapter
  ): Record<string, (to: unknown) => Promise<Refusal>> => {
    const { plugin, direct } = build(adapter);
    return {
      "ctx.services.email.send": (to: unknown) =>
        refusal(() =>
          plugin.send({ to: to as string[], subject: "Hi", html: "<p>x</p>" })
        ),
      "ctx.services.email.sendWithTemplate": (to: unknown) =>
        refusal(() => plugin.sendWithTemplate("alert", to as string[], {})),
      "nextly.email.send": (to: unknown) =>
        refusal(() =>
          direct.send({ to: to as string[], subject: "Hi", html: "<p>x</p>" })
        ),
      "nextly.email.sendWithTemplate": (to: unknown) =>
        refusal(() =>
          direct.sendWithTemplate({ to: to as string[], template: "alert" })
        ),
      "POST /api/email/send": async (to: unknown) =>
        restRefusal(
          await postSend(
            post("/api/email/send", { to, subject: "Hi", html: "<p>x</p>" })
          )
        ),
      "POST /api/email/send-with-template": async (to: unknown) =>
        restRefusal(
          await postSendTemplate(
            post("/api/email/send-with-template", { to, template: "alert" })
          )
        ),
    };
  };

  const surfaceNames = Object.keys(surfaces(mockAdapter().adapter));

  it.each(surfaceNames)("with no `to` address, on %s", async name => {
    const { adapter, send } = mockAdapter(10);
    const entry = await surfaces(adapter)[name]([]);
    expect(entry.path).toBe("to");
    expect(send).not.toHaveBeenCalled();
  });

  it.each(surfaceNames)(
    "with an address that is not one, naming which, on %s",
    async name => {
      const { adapter, send } = mockAdapter(10);
      const entry = await surfaces(adapter)[name]([A, "not-an-address"]);
      expect(entry.path).toBe("to.1");
      expect(send).not.toHaveBeenCalled();
    }
  );

  it.each(surfaceNames)(
    "with more `to` addresses than the adapter takes, on %s",
    async name => {
      const { adapter, send } = mockAdapter(2);
      const entry = await surfaces(adapter)[name]([A, B, C]);
      expect(entry).toMatchObject({ path: "to", code: "TOO_MANY" });
      expect(send).not.toHaveBeenCalled();
    }
  );

  it("names the limit in the refusal", async () => {
    const { adapter } = mockAdapter(2);
    const { service } = build(adapter);

    const error = await service
      .send({ to: [A, B, C], subject: "Hi", html: "<p>x</p>" })
      .catch((thrown: unknown) => thrown);

    expect(JSON.stringify((error as NextlyError).publicData)).toContain(
      "at most 2"
    );
  });

  it.each(["send", "sendWithTemplate"] as const)(
    "naming a person with more than one `to` address, on ctx.services.email.%s",
    async method => {
      const { adapter, send } = mockAdapter(10);
      const { plugin } = build(adapter);
      const person = { kind: "accounts:account", id: "acc-1" };
      const attempt = () =>
        method === "send"
          ? plugin.send({ to: [A, B], subject: "Hi", html: "<p>x</p>", person })
          : plugin.sendWithTemplate("alert", [A, B], {}, { person });

      const error = await attempt().catch((thrown: unknown) => thrown);

      // The rule's own refusal, not the one for a person that cannot be read,
      // which shares the path.
      expect(JSON.stringify((error as NextlyError).publicData)).toContain(
        "exactly one `to` address"
      );
      expect(send).not.toHaveBeenCalled();
      // The control: the same person with one address is sent.
      await (method === "send"
        ? plugin.send({ to: A, subject: "Hi", html: "<p>x</p>", person })
        : plugin.sendWithTemplate("alert", A, {}, { person }));
      expect(send).toHaveBeenCalledTimes(1);
    }
  );
});

describe("each built-in adapter's `to` limit", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });
  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  const addresses = (count: number) =>
    Array.from({ length: count }, (_, index) => `r${index}@example.com`);

  const apiAdapters = [
    {
      name: "Resend",
      max: RESEND_MAX_TO,
      adapter: () => createResendProvider({ apiKey: "re_test" }),
      sentTo: (body: Record<string, unknown>) => body.to as string[],
      okBody: { id: "msg_1" },
    },
    {
      name: "SendLayer",
      max: SENDLAYER_MAX_TO,
      adapter: () => createSendLayerProvider({ apiKey: "sl_test" }),
      sentTo: (body: Record<string, unknown>) =>
        (body.To as Array<{ email: string }>).map(entry => entry.email),
      okBody: { MessageID: "msg_1" },
    },
  ];

  it.each(apiAdapters)(
    "$name: sends to every address at its limit, in one request",
    async ({ max, adapter, sentTo, okBody }) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => okBody,
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const { service } = build(adapter());

      const result = await service.send({
        to: addresses(max),
        subject: "Hi",
        html: "<p>x</p>",
      });

      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0][1] as RequestInit;
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(sentTo(body)).toEqual(addresses(max));
    }
  );

  it.each(apiAdapters)(
    "$name: refuses one address over its limit without a request",
    async ({ max, adapter }) => {
      const fetchMock = vi.fn();
      globalThis.fetch = fetchMock as unknown as typeof fetch;
      const { service } = build(adapter());

      const error = await service
        .send({ to: addresses(max + 1), subject: "Hi", html: "<p>x</p>" })
        .catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(NextlyError);
      expect(JSON.stringify((error as NextlyError).publicData)).toContain(
        `at most ${max}`
      );
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

  it("SendLayer: sends a display-name recipient as its name and mailbox", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ MessageID: "msg_1" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { service } = build(createSendLayerProvider({ apiKey: "sl_test" }));

    await service.send({
      to: ["Ann Lee <ann@example.com>", B],
      cc: ["Ops <ops@example.com>"],
      subject: "Hi",
      html: "<p>x</p>",
    });

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.To).toEqual([
      { name: "Ann Lee", email: "ann@example.com" },
      { name: "", email: B },
    ]);
    expect(body.CC).toEqual([{ name: "Ops", email: "ops@example.com" }]);
  });

  const smtp = () =>
    createSmtpProvider({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "u", pass: "p" },
    });

  it("SMTP: sends to every address at its limit, in one message", async () => {
    mockSendMail.mockResolvedValue({ messageId: "<m@example.com>" });
    const { service } = build(smtp());

    const result = await service.send({
      to: addresses(SMTP_MAX_TO),
      subject: "Hi",
      html: "<p>x</p>",
    });

    expect(result.success).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail.mock.calls[0][0].to).toEqual(addresses(SMTP_MAX_TO));
  });

  it("SMTP: refuses one address over its limit without a session", async () => {
    const { service } = build(smtp());

    const error = await service
      .send({ to: addresses(SMTP_MAX_TO + 1), subject: "Hi", html: "<p>x</p>" })
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(NextlyError);
    expect(JSON.stringify((error as NextlyError).publicData)).toContain(
      `at most ${SMTP_MAX_TO}`
    );
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
