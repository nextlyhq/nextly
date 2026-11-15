/**
 * The Organization tab's brand details while a person edits them: read from
 * the stored `brandDetails`, written back in its stored form, moved onto
 * newer settings, and checked before a save. Plain functions, so the screen
 * and its tests share them.
 *
 * @module admin/brand-draft
 */
import { isRecord } from "../plain-values";
import {
  contactPointOf,
  contactProblem,
  contactValueOf,
  emailProblem,
  foundingDateProblem,
  telephoneProblem,
  webAddressProblem,
} from "../settings/brand-details";
import type { StructuredDataBrand } from "../structured-data/rules";

/** One way to reach the brand, as the form holds it. */
export interface ContactPointDraft {
  /** What it is for, such as `customer support`. */
  contactType: string;
  /** An email address, a telephone number or a web address. */
  value: string;
}

/** The brand details as the form holds them: each fact as typed. */
export interface BrandDetailsDraft {
  description: string;
  email: string;
  telephone: string;
  foundingDate: string;
  contactPoints: ContactPointDraft[];
  parentName: string;
  parentUrl: string;
  parentDescription: string;
  parentFoundingDate: string;
}

/** The form's text facts, each kept and moved on its own. */
export const BRAND_TEXT_FACTS = [
  "description",
  "email",
  "telephone",
  "foundingDate",
  "parentName",
  "parentUrl",
  "parentDescription",
  "parentFoundingDate",
] as const;

/** One of the form's text facts. */
export type BrandTextFact = (typeof BRAND_TEXT_FACTS)[number];

/** The owner's facts as stored, by the form fact each is typed in. */
const PARENT_FACTS = {
  parentName: "name",
  parentUrl: "url",
  parentDescription: "description",
  parentFoundingDate: "foundingDate",
} as const;

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";

/** The form's values for a stored `brandDetails`, empty where none is stored. */
export function brandDetailsDraftOf(value: unknown): BrandDetailsDraft {
  const stored = isRecord(value) ? value : {};
  const parent = isRecord(stored.parentOrganization)
    ? stored.parentOrganization
    : {};
  return {
    description: text(stored.description),
    email: text(stored.email),
    telephone: text(stored.telephone),
    foundingDate: text(stored.foundingDate),
    contactPoints: (Array.isArray(stored.contactPoints)
      ? stored.contactPoints
      : []
    )
      .filter(isRecord)
      .map(point => ({
        contactType: text(point.contactType),
        value: contactValueOf({
          contactType: text(point.contactType),
          ...(typeof point.email === "string" ? { email: point.email } : {}),
          ...(typeof point.telephone === "string"
            ? { telephone: point.telephone }
            : {}),
          ...(typeof point.url === "string" ? { url: point.url } : {}),
        }),
      })),
    parentName: text(parent.name),
    parentUrl: text(parent.url),
    parentDescription: text(parent.description),
    parentFoundingDate: text(parent.foundingDate),
  };
}

/** `{ [key]: value.trim() }` where the value is not blank. */
const kept = <K extends string>(
  key: K,
  value: string
): Partial<Record<K, string>> =>
  value.trim() === ""
    ? {}
    : ({ [key]: value.trim() } as Partial<Record<K, string>>);

/**
 * The brand details as they are stored: blanks left out, each contact
 * point's way to reach it read from its form, and nothing at all where every
 * fact is blank.
 */
export function storedBrandDetails(
  draft: BrandDetailsDraft
): Record<string, unknown> | null {
  const contactPoints = draft.contactPoints
    .filter(point => point.value.trim() !== "")
    .map(
      point =>
        contactPointOf(point.contactType, point.value) ?? {
          // Not yet a way to reach anyone: the save is held up until it is.
          contactType: point.contactType.trim(),
          url: point.value.trim(),
        }
    );
  const parent: Record<string, string> = {};
  for (const [fact, name] of Object.entries(PARENT_FACTS)) {
    Object.assign(parent, kept(name, draft[fact as keyof typeof PARENT_FACTS]));
  }
  const stored: Record<string, unknown> = {
    ...kept("description", draft.description),
    ...kept("email", draft.email),
    ...kept("telephone", draft.telephone),
    ...kept("foundingDate", draft.foundingDate),
    ...(contactPoints.length === 0 ? {} : { contactPoints }),
    ...(Object.keys(parent).length === 0 ? {} : { parentOrganization: parent }),
  };
  return Object.keys(stored).length === 0 ? null : stored;
}

/** Why each text fact, as typed, would be refused; none where it is fine. */
const FACT_RULES: Partial<
  Record<BrandTextFact, (value: string) => string | null>
> = {
  email: emailProblem,
  telephone: telephoneProblem,
  foundingDate: foundingDateProblem,
  parentUrl: webAddressProblem,
  parentFoundingDate: foundingDateProblem,
};

/** Why one text fact, as typed, would be refused; null when it is fine or blank. */
export function brandFactProblem(
  fact: BrandTextFact,
  value: string
): string | null {
  const rule = FACT_RULES[fact];
  return rule === undefined || value.trim() === "" ? null : rule(value.trim());
}

/** Why one contact point, as typed, would be refused; null when it is fine or blank. */
export function contactPointProblem(point: ContactPointDraft): string | null {
  if (point.value.trim() === "") return null;
  if (point.contactType.trim() === "") return "Choose what it is for.";
  return contactProblem(point.value);
}

/** What stops the brand details being saved, in one sentence; null when nothing. */
export function brandDetailsDraftProblem(
  draft: BrandDetailsDraft
): string | null {
  for (const fact of BRAND_TEXT_FACTS) {
    if (brandFactProblem(fact, draft[fact]) !== null) {
      return "Fix the organization's details first.";
    }
  }
  if (draft.contactPoints.some(point => contactPointProblem(point) !== null)) {
    return "Fix the contact point first.";
  }
  // A parent organization's facts without its name are kept: the name may
  // be the site's code's, and with neither, none is named.
  return null;
}

/** A text value, where it is one that is not blank. */
const textOf = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/** The text items of a list, where it is one. */
const textsOf = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => textOf(item) !== undefined)
    : [];

/** `{ [key]: value }` where the value is text, and nothing where it is not. */
const withText = <K extends string>(
  key: K,
  value: unknown
): Partial<Record<K, string>> => {
  const found = textOf(value);
  return found === undefined
    ? {}
    : ({ [key]: found } as Partial<Record<K, string>>);
};

/**
 * The brand facts the site's code gives (the plugin's
 * `structuredData.brand` option), as the screen is handed them, for the
 * Organization tab to show where the settings hold nothing of their own.
 * Read leniently: a value that is not one is left out.
 */
export function codeBrandOf(value: unknown): StructuredDataBrand {
  if (!isRecord(value)) return {};
  const logo = isRecord(value.logo) ? textOf(value.logo.url) : undefined;
  const parent = isRecord(value.parentOrganization)
    ? value.parentOrganization
    : undefined;
  const parentName = parent === undefined ? undefined : textOf(parent.name);
  return {
    ...withText("name", value.name),
    ...(textsOf(value.otherNames).length > 0
      ? { otherNames: textsOf(value.otherNames) }
      : {}),
    ...(logo === undefined ? {} : { logo: { url: logo } }),
    ...(Array.isArray(value.profiles)
      ? {
          profiles: value.profiles
            .filter(isRecord)
            .flatMap(profile =>
              textOf(profile.url) === undefined
                ? []
                : [{ url: String(profile.url) }]
            ),
        }
      : {}),
    ...withText("description", value.description),
    ...withText("email", value.email),
    ...withText("telephone", value.telephone),
    ...withText("foundingDate", value.foundingDate),
    ...(Array.isArray(value.contactPoints)
      ? {
          contactPoints: value.contactPoints.filter(isRecord).map(point => ({
            contactType: textOf(point.contactType) ?? "",
            ...withText("email", point.email),
            ...withText("telephone", point.telephone),
            ...withText("url", point.url),
            ...(textsOf(point.availableLanguage).length > 0
              ? { availableLanguage: textsOf(point.availableLanguage) }
              : {}),
          })),
        }
      : {}),
    ...(parent === undefined || parentName === undefined
      ? {}
      : {
          parentOrganization: {
            name: parentName,
            ...withText("url", parent.url),
            ...withText("description", parent.description),
            ...withText("foundingDate", parent.foundingDate),
            ...(textsOf(parent.sameAs).length > 0
              ? { sameAs: textsOf(parent.sameAs) }
              : {}),
          },
        }),
    ...(Array.isArray(value.founders)
      ? {
          founders: value.founders.filter(isRecord).flatMap(founder => {
            const name = textOf(founder.name);
            return name === undefined
              ? []
              : [{ name, ...withText("jobTitle", founder.jobTitle) }];
          }),
        }
      : {}),
  };
}

/** The code's value for each of the form's text facts, where it gives one. */
export function codeFactOf(
  brand: StructuredDataBrand,
  fact: BrandTextFact
): string | undefined {
  const parent = brand.parentOrganization;
  switch (fact) {
    case "parentName":
      return parent?.name;
    case "parentUrl":
      return parent?.url;
    case "parentDescription":
      return parent?.description;
    case "parentFoundingDate":
      return parent?.foundingDate;
    default:
      return brand[fact];
  }
}
