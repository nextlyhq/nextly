/**
 * The brand facts the SEO settings keep beyond the brand's name, other
 * names, logo and profiles: what the brand is, how to reach it, when it was
 * founded and who owns it. Every one of them the plugin's options can also
 * give (`structuredData.brand`), so a site can move each from its code to
 * the admin; the founders and a contact point's languages stay the options'.
 *
 * Kept as one value, `brandDetails`, shared by the Single that refuses a bad
 * value, the reader that hands them to structured data and the screen that
 * explains a problem as a person types.
 *
 * @module settings/brand-details
 */
import { isRecord } from "../plain-values";
import type {
  StructuredDataContactPoint,
  StructuredDataParentOrganization,
} from "../structured-data/rules";

/** The brand details as structured data takes them, blanks left out. */
export interface BrandDetails {
  description?: string;
  email?: string;
  telephone?: string;
  /** When it was founded, as ISO 8601 (`2020`, `2020-03`, `2020-03-01`). */
  foundingDate?: string;
  /** Ways to reach the brand; none read as none kept. */
  contactPoints?: StructuredDataContactPoint[];
  /** What the settings say of the owner: only the facts they hold. */
  parentOrganization?: Partial<
    Omit<StructuredDataParentOrganization, "sameAs">
  >;
}

/** An email address: no slash or colon, so a web address holding one is not. */
const EMAIL = /^[^\s@/:]+@[^\s@/:]+\.[^\s@/:]+$/;
const TELEPHONE = /^\+?[0-9][0-9 ().-]{3,}[0-9]$/;
const WEB_ADDRESS = /^https?:\/\/[^\s/]+\.\S+$/i;
const FOUNDING_DATE = /^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$/;

/** The facts the stored value may hold, beside the contact points and the owner. */
const SCALARS = ["description", "email", "telephone", "foundingDate"] as const;

/** The owner's facts the stored value may hold. */
const PARENT_FACTS = ["name", "url", "description", "foundingDate"] as const;

/** Why `value` is not an email address; null when it is. */
export function emailProblem(value: string): string | null {
  return EMAIL.test(value) ? null : "Write a whole email address.";
}

/** Why `value` is not a telephone number; null when it is. */
export function telephoneProblem(value: string): string | null {
  return TELEPHONE.test(value)
    ? null
    : "Write a telephone number, with its country code, such as +1 555 0100.";
}

/** Why `value` is not a founding date; null when it is. */
export function foundingDateProblem(value: string): string | null {
  return FOUNDING_DATE.test(value)
    ? null
    : "Write the year, or the year, month and day, such as 2020 or 2020-03-01.";
}

/** Why `value` is not a whole web address; null when it is. */
export function webAddressProblem(value: string): string | null {
  return WEB_ADDRESS.test(value)
    ? null
    : "Write the whole address, starting with https://.";
}

/** Which way to reach the brand `value` is, told by its form. */
function contactKindOf(
  value: string
): "email" | "telephone" | "url" | undefined {
  // A web address first: one may hold an email address in its query.
  if (WEB_ADDRESS.test(value)) return "url";
  if (EMAIL.test(value)) return "email";
  if (TELEPHONE.test(value)) return "telephone";
  return undefined;
}

/** Why `value` is not one way to reach the brand; null when it is. */
export function contactProblem(value: string): string | null {
  return contactKindOf(value.trim()) === undefined
    ? "Write an email address, a telephone number or a web address."
    : null;
}

/**
 * A contact point from its purpose and one way to reach it, as typed: an
 * email address, a web address or a telephone number, told by its form.
 * Null where `value` is none of them.
 */
export function contactPointOf(
  contactType: string,
  value: string
): StructuredDataContactPoint | null {
  const reach = value.trim();
  const kind = contactKindOf(reach);
  return kind === undefined
    ? null
    : { contactType: contactType.trim(), [kind]: reach };
}

/** The one way to reach a contact point, as the screen shows it. */
export function contactValueOf(point: StructuredDataContactPoint): string {
  return point.email ?? point.telephone ?? point.url ?? "";
}

/** Why a stored text fact is wrong, by the rule its name keeps it to. */
function factProblem(name: string, value: unknown): string | null {
  if (typeof value !== "string") return `The brand's ${name} must be text.`;
  if (value.trim() === "") return null;
  if (name === "email") return emailProblem(value.trim());
  if (name === "telephone") return telephoneProblem(value.trim());
  if (name === "foundingDate") return foundingDateProblem(value.trim());
  if (name === "url") return webAddressProblem(value.trim());
  return null;
}

/** The ways a contact point can be reached, one of which it holds. */
const WAYS = ["email", "telephone", "url"] as const;

/** Why one stored contact point is not one; null when it is. */
function contactPointProblem(point: unknown): string | null {
  if (
    !isRecord(point) ||
    typeof point.contactType !== "string" ||
    point.contactType.trim() === ""
  ) {
    return "Each contact point must say what it is for.";
  }
  const ways = WAYS.filter(way => point[way] !== undefined);
  const [way] = ways;
  if (ways.length !== 1 || way === undefined) {
    return `The ${point.contactType} contact point needs one way to reach it.`;
  }
  return factProblem(way, point[way]);
}

/** Why a stored list of contact points is not one; null when it is. */
function contactPointsProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!Array.isArray(value)) return "Contact points must be a list.";
  for (const point of value) {
    const problem = contactPointProblem(point);
    if (problem !== null) return problem;
  }
  return null;
}

/** Why a stored parent organisation is not one; null when it is. */
function parentProblem(value: unknown): string | null {
  if (value === undefined) return null;
  if (!isRecord(value)) {
    return "The parent organization must be kept as named facts.";
  }
  for (const [name, fact] of Object.entries(value)) {
    if (!(PARENT_FACTS as readonly string[]).includes(name)) {
      return `The parent organization has no fact called ${name}.`;
    }
    const problem = factProblem(name, fact);
    if (problem !== null) return problem;
  }
  return null;
}

/** Why one stored brand fact, by its name, is wrong; null when it is fine. */
function namedFactProblem(name: string, fact: unknown): string | null {
  if (name === "contactPoints") return contactPointsProblem(fact);
  if (name === "parentOrganization") return parentProblem(fact);
  if ((SCALARS as readonly string[]).includes(name)) {
    return factProblem(name, fact);
  }
  return `The brand has no fact called ${name}.`;
}

/** Why a stored `brandDetails` value is not one; null when it is. */
export function brandDetailsProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return "Brand details must be kept as named facts.";
  for (const [name, fact] of Object.entries(value)) {
    const problem = namedFactProblem(name, fact);
    if (problem !== null) return problem;
  }
  return null;
}

/** A stored text fact, trimmed, where it is not blank. */
const factOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;

/** The facts of `names` in `record` that are set, trimmed. */
function factsOf<K extends string>(
  record: Readonly<Record<string, unknown>>,
  names: readonly K[]
): Partial<Record<K, string>> {
  const facts: Partial<Record<K, string>> = {};
  for (const name of names) {
    const fact = factOf(record[name]);
    if (fact !== undefined) facts[name] = fact;
  }
  return facts;
}

/**
 * The stored brand details, as structured data takes them: blanks left out,
 * and nothing where none are stored or the stored value fails its rule.
 */
export function brandDetailsOf(value: unknown): BrandDetails {
  if (!isRecord(value) || brandDetailsProblem(value) !== null) return {};
  const contactPoints = (
    Array.isArray(value.contactPoints) ? value.contactPoints : []
  )
    .filter(isRecord)
    .map(point => ({
      contactType: String(point.contactType).trim(),
      ...factsOf(point, WAYS),
    }));
  const parent = isRecord(value.parentOrganization)
    ? factsOf(value.parentOrganization, PARENT_FACTS)
    : {};
  return {
    ...factsOf(value, SCALARS),
    ...(contactPoints.length === 0 ? {} : { contactPoints }),
    ...(Object.keys(parent).length === 0 ? {} : { parentOrganization: parent }),
  };
}
