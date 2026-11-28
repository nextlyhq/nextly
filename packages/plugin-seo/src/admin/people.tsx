/**
 * The Settings screen's People tab: the people (and teams) the site names,
 * each described to search engines as one person, with one identifier, on
 * every page that names them: as a founder, as a post's author, or as whom a
 * profile page is about. Each is a card of their facts; the site's code's
 * People are shown read-only while the settings list none of their own.
 *
 * @module admin/people
 */
import {
  Button,
  SegmentedChoice,
  SettingsRowGroup,
  Switch,
} from "@nextlyhq/plugin-sdk/admin";
import { useId, type JSX } from "react";

import { listedPersonIdsOf } from "../structured-data/people";
import type {
  StructuredDataBrand,
  StructuredDataPerson,
} from "../structured-data/rules";

import { CODE_LIST_NOTE } from "./brand-details";
import {
  EMPTY_PERSON,
  otherNamesOf,
  personDraftOf,
  personDraftProblem,
  type PersonDraft,
} from "./people-draft";
import type { SettingsDraft } from "./settings-draft";
import { ControlNote, SettingsCard, TextRow } from "./settings-parts";

/** What the People tab is handed. */
export interface PeopleTabProps {
  draft: SettingsDraft;
  change: (next: (draft: SettingsDraft) => SettingsDraft) => void;
  /** The People the site's code gives, shown while the settings list none. */
  codePeople: readonly StructuredDataPerson[];
  /** The site's main production address, which a default identifier is made at. */
  home?: string;
  /** The brand facts the site's code gives, for whether the site is a person's. */
  codeBrand?: StructuredDataBrand;
}

/** The kinds an entry can be, as the card offers them. */
const KINDS = [
  { value: "person", label: "A person" },
  { value: "organization", label: "A team or company" },
] as const;

/**
 * An origin no site has (`.invalid` is reserved), standing in for the site's
 * while its production address is not given, so an identifier made at it is
 * known to be unknown.
 */
const UNKNOWN_ORIGIN = "https://site.invalid";

/** What of a person as typed decides the identifier pages give them. */
function identityOf(draft: PersonDraft): StructuredDataPerson {
  const otherNames = otherNamesOf(draft.otherNames);
  return {
    name: draft.name.trim(),
    type: draft.type,
    ...(otherNames.length === 0 ? {} : { otherNames }),
    ...(draft.url.trim() === "" ? {} : { url: draft.url.trim() }),
    ...(draft.id.trim() === "" ? {} : { id: draft.id.trim() }),
  };
}

/**
 * The identifier each person as typed goes by where none is given, as the
 * site's pages resolve the whole list (`listedPersonIdsOf`): two people
 * sharing a page each get one from their name, for one. Nothing for one the
 * site's address is needed for while it is not given.
 */
function placeholderIdsOf(
  people: readonly PersonDraft[],
  home: string | undefined,
  ownerName?: string
): (string | undefined)[] {
  let origin = UNKNOWN_ORIGIN;
  try {
    if (home !== undefined) origin = new URL(home).origin;
  } catch {
    // Not an address yet: as if none were given.
  }
  return listedPersonIdsOf(people.map(identityOf), origin, ownerName).map(id =>
    id.startsWith(`${UNKNOWN_ORIGIN}/`) ? undefined : id
  );
}

/** Whether a site is a person's: as its settings say, else as its code does. */
export function isPersonalSite(
  draft: Pick<SettingsDraft, "siteKind">,
  codeBrand: StructuredDataBrand
): boolean {
  return draft.siteKind === null
    ? codeBrand.kind === "person"
    : draft.siteKind === "person";
}

/** The name whoever runs the site goes by: the brand's, else the site's. */
export function ownerNameOf(
  draft: Pick<SettingsDraft, "brandName" | "siteName">,
  codeBrand: StructuredDataBrand
): string {
  return (draft.brandName.trim() || codeBrand.name || draft.siteName).trim();
}

/** A card's words for a person's facts, and for a team's. */
const CARD_WORDS = {
  person: { page: "Their page", image: "Photo", description: "Short bio" },
  organization: { page: "Its page", image: "Logo", description: "Description" },
} as const;

/** One person's card: each fact, and the identifier every site names them by. */
function PersonCard({
  person,
  set,
  remove,
  placeholderId,
  brandName,
}: {
  person: PersonDraft;
  set: (next: PersonDraft) => void;
  remove: () => void;
  /** The identifier pages give them where none is typed, where known. */
  placeholderId: string | undefined;
  brandName: string;
}): JSX.Element {
  const kindId = useId();
  const problem = personDraftProblem(person);
  const named = person.name.trim() === "" ? "this person" : person.name.trim();
  const isPerson = person.type === "person";
  const words = CARD_WORDS[person.type];
  const field =
    (fact: keyof PersonDraft) =>
    (value: string): void =>
      set({ ...person, [fact]: value });
  return (
    <SettingsCard>
      <TextRow
        label="Name"
        description="As pages name them, such as in a byline."
        value={person.name}
        onChange={field("name")}
        {...(problem === null
          ? {}
          : { note: problem, noteTone: "danger" as const })}
      />
      <SettingsRowGroup
        label="Kind"
        description="A team account, such as an editorial team, is described as an organization."
      >
        <span id={kindId} className="sr-only">
          Kind
        </span>
        <SegmentedChoice
          size="bordered"
          aria-labelledby={kindId}
          options={KINDS.map(kind => ({
            value: kind.value,
            label: kind.label,
          }))}
          value={person.type}
          onSelect={next =>
            set({
              ...person,
              type: next === "organization" ? "organization" : "person",
            })
          }
        />
      </SettingsRowGroup>
      <TextRow
        label="Other names"
        description="Names a page may credit them by, one a line."
        value={person.otherNames}
        multiline
        onChange={field("otherNames")}
      />
      <TextRow
        label={words.page}
        description="An address on this site, such as /about, or a whole address elsewhere."
        value={person.url}
        placeholder="/about"
        mono
        onChange={field("url")}
      />
      <TextRow
        label={words.image}
        description="The address of an image, on this site or elsewhere."
        value={person.image}
        placeholder="https://"
        mono
        onChange={field("image")}
      />
      {isPerson ? (
        <TextRow
          label="Job title"
          description="Their role, such as Founder or Editor."
          value={person.jobTitle}
          onChange={field("jobTitle")}
        />
      ) : null}
      <TextRow
        label={words.description}
        description="A sentence or two."
        value={person.description}
        multiline
        onChange={field("description")}
      />
      <TextRow
        label="Profiles"
        description="Their official accounts elsewhere, one address a line."
        value={person.sameAs}
        placeholder="https://github.com/…"
        multiline
        mono
        onChange={field("sameAs")}
      />
      {isPerson ? (
        <>
          <TextRow
            label="Knows about"
            description="Topics they are known for. Separate with commas."
            value={person.knowsAbout}
            onChange={field("knowsAbout")}
          />
          <TextRow
            label="Works for"
            description="The organization they work for, where it is not this one."
            value={person.worksForName}
            onChange={field("worksForName")}
          />
          <TextRow
            label="Works for: website"
            description="Its home page."
            value={person.worksForUrl}
            placeholder="https://"
            mono
            onChange={field("worksForUrl")}
          />
          <SettingsRowGroup
            label="Founder"
            description={`Named as a founder of ${brandName.trim() === "" ? "the organization" : brandName.trim()} on every page.`}
          >
            <Switch
              aria-label={`${named} is a founder`}
              checked={person.founder}
              onCheckedChange={founder => set({ ...person, founder })}
            />
          </SettingsRowGroup>
        </>
      ) : null}
      <TextRow
        label="Identifier"
        description="Advanced. Use the same identifier on every site this person appears on, so search engines read one person."
        value={person.id}
        {...(placeholderId === undefined ? {} : { placeholder: placeholderId })}
        mono
        note={`Paste the one another site gives them, such as https://example.com/#person. ${
          placeholderId === undefined
            ? "Empty uses one made from their page, else their name at the site's production address."
            : "Empty uses the address shown."
        }`}
        onChange={field("id")}
      />
      <div className="py-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          // A long name wraps within the card rather than running past it.
          className="h-auto max-w-full whitespace-normal py-1.5 text-left [overflow-wrap:anywhere]"
          onClick={remove}
        >
          Remove {named}
        </Button>
      </div>
    </SettingsCard>
  );
}

/** The People the site's code gives, each shown read-only. */
function CodePeople({
  people,
}: {
  people: readonly StructuredDataPerson[];
}): JSX.Element {
  return (
    <SettingsCard>
      {people.map((person, index) => (
        <TextRow
          key={index}
          label={person.name}
          description={
            [
              person.jobTitle,
              person.type === "organization" ? "Team" : undefined,
            ]
              .filter(Boolean)
              .join(", ") || "Person"
          }
          value={person.url ?? person.id ?? ""}
          readOnly
          mono
          {...(index === people.length - 1 ? { note: CODE_LIST_NOTE } : {})}
        />
      ))}
    </SettingsCard>
  );
}

/** Each card's identifier where none is typed, as the site's pages give it. */
function cardIdsOf(
  draft: SettingsDraft,
  home: string | undefined,
  codeBrand: StructuredDataBrand
): (string | undefined)[] {
  const owner = isPersonalSite(draft, codeBrand)
    ? ownerNameOf(draft, codeBrand)
    : undefined;
  return placeholderIdsOf(draft.people, home, owner);
}

/**
 * The People tab: one card per person, each edited in place, and room for
 * another. A name a page gives is matched to a person here by their page's
 * address or by the same name (or one of their other names), never a near
 * one, so the tab says so above the list.
 */
export function PeopleTab({
  draft,
  change,
  codePeople,
  home,
  codeBrand = {},
}: PeopleTabProps): JSX.Element {
  const people = draft.people;
  const ids = cardIdsOf(draft, home, codeBrand);
  const setPeople = (next: (people: PersonDraft[]) => PersonDraft[]) =>
    change(current => ({ ...current, people: next(current.people) }));
  const showsCode = people.length === 0 && codePeople.length > 0;
  return (
    <div className="grid gap-4">
      <ControlNote>
        Each person here is one person to search engines on every page that
        names them: as a founder, as the author of a post, or on their profile
        page. A page names them by their page&apos;s address, or by the same
        name or one of their other names, never a near one.
      </ControlNote>
      {showsCode ? <CodePeople people={codePeople} /> : null}
      {people.map((person, index) => (
        <PersonCard
          key={index}
          person={person}
          placeholderId={ids[index]}
          brandName={draft.brandName || draft.siteName}
          set={next =>
            setPeople(all =>
              all.map((each, at) => (at === index ? next : each))
            )
          }
          remove={() => setPeople(all => all.filter((_, at) => at !== index))}
        />
      ))}
      <div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            setPeople(all => [
              ...(all.length === 0 && showsCode
                ? codePeople.map(each => personDraftOf({ ...each }))
                : all),
              { ...EMPTY_PERSON },
            ])
          }
        >
          Add a person
        </Button>
      </div>
    </div>
  );
}
