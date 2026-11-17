/**
 * What a write may say about where its translated values came from: per field, a machine
 * translation (with its engine), an agent's, a copy from another language, or a value written
 * originally in its own language. Read at the boundary from the write's `_provenance` key and
 * checked with zod, so nothing past it trusts the shape.
 *
 * @experimental Until per-field provenance is complete.
 *
 * @module domains/i18n/provenance/provenance-claims
 */
import { z } from "zod";

import { nextlyValidationFromZod } from "../../../api/zod-to-nextly-error";
import type { RequestActor } from "../../../auth/request-actor";
import { NextlyError } from "../../../errors/nextly-error";
import { DOCUMENT_PROVENANCE_KEY } from "../../../lib/system-columns";

/**
 * For a field with a structure per language (a translated repeater or blocks field): which row of
 * the source language each of the value's rows was made from, by row id.
 */
const RowOriginsSchema = z.record(
  z.string().min(1).max(191),
  z.string().min(1).max(191)
);

const ProvenanceClaimSchema = z.discriminatedUnion("origin", [
  z
    .object({
      origin: z.literal("machine"),
      engine: z.string().min(1).max(191),
      rows: RowOriginsSchema.optional(),
    })
    .strict(),
  z
    .object({ origin: z.literal("agent"), rows: RowOriginsSchema.optional() })
    .strict(),
  z
    .object({
      origin: z.literal("copy"),
      sourceLocale: z.string().min(1).max(35),
      rows: RowOriginsSchema.optional(),
    })
    .strict(),
  z.object({ origin: z.literal("original") }).strict(),
]);

/** What one field's value is claimed to have come from. */
export type ProvenanceClaim = z.infer<typeof ProvenanceClaimSchema>;

/** Each claimed field's claim, by field name. */
export type ProvenanceClaims = Readonly<Record<string, ProvenanceClaim>>;

const ProvenanceInput = z.record(
  z.string().min(1).max(255),
  ProvenanceClaimSchema
);

/**
 * The claims a write body names under `_provenance`, or undefined when it names none.
 *
 * @throws NextlyError.validation for a value that is not one.
 */
export function provenanceClaimsOf(
  body: Readonly<Record<string, unknown>>
): ProvenanceClaims | undefined {
  if (!Object.hasOwn(body, DOCUMENT_PROVENANCE_KEY)) return undefined;
  const parsed = ProvenanceInput.safeParse(body[DOCUMENT_PROVENANCE_KEY]);
  if (!parsed.success) throw nextlyValidationFromZod(parsed.error);
  return parsed.data;
}

/**
 * The value `claims` names under `key`, read from its own keys only. Claims and their row maps are
 * plain objects, so an inherited member such as `constructor` would otherwise answer for a field or
 * row of that name that the write never claimed.
 */
export function ownEntry<T>(
  claims: Readonly<Record<string, T>> | undefined,
  key: string
): T | undefined {
  return claims !== undefined && Object.hasOwn(claims, key)
    ? claims[key]
    : undefined;
}

/**
 * Refuses a claim the writer may not make: `agent` is claimed by an agent's own credentials, an
 * API key or a plugin-defined person, never by a person signed in.
 */
export function assertClaimsAllowed(
  claims: ProvenanceClaims | undefined,
  savedBy: RequestActor | undefined
): void {
  if (claims === undefined) return;
  const agents = Object.entries(claims).filter(
    ([, claim]) => claim.origin === "agent"
  );
  if (agents.length === 0) return;
  if (savedBy?.type === "apiKey" || savedBy?.type === "principal") return;
  throw NextlyError.validation({
    errors: agents.map(([field]) => ({
      path: `${DOCUMENT_PROVENANCE_KEY}.${field}`,
      code: "PROVENANCE_AGENT_NOT_ALLOWED",
      message:
        "Only an API key or a plugin-defined person may say a value was written by an agent.",
    })),
  });
}
