/**
 * The Organization tab's rows beyond the brand's name, other names, logo
 * and profiles: what it is, how to reach it, when it was founded and who
 * owns it, and the facts only the site's code gives. Each row shows the
 * code's value where the settings hold none, said to be set in the code, so
 * the tab shows every fact pages state and a person moves one to the admin
 * by typing it.
 *
 * @module admin/brand-details
 */
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SettingsRowGroup,
} from "@nextlyhq/plugin-sdk/admin";
import { X } from "lucide-react";
import type { JSX } from "react";

import { contactValueOf } from "../settings/brand-details";
import type { StructuredDataBrand } from "../structured-data/rules";

import {
  brandFactProblem,
  codeFactOf,
  contactPointProblem,
  type BrandTextFact,
  type ContactPointDraft,
} from "./brand-draft";
import type { SettingsDraft } from "./settings-draft";
import { ControlNote, TextRow } from "./settings-parts";

/** Under a field the site's code fills while the settings hold nothing. */
export const CODE_NOTE =
  "Set in the site's code. Type here to set it in the admin instead.";

/** Under a list the site's code fills while the settings hold none. */
export const CODE_LIST_NOTE =
  "Set in the site's code. Add one here to set them in the admin instead.";

/** Under a fact only the site's code can give. */
const CODE_ONLY_NOTE = "Set in the site's code.";

/**
 * What each contact point can be for, as Google's examples name them; a
 * purpose saved before, or given by the code, is offered too.
 */
const CONTACT_TYPES = [
  "customer support",
  "technical support",
  "billing support",
  "sales",
  "reservations",
  "emergency",
] as const;

/** A purpose as a choice reads it: its first letter capitalised. */
const purposeLabel = (purpose: string): string =>
  purpose.charAt(0).toUpperCase() + purpose.slice(1);

/** What the Organization tab is handed besides the draft. */
export interface BrandRowsProps {
  draft: SettingsDraft;
  change: (next: (draft: SettingsDraft) => SettingsDraft) => void;
  /** The brand facts the site's code gives, shown where the settings hold none. */
  codeBrand: StructuredDataBrand;
}

/** One text fact's row: typed here, else the code's value shown in it. */
function FactRow({
  draft,
  change,
  codeBrand,
  fact,
  label,
  description,
  placeholder,
  multiline = false,
  mono = false,
}: BrandRowsProps & {
  fact: BrandTextFact;
  label: string;
  description: string;
  placeholder?: string;
  multiline?: boolean;
  mono?: boolean;
}): JSX.Element {
  const value = draft.brandDetails[fact];
  const fromCode = codeFactOf(codeBrand, fact);
  const showsCode = value.trim() === "" && fromCode !== undefined;
  const problem = brandFactProblem(fact, value);
  const shownPlaceholder = showsCode ? fromCode : placeholder;
  return (
    <TextRow
      label={label}
      description={description}
      value={value}
      multiline={multiline}
      mono={mono}
      {...(shownPlaceholder === undefined
        ? {}
        : { placeholder: shownPlaceholder })}
      {...(showsCode ? { note: CODE_NOTE } : {})}
      error={problem}
      onChange={next =>
        change(current => ({
          ...current,
          brandDetails: { ...current.brandDetails, [fact]: next },
        }))
      }
    />
  );
}

/** A small button that removes one contact point. */
function RemoveContact({
  label,
  onClick,
}: {
  label: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      onClick={onClick}
    >
      <X className="size-4" aria-hidden="true" />
    </Button>
  );
}

/** The contact points the site's code gives, one read-only row each. */
function CodeContactPoints({
  points,
}: {
  points: NonNullable<StructuredDataBrand["contactPoints"]>;
}): JSX.Element {
  return (
    <div className="grid gap-2">
      {points.map((point, index) => (
        <div key={index} className="flex items-center gap-2">
          <span className="w-36 shrink-0 truncate text-xs font-medium text-muted-foreground">
            {purposeLabel(point.contactType)}
          </span>
          <Input
            className="bg-muted font-mono text-[13px]"
            value={contactValueOf(point)}
            readOnly
            aria-label={`${purposeLabel(point.contactType)}, set in the site's code`}
          />
        </div>
      ))}
    </div>
  );
}

/** One contact point being edited: what it is for, and how to reach it. */
function ContactRow({
  point,
  set,
  remove,
}: {
  point: ContactPointDraft;
  set: (next: ContactPointDraft) => void;
  remove: () => void;
}): JSX.Element {
  const problem = contactPointProblem(point);
  const purposes = [
    ...new Set([
      ...CONTACT_TYPES,
      ...(point.contactType === "" ? [] : [point.contactType]),
    ]),
  ];
  const name =
    point.contactType === "" ? "Contact" : purposeLabel(point.contactType);
  return (
    <div>
      <div className="flex items-center gap-2">
        <Select
          value={point.contactType}
          onValueChange={contactType => set({ ...point, contactType })}
        >
          <SelectTrigger className="w-44 shrink-0" aria-label="What it is for">
            <SelectValue placeholder="What it is for" />
          </SelectTrigger>
          <SelectContent>
            {purposes.map(purpose => (
              <SelectItem key={purpose} value={purpose}>
                {purposeLabel(purpose)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          className="font-mono text-[13px]"
          value={point.value}
          placeholder="Email, telephone or https://"
          aria-label={`${name}: email, telephone or address`}
          aria-invalid={problem !== null}
          onChange={event => set({ ...point, value: event.target.value })}
        />
        <RemoveContact
          label={`Remove ${name.toLowerCase()}`}
          onClick={remove}
        />
      </div>
      {problem === null ? null : (
        <ControlNote tone="danger">{problem}</ControlNote>
      )}
    </div>
  );
}

/** The ways to reach the brand: the settings' own, else the code's, shown. */
function ContactPoints({
  draft,
  change,
  codeBrand,
}: BrandRowsProps): JSX.Element {
  const points = draft.brandDetails.contactPoints;
  const fromCode = codeBrand.contactPoints ?? [];
  const setPoints = (
    next: (points: ContactPointDraft[]) => ContactPointDraft[]
  ) =>
    change(current => ({
      ...current,
      brandDetails: {
        ...current.brandDetails,
        contactPoints: next(current.brandDetails.contactPoints),
      },
    }));
  const showsCode = points.length === 0 && fromCode.length > 0;
  return (
    <SettingsRowGroup
      label="Contact points"
      description="Where people reach you for support, sales and the like."
    >
      {showsCode ? (
        <>
          <CodeContactPoints points={fromCode} />
          <ControlNote>{CODE_LIST_NOTE}</ControlNote>
        </>
      ) : (
        <div className="grid gap-2">
          {points.map((point, index) => (
            <ContactRow
              key={index}
              point={point}
              set={next =>
                setPoints(all =>
                  all.map((each, at) => (at === index ? next : each))
                )
              }
              remove={() =>
                setPoints(all => all.filter((_, at) => at !== index))
              }
            />
          ))}
        </div>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className={points.length > 0 || showsCode ? "mt-2" : undefined}
        onClick={() =>
          setPoints(all => [
            ...all,
            { contactType: "customer support", value: "" },
          ])
        }
      >
        Add a contact point
      </Button>
    </SettingsRowGroup>
  );
}

/** The facts only the site's code gives, shown where it gives any. */
function CodeOnlyRows({
  codeBrand,
}: {
  codeBrand: StructuredDataBrand;
}): JSX.Element | null {
  const founders = (codeBrand.founders ?? []).map(founder =>
    founder.jobTitle === undefined
      ? founder.name
      : `${founder.name}, ${founder.jobTitle}`
  );
  const parentProfiles = codeBrand.parentOrganization?.sameAs ?? [];
  const languages = [
    ...new Set(
      (codeBrand.contactPoints ?? []).flatMap(
        point => point.availableLanguage ?? []
      )
    ),
  ];
  return (
    <>
      {founders.length === 0 ? null : (
        <TextRow
          label="Founders"
          description="Who founded the organization, described on its About page."
          value={founders.join("; ")}
          readOnly
          note={CODE_ONLY_NOTE}
        />
      )}
      {parentProfiles.length === 0 ? null : (
        <TextRow
          label="Parent organization's profiles"
          description="Its official accounts elsewhere."
          value={parentProfiles.join(", ")}
          readOnly
          mono
          note={CODE_ONLY_NOTE}
        />
      )}
      {languages.length === 0 ? null : (
        <TextRow
          label="Contact languages"
          description="The languages the contact points answer in."
          value={languages.join(", ")}
          readOnly
          note={CODE_ONLY_NOTE}
        />
      )}
    </>
  );
}

/** The Organization tab's rows after the profiles. */
export function BrandDetailRows(props: BrandRowsProps): JSX.Element {
  return (
    <>
      <FactRow
        {...props}
        fact="description"
        label="Description"
        description="What the organization is, in a sentence or two."
        placeholder={props.draft.description}
        multiline
      />
      <FactRow
        {...props}
        fact="email"
        label="Email"
        description="The address people and programs can write to."
        mono
      />
      <FactRow
        {...props}
        fact="telephone"
        label="Telephone"
        description="With the country code, such as +1 555 0100."
        mono
      />
      <ContactPoints {...props} />
      <FactRow
        {...props}
        fact="foundingDate"
        label="Founded"
        description="The year, or the full date, such as 2020 or 2020-03-01."
      />
      <FactRow
        {...props}
        fact="parentName"
        label="Parent organization"
        description="The company that owns this one, if any."
      />
      <FactRow
        {...props}
        fact="parentUrl"
        label="Parent organization's website"
        description="Its home page."
        placeholder="https://"
        mono
      />
      <FactRow
        {...props}
        fact="parentDescription"
        label="Parent organization's description"
        description="What it is, in a sentence or two."
        multiline
      />
      <FactRow
        {...props}
        fact="parentFoundingDate"
        label="Parent organization founded"
        description="The year, or the full date."
      />
      <CodeOnlyRows codeBrand={props.codeBrand} />
    </>
  );
}
