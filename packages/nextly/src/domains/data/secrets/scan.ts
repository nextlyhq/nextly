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
const MIN_SEED_LENGTH = 16;

/** One seed with the byte patterns it is looked for as. */
interface LookedFor {
  readonly seed: SeededSecret;
  readonly forms: ReadonlyArray<{ form: SightingForm; bytes: Buffer }>;
}

/** Every form one seeded value is looked for in. */
function formsOf(value: string): LookedFor["forms"] {
  const raw = Buffer.from(value, "utf8");
  const hex = raw.toString("hex");
  return [
    { form: "as written", bytes: raw },
    { form: "base64", bytes: Buffer.from(raw.toString("base64"), "utf8") },
    {
      form: "base64url",
      bytes: Buffer.from(raw.toString("base64url"), "utf8"),
    },
    { form: "hex", bytes: Buffer.from(hex, "utf8") },
    { form: "hex", bytes: Buffer.from(hex.toUpperCase(), "utf8") },
  ];
}

/** Refuse a seed short enough to be found where nobody put it. */
function assertSeedsAreLongEnough(seeds: readonly SeededSecret[]): void {
  const short = seeds.find(seed => seed.value.length < MIN_SEED_LENGTH);
  if (short === undefined) return;
  throw NextlyError.invalidInput({
    message: `A seeded secret must be at least ${MIN_SEED_LENGTH} characters, so the scan cannot match it by chance.`,
    logContext: { label: short.label, length: short.value.length },
  });
}

/** A part's content as bytes, without copying a binary part. */
function bytesOf(part: OutputPart): Buffer {
  return typeof part.content === "string"
    ? Buffer.from(part.content, "utf8")
    : Buffer.from(
        part.content.buffer,
        part.content.byteOffset,
        part.content.byteLength
      );
}

/** The forms of one seed found in one part's bytes, each form once. */
function formsFoundIn(bytes: Buffer, looked: LookedFor): SightingForm[] {
  const found = new Set<SightingForm>();
  for (const { form, bytes: needle } of looked.forms) {
    if (bytes.includes(needle)) found.add(form);
  }
  return [...found];
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
  assertSeedsAreLongEnough(seeds);
  const looked = seeds.map(seed => ({ seed, forms: formsOf(seed.value) }));
  const found: SecretSighting[] = [];
  for (const part of parts) {
    const bytes = bytesOf(part);
    for (const each of looked) {
      for (const form of formsFoundIn(bytes, each)) {
        found.push({ label: each.seed.label, where: part.where, form });
      }
    }
  }
  return found;
}
