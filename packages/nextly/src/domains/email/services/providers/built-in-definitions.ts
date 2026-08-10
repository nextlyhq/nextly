/**
 * The providers Nextly ships with, expressed as definitions.
 *
 * These are the exemplars a third-party provider is written against, so they
 * declare everything a plugin would have to: field metadata, which values are
 * secret, and an authoritative parse. Nothing here is privileged — the registry
 * treats a built-in and a plugin provider identically, and that is the point.
 *
 * They stay in core because each is either zero-dependency (`resend`,
 * `sendlayer`, both plain `fetch`) or carries a dependency the host already
 * chooses to install (`smtp` via nodemailer). Weight, not vendor identity, is
 * what decides whether a provider belongs in a package.
 *
 * @module domains/email/services/providers/built-in-definitions
 */

import { z } from "zod";

import { NextlyError } from "../../../../errors";
import type { RegisteredEmailProvider } from "../../provider-definition";
import { defineEmailProvider } from "../../provider-definition";

import { createResendProvider } from "./resend-provider";
import { createSendLayerProvider } from "./sendlayer-provider";
import {
  assertTransportIsSafe,
  createSmtpProvider,
  isLoopbackHost,
  verifySmtpConnection,
} from "./smtp-provider";

/**
 * Turn a Zod failure into the error the API boundary reports.
 *
 * Zod is used here and never escapes: `parseConfig` is a plain function in the
 * public contract precisely so a provider package is not forced onto core's
 * validation library or its version.
 */
function parseOrThrow<T>(
  schema: z.ZodType<T>,
  input: unknown,
  type: string
): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  throw NextlyError.validation({
    errors: result.error.issues.map(issue => ({
      // A root-level issue (a non-object input, say) carries an empty path, and
      // joining it produced a trailing dot -- "configuration." names no field.
      path:
        issue.path.length > 0
          ? `configuration.${issue.path.join(".")}`
          : "configuration",
      code: "INVALID_PROVIDER_CONFIG",
      message: issue.message,
    })),
    logContext: { providerType: type },
  });
}

/**
 * Credentials are required for a remote server and optional for a loopback one.
 *
 * A local sink -- Mailpit, MailHog -- accepts anything and is documented with
 * `SMTP_USER=` and `SMTP_PASS=` empty (`docs/guides/email.mdx`), so demanding
 * them would reject the repository's own local development configuration.
 * A remote server that genuinely needs no credentials is not a case worth
 * opening the door for: unauthenticated relay to a remote host is a misconfig
 * far more often than an intention.
 */
const smtpSchema = z
  .object({
    host: z.string().min(1, "SMTP host is required"),
    port: z.coerce
      .number()
      .int("Port must be a whole number")
      .min(1, "Port must be between 1 and 65535")
      .max(65535, "Port must be between 1 and 65535"),
    secure: z.boolean().optional(),
    auth: z.object({
      user: z.string(),
      pass: z.string(),
    }),
  })
  .superRefine((config, ctx) => {
    if (isLoopbackHost(config.host)) return;
    if (config.auth.user === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["auth", "user"],
        message: "SMTP username is required",
      });
    }
    if (config.auth.pass === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["auth", "pass"],
        message: "SMTP password is required",
      });
    }
  });

const apiKeySchema = (label: string) =>
  z.object({ apiKey: z.string().min(1, `${label} API key is required`) });

export const smtpDefinition: RegisteredEmailProvider = defineEmailProvider({
  type: "smtp",
  label: "SMTP",
  description: "Send through your own SMTP server or a relay.",
  // The only built-in that can be asked whether it works without sending.
  capabilities: { attachments: true, replyTo: true, connectionTest: true },
  configFields: [
    {
      name: "host",
      label: "SMTP Host",
      kind: "text",
      required: true,
      help: "Hostname of your SMTP server.",
      placeholder: "smtp.example.com",
    },
    {
      name: "port",
      label: "SMTP Port",
      kind: "number",
      required: true,
      default: 587,
      help: "Commonly 587 for STARTTLS, 465 for implicit TLS.",
      constraints: { min: 1, max: 65535 },
    },
    {
      name: "secure",
      label: "Use Secure Connection (SSL/TLS)",
      kind: "boolean",
      default: false,
      help: "Required for port 465. Port 587 upgrades with STARTTLS instead.",
    },
    // NOT marked required, because they are not unconditionally required:
    // `smtpSchema` accepts empty credentials for a loopback host and demands
    // them for a remote one. `required` can only state an absolute rule, so
    // declaring it here would make a catalog-driven client refuse exactly the
    // Mailpit setup this repository documents. The parser stays authoritative
    // and reports the missing credential against `configuration.auth.*`.
    {
      name: "auth.user",
      label: "SMTP Username",
      kind: "text",
      help: "Account used to authenticate against the server. May be left empty only for a local sink such as Mailpit.",
    },
    {
      name: "auth.pass",
      label: "SMTP Password",
      kind: "password",
      secret: true,
      help: "May be left empty only for a local sink such as Mailpit.",
    },
  ],
  parseConfig: input => {
    const config = parseOrThrow(smtpSchema, input, "smtp");
    // The transport-safety rule runs HERE, not only when an adapter is built.
    // Otherwise a plaintext-to-remote configuration saves successfully and is
    // refused at the first send -- a provider the admin reports as created and
    // that cannot be used, which is exactly what validating at the write
    // boundary exists to prevent.
    try {
      assertTransportIsSafe(config);
    } catch (error) {
      throw NextlyError.validation({
        errors: [
          {
            path: "configuration.secure",
            code: "INVALID_PROVIDER_CONFIG",
            message:
              "Refusing plaintext SMTP to a remote host. Use TLS (port 465), STARTTLS (port 587), or a loopback host.",
          },
        ],
        cause: error instanceof Error ? error : undefined,
        logContext: { providerType: "smtp" },
      });
    }
    return config;
  },
  createAdapter: config => createSmtpProvider(config),
  testConnection: config => verifySmtpConnection(config),
});

export const resendDefinition: RegisteredEmailProvider = defineEmailProvider({
  type: "resend",
  label: "Resend",
  description: "Send through the Resend API.",
  docsUrl: "https://resend.com/docs/api-reference/emails/send-email",
  // Resend publishes a shared address that works before any domain is
  // verified, so "use a verified domain" alone would make a usable test
  // configuration look impossible. The limitation is stated with it, because
  // the address silently only delivers to the account holder.
  senderGuidance:
    "For testing without a verified domain, use onboarding@resend.dev — it delivers only to the email address on your Resend account.",
  // A hosted API that only accepts senders on a domain verified in the account.
  // Declared, because nothing else in the descriptor distinguishes a hosted
  // provider from a relay the operator runs themselves.
  capabilities: {
    attachments: true,
    replyTo: true,
    requiresVerifiedSender: true,
  },
  configFields: [
    {
      name: "apiKey",
      label: "API Key",
      kind: "password",
      required: true,
      secret: true,
      placeholder: "re_...",
      help: "Created in the Resend dashboard under API Keys.",
    },
  ],
  parseConfig: input => parseOrThrow(apiKeySchema("Resend"), input, "resend"),
  createAdapter: config => createResendProvider(config),
});

export const sendLayerDefinition: RegisteredEmailProvider = defineEmailProvider(
  {
    type: "sendlayer",
    label: "SendLayer",
    description: "Send through the SendLayer API.",
    docsUrl: "https://sendlayer.com/docs/",
    capabilities: {
      attachments: true,
      replyTo: true,
      requiresVerifiedSender: true,
    },
    configFields: [
      {
        name: "apiKey",
        label: "API Key",
        kind: "password",
        required: true,
        secret: true,
        help: "Found in your SendLayer account settings.",
      },
    ],
    parseConfig: input =>
      parseOrThrow(apiKeySchema("SendLayer"), input, "sendlayer"),
    createAdapter: config => createSendLayerProvider(config),
  }
);

/** Every provider seeded into a fresh registry. */
export const BUILT_IN_EMAIL_PROVIDERS: ReadonlyArray<RegisteredEmailProvider> =
  [smtpDefinition, resendDefinition, sendLayerDefinition];
