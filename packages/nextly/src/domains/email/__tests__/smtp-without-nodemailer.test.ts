/**
 * SMTP on an install that never installed nodemailer.
 *
 * The library is an optional peer dependency, so this is an ordinary state
 * rather than a broken one. What must hold: constructing still works, because
 * whether a configuration is VALID does not depend on the library being
 * present; a send fails naming the package; and the connection probe reports a
 * failure rather than throwing, because the admin renders its result.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../services/providers/nodemailer-loader", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../services/providers/nodemailer-loader")
    >();

  return {
    ...actual,
    isNodemailerAvailable: () => false,
    loadNodemailer: () =>
      Promise.reject(
        new Error(
          'The SMTP email provider needs the "nodemailer" package, which is not installed on this server.'
        )
      ),
  };
});

const CONFIG = {
  host: "smtp.example.com",
  port: 465,
  secure: true,
  auth: { user: "u", pass: "p" },
};

describe("SMTP when nodemailer is not installed", () => {
  it("still constructs, because configuration validity does not need the library", async () => {
    const { createSmtpProvider } = await import(
      "../services/providers/smtp-provider"
    );

    expect(() => createSmtpProvider(CONFIG)).not.toThrow();
  });

  it("fails the send with a message naming the package", async () => {
    const { createSmtpProvider } = await import(
      "../services/providers/smtp-provider"
    );
    const adapter = createSmtpProvider(CONFIG);

    await expect(
      adapter.send({
        to: "a@example.com",
        from: "b@example.com",
        subject: "s",
        html: "<p>h</p>",
      })
    ).rejects.toThrow(/nodemailer/);
  });

  it("reports the connection probe as failed rather than throwing", async () => {
    const { verifySmtpConnection } = await import(
      "../services/providers/smtp-provider"
    );

    const result = await verifySmtpConnection(CONFIG);

    // The probe's contract is a verdict, not an exception: the admin renders
    // `ok` and `detail`, so a throw here would surface as an unhandled failure
    // instead of the instruction the operator needs.
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/nodemailer/);
  });

  it("keeps refusing an unsafe transport before the library is ever consulted", async () => {
    const { createSmtpProvider } = await import(
      "../services/providers/smtp-provider"
    );

    // The plaintext-to-a-remote-host guard is a precondition and must not have
    // moved behind the dynamic import: a missing library is not a reason to
    // stop refusing a configuration that would put credentials on the wire.
    expect(() =>
      createSmtpProvider({
        host: "smtp.example.com",
        port: 25,
        secure: false,
        auth: { user: "u", pass: "p" },
      })
    ).toThrow();
  });
});
