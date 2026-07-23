/**
 * Client-side validation and wire-mapping for the webhook endpoint form.
 *
 * The zod rules mirror the server (`packages/nextly/src/schemas/_zod/webhooks.ts`)
 * so a mistake surfaces on the field instead of as a round-trip 400. The mapping
 * helpers encode the redaction contract: reading an endpoint returns header
 * values as a placeholder, and updating REPLACES the whole header set, so the
 * only safe edits are "leave headers untouched" (omit them) or "re-enter the
 * full set" (send them all) — never echo the placeholder back.
 */

import { z } from "zod";

import {
  REDACTED_HEADER_VALUE,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_EVENT_WILDCARD,
  type CreateWebhookInput,
  type UpdateWebhookInput,
  type WebhookEndpointSummary,
  type WebhookEventSubscription,
  type WebhookEventType,
} from "@admin/types/webhooks";

// RFC 9110 token for a header name; printable-ASCII (+ HTAB) for a value —
// identical to the server so the two never disagree.
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HEADER_VALUE = /^[\t\x20-\x7e\x80-\xff]*$/;
const RESERVED_HEADER_PREFIXES = ["webhook-", "content-type", "user-agent"];

export interface HeaderRow {
  name: string;
  value: string;
}

export interface WebhookFormValues {
  name: string;
  url: string;
  /** Subscribe to every event (the `*` wildcard); disables specific types. */
  allEvents: boolean;
  eventTypes: WebhookEventType[];
  headers: HeaderRow[];
  enabled: boolean;
}

const headerRowSchema = z.object({
  name: z
    .string()
    .min(1, "Header name is required.")
    .max(256, "Header name must be 256 characters or fewer.")
    .regex(
      HEADER_NAME,
      "Header names may only contain letters, digits and !#$%&'*+-.^_`|~"
    )
    .refine(
      name =>
        !RESERVED_HEADER_PREFIXES.some(reserved =>
          name.toLowerCase().startsWith(reserved)
        ),
      "webhook-*, content-type and user-agent are set by delivery and cannot be overridden."
    ),
  // The value may be empty (the server accepts it); only the redacted
  // placeholder and control characters are rejected.
  value: z
    .string()
    .max(4096, "Header value must be 4096 characters or fewer.")
    .regex(
      HEADER_VALUE,
      "Header values cannot contain line breaks or control characters."
    )
    .refine(
      value => value !== REDACTED_HEADER_VALUE,
      "Re-enter the real value; the hidden placeholder cannot be saved."
    ),
});

export const webhookFormSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required.")
      .max(255, "Name must be 255 characters or fewer."),
    url: z
      .string()
      .trim()
      .url("Must be a valid URL.")
      .max(2048, "URL must be 2048 characters or fewer.")
      // The delivery transport speaks HTTPS only, so reject other schemes here
      // rather than after a round trip.
      .refine(value => {
        try {
          return new URL(value).protocol === "https:";
        } catch {
          return false;
        }
      }, "Use an HTTPS URL."),
    allEvents: z.boolean(),
    eventTypes: z.array(z.enum(WEBHOOK_EVENT_TYPES)),
    headers: z.array(headerRowSchema),
    enabled: z.boolean(),
  })
  .refine(values => values.allEvents || values.eventTypes.length >= 1, {
    message: "Subscribe to at least one event type.",
    path: ["eventTypes"],
  })
  .refine(
    values => {
      const names = values.headers.map(header => header.name.toLowerCase());
      return new Set(names).size === names.length;
    },
    { message: "Header names must be unique.", path: ["headers"] }
  );

/** Rows with a real name become a `{ name: value }` record; empty set → undefined. */
function headersRecord(rows: HeaderRow[]): Record<string, string> | undefined {
  const named = rows.filter(row => row.name.trim() !== "");
  if (named.length === 0) return undefined;
  const record: Record<string, string> = {};
  for (const row of named) record[row.name.trim()] = row.value;
  return record;
}

function sameEvents(
  a: WebhookEventSubscription[],
  b: WebhookEventSubscription[]
): boolean {
  if (a.length !== b.length) return false;
  const set = new Set(b);
  return a.every(value => set.has(value));
}

function resolvedEventTypes(
  values: WebhookFormValues
): WebhookEventSubscription[] {
  return values.allEvents ? [WEBHOOK_EVENT_WILDCARD] : values.eventTypes;
}

export function toCreateInput(values: WebhookFormValues): CreateWebhookInput {
  return {
    name: values.name.trim(),
    url: values.url.trim(),
    eventTypes: resolvedEventTypes(values),
    enabled: values.enabled,
    headers: headersRecord(values.headers),
  };
}

/**
 * Build the minimal PATCH: only changed fields. Headers are special — because a
 * read redacts them and a write replaces the whole set, they are sent only when
 * the operator actually edited the section (`headersDirty`). Dirty with rows
 * replaces the set; dirty with no rows clears it (`null`); untouched omits them.
 */
export function toUpdateInput(
  values: WebhookFormValues,
  context: { original: WebhookEndpointSummary; headersDirty: boolean }
): UpdateWebhookInput {
  const { original, headersDirty } = context;
  const patch: UpdateWebhookInput = {};

  const name = values.name.trim();
  if (name !== original.name) patch.name = name;

  const url = values.url.trim();
  if (url !== original.url) patch.url = url;

  const eventTypes = resolvedEventTypes(values);
  if (!sameEvents(eventTypes, original.eventTypes))
    patch.eventTypes = eventTypes;

  if (values.enabled !== original.enabled) patch.enabled = values.enabled;

  if (headersDirty) {
    patch.headers = headersRecord(values.headers) ?? null;
  }

  return patch;
}

/**
 * Seed form values from a loaded endpoint. The editable headers list starts
 * EMPTY: a read redacts header values and an update replaces the whole set, so
 * seeding rows would either force re-entry of every value or overwrite real
 * values with blanks. The edit page shows the current header names read-only
 * instead, and an untouched headers section is omitted from the PATCH.
 */
export function toFormValues(
  endpoint: WebhookEndpointSummary
): WebhookFormValues {
  const allEvents = endpoint.eventTypes.includes(WEBHOOK_EVENT_WILDCARD);
  return {
    name: endpoint.name,
    url: endpoint.url,
    allEvents,
    eventTypes: allEvents
      ? []
      : endpoint.eventTypes.filter(type => type !== WEBHOOK_EVENT_WILDCARD),
    headers: [],
    enabled: endpoint.enabled,
  };
}
