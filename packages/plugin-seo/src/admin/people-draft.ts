/**
 * The People tab's list while a person edits it: read from the stored
 * `people`, written back in its stored form, and checked by the rule the
 * settings keep it to. Plain functions, so the screen and its tests share
 * them.
 *
 * @module admin/people-draft
 */
import { isRecord } from "../plain-values";
import { peopleProblem, storedPeopleOf } from "../settings/people-stored";
import type { StructuredDataPerson } from "../structured-data/rules";

/** One person (or team) as the form holds them: each fact as typed. */
export interface PersonDraft {
  name: string;
  /** Other names they go by, one a line, since a name may hold a comma. */
  otherNames: string;
  type: "person" | "organization";
  /** Their own page: from the site's root, or a whole address. */
  url: string;
  /** The identifier every site names them by, where it is not the default. */
  id: string;
  /** A picture of them: from the site's root, or a whole address. */
  image: string;
  jobTitle: string;
  description: string;
  /** Their profiles elsewhere, one address a line. */
  sameAs: string;
  /** What they are known for, separated by commas. */
  knowsAbout: string;
  worksForName: string;
  worksForUrl: string;
  founder: boolean;
}

/** A person with nothing typed yet, as "Add a person" makes one. */
export const EMPTY_PERSON: PersonDraft = {
  name: "",
  otherNames: "",
  type: "person",
  url: "",
  id: "",
  image: "",
  jobTitle: "",
  description: "",
  sameAs: "",
  knowsAbout: "",
  worksForName: "",
  worksForUrl: "",
  founder: false,
};

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

const texts = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((each): each is string => typeof each === "string")
    : [];

/** The form's values for one person as stored or as the code gives them. */
export function personDraftOf(person: Record<string, unknown>): PersonDraft {
  const employer = isRecord(person.worksFor) ? person.worksFor : {};
  return {
    name: text(person.name),
    otherNames: texts(person.otherNames).join("\n"),
    type: person.type === "organization" ? "organization" : "person",
    url: text(person.url),
    id: text(person.id),
    image: text(person.image),
    jobTitle: text(person.jobTitle),
    description: text(person.description),
    sameAs: texts(person.sameAs).join("\n"),
    knowsAbout: texts(person.knowsAbout).join(", "),
    worksForName: text(employer.name),
    worksForUrl: text(employer.url),
    founder: person.founder === true,
  };
}

/** The form's values for a stored `people`, none where none is stored. */
export function peopleDraftOf(value: unknown): PersonDraft[] {
  return (Array.isArray(value) ? value : [])
    .filter(isRecord)
    .map(personDraftOf);
}

/** A list typed with commas or lines, each item trimmed, blanks left out. */
const split = (value: string, by: RegExp): string[] =>
  value
    .split(by)
    .map(each => each.trim())
    .filter(each => each !== "");

/** The other names as typed, one a line, each trimmed, blanks left out. */
export const otherNamesOf = (value: string): string[] =>
  split(value, /\s*\n\s*/);

/** `{ [key]: value.trim() }` where the value is not blank. */
const kept = <K extends string>(
  key: K,
  value: string
): Partial<Record<K, string>> =>
  value.trim() === ""
    ? {}
    : ({ [key]: value.trim() } as Partial<Record<K, string>>);

/** `{ [key]: list }` where the list has anything in it. */
const keptList = <K extends string>(
  key: K,
  list: string[]
): Partial<Record<K, string[]>> =>
  list.length === 0 ? {} : ({ [key]: list } as Partial<Record<K, string[]>>);

/** Whether nothing at all is typed for a person. */
function isBlankPerson(draft: PersonDraft): boolean {
  return (
    JSON.stringify({ ...draft, type: "person", founder: false }) ===
    JSON.stringify(EMPTY_PERSON)
  );
}

/** One person as stored: blanks left out, lists split. */
function storedPerson(draft: PersonDraft): StructuredDataPerson {
  return {
    name: draft.name.trim(),
    ...keptList("otherNames", otherNamesOf(draft.otherNames)),
    ...(draft.type === "organization" ? { type: "organization" as const } : {}),
    ...kept("url", draft.url),
    ...kept("id", draft.id),
    ...kept("image", draft.image),
    ...kept("jobTitle", draft.jobTitle),
    ...kept("description", draft.description),
    ...keptList("sameAs", split(draft.sameAs, /\s*\n\s*/)),
    ...keptList("knowsAbout", split(draft.knowsAbout, /,/)),
    ...(draft.worksForName.trim() === ""
      ? {}
      : {
          worksFor: {
            name: draft.worksForName.trim(),
            ...kept("url", draft.worksForUrl),
          },
        }),
    ...(draft.founder ? { founder: true } : {}),
  };
}

/** The People as stored: a person with nothing typed left out. */
export function storedPeople(
  drafts: readonly PersonDraft[]
): StructuredDataPerson[] {
  return drafts.filter(draft => !isBlankPerson(draft)).map(storedPerson);
}

/** Why one person as typed can't be saved; null when they can. */
export function personDraftProblem(draft: PersonDraft): string | null {
  if (isBlankPerson(draft)) return null;
  return peopleProblem([storedPerson(draft)]);
}

/** Why the People as typed can't be saved, naming the person; null when they can. */
export function peopleDraftProblem(
  drafts: readonly PersonDraft[]
): string | null {
  return peopleProblem(storedPeople(drafts));
}

/**
 * The People the site's code gives (the plugin's `structuredData.people`
 * option), as the screen is handed them, for the People tab to show while
 * the settings list none. Read leniently: a list that is not one is none.
 */
export function codePeopleOf(value: unknown): StructuredDataPerson[] {
  return storedPeopleOf(value) ?? [];
}
