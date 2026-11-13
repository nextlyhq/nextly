/**
 * The verification codes as the SEO settings store them, and the tags they
 * become: one code per service with a box, and the other services' tags as a
 * name and a code each.
 *
 * Parsed with zod where the value is written (the Single's validation) and
 * again where it is read (the home page's head), so a value edited past the
 * screen, or stored before a rule existed, is ignored rather than written
 * into a page.
 *
 * @module settings/verification-stored
 */
import { z } from "zod";

import {
  isCode,
  MAX_OTHER_SERVICES,
  readOtherName,
  VERIFICATION_SERVICES,
} from "./verification";

const code = z
  .string()
  .refine(isCode, "A code is letters and numbers, copied from the service.");

const otherTag = z
  .object({
    name: z.string().superRefine((name, context) => {
      if (name.trim() === "") {
        context.addIssue({
          code: "custom",
          message: "A tag needs a name and a code.",
        });
        return;
      }
      const read = readOtherName(name);
      if (read === null) return;
      context.addIssue({
        code: "custom",
        message:
          read.kind === "refused"
            ? read.message
            : `${name} belongs in its own box, not under other services.`,
      });
    }),
    code,
  })
  .strict();

/** The verification codes as stored. */
interface StoredVerification {
  google?: string;
  bing?: string;
  pinterest?: string;
  yandex?: string;
  baidu?: string;
  /** The other services' tags, in the order saved. */
  others?: { name: string; code: string }[];
}

/** The stored value: each service's code, and the other services' tags. */
const storedVerification: z.ZodType<StoredVerification> = z
  .object({
    google: code.optional(),
    bing: code.optional(),
    pinterest: code.optional(),
    yandex: code.optional(),
    baidu: code.optional(),
    others: z.array(otherTag).max(MAX_OTHER_SERVICES).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const tag of value.others ?? []) {
      const name = tag.name.trim().toLowerCase();
      if (seen.has(name)) {
        context.addIssue({
          code: "custom",
          message: `${tag.name} is named twice under other services.`,
        });
      }
      seen.add(name);
    }
  });

/** Why a stored set of verification codes is not one; null when it is. */
export function verificationProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const parsed = storedVerification.safeParse(value);
  return parsed.success
    ? null
    : (parsed.error.issues[0]?.message ??
        "These verification codes can't be saved.");
}

/**
 * The tags the stored `value` places in the home page's head, by meta name:
 * each service's code, then each other service's, in the order saved.
 * Nothing for a value its rule refuses, so no tag is half-trusted.
 */
export function verificationTagsOf(value: unknown): Record<string, string> {
  if (value === null || value === undefined) return {};
  const parsed = storedVerification.safeParse(value);
  if (!parsed.success) return {};
  const tags: Record<string, string> = {};
  for (const service of VERIFICATION_SERVICES) {
    const saved = parsed.data[service.key];
    if (saved !== undefined) tags[service.metaName] = saved;
  }
  for (const tag of parsed.data.others ?? []) tags[tag.name.trim()] = tag.code;
  return tags;
}
