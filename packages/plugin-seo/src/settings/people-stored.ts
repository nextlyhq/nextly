/**
 * The rule a list of People is kept to, wherever it comes from: the SEO
 * settings Single refuses a stored list by it, structured data reads a stored
 * one through it, the plugin's options are checked by it when the plugin is
 * created, and the People tab explains a problem by it as a person types.
 * Plain functions over plain values, with no server code, so the admin's
 * client bundle shares them.
 *
 * @module settings/people-stored
 */
import { isRecord } from "../plain-values";
import type { StructuredDataPerson } from "../structured-data/rules";

import { webAddressProblem } from "./brand-details";

/** The facts one person may hold, and nothing else. */
const FACTS = [
  "name",
  "otherNames",
  "url",
  "id",
  "type",
  "jobTitle",
  "description",
  "image",
  "sameAs",
  "knowsAbout",
  "worksFor",
  "founder",
] as const;

/** The facts held as text with something in it. */
const TEXTS = ["jobTitle", "description"] as const;

/** Text with something in it. */
const filled = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

/** Why `value` is not an address on the site (`/about`) or a whole one. */
function pageAddressProblem(value: string): string | null {
  return /^\/(?!\/)\S*$/.test(value.trim())
    ? null
    : webAddressProblem(value.trim()) === null
      ? null
      : "must be an address from the site's root, such as /about, or a whole one starting with https://";
}

/** Why the fact `name` of one person is not one; null when it is. */
function factProblem(name: string, value: unknown): string | null {
  switch (name) {
    case "name":
      return filled(value) ? null : "needs a name";
    case "type":
      return value === "person" || value === "organization"
        ? null
        : "must be a person or an organization";
    case "founder":
      return typeof value === "boolean" ? null : "must be true or false";
    case "url":
    case "image":
      return typeof value === "string"
        ? pageAddressProblem(value)
        : `${name} must be text`;
    case "id":
      return typeof value === "string" &&
        webAddressProblem(value.trim()) === null
        ? null
        : "id must be a whole address, starting with https://";
    case "sameAs":
      return Array.isArray(value) &&
        value.every(
          url =>
            typeof url === "string" && webAddressProblem(url.trim()) === null
        )
        ? null
        : "profiles must each be a whole address, starting with https://";
    case "worksFor":
      return employerProblem(value);
    default:
      if ((TEXTS as readonly string[]).includes(name)) {
        return typeof value === "string" ? null : `${name} must be text`;
      }
      return Array.isArray(value) && value.every(filled)
        ? null
        : `${name} must be a list of names`;
  }
}

/** Why a stored employer is not one: a name, and a whole address if any. */
function employerProblem(value: unknown): string | null {
  if (!isRecord(value) || !filled(value.name)) {
    return "the organization they work for needs a name";
  }
  for (const [name, fact] of Object.entries(value)) {
    if (name === "name") continue;
    if (name !== "url") return `the organization they work for has no ${name}`;
    if (typeof fact !== "string" || webAddressProblem(fact.trim()) !== null) {
      return "the organization they work for must have a whole address, starting with https://";
    }
  }
  return null;
}

/** Why one person is not one, naming them; null when they are. */
function personProblem(person: unknown, at: number): string | null {
  if (!isRecord(person)) return `Person ${at + 1} must be kept as named facts.`;
  const who = filled(person.name) ? person.name.trim() : `Person ${at + 1}`;
  for (const [name, value] of Object.entries(person)) {
    if (!(FACTS as readonly string[]).includes(name)) {
      return `${who} has no fact called ${name}.`;
    }
    // A fact left out is as good as none.
    if (value === undefined) continue;
    const problem = factProblem(name, value);
    if (problem !== null) return `${who}: ${problem}.`;
  }
  return filled(person.name) ? null : `${who} needs a name.`;
}

/**
 * Why `value` is not a list of people, each with a name and only the facts a
 * person has, in one sentence naming the person; null when it is one.
 * Nothing stored is none.
 */
export function peopleProblem(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (!Array.isArray(value)) return "People must be a list.";
  for (const [at, person] of value.entries()) {
    const problem = personProblem(person, at);
    if (problem !== null) return problem;
  }
  return null;
}

/** A list of texts, each trimmed, the blank ones left out. */
const textsOf = (value: unknown): string[] =>
  (Array.isArray(value) ? value : []).filter(filled).map(each => each.trim());

/** `{ [key]: value }` where the value is set, and nothing where it is not. */
const defined = <K extends string, V>(
  key: K,
  value: V | undefined
): Partial<Record<K, V>> =>
  value === undefined ? {} : ({ [key]: value } as Partial<Record<K, V>>);

/** A text fact, trimmed, where it is not blank. */
const textIn = (value: unknown): string | undefined =>
  filled(value) ? value.trim() : undefined;

/** A list fact, trimmed, where anything is left in it. */
const listIn = (value: unknown): string[] | undefined => {
  const list = textsOf(value);
  return list.length > 0 ? list : undefined;
};

/** One stored person, each fact trimmed and blanks left out. */
function personOf(person: Record<string, unknown>): StructuredDataPerson {
  const employer = isRecord(person.worksFor) ? person.worksFor : undefined;
  const employerName = textIn(employer?.name);
  return {
    name: String(person.name).trim(),
    ...defined("otherNames", listIn(person.otherNames)),
    ...defined("url", textIn(person.url)),
    ...defined("id", textIn(person.id)),
    ...defined(
      "type",
      person.type === "organization" ? ("organization" as const) : undefined
    ),
    ...defined("jobTitle", textIn(person.jobTitle)),
    ...defined("description", textIn(person.description)),
    ...defined("image", textIn(person.image)),
    ...defined("sameAs", listIn(person.sameAs)),
    ...defined("knowsAbout", listIn(person.knowsAbout)),
    ...defined(
      "worksFor",
      employerName === undefined
        ? undefined
        : { name: employerName, ...defined("url", textIn(employer?.url)) }
    ),
    ...defined("founder", person.founder === true ? true : undefined),
  };
}

/**
 * A list of people as structured data reads it, each fact trimmed and the
 * blank ones left out; nothing where `value` fails the rule above, such as a
 * value edited past the settings' check, which is read as absent rather than
 * half-trusted.
 */
export function storedPeopleOf(
  value: unknown
): StructuredDataPerson[] | undefined {
  if (!Array.isArray(value) || peopleProblem(value) !== null) return undefined;
  return value.filter(isRecord).map(personOf);
}
