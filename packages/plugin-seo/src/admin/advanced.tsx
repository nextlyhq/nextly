/**
 * The SEO panel's Advanced section: hiding the page from search, its official
 * address, a different title when shared, the share image, the structured
 * data type, and how search results may show the page. Closed until
 * a person opens it; a count beside its name says how many of the page's
 * problems are inside.
 *
 * @module admin/advanced
 */
import {
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
  Textarea,
} from "@nextlyhq/plugin-sdk/admin";
import { Check, ChevronRight, Lock, TriangleAlert } from "lucide-react";
import { useEffect, useId, useState, type ReactNode } from "react";

import type { SeoAnswer, Sourced } from "../resolver/order";
import {
  isStructuredDataTypeKey,
  structuredDataChoiceText,
} from "../structured-data/catalog";
import { checkCanonical, storedCanonical } from "../tab/canonical";
import type { SeoTabContext } from "../tab/contract";
import { absoluteAddress } from "../tab/display";
import { thingsToFix } from "../tab/problems";

import { DISPLAY_FIELDS, DisplayRows } from "./display-rows";
import {
  AutomaticSource,
  Chip,
  cx,
  describeSource,
  inSentence,
  Note,
  type SourcedValue,
  type SourceNames,
  SourceRow,
} from "./parts";
import { keyOf, Row, RowButton, useOutsideChange } from "./rows";
import { ShareImageRow } from "./share-image-row";
import {
  isTyped,
  typedText,
  unsharedAnswer,
  type ChosenImage,
  type SeoPanelField,
  type SeoPanelValues,
} from "./values";

/** What the Advanced section is handed by the panel. */
export interface AdvancedProps {
  values: SeoPanelValues;
  answer: SeoAnswer | undefined;
  context: SeoTabContext | undefined;
  names: SourceNames;
  chosenImage: ChosenImage | undefined;
  writable: boolean;
  /** Why a value was refused when the page was saved, by field. */
  errors: Partial<Record<SeoPanelField, string>>;
  /** How many of the page's problems are in this section. */
  problemCount: number;
  defaultOpen: boolean;
  onSet: (field: SeoPanelField, value: unknown) => void;
  /** Opens the media library; absent where no image can be chosen. */
  onChooseImage?: () => void;
  /** The file of the picture shown while none is chosen, where it was read. */
  shownImageFile?: ChosenImage | undefined;
  /**
   * Makes a share image of the right size from the picture shown and sets it
   * as the page's; answers the made image's id, or none where it did not.
   * Absent where none can be made.
   */
  onMakeShareImage?: (() => Promise<string | undefined>) | undefined;
  /** Opens the page's own content at one of its fields. */
  onGoToField?: ((field: string) => void) | undefined;
}

export function AdvancedSection(props: AdvancedProps): ReactNode {
  // A value refused at save is inside, so the section opens to show it.
  const refused = Object.entries(props.errors).some(
    ([field, message]) =>
      Boolean(message) && field !== "metaTitle" && field !== "metaDescription"
  );
  const [open, setOpen] = useState(props.defaultOpen || refused);
  useEffect(() => {
    if (refused) setOpen(true);
  }, [refused]);
  const rows = advancedRows(props);
  // Nothing to put under it where the group declares only the two fields.
  if (rows.length === 0) return null;
  return (
    <AdvancedFrame
      summary={summaryOf(rows.map(row => row.summary))}
      problemCount={props.problemCount}
      open={open}
      onOpenChange={setOpen}
    >
      {rows.map(({ key, Row: Drawn }) => (
        <Drawn key={key} {...props} />
      ))}
    </AdvancedFrame>
  );
}

/**
 * The Advanced section's frame: its name, a summary of the rows inside, a
 * count of the problems they hold, and the rows, shown while open. Every
 * surface that edits a page's SEO draws its Advanced section in it.
 */
export function AdvancedFrame({
  summary,
  problemCount = 0,
  open,
  onOpenChange,
  children,
}: {
  summary: string;
  problemCount?: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}): ReactNode {
  const id = useId();
  return (
    // A disclosure under a rule, as the SEO tab draws it: the name with a
    // turning arrow, and the rows inside once open.
    <section className="border-t border-border pt-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        title={summary}
        onClick={() => onOpenChange(!open)}
        className="flex w-full cursor-pointer items-center gap-2 rounded-md border-0 bg-transparent py-1.5 text-left hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        <ChevronRight
          aria-hidden="true"
          className={cx(
            "size-4 text-foreground transition-transform motion-reduce:transition-none",
            open && "rotate-90"
          )}
        />
        <b className="text-sm font-medium text-foreground">Advanced</b>
        <span className="sr-only">{summary}</span>
        {problemCount > 0 ? (
          // The count in 12px, the smallest text the admin draws.
          <span
            title={thingsToFix(problemCount)}
            className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full border border-warning-border bg-warning-surface px-[5px] text-xs leading-none font-semibold text-warning-text"
          >
            {problemCount}
          </span>
        ) : null}
      </button>
      <div id={`${id}-body`} hidden={!open}>
        {children}
      </div>
    </section>
  );
}

/** One row the section may draw, and how its name reads in the summary. */
interface AdvancedRow {
  key: string;
  summary: string;
  Row: (props: AdvancedProps) => ReactNode;
}

/**
 * The rows for the fields the group declares: a control is offered only
 * where its value can be stored. Every row while the group is not known yet.
 */
function advancedRows(props: AdvancedProps): AdvancedRow[] {
  const has = (...names: string[]) =>
    props.context === undefined ||
    names.some(name => props.context?.fields.includes(name));
  const hasAll = (...names: string[]) => names.every(name => has(name));
  const rows: (AdvancedRow | false)[] = [
    has("noindex") && {
      key: "hide",
      summary: "hiding from search",
      Row: HideRow,
    },
    // An address on another site is used only once marked confirmed, so the
    // row needs the mark as well as the address.
    hasAll("canonical", "canonicalElsewhere") && {
      key: "address",
      summary: "official address",
      Row: OfficialAddressRow,
    },
    has("socialTitle", "socialDescription", "ogImage") && {
      key: "shared",
      summary: "sharing",
      Row: SharingRows,
    },
    props.context?.structuredData !== undefined && {
      key: "structured",
      summary: "structured data",
      Row: StructuredDataRow,
    },
    has(...DISPLAY_FIELDS) && {
      key: "display",
      summary: "how search results show it",
      Row: DisplayRows,
    },
  ];
  return rows.filter((row): row is AdvancedRow => row !== false);
}

/** The section's summary, "Hiding from search, official address, sharing". */
function summaryOf(names: readonly string[]): string {
  const text = names.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** The rows about shared links, each where its field is declared. */
function SharingRows(props: AdvancedProps): ReactNode {
  const has = (name: string) =>
    props.context === undefined || props.context.fields.includes(name);
  return (
    <>
      {has("socialTitle") || has("socialDescription") ? (
        <SharedTitleRow {...props} />
      ) : null}
      {has("ogImage") ? <ShareImageRow {...props} /> : null}
    </>
  );
}

/** The type of thing Google is told the page is, and whether it is complete. */
/**
 * One action per detail the page's own content lacks, opening the content
 * at that field: "Add an author on the Content tab".
 */
function ContentFixes({
  problems,
  onGoToField,
}: {
  problems: NonNullable<SeoTabContext["structuredData"]>["problems"];
  onGoToField: ((field: string) => void) | undefined;
}): ReactNode {
  if (onGoToField === undefined) return null;
  const fields = problems.flatMap(problem =>
    problem.fix === "content" && problem.field !== undefined
      ? [problem.field]
      : []
  );
  if (fields.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {fields.map(field => (
        <RowButton key={field.name} onClick={() => onGoToField(field.name)}>
          Add {withArticle(field.label)} on the Content tab
        </RowButton>
      ))}
    </div>
  );
}

/** A field's name with "a" or "an" before it, in a sentence: "an author". */
function withArticle(label: string): string {
  const name = inSentence(label);
  return /^[aeiou]/i.test(name) ? `an ${name}` : `a ${name}`;
}

/**
 * The choice of no type of the page's own, which the automatic one answers.
 * The admin's select takes no empty value, so it has a name no type has.
 */
const AUTOMATIC_TYPE = "=automatic";

function StructuredDataRow({
  values,
  context,
  onGoToField,
  writable,
  errors,
  onSet,
}: AdvancedProps): ReactNode {
  const id = useId();
  const structured = context?.structuredData;
  if (structured === undefined) return null;
  const chosen = typedText(values.structuredDataType);
  return (
    <Row
      error={errors.structuredDataType}
      label="Structured data type"
      labelId={`${id}-label`}
      help="Tells Google what kind of page this is, so it can show details like the author and date. A type Google no longer shows says so."
      control={
        <Select
          value={chosen === "" ? AUTOMATIC_TYPE : chosen}
          disabled={!writable}
          onValueChange={next =>
            onSet("structuredDataType", next === AUTOMATIC_TYPE ? null : next)
          }
        >
          <SelectTrigger
            aria-labelledby={`${id}-label`}
            className="h-8 w-auto min-w-[210px] text-xs"
          >
            {/* The type's name alone: the list carries its note. */}
            <SelectValue>
              {chosen === ""
                ? `${structured.automatic.label} · automatic`
                : structured.offered.find(type => type.key === chosen)?.label}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={AUTOMATIC_TYPE}>
              {structured.automatic.label} · automatic
            </SelectItem>
            {structured.offered.map(type => (
              <SelectItem key={type.key} value={type.key}>
                {isStructuredDataTypeKey(type.key)
                  ? structuredDataChoiceText(type.key)
                  : type.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      }
    >
      {structured.problems.length > 0 ? (
        <Note tone="warning">
          {structured.problems.map(problem => (
            <b key={problem.message} className="mr-1 font-semibold">
              {problem.message}
            </b>
          ))}
          Google gets no {structured.type.label} details for this page until
          then.
          <ContentFixes
            problems={structured.problems}
            onGoToField={onGoToField}
          />
        </Note>
      ) : (
        <SourceRow>
          <span className="inline-flex items-center gap-1 font-semibold text-success-text">
            <Check aria-hidden="true" className="size-3.5" />
            Complete
          </span>
          <span>
            {structured.details.length > 0
              ? structured.details.join(", ")
              : "Generated from this page's content."}
          </span>
        </SourceRow>
      )}
    </Row>
  );
}

/** Whether the stored address was confirmed to be on another site. */
function confirmedElsewhere(values: SeoPanelValues): boolean {
  return values.canonicalElsewhere === true;
}

function HideRow({
  values,
  answer,
  names,
  writable,
  errors,
  onSet,
}: AdvancedProps): ReactNode {
  const label = "Hide this page from search";
  // Hidden with its whole type: the page's own switch cannot show it.
  const byType = answer?.robots.from === "type";
  return (
    <Row
      error={errors.noindex}
      label={label}
      help="Search engines won't list it, and it leaves the sitemap. Anyone with the link can still open it."
      control={
        <Switch
          aria-label={label}
          checked={byType || values.noindex === true}
          disabled={!writable || byType}
          onCheckedChange={checked => onSet("noindex", checked)}
        />
      }
    >
      {byType ? (
        <Note icon={<Lock className="size-4" />}>
          On for every {inSentence(names.typeLabel)} page, so this switch
          can&apos;t turn it off.
        </Note>
      ) : undefined}
    </Row>
  );
}

/**
 * The official address: the page's own, automatic, unless a person uses
 * another. One on another site is used only once they confirm the page lives
 * there.
 */
function OfficialAddressRow({
  values,
  context,
  writable,
  errors,
  onSet,
}: AdvancedProps): ReactNode {
  const typed = typedText(values.canonical);
  // The site's production addresses, as the resolver judges a typed address.
  const origins = context?.levels.site.productionAddresses ?? [];
  const [editing, setEditing] = useState(typed !== "");
  const [text, setText] = useState(typed);
  const [confirmed, setConfirmed] = useState(() => confirmedElsewhere(values));
  const id = useId();
  const wrote = useOutsideChange(
    keyOf(values.canonical, values.canonicalElsewhere),
    () => {
      const held = typedText(values.canonical);
      setText(held);
      setEditing(held !== "");
      setConfirmed(confirmedElsewhere(values));
    }
  );
  const write = (next: string, elsewhere: boolean) => {
    const stored = storedCanonical(next, origins, elsewhere);
    wrote(keyOf(stored.canonical, stored.canonicalElsewhere));
    onSet("canonical", stored.canonical);
    onSet("canonicalElsewhere", stored.canonicalElsewhere);
  };
  const own = context?.levels.address;
  return (
    <Row
      error={errors.canonical ?? errors.canonicalElsewhere}
      label="Official address"
      help="The one address search engines should credit for this page. Leave it automatic unless the article first appeared on another site."
      control={
        editing ? (
          <RowButton
            disabled={!writable}
            onClick={() => {
              setEditing(false);
              setText("");
              setConfirmed(false);
              write("", false);
            }}
          >
            Go back to automatic
          </RowButton>
        ) : (
          <RowButton
            disabled={!writable || context === undefined}
            onClick={() => setEditing(true)}
          >
            Use another address
          </RowButton>
        )
      }
    >
      {editing ? (
        <>
          <Input
            autoFocus
            aria-label="Official address"
            aria-describedby={`${id}-check`}
            aria-invalid={checkCanonical(text, origins).kind === "bad"}
            placeholder="https://"
            value={text}
            disabled={!writable}
            className="font-mono text-xs"
            onChange={event => {
              setText(event.target.value);
              setConfirmed(false);
              write(event.target.value, false);
            }}
          />
          <div id={`${id}-check`}>
            <AddressCheck
              text={text}
              origins={origins}
              confirmed={confirmed}
              disabled={!writable}
              onConfirm={next => {
                setConfirmed(next);
                write(text, next);
              }}
            />
          </div>
        </>
      ) : (
        <SourceRow>
          {own === undefined || context === undefined ? (
            <span>
              This page has no public address yet, so it has no official
              address.
            </span>
          ) : (
            <>
              <Chip>Automatic</Chip>
              <span
                data-testid="seo-official-address"
                className="font-mono text-xs break-all text-foreground"
              >
                {absoluteAddress(context.site.origin, own)}
              </span>
              <span>this page&apos;s own address</span>
            </>
          )}
        </SourceRow>
      )}
    </Row>
  );
}

/** What a typed address will do, or why it cannot be used. */
function AddressCheck({
  text,
  origins,
  confirmed,
  disabled,
  onConfirm,
}: {
  text: string;
  origins: readonly string[];
  confirmed: boolean;
  disabled: boolean;
  onConfirm: (confirmed: boolean) => void;
}): ReactNode {
  const check = checkCanonical(text, origins);
  const help = "m-0 text-[12.5px] leading-[1.45] text-muted-foreground";
  if (check.kind === "empty") {
    return (
      <p className={help}>
        Only for an article that first appeared somewhere else. Search engines
        will credit that address instead of this page.
      </p>
    );
  }
  if (check.kind === "bad") {
    return (
      <p
        role="alert"
        className="m-0 flex items-start gap-1.5 text-[12.5px] leading-[1.45] font-medium text-danger-text"
      >
        <TriangleAlert aria-hidden="true" className="mt-px size-4 flex-none" />
        {check.message}
      </p>
    );
  }
  if (check.kind === "same") {
    return (
      <p className={help}>
        An address on this site. Search engines will credit it instead of this
        page.
      </p>
    );
  }
  return (
    <Note tone="warning">
      <b className="font-semibold">
        That address is on another site, {check.host}.
      </b>{" "}
      Search engines will credit it, and this page may drop out of results.
      <label className="mt-1.5 flex items-center gap-1.5">
        <Checkbox
          checked={confirmed}
          disabled={disabled}
          onCheckedChange={checked => onConfirm(checked === true)}
        />
        This article lives on that site
      </label>
      {confirmed ? null : (
        <div className="mt-1 text-[12.5px] text-muted-foreground">
          Until you tick this, the automatic address stays in use.
        </div>
      )}
    </Note>
  );
}

/**
 * The source a shared link's text has of its own while none is typed for it,
 * or `undefined` where a shared link uses the Google one. The one decision the
 * empty shared fields and the switch's sentence both read.
 */
function ownSharedSource(
  shared: Sourced<string> | undefined,
  google: Sourced<string> | undefined
): Sourced<string> | undefined {
  if (shared === undefined) return undefined;
  return shared.value === google?.value && shared.from === google.from
    ? undefined
    : shared;
}

/**
 * The switch's sentence: what shared links use for their title while none is
 * typed for them, the Google title or the one the route, template or design
 * sets for them, named as the empty field's source line names it.
 */
function sharedTitleHelp(
  own: Sourced<string> | undefined,
  names: SourceNames
): string {
  const rest =
    " Turn this on only if you want a different one on LinkedIn, Slack and others.";
  const source =
    own === undefined ? undefined : describeSource(own, "socialTitle", names);
  if (source?.kind === "code") {
    return `Shared links use the title this page's route sets for them.${rest}`;
  }
  if (source?.kind === "template") {
    const drawer = source.design ? "design" : "template";
    return `Shared links use the title this page's ${drawer} sets for them.${rest}`;
  }
  return `Shared links use the Google title.${rest}`;
}

/**
 * Where an empty shared title or description comes from: the Google one,
 * where a shared link uses the same, and else its own source, named as every
 * automatic value's is.
 */
function SharedSource({
  shared,
  google,
  googleName,
  value,
  names,
}: {
  shared: Sourced<string> | undefined;
  google: Sourced<string> | undefined;
  googleName: string;
  value: SourcedValue;
  names: SourceNames;
}): ReactNode {
  const own = ownSharedSource(shared, google);
  if (own === undefined) {
    return (
      <>
        <Chip>Automatic</Chip>
        <span>same as the {googleName}</span>
      </>
    );
  }
  return <AutomaticSource sourced={own} value={value} names={names} />;
}

/** A title for shared links that differs from the Google title. */
function SharedTitleRow({
  values,
  context,
  names,
  writable,
  errors,
  onSet,
}: AdvancedProps): ReactNode {
  // What a shared link uses while its own text is empty, which the empty
  // fields show and name: not always the Google title, since the route or the
  // template may set text for shared links of its own.
  const unshared = unsharedAnswer(context, values);
  const has = (name: string) =>
    context === undefined || context.fields.includes(name);
  const typedNow = () =>
    isTyped(values.socialTitle) || isTyped(values.socialDescription);
  const [on, setOn] = useState(typedNow);
  const wrote = useOutsideChange(
    keyOf(values.socialTitle, values.socialDescription),
    () => setOn(typedNow())
  );
  const write = (field: "socialTitle" | "socialDescription", next: string) => {
    const value = next === "" ? null : next;
    wrote(
      field === "socialTitle"
        ? keyOf(value, values.socialDescription)
        : keyOf(values.socialTitle, value)
    );
    onSet(field, value);
  };
  const label = "Different title when shared";
  const typed = typedText(values.socialTitle);
  return (
    <Row
      error={errors.socialTitle ?? errors.socialDescription}
      label={label}
      help={sharedTitleHelp(
        ownSharedSource(unshared?.socialTitle, unshared?.title),
        names
      )}
      control={
        <Switch
          aria-label={label}
          checked={on}
          disabled={!writable}
          onCheckedChange={checked => {
            setOn(checked);
            if (checked) return;
            wrote(keyOf(null, null));
            onSet("socialTitle", null);
            onSet("socialDescription", null);
          }}
        />
      }
    >
      {on ? (
        <>
          {has("socialTitle") && (
            <>
              <Input
                autoFocus
                aria-label="Title when shared"
                placeholder={unshared?.socialTitle?.value ?? ""}
                value={typed}
                disabled={!writable}
                onChange={event => write("socialTitle", event.target.value)}
              />
              <SourceRow>
                {isTyped(typed) ? (
                  <Chip kind="typed">Typed for this page</Chip>
                ) : (
                  <SharedSource
                    shared={unshared?.socialTitle}
                    google={unshared?.title}
                    googleName="Google title"
                    value="socialTitle"
                    names={names}
                  />
                )}
              </SourceRow>
            </>
          )}
          {has("socialDescription") && (
            <>
              <Textarea
                rows={2}
                aria-label="Description when shared"
                placeholder={unshared?.socialDescription?.value ?? ""}
                value={typedText(values.socialDescription)}
                disabled={!writable}
                onChange={event =>
                  write("socialDescription", event.target.value)
                }
              />
              <SourceRow>
                {isTyped(values.socialDescription) ? (
                  <Chip kind="typed">Typed for this page</Chip>
                ) : (
                  <SharedSource
                    shared={unshared?.socialDescription}
                    google={unshared?.description}
                    googleName="Google description"
                    value="description"
                    names={names}
                  />
                )}
              </SourceRow>
            </>
          )}
        </>
      ) : undefined}
    </Row>
  );
}
