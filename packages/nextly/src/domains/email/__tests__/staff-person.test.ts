/**
 * A send that names a staff user as its recipient.
 *
 * `person` accepts a staff user as `{ kind: "staff", id }`, so the delivery
 * record names them and their deletion can erase it. A record kept under a
 * staff user who does not exist could never be matched by that deletion, so
 * such a send is refused, and refused before any provider is contacted. The
 * integration suite (`staff-person.integration.test.ts`) reads the records on
 * each dialect; these cases pin the refusal and its order.
 */
import { describe, expect, it, vi } from "vitest";

import type { EmailProviderAdapter } from "../types";

import { NextlyError } from "../../../errors";
import { STAFF_PERSON_ID_MAX_LENGTH } from "../../../plugins/principals/ref";
import { EmailService } from "../services/email-service";

// `lib/env` only re-exports this module, and `getBaseUrl` reaches the real one
// directly, so mocking the re-export alone leaves env validation running.
vi.mock("../../../shared/lib/env", () => ({
  env: {
    NEXTLY_SECRET: "test-secret-must-be-32chars-long!!",
    DB_DIALECT: "sqlite",
    DATABASE_URL: undefined,
    NODE_ENV: "test",
    NEXT_PUBLIC_APP_URL: "http://localhost:3000",
  },
}));

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
};

/**
 * An email service whose staff-user lookup answers `found`, and whose every
 * send goes to `adapter`.
 */
function makeService(
  adapter: EmailProviderAdapter,
  found: { id: string } | undefined
): { service: EmailService; lookup: ReturnType<typeof vi.fn> } {
  const lookup = vi.fn().mockResolvedValue(found);
  const database = {
    getCapabilities: () => ({ dialect: "sqlite" as const }),
    getDrizzle: () => ({ query: { users: { findFirst: lookup } } }),
  };
  const service = new EmailService(
    database as never,
    logger as never,
    {
      getProviderDecrypted: vi.fn(),
      getDefaultProviderDecrypted: vi.fn().mockResolvedValue(null),
    } as never,
    {
      getTemplateBySlug: vi.fn().mockResolvedValue(null),
      getLayoutFor: vi.fn().mockResolvedValue(null),
    } as never,
    {
      providerConfig: { provider: "resend" as const, apiKey: "re_x" },
      from: "App <noreply@example.com>",
      templates: {
        passwordReset: () => ({ subject: "Reset", html: "<p>reset</p>" }),
      },
    }
  );
  vi.spyOn(
    service as unknown as { resolveProvider: () => Promise<unknown> },
    "resolveProvider"
  ).mockResolvedValue({
    adapter,
    from: "App <noreply@example.com>",
    providerType: "resend",
  });
  return { service, lookup };
}

function send(service: EmailService, person: { kind: string; id: string }) {
  return service.send({
    to: "ada@example.com",
    subject: "Hello",
    html: "<p>hi</p>",
    person,
  });
}

describe("a send naming a staff user", () => {
  it("is refused before any provider is contacted when the user does not exist", async () => {
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockResolvedValue({ success: true, messageId: "m1" }),
    };
    const { service, lookup } = makeService(adapter, undefined);

    await expect(
      send(service, { kind: "staff", id: "no-such-user" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });

    expect(lookup).toHaveBeenCalledTimes(1);
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it("is sent when the user exists", async () => {
    // The positive control: without it, a check that refused every staff
    // user would also pass the case above.
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockResolvedValue({ success: true, messageId: "m1" }),
    };
    const { service } = makeService(adapter, { id: "u-1" });

    await expect(send(service, { kind: "staff", id: "u-1" })).resolves.toEqual(
      expect.objectContaining({ success: true })
    );
    expect(adapter.send).toHaveBeenCalledTimes(1);
  });

  it("is refused for an id no account could have, without a lookup", async () => {
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockResolvedValue({ success: true }),
    };
    const { service, lookup } = makeService(adapter, { id: "u-1" });

    await expect(
      send(service, { kind: "staff", id: "" })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(lookup).not.toHaveBeenCalled();
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it("accepts a staff id longer than a plugin-defined person's, up to what a record holds", async () => {
    // A staff user's id is not held to the 128 characters a plugin's person
    // is: `users.id` is wider, and core's own emails always name the user.
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockResolvedValue({ success: true }),
    };
    const id = "u".repeat(150);
    const { service } = makeService(adapter, { id });

    await expect(send(service, { kind: "staff", id })).resolves.toEqual(
      expect.objectContaining({ success: true })
    );
    expect(adapter.send).toHaveBeenCalledTimes(1);
  });

  it("refuses an id longer than a record can hold, without a lookup", async () => {
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockResolvedValue({ success: true }),
    };
    const id = "u".repeat(STAFF_PERSON_ID_MAX_LENGTH + 1);
    const { service, lookup } = makeService(adapter, { id });

    await expect(send(service, { kind: "staff", id })).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it("sends core's email to a user whose id no record can hold, naming nobody", async () => {
    // Core's reset, verification and welcome emails must still reach such an
    // account, as they did before staff users were named.
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockResolvedValue({ success: true }),
    };
    const id = "u".repeat(STAFF_PERSON_ID_MAX_LENGTH + 1);
    const { service, lookup } = makeService(adapter, { id });

    const result = await service.sendPasswordResetEmail(
      "ada@example.com",
      { name: "Ada", email: "ada@example.com" },
      "tok",
      { staffUserId: id }
    );

    expect(result.success).toBe(true);
    expect(adapter.send).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("reports a failed staff lookup as a Nextly error, not the driver's", async () => {
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockResolvedValue({ success: true }),
    };
    const { service, lookup } = makeService(adapter, { id: "u-1" });
    lookup.mockRejectedValueOnce(new Error("connection lost"));

    const failure = await send(service, { kind: "staff", id: "u-1" }).catch(
      (error: unknown) => error
    );
    expect(NextlyError.is(failure)).toBe(true);
    expect(adapter.send).not.toHaveBeenCalled();
  });

  it("names nobody when a caller's user object only happens to carry an id", async () => {
    // The helpers are open to plugins, whose user objects may carry an id
    // that is no staff user's: only an explicit staffUserId names one.
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockResolvedValue({ success: true }),
    };
    const { service, lookup } = makeService(adapter, undefined);
    const member = { id: "member-1", name: "Ada", email: "ada@example.com" };

    const result = await service.sendPasswordResetEmail(
      member.email,
      member,
      "tok"
    );

    expect(result.success).toBe(true);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("names a staff user by the id as stored, not as the caller spelled it", async () => {
    // MySQL's usual collation matches `U-1` to a row stored as `u-1`; the
    // record and the deletion's digest must name one spelling.
    const adapter: EmailProviderAdapter = {
      send: vi.fn().mockResolvedValue({ success: true }),
    };
    const { service } = makeService(adapter, { id: "u-1" });
    const named = await (
      service as unknown as {
        personToRecord(value: unknown): Promise<unknown>;
      }
    ).personToRecord({ kind: "staff", id: "U-1" });

    expect(named).toEqual({ kind: "staff", id: "u-1" });
  });
});
