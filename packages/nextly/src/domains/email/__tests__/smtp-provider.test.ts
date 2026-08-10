/**
 * Tests for the SMTP email provider adapter.
 *
 * Covers:
 * - Successful send — returns success + messageId
 * - Forwards all options to nodemailer transport.sendMail (to, from, subject, html, cc, bcc)
 * - Creates transport with correct config (host, port, secure, auth)
 * - Throws provider-prefixed error on transport failure
 * - Handles missing optional fields (cc, bcc undefined)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

import { createSmtpProvider } from "../services/providers/smtp-provider";

// ── Hoist mock fns so they're available before any imports ────────────────
const mockSendMail = vi.hoisted(() => vi.fn());
const mockCreateTransport = vi.hoisted(() =>
  vi.fn(() => ({ sendMail: mockSendMail }))
);

// ── Mock nodemailer module ───────────────────────────────────────────────
vi.mock("nodemailer", () => ({
  default: {
    createTransport: mockCreateTransport,
  },
}));

// ── Helpers ──────────────────────────────────────────────────────────────

const SMTP_CONFIG = {
  host: "smtp.example.com",
  port: 587,
  secure: false,
  auth: {
    user: "user@example.com",
    pass: "test-password",
  },
};

const BASE_OPTIONS = {
  to: "recipient@example.com",
  from: "App <noreply@example.com>",
  subject: "Hello",
  html: "<p>Hello World</p>",
};

// ── Tests ────────────────────────────────────────────────────────────────

describe("createSmtpProvider", () => {
  beforeEach(() => {
    mockSendMail.mockReset();
    mockCreateTransport.mockClear();
  });

  it("returns success and messageId on a successful send", async () => {
    mockSendMail.mockResolvedValueOnce({
      messageId: "<abc123@smtp.example.com>",
    });

    const adapter = createSmtpProvider(SMTP_CONFIG);
    const result = await adapter.send(BASE_OPTIONS);

    expect(result.success).toBe(true);
    expect(result.messageId).toBe("<abc123@smtp.example.com>");
  });

  it("forwards all options to nodemailer transport.sendMail including cc and bcc", async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: "<msg1>" });

    const adapter = createSmtpProvider(SMTP_CONFIG);
    await adapter.send({
      ...BASE_OPTIONS,
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
    });

    expect(mockSendMail).toHaveBeenCalledOnce();
    expect(mockSendMail).toHaveBeenCalledWith({
      from: BASE_OPTIONS.from,
      to: BASE_OPTIONS.to,
      subject: BASE_OPTIONS.subject,
      html: BASE_OPTIONS.html,
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
    });
  });

  it("creates transport with correct config (host, port, secure, auth)", async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: "<msg2>" });

    const adapter = createSmtpProvider(SMTP_CONFIG);
    await adapter.send(BASE_OPTIONS);

    expect(mockCreateTransport).toHaveBeenCalledOnce();
    expect(mockCreateTransport).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      // Port 587 starts in the clear and upgrades. Without requireTLS
      // nodemailer upgrades only if the server ADVERTISES STARTTLS and
      // otherwise authenticates in plaintext, so a misconfigured or
      // intercepted server could collect these credentials. Forcing it makes
      // the connection fail instead, which is the right outcome for a link
      // that cannot be secured.
      requireTLS: true,
      auth: {
        user: "user@example.com",
        pass: "test-password",
      },
    });
  });

  it("sends no auth block when credentials are empty", async () => {
    // The documented Mailpit setup leaves SMTP_USER and SMTP_PASS empty.
    // nodemailer attempts an AUTH exchange whenever the key is present, so a
    // blank auth object is not the same as none -- a local sink expecting no
    // credentials should not be asked to negotiate them.
    mockSendMail.mockResolvedValueOnce({ messageId: "<msg-noauth>" });

    const adapter = createSmtpProvider({
      host: "localhost",
      port: 1025,
      secure: false,
      auth: { user: "", pass: "" },
    });
    await adapter.send(BASE_OPTIONS);

    // Asserted through the matcher rather than by indexing the mock's call
    // tuple, which vitest types as empty for an untyped mock.
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.not.objectContaining({ auth: expect.anything() })
    );
  });

  it("does not force STARTTLS against a loopback sink", async () => {
    // Mailpit and MailHog speak plaintext by design and advertise no STARTTLS.
    // The safety guard deliberately permits plaintext-on-loopback, and this
    // repository ships Mailpit in its own docker-compose, so forcing an upgrade
    // here would break the documented local development path.
    mockSendMail.mockResolvedValueOnce({ messageId: "<msg-local>" });

    const adapter = createSmtpProvider({
      host: "localhost",
      port: 1025,
      secure: false,
      auth: { user: "dev", pass: "dev" },
    });
    await adapter.send(BASE_OPTIONS);

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: false, requireTLS: false })
    );
  });

  it("does not force an upgrade when the connection is already implicitly TLS", async () => {
    // secure: true (port 465) needs no STARTTLS negotiation, so requiring one
    // would be meaningless rather than safer.
    mockSendMail.mockResolvedValueOnce({ messageId: "<msg-tls>" });

    const adapter = createSmtpProvider({
      host: "smtp.example.com",
      port: 465,
      secure: true,
      auth: { user: "user@example.com", pass: "test-password" },
    });
    await adapter.send(BASE_OPTIONS);

    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true, requireTLS: false })
    );
  });

  it("defaults secure to true when config.secure is undefined", async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: "<msg3>" });

    const configWithoutSecure = {
      host: "smtp.example.com",
      port: 465,
      auth: { user: "user@example.com", pass: "test-password" },
    };

    const adapter = createSmtpProvider(configWithoutSecure);
    await adapter.send(BASE_OPTIONS);

    // Secure-by-default: an unset `secure` resolves to true (port 465 implicit
    // TLS), never silently downgrading to plaintext.
    expect(mockCreateTransport).toHaveBeenCalledWith(
      expect.objectContaining({ secure: true })
    );
  });

  it("throws a provider-prefixed error on transport failure", async () => {
    mockSendMail.mockRejectedValueOnce(new Error("Connection refused"));

    const adapter = createSmtpProvider(SMTP_CONFIG);

    await expect(adapter.send(BASE_OPTIONS)).rejects.toThrow(
      "SMTP provider error: Connection refused"
    );
  });

  it("throws a generic provider error when a non-Error is thrown", async () => {
    mockSendMail.mockRejectedValueOnce("unexpected string error");

    const adapter = createSmtpProvider(SMTP_CONFIG);

    await expect(adapter.send(BASE_OPTIONS)).rejects.toThrow(
      "SMTP provider error: SMTP send failed"
    );
  });

  it("handles missing optional fields (cc, bcc undefined)", async () => {
    mockSendMail.mockResolvedValueOnce({ messageId: "<msg4>" });

    const adapter = createSmtpProvider(SMTP_CONFIG);
    await adapter.send(BASE_OPTIONS);

    expect(mockSendMail).toHaveBeenCalledWith({
      from: BASE_OPTIONS.from,
      to: BASE_OPTIONS.to,
      subject: BASE_OPTIONS.subject,
      html: BASE_OPTIONS.html,
      cc: undefined,
      bcc: undefined,
    });
  });

  it("creates a fresh transport on each send() call", async () => {
    mockSendMail
      .mockResolvedValueOnce({ messageId: "<id1>" })
      .mockResolvedValueOnce({ messageId: "<id2>" });

    const adapter = createSmtpProvider(SMTP_CONFIG);
    await adapter.send(BASE_OPTIONS);
    await adapter.send(BASE_OPTIONS);

    expect(mockCreateTransport).toHaveBeenCalledTimes(2);
  });
});
