/**
 * The DTCG file's shapes as Nextly reads and writes them: the extension
 * Nextly's own fields travel in, a token node, the DTCG types and the token
 * kind each maps to, the issue and plain-object helpers every reader uses, and a node's
 * stated type, description and extensions as every reader takes them.
 *
 * @module style/dtcg-format
 */
import type { ValidationIssue } from "../validation";

import type { TokenKind } from "./catalog-types";

/** The key this vendor's data lives under, in the notation the format asks for. */
export const NEXTLY_EXTENSION = "com.nextlyhq.nextly";

/** What this writes under its own extension key. */
export interface NextlyExtension {
  /** The exact CSS per mode, which is what makes a round trip exact. */
  css: { light: string; dark?: string };
  kind: TokenKind;
  /**
   * The token's stable identity, when it has one distinct from its name.
   *
   * It rides HERE because the format leaves nowhere else for it. DTCG has no
   * concept of a token id — a name is the only identity it knows, and `{a.b}`
   * aliases resolve by path — while every property the format defines is
   * `$`-prefixed and that prefix is reserved for future versions of the spec,
   * so a `$id` of this system's invention would squat on it. `$extensions`
   * under a reverse-domain key is what the spec offers instead, and what it
   * guarantees: extension data a tool does not understand MUST be preserved,
   * so an identity that leaves through Figma or Style Dictionary comes back.
   *
   * Omitted when the name IS the identity, so a file this exports carries no
   * field a reader has to interpret to arrive at the token that was written.
   */
  id?: string;
  /**
   * The token's plain label, when it has one. The format has no field for a
   * display name beside the path, so it rides here with the identity.
   */
  label?: string;
  /**
   * The token's own description, `null` for none, written only when
   * `$description` holds text this system added: a fluid size names its
   * `clamp()` there for other tools, and the import gives back only what the
   * author wrote.
   */
  description?: string | null;
}

/** A DTCG group or token; the format is a tree of plain JSON. */
export type DtcgNode = { [key: string]: unknown };

/** The `$type` each kind projects onto, or `undefined` where DTCG has none. */
export const DTCG_TYPE: Partial<Record<TokenKind, string>> = {
  color: "color",
  dimension: "dimension",
  fontFamily: "fontFamily",
  fontWeight: "fontWeight",
  number: "number",
  duration: "duration",
  shadow: "shadow",
};

/** The kinds a `$type` projects back onto. */
export const KIND_BY_TYPE: Map<string, TokenKind> = new Map<string, TokenKind>([
  ...Object.entries(DTCG_TYPE).map(([kind, type]): [string, TokenKind] => [
    type,
    kind as TokenKind,
  ]),
  // The one type outside DTCG this reads: Figma writes a string variable as
  // `string`, which is how the Figma export writes a custom value, so a file
  // from Figma or from this system's own Figma export comes back as one.
  ["string", "custom"],
]);

export function issue(message: string): ValidationIssue {
  return {
    path: "siteTokens",
    code: "invalid-style-value",
    severity: "warning",
    message,
  };
}

/**
 * A node's own `$type` as the reader takes it: a name, or nothing.
 *
 * This and the two below are the ONE place each field's acceptance is decided.
 * The walk, the token reader and the report of what was passed over all ask
 * them, so the report cannot call a field ignored that the reader used, or stay
 * silent about one it dropped — a disagreement that would otherwise have no
 * symptom until someone widened one side.
 */
export function statedType(node: DtcgNode): string | undefined {
  return typeof node.$type === "string" ? node.$type : undefined;
}

/** A token's own `$description` as the reader takes it: text, or nothing. */
export function statedDescription(node: DtcgNode): string | undefined {
  return typeof node.$description === "string" ? node.$description : undefined;
}

/** A token's own `$extensions` as the reader takes them: an object, or nothing. */
export function statedExtensions(node: DtcgNode): DtcgNode | undefined {
  return isPlainObject(node.$extensions) ? node.$extensions : undefined;
}

/* ------------------------------------------------------------------ shared */

export function isPlainObject(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
