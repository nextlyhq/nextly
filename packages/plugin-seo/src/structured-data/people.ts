/**
 * The site's People: each person (or team) the site names, resolved to one
 * node with one `@id`, so a founder, the default author, a post's author and
 * the subject of a profile page are one person wherever they are named.
 *
 * A name a page gives is matched to an entry by the address of the person's
 * page, then by their name or one of their other names, the same ignoring
 * case and spacing: exact matches only, so two different people are never
 * merged by a guess. A person nobody listed is described as before, from what
 * the page holds.
 *
 * On a person's site (`brand.kind: "person"`) the person who runs it is one
 * of these entries too: the entry named as the brand, over the brand's own
 * facts, so every page names the one person who publishes the site.
 *
 * @module structured-data/people
 */
import type { PageMetadataImage } from "@nextlyhq/plugin-sdk";

import { originOf } from "../origin";

import type { StructuredDataNode } from "./graph";
import { absolute, linksOf, node } from "./node-parts";
import type {
  StructuredDataBrand,
  StructuredDataPerson,
  StructuredDataRules,
} from "./rules";

/** A JSON value, as a node holds it. */
type Json = StructuredDataNode[string];

/** One entry of the site's People, with the `@id` it goes by. */
export interface PersonEntry {
  /** The node's `@id`, the one every reference to the person names. */
  id: string;
  /** Its facts, with its own page and picture at absolute addresses. */
  person: StructuredDataPerson;
  /**
   * The site's own organisation, named by its brand name: its node is the
   * site's, so none is written for the entry.
   */
  site?: true;
}

/** The people a page's graph names, resolved once per page. */
export interface People {
  /** The entry a name the page gives is, where it is one of the site's. */
  match(named: {
    name: string;
    url?: string | undefined;
  }): PersonEntry | undefined;
  /** The site's founders, each an entry. */
  founders: readonly PersonEntry[];
  /** The person who runs the site, on a person's site. */
  owner?: PersonEntry;
}

/** A page's address as matched: no query, fragment or final slash. */
function addressKey(address: string): string | undefined {
  try {
    const url = new URL(address);
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return undefined;
  }
}

/** A name as matched: its words, spaced once, in any case. */
function nameKey(name: string): string {
  return name.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
}

/** The names a person is known by: their name, then their other names. */
function namesOf(person: StructuredDataPerson): string[] {
  return [person.name, ...(person.otherNames ?? [])].filter(
    name => name.trim() !== ""
  );
}

/** Whether two entries name one person: one `@id`, one page or one name. */
function samePerson(a: StructuredDataPerson, b: StructuredDataPerson): boolean {
  if (a.id !== undefined && a.id === b.id) return true;
  const names = new Set(namesOf(a).map(nameKey));
  return namesOf(b).some(name => names.has(nameKey(name)));
}

/**
 * `over`'s facts, with `under`'s where `over` gives none: two entries of one
 * person read as one. A list is one fact, taken whole from the side that
 * holds it.
 */
function mergedPerson(
  over: StructuredDataPerson,
  under: StructuredDataPerson
): StructuredDataPerson {
  // A fact set to undefined, as a config written by hand may hold, gives
  // way to the other side's.
  const held = Object.fromEntries(
    Object.entries(over).filter(([, value]) => value !== undefined)
  ) as Partial<StructuredDataPerson>;
  return { ...under, ...held, name: over.name };
}

/** A person's own page and picture as absolute addresses, the rest as given. */
function placed(
  person: StructuredDataPerson,
  origin: string
): StructuredDataPerson {
  const url =
    person.url === undefined ? undefined : absolute(person.url, origin);
  const image =
    person.image === undefined ? undefined : absolute(person.image, origin);
  const { url: _url, image: _image, ...rest } = person;
  return {
    ...rest,
    ...(url === undefined ? {} : { url }),
    ...(image === undefined ? {} : { image }),
  };
}

/** The part of an `@id` a name gives a person with no page of their own. */
function nameFragment(name: string): string {
  const slug = nameKey(name)
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return encodeURIComponent(slug === "" ? "unnamed" : slug);
}

/** The suffix a node of the entry's type is named with: `#person` or `#organization`. */
const kindOf = (person: Pick<StructuredDataPerson, "type">): string =>
  person.type === "organization" ? "organization" : "person";

/**
 * The `@id` a person who gives none goes by: `<their page>#person` (or
 * `#organization` for a team), else one made from their name at the site's
 * home, `<home>#person-<name>`, which is also what a person sharing their
 * page with another entry goes by, since two people sharing a page (an About
 * page, say) are still two people. `person.url` is absolute, as an entry's
 * is once placed; the People tab shows the same identifier by this rule.
 */
function defaultPersonId(
  person: Pick<StructuredDataPerson, "name" | "url" | "type">,
  home: string,
  sharesPage = false
): string {
  const kind = kindOf(person);
  const page = person.url === undefined ? undefined : addressKey(person.url);
  return person.url !== undefined && page !== undefined && !sharesPage
    ? `${new URL(person.url).href.replace(/#.*$/, "")}#${kind}`
    : `${home}#${kind}-${nameFragment(person.name)}`;
}

/** How many entries name each page, by its address as matched. */
function pageCounts(
  people: readonly StructuredDataPerson[]
): Map<string, number> {
  const pages = new Map<string, number>();
  for (const person of people) {
    const page = person.url === undefined ? undefined : addressKey(person.url);
    if (page !== undefined) pages.set(page, (pages.get(page) ?? 0) + 1);
  }
  return pages;
}

/** `id`, or where an earlier entry took it, `id-2`, `id-3` and so on. */
function unusedId(id: string, used: Set<string>): string {
  let next = id;
  for (let count = 2; used.has(next); count += 1) next = `${id}-${count}`;
  used.add(next);
  return next;
}

/**
 * Each entry's `@id`: the one it gives, else its default one. Two different
 * names can make one default (`Anne-Marie` and `Anne Marie`), so a default
 * an earlier entry already goes by is numbered, keeping the two people two.
 */
function identified(
  people: readonly StructuredDataPerson[],
  home: string
): PersonEntry[] {
  const pages = pageCounts(people);
  const used = new Set<string>();
  return people.map(person => {
    if (person.id !== undefined && originOf(person.id) !== undefined) {
      used.add(person.id);
      return { id: person.id, person };
    }
    const page = person.url === undefined ? undefined : addressKey(person.url);
    const shared = page !== undefined && (pages.get(page) ?? 0) > 1;
    return {
      id: unusedId(defaultPersonId(person, home, shared), used),
      person,
    };
  });
}

/** `people` with every two entries of one person read as one, the first's facts first. */
function merged(
  people: readonly StructuredDataPerson[]
): StructuredDataPerson[] {
  const list: StructuredDataPerson[] = [];
  for (const person of people) {
    const at = list.findIndex(each => samePerson(each, person));
    if (at === -1) list.push(person);
    else list[at] = mergedPerson(list[at], person);
  }
  return list;
}

/** The facts the brand gives the person who runs a person's site. */
function ownerFactsOf(
  brand: StructuredDataBrand,
  name: string,
  home: string,
  origin: string
): StructuredDataPerson {
  const logo: PageMetadataImage | undefined = brand.logo;
  const image = logo === undefined ? undefined : absolute(logo.url, origin);
  const sameAs = (brand.profiles ?? []).map(profile => profile.url);
  return {
    name,
    url: home,
    ...(brand.otherNames === undefined || brand.otherNames.length === 0
      ? {}
      : { otherNames: brand.otherNames }),
    ...(image === undefined ? {} : { image }),
    ...(sameAs.length === 0 ? {} : { sameAs }),
    ...(brand.description === undefined
      ? {}
      : { description: brand.description }),
  };
}

/**
 * The founders the brand's own list gives, each marked as one; none where
 * any People entry is marked as a founder, since the founders are one fact.
 */
function codeFoundersOf(
  rules: Pick<StructuredDataRules, "brand">,
  listed: readonly StructuredDataPerson[]
): StructuredDataPerson[] {
  if (listed.some(person => person.founder === true)) return [];
  return (rules.brand.founders ?? []).map(founder => ({
    ...founder,
    founder: true,
  }));
}

/** Whether `person` goes by the name `key` (a name as matched). */
const goesBy = (person: StructuredDataPerson, key: string): boolean =>
  namesOf(person).some(name => nameKey(name) === key);

/**
 * The entries of a person's site, placed: the one named as the brand is the
 * person who runs the site, their own facts over the brand's and their page
 * the site's home unless given, and is added from the brand's facts alone
 * where nobody listed is.
 */
function ownedPeople(
  people: readonly StructuredDataPerson[],
  brand: StructuredDataBrand,
  ownerName: string,
  origin: string
): StructuredDataPerson[] {
  const key = nameKey(ownerName);
  const facts = ownerFactsOf(brand, ownerName, `${origin}/`, origin);
  const all = people.map(each =>
    placed(
      goesBy(each, key)
        ? mergedPerson({ ...each, type: "person" }, facts)
        : each,
      origin
    )
  );
  return all.some(each => goesBy(each, key)) ? all : [facts, ...all];
}

/**
 * The entries by their page's address, each page with every entry that names
 * it, and by each name, the first winning.
 */
function indexesOf(entries: readonly PersonEntry[]): {
  byPage: Map<string, PersonEntry[]>;
  byName: Map<string, PersonEntry>;
} {
  const byPage = new Map<string, PersonEntry[]>();
  const byName = new Map<string, PersonEntry>();
  for (const entry of entries) {
    const page =
      entry.person.url === undefined ? undefined : addressKey(entry.person.url);
    if (page !== undefined)
      byPage.set(page, [...(byPage.get(page) ?? []), entry]);
    for (const name of namesOf(entry.person)) {
      if (!byName.has(nameKey(name))) byName.set(nameKey(name), entry);
    }
  }
  return { byPage, byName };
}

/**
 * The entry whose page a name was given with: the one entry naming that
 * page, or where several share it (an About page, say), the one going by the
 * name given; none where none of them does.
 */
function pageEntryOf(
  sharing: readonly PersonEntry[] | undefined,
  key: string
): PersonEntry | undefined {
  if (sharing === undefined) return undefined;
  if (sharing.length === 1) return sharing[0];
  return sharing.find(entry => goesBy(entry.person, key));
}

/**
 * On an organisation's site, the entry a name that is the brand's stands for:
 * the site's own organisation, whose node the site already writes.
 */
function siteEntryOf(
  ownerName: string | undefined,
  organizationId: string | undefined
): PersonEntry | undefined {
  if (organizationId === undefined || ownerName === undefined) return undefined;
  return {
    id: organizationId,
    person: { name: ownerName, type: "organization" },
    site: true,
  };
}

/**
 * The site's People for one page's graph: its entries with their `@id`s,
 * its founders and, on a person's site, the person who runs it.
 *
 * `ownerName` is the name whoever runs the site goes by (the brand's, else
 * the site's), and `organizationId` the site organisation's `@id` where it
 * has one: a name the page gives that is the brand's own is that
 * organisation, or that person.
 */
export function peopleOf(
  rules: Pick<StructuredDataRules, "brand" | "people">,
  origin: string,
  ownerName: string | undefined,
  organizationId: string | undefined
): People {
  const listed = rules.people ?? [];
  const people = merged([...listed, ...codeFoundersOf(rules, listed)]);
  const personal = rules.brand.kind === "person" && ownerName !== undefined;
  const entries = identified(
    personal
      ? ownedPeople(people, rules.brand, ownerName, origin)
      : people.map(each => placed(each, origin)),
    `${origin}/`
  );
  const { byPage, byName } = indexesOf(entries);
  const ownerKey = ownerName === undefined ? undefined : nameKey(ownerName);
  const site = personal ? undefined : siteEntryOf(ownerName, organizationId);
  const owner = personal ? byName.get(nameKey(ownerName)) : undefined;
  return {
    match(named) {
      const page = named.url === undefined ? undefined : addressKey(named.url);
      const key = nameKey(named.name);
      return (
        pageEntryOf(page === undefined ? undefined : byPage.get(page), key) ??
        byName.get(key) ??
        (key === ownerKey ? site : undefined)
      );
    },
    founders: personal
      ? []
      : entries.filter(entry => entry.person.founder === true),
    ...(owner === undefined ? {} : { owner }),
  };
}

/**
 * The `@id` each of `people` goes by on the site's pages, in their order,
 * resolved as a page's graph resolves the whole list: entries of one person
 * read as one, a page shared by two entries giving each an `@id` from their
 * name, and a default two names would share numbered. On a person's site
 * the entry going by `ownerName` is the person who runs it, at the site's
 * home unless their page is given. The People tab shows these.
 */
export function listedPersonIdsOf(
  people: readonly StructuredDataPerson[],
  origin: string,
  ownerName?: string
): string[] {
  const home = `${origin}/`;
  const owner = ownerName === undefined ? undefined : nameKey(ownerName);
  const all = merged(people).map(each =>
    placed(
      owner !== undefined && goesBy(each, owner)
        ? { ...each, type: "person", url: each.url ?? home }
        : each,
      origin
    )
  );
  const entries = identified(all, home);
  return people.map(person => {
    const entry = entries[all.findIndex(each => samePerson(each, person))];
    return entry === undefined
      ? defaultPersonId(placed(person, origin), home)
      : entry.id;
  });
}

/** The organisation a person works for, as structured data names it. */
function employerNode(
  person: StructuredDataPerson,
  site: { "@id": string } | undefined
): Json | undefined {
  const employer = person.worksFor;
  if (employer === undefined) return site;
  const url =
    employer.url === undefined || originOf(employer.url) === undefined
      ? undefined
      : new URL(employer.url).href.replace(/#.*$/, "");
  return node({
    "@type": "Organization",
    // Named as the organisation's own site names itself (`<home>#organization`),
    // so the two describe one organisation.
    "@id": url === undefined ? undefined : `${url}#organization`,
    name: employer.name,
    url,
  });
}

/**
 * The node an entry is described by: a person, with every fact the entry
 * holds, or a team or company credited as one. None for the site's own
 * organisation, whose node the site writes.
 *
 * `organization` is the site's organisation, which a founder with no
 * employer of their own works for.
 */
export function personEntryNode(
  entry: PersonEntry,
  organization: { "@id": string } | undefined,
  more: { email?: string; telephone?: string } = {}
): StructuredDataNode | undefined {
  if (entry.site === true) return undefined;
  const { person } = entry;
  const otherNames = person.otherNames ?? [];
  const alternateName = otherNames.length > 0 ? [...otherNames] : undefined;
  if (person.type === "organization") {
    return node({
      "@type": "Organization",
      "@id": entry.id,
      name: person.name,
      alternateName,
      url: person.url,
      logo: person.image,
      description: person.description,
      sameAs: linksOf(person.sameAs),
    });
  }
  return node({
    "@type": "Person",
    "@id": entry.id,
    name: person.name,
    alternateName,
    url: person.url,
    image: person.image,
    jobTitle: person.jobTitle,
    description: person.description,
    email: more.email,
    telephone: more.telephone,
    sameAs: linksOf(person.sameAs),
    knowsAbout:
      person.knowsAbout === undefined || person.knowsAbout.length === 0
        ? undefined
        : [...person.knowsAbout],
    worksFor: employerNode(
      person,
      person.founder === true ? organization : undefined
    ),
  });
}
