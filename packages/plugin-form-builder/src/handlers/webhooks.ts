/**
 * Webhook Handler
 *
 * Triggers webhook notifications for form events.
 * Webhooks are fired asynchronously and do not block form submission.
 *
 * @module handlers/webhooks
 * @since 0.1.0
 */

import { safeFetch, ExternalUrlError } from "@revnixhq/nextly";

import type {
  FormDocument,
  SubmissionDocument,
  WebhookConfig,
  WebhookEvent,
} from "../types";

// ============================================================================
// Types
// ============================================================================

/**
 * Webhook payload sent to configured endpoints.
 */
export interface WebhookPayload {
  /** Event type that triggered the webhook */
  event: WebhookEvent;

  /** ISO 8601 timestamp when the event occurred */
  timestamp: string;

  /** Form information */
  form: {
    id: string;
    slug: string;
    name: string;
  };

  /** Submission information (full data or minimal based on config) */
  submission:
    | SubmissionDocument
    | {
        id: string;
        submittedAt: Date;
      };
}

/**
 * Options for triggering webhooks.
 */
export interface TriggerWebhooksOptions {
  /** Event type */
  event: WebhookEvent;

  /** Form document */
  form: FormDocument;

  /** Submission document */
  submission: SubmissionDocument;
}

/**
 * Result of a single webhook delivery attempt.
 */
export interface WebhookDeliveryResult {
  /** Webhook URL */
  url: string;

  /** Whether the delivery was successful */
  success: boolean;

  /** HTTP status code (if request completed) */
  statusCode?: number;

  /** Error message (if delivery failed) */
  error?: string;

  /** Time taken in milliseconds */
  durationMs: number;
}

/**
 * Result of triggering webhooks for an event.
 */
export interface TriggerWebhooksResult {
  /** Number of webhooks triggered */
  triggered: number;

  /** Number of successful deliveries */
  successful: number;

  /** Number of failed deliveries */
  failed: number;

  /** Individual delivery results */
  results: WebhookDeliveryResult[];
}

// ============================================================================
// Constants
// ============================================================================

/** Default timeout for webhook requests (10 seconds) */
const WEBHOOK_TIMEOUT_MS = 10_000;

/** Header name for webhook signature */
const SIGNATURE_HEADER = "X-Webhook-Signature";

/** Header name for event type */
const EVENT_HEADER = "X-Webhook-Event";

/** Header name for delivery ID (submission ID) */
const DELIVERY_ID_HEADER = "X-Webhook-Delivery-ID";

// ============================================================================
// Signature Generation
// ============================================================================

/**
 * Generate HMAC-SHA256 signature for webhook payload.
 *
 * @param payload - The webhook payload as a string
 * @param secret - The secret key for signing
 * @returns Signature in format "sha256=<hex>"
 */
async function generateSignature(
  payload: string,
  secret: string
): Promise<string> {
  // Use Web Crypto API (works in both Node.js 18+ and browsers)
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const messageData = encoder.encode(payload);

  // Import the key
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  // Sign the message
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, messageData);

  // Convert to hex string
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

  return `sha256=${hashHex}`;
}

// ============================================================================
// Webhook Delivery
// ============================================================================

/**
 * Send a single webhook request.
 *
 * @param webhook - Webhook configuration
 * @param payload - Webhook payload
 * @returns Delivery result
 */
async function sendWebhook(
  webhook: WebhookConfig,
  payload: WebhookPayload
): Promise<WebhookDeliveryResult> {
  const startTime = Date.now();
  const payloadString = JSON.stringify(payload);

  try {
    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      [EVENT_HEADER]: payload.event,
      [DELIVERY_ID_HEADER]: payload.submission.id,
      ...webhook.headers,
    };

    // Add signature if secret is configured
    if (webhook.secret) {
      headers[SIGNATURE_HEADER] = await generateSignature(
        payloadString,
        webhook.secret
      );
    }

    // Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

    try {
      const response = await safeFetch(webhook.url, {
        method: webhook.method || "POST",
        headers,
        body: payloadString,
        signal: controller.signal,
        allowLocalhost: process.env.NODE_ENV !== "production",
      });

      clearTimeout(timeoutId);

      const durationMs = Date.now() - startTime;

      // Consider 2xx status codes as success
      if (response.ok) {
        return {
          url: webhook.url,
          success: true,
          statusCode: response.status,
          durationMs,
        };
      }

      return {
        url: webhook.url,
        success: false,
        statusCode: response.status,
        error: `HTTP ${response.status}: ${response.statusText}`,
        durationMs,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  } catch (error) {
    const durationMs = Date.now() - startTime;

    // Handle abort (timeout)
    if (error instanceof Error && error.name === "AbortError") {
      return {
        url: webhook.url,
        success: false,
        error: `Timeout after ${WEBHOOK_TIMEOUT_MS}ms`,
        durationMs,
      };
    }

    // Audit C3/H8 (T-008): the webhook URL pointed at an internal/
    // non-public address and was refused before the request left the
    // host. Surface as a distinct delivery failure.
    if (error instanceof ExternalUrlError) {
      return {
        url: webhook.url,
        success: false,
        error: `Webhook URL rejected for SSRF safety: ${error.message}`,
        durationMs,
      };
    }

    // Handle other errors
    return {
      url: webhook.url,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs,
    };
  }
}

// ============================================================================
// Main Webhook Trigger Function
// ============================================================================

/**
 * Trigger webhooks for a form event.
 *
 * This function fires all matching webhooks asynchronously and does not
 * block form submission. Failed webhooks are logged but do not cause
 * submission failures.
 *
 * @param options - Trigger options
 * @returns Result of webhook triggering
 *
 * @example
 * ```typescript
 * // After creating a submission
 * const result = await triggerWebhooks({
 *   event: 'submission.created',
 *   form,
 *   submission,
 * });
 *
 * console.log(`Triggered ${result.triggered} webhooks`);
 * console.log(`Successful: ${result.successful}, Failed: ${result.failed}`);
 * ```
 */
export async function triggerWebhooks(
  options: TriggerWebhooksOptions
): Promise<TriggerWebhooksResult> {
  const { event, form, submission } = options;

  // Get webhooks configured on the form
  const webhooks = form.webhooks || [];

  // Filter webhooks that subscribe to this event
  const relevantWebhooks = webhooks.filter(w => w.events.includes(event));

  if (relevantWebhooks.length === 0) {
    return {
      triggered: 0,
      successful: 0,
      failed: 0,
      results: [],
    };
  }

  // Build payloads and send webhooks in parallel
  const deliveryPromises = relevantWebhooks.map(async webhook => {
    // Build payload based on includeData setting
    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      form: {
        id: form.id,
        slug: form.slug,
        name: form.name,
      },
      submission:
        webhook.includeData !== false
          ? submission
          : {
              id: submission.id,
              submittedAt: submission.submittedAt,
            },
    };

    return sendWebhook(webhook, payload);
  });

  // Wait for all webhooks to complete (or fail)
  const results = await Promise.all(deliveryPromises);

  // Count successes and failures
  const successful = results.filter(r => r.success).length;
  const failed = results.filter(r => !r.success).length;

  return {
    triggered: relevantWebhooks.length,
    successful,
    failed,
    results,
  };
}

// ============================================================================
// Fire-and-Forget Helper
// ============================================================================

/**
 * Trigger webhooks without waiting for completion.
 *
 * This is the recommended way to call webhooks from submission handlers
 * as it doesn't block the response. Errors are logged but not thrown.
 *
 * @param options - Trigger options
 * @param logger - Optional logger for error reporting
 *
 * @example
 * ```typescript
 * // In submission handler - fire and forget
 * fireWebhooks(
 *   { event: 'submission.created', form, submission },
 *   pluginContext.infra.logger
 * );
 *
 * // Continue with response immediately
 * return { success: true, submission };
 * ```
 */
export function fireWebhooks(
  options: TriggerWebhooksOptions,
  logger?: {
    info?: (message: string, data?: Record<string, unknown>) => void;
    warn?: (message: string, data?: Record<string, unknown>) => void;
    error?: (message: string, data?: Record<string, unknown>) => void;
  }
): void {
  // Fire webhooks in background
  triggerWebhooks(options)
    .then(result => {
      if (result.triggered > 0) {
        if (result.failed > 0) {
          logger?.warn?.("Some webhooks failed", {
            event: options.event,
            formSlug: options.form.slug,
            submissionId: options.submission.id,
            triggered: result.triggered,
            successful: result.successful,
            failed: result.failed,
            errors: result.results
              .filter(r => !r.success)
              .map(r => ({ url: r.url, error: r.error })),
          });
        } else {
          logger?.info?.("Webhooks triggered successfully", {
            event: options.event,
            formSlug: options.form.slug,
            submissionId: options.submission.id,
            count: result.triggered,
          });
        }
      }
    })
    .catch(error => {
      // This shouldn't happen since triggerWebhooks catches all errors,
      // but handle it just in case
      logger?.error?.("Unexpected error triggering webhooks", {
        event: options.event,
        formSlug: options.form.slug,
        submissionId: options.submission.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate a webhook URL.
 *
 * @param url - URL to validate
 * @returns Whether the URL is valid for webhooks
 */
export function isValidWebhookUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    // Only allow HTTPS in production (HTTP allowed for localhost)
    if (
      parsed.protocol !== "https:" &&
      !parsed.hostname.match(/^(localhost|127\.0\.0\.1)$/)
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the list of supported webhook events.
 *
 * @returns Array of supported event types
 */
export function getSupportedWebhookEvents(): WebhookEvent[] {
  return ["submission.created", "submission.updated", "submission.deleted"];
}
