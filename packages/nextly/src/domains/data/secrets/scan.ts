/**
 * The "seeded secret found nowhere" scan.
 *
 * A test of anything that writes a site's data out seeds a known value into
 * every place a secret is kept, runs the writer, and hands every part of its
 * output here. The scan reports every place a seeded value turns up, so the
 * test asserts the report is empty, after a positive control (the same scan
 * over the unguarded rows) has shown it finds each one.
 *
 * Archives encode what they carry, so each value is looked for as written and
 * in the encodings an archive is likely to use: base64, base64url and hex.
 * A value is matched byte for byte, in text and in binary parts alike.
 *
 * The base64 forms match a value encoded on its own, or inside a longer
 * encoding at an offset that is a multiple of three bytes; anywhere else its
 * base64 characters differ. A writer that encodes whole parts (a compressed or
 * encrypted file) is scanned after decoding them, not by this alone.
 *
 * @module domains/data/secrets/scan
 */

import { NextlyError } from "../../../errors/nextly-error";

/** A value seeded into one place a secret is kept, and a name for that place. */
export interface SeededSecret {
  readonly label: string;
  readonly value: string;
}

/** One part of a writer's output: a file in an archive, a response body. */
export interface OutputPart {
  readonly where: string;
  readonly content: string | Uint8Array;
}

/** How a seeded value appeared. */
export type SightingForm = "as written" | "base64" | "base64url" | "hex";

export interface SecretSighting {
  readonly label: string;
  readonly where: string;
  readonly form: SightingForm;
}

/**
 * The shortest value worth seeding. A short value turns up by chance in
 * unrelated bytes, and a scan that reports noise gets its findings ignored.
 */
export const MIN_SEED_LENGTH = 16;

/** Every form one seeded value is looked for in. */
function formsOf(value: string): Array<{ form: SightingForm; bytes: Buffer }> {
  const raw = Buffer.from(value, "utf8");
  const hex = raw.toString("hex");
  return [
    { form: "as written" as const, bytes: raw },
    {
      form: "base64" as const,
      bytes: Buffer.from(raw.toString("base64"), "utf8"),
    },
    {
      form: "base64url" as const,
      bytes: Buffer.from(raw.toString("base64url"), "utf8"),
    },
    { form: "hex" as const, bytes: Buffer.from(hex, "utf8") },
    { form: "hex" as const, bytes: Buffer.from(hex.toUpperCase(), "utf8") },
  ];
}

/**
 * Every place a seeded value appears in the output.
 *
 * A form is reported once per part, so a part holding a value both as written
 * and in base64 is reported twice, once for each form.
 */
export function findSeededSecrets(
  parts: Iterable<OutputPart>,
  seeds: readonly SeededSecret[]
): SecretSighting[] {
  for (const seed of seeds) {
    if (seed.value.length < MIN_SEED_LENGTH) {
      throw NextlyError.invalidInput({
        message: `A seeded secret must be at least ${MIN_SEED_LENGTH} characters, so the scan cannot match it by chance.`,
        logContext: { label: seed.label, length: seed.value.length },
      });
    }
  }

  const looked = seeds.map(seed => ({ seed, forms: formsOf(seed.value) }));
  const found: SecretSighting[] = [];
  for (const part of parts) {
    const bytes =
      typeof part.content === "string"
        ? Buffer.from(part.content, "utf8")
        : Buffer.from(
            part.content.buffer,
            part.content.byteOffset,
            part.content.byteLength
          );
    for (const { seed, forms } of looked) {
      const seen = new Set<SightingForm>();
      for (const { form, bytes: needle } of forms) {
        if (seen.has(form)) continue;
        if (bytes.includes(needle)) {
          seen.add(form);
          found.push({ label: seed.label, where: part.where, form });
        }
      }
    }
  }
  return found;
}
