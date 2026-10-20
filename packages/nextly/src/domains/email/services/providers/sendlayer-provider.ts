/**
 * SendLayer Email Provider Adapter
 *
 * Implements the `EmailProviderAdapter` interface using the SendLayer REST API.
 * Each `send()` call makes a POST request to the SendLayer API — no SDK needed,
 * uses native `fetch`. Serverless-friendly.
 *
 * @module services/email/providers/sendlayer-provider
 * @since 1.0.0
 */

import { httpFailure, providerFailure, withEmailFailure } from "../../failure";
import type { EmailProviderAdapter } from "../../types";
import { displayNameAndMailbox, messageToAddresses } from "../recipients";

/** SendLayer API base URL. */
const SENDLAYER_API_URL = "https://console.sendlayer.com/api/v1/email";

/**
 * SendLayer configuration shape stored in `EmailProviderRecord.configuration`.
 * Matches the `SendLayerConfig` type minus the discriminant `provider` field.
 */
interface SendLayerProviderConfig {
  apiKey: string;
}

/**
 * The most `to` addresses SendLayer accepts on one message.
 *
 * SendLayer's rate-limit reference caps every account at 10 `To` addresses per
 * request (and 10 `CC`, 5 `BCC`). Declared so a longer list is refused before
 * the request with the limit named, instead of failing at SendLayer.
 */
export const SENDLAYER_MAX_TO = 10;

/**
 * Parse a "from" address string into name and email parts.
 *
 * Handles formats:
 * - `"App Name <noreply@example.com>"` → `{ name: "App Name", email: "noreply@example.com" }`
 * - `"noreply@example.com"` → `{ name: "", email: "noreply@example.com" }`
 */
function parseFromAddress(from: string): { name: string; email: string } {
  // Quote-aware, as the address was checked: a `<` inside a quoted display
  // name is text, not the start of the mailbox.
  return displayNameAndMailbox(from);
}

/**
 * Create a SendLayer email provider adapter.
 *
 * @param config - Decrypted SendLayer configuration from the email provider record
 * @returns An `EmailProviderAdapter` that sends emails via SendLayer REST API
 *
 * @example
 * ```typescript
 * const adapter = createSendLayerProvider({
 *   apiKey: 'your-sendlayer-api-key',
 * });
 *
 * await adapter.send({
 *   to: 'recipient@example.com',
 *   from: 'App <noreply@example.com>',
 *   subject: 'Hello',
 *   html: '<p>Hello World</p>',
 * });
 * ```
 */
export function createSendLayerProvider(
  config: SendLayerProviderConfig
): EmailProviderAdapter {
  return {
    maxToPerMessage: SENDLAYER_MAX_TO,
    async send(options) {
      const from = parseFromAddress(options.from);

      const body: Record<string, unknown> = {
        From: from,
        // Every `to` address when there is more than one, else the one. Each
        // address is split into SendLayer's name and email fields, so a
        // display-name form (`Name <user@example.com>`) is sent to the mailbox
        // it names rather than refused as an invalid email.
        To: messageToAddresses(options).map(address =>
          parseFromAddress(address)
        ),
        Subject: options.subject,
        ContentType: "HTML",
        HTMLContent: options.html,
      };

      // Plain-text alternative (SendLayer's documented PlainContent field).
      if (options.text) {
        body.PlainContent = options.text;
      }

      // Reply-To (SendLayer's documented ReplyTo array-of-address field).
      if (options.replyTo) {
        const replyTo = parseFromAddress(options.replyTo);
        body.ReplyTo = [{ name: replyTo.name, email: replyTo.email }];
      }

      if (options.cc && options.cc.length > 0) {
        body.CC = options.cc.map(address => parseFromAddress(address));
      }

      if (options.bcc && options.bcc.length > 0) {
        body.BCC = options.bcc.map(address => parseFromAddress(address));
      }

      if (options.attachments && options.attachments.length > 0) {
        body.Attachments = options.attachments.map(a => ({
          Name: a.filename,
          Content: a.content.toString("base64"),
          Type: a.mimeType,
        }));
      }

      // Whether SendLayer answered at all: a throw before it did is a network
      // failure, and a throw after it a classified or unreadable answer.
      let answered = false;
      try {
        const response = await fetch(SENDLAYER_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify(body),
        });
        answered = true;

        if (!response.ok) {
          const errorBody = await response.text();
          // Classified by status alone: SendLayer's error body names a code,
          // not whether the request can succeed later.
          throw withEmailFailure(
            new Error(
              `HTTP ${response.status}: ${errorBody || response.statusText}`
            ),
            httpFailure(response.status)
          );
        }

        const data = (await response.json()) as { MessageID?: string };

        return {
          success: true,
          messageId: data.MessageID,
        };
      } catch (error) {
        throw providerFailure(
          {
            prefix: "SendLayer provider error",
            fallback: "SendLayer send failed",
          },
          error,
          answered
        );
      }
    },
  };
}
