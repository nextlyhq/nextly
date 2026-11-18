/**
 * A page's own code as a document holds it (`settings.code`): read from a
 * blocks value, whether stored as text or as a record. A leaf, so the
 * published page's output reads it without the write checks.
 *
 * @module site-code/page-code
 */
import { isPlainRecord } from "@nextlyhq/blocks-engine";

/** A page's code as one document holds it: each place's text. */
export interface HeldPageCode {
  readonly head: string;
  readonly body: string;
  readonly acknowledgedCsp?: string;
}

/** Text, or empty. */
function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** A blocks value as a record: parsed where it is stored as text. */
function documentOf(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try {
      const parsed: unknown = JSON.parse(value);
      return isPlainRecord(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return isPlainRecord(value) ? value : undefined;
}

/** The code a document holds, or none where it holds no code. */
export function pageCodeOf(value: unknown): HeldPageCode | null {
  const settings = documentOf(value)?.settings;
  const code = isPlainRecord(settings) ? settings.code : undefined;
  if (!isPlainRecord(code)) return null;
  const held = { head: textOf(code.head), body: textOf(code.body) };
  if (held.head === "" && held.body === "") return null;
  const acknowledged = textOf(code.acknowledgedCsp);
  return acknowledged === ""
    ? held
    : { ...held, acknowledgedCsp: acknowledged };
}

/** Whether two documents' code is the same, the acknowledgement aside. */
export function samePageCode(
  a: HeldPageCode | null,
  b: HeldPageCode | null
): boolean {
  if (a === null || b === null) return a === b;
  return a.head === b.head && a.body === b.body;
}
