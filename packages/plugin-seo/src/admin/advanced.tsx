/**
 * The SEO panel's Advanced section: hiding the page from search, its official
 * address, a different title when shared, and the share image. Closed until
 * a person opens it; a count beside its name says how many of the page's
 * problems are inside.
 *
 * @module admin/advanced
 */
import { Checkbox, Input, Switch, Textarea } from "@nextlyhq/ui";
import { Check, ChevronDown, Lock, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { SeoAnswer } from "../resolver/order";
import { checkCanonical, storedCanonical } from "../tab/canonical";
import type { SeoTabContext } from "../tab/contract";
import { absoluteAddress } from "../tab/display";
import { thingsToFix } from "../tab/problems";

import {
  Chip,
  cx,
  inSentence,
  Note,
  type SourceNames,
  SourceRow,
} from "./parts";
import { Row, RowButton } from "./rows";
import { ShareImageRow } from "./share-image-row";
import {
  isTyped,
  typedText,
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
  const id = useId();
  const rows = advancedRows(props);
  // Nothing to put under it where the group declares only the two fields.
  if (rows.length === 0) return null;
  return (
    <section className="rounded-lg border border-border bg-card">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={() => setOpen(was => !was)}
        className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg border-0 bg-transparent px-3.5 py-3 text-left hover:bg-accent"
      >
        <b className="text-sm font-semibold text-foreground">Advanced</b>
        <span className="min-w-0 flex-1 text-[12.5px] text-muted-foreground">
          {summaryOf(rows.map(row => row.summary))}
        </span>
        {props.problemCount > 0 ? (
          <span
            title={thingsToFix(props.problemCount)}
            className="inline-grid h-[18px] min-w-[18px] place-items-center rounded-full border border-warning-border bg-warning-surface px-[5px] text-[11px] leading-none font-semibold text-warning-text"
          >
            {props.problemCount}
          </span>
        ) : null}
        <ChevronDown
          aria-hidden="true"
          className={cx(
            "size-4 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>
      <div id={`${id}-body`} hidden={!open}>
        {rows.map(({ key, Row: Drawn }) => (
          <Drawn key={key} {...props} />
        ))}
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
  const rows: (AdvancedRow | false)[] = [
    has("noindex") && {
      key: "hide",
      summary: "hiding from search",
      Row: HideRow,
    },
    has("canonical") && {
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
      help="Tells Google what kind of page this is, so it can show details like the author and date. Only types Google still shows are offered."
      control={
        // Drawn as the row's buttons are, with a caret of its own in place
        // of the browser's.
        <span className="relative inline-flex">
          <select
            aria-labelledby={`${id}-label`}
            value={chosen}
            disabled={!writable}
            onChange={event =>
              onSet(
                "structuredDataType",
                event.target.value === "" ? null : event.target.value
              )
            }
            className="h-7 min-w-[210px] cursor-pointer appearance-none rounded-md border border-border bg-background pl-2.5 pr-7 text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            <option value="">{structured.automatic.label} · automatic</option>
            {structured.offered.map(type => (
              <option key={type.key} value={type.key}>
                {type.label}
              </option>
            ))}
          </select>
          <ChevronDown
            aria-hidden="true"
            className="pointer-events-none absolute right-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
          />
        </span>
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

/**
 * Calls `reset` when the stored values (`stored`, as one key) change by
 * anything but the row's own writes, such as the document being read again
 * or switched to another language, so the row shows what the document holds.
 * Returns the function the row tells the key its own write leaves.
 */
function useOutsideChange(
  stored: string,
  reset: () => void
): (written: string) => void {
  const expected = useRef(stored);
  const latestReset = useRef(reset);
  latestReset.current = reset;
  useEffect(() => {
    if (stored === expected.current) return;
    expected.current = stored;
    latestReset.current();
  }, [stored]);
  return written => {
    expected.current = written;
  };
}

/** Stored values as one key, an absent value read as none. */
const keyOf = (...stored: unknown[]): string =>
  JSON.stringify(stored.map(value => value ?? null));

/**
 * Whether the stored address was confirmed to be on another site: marked so,
 * or, where the group keeps no mark, an address elsewhere at all, since one
 * is stored only once confirmed.
 */
function confirmedElsewhere(
  values: SeoPanelValues,
  origins: readonly string[]
): boolean {
  if (values.canonicalElsewhere === true) return true;
  return (
    checkCanonical(typedText(values.canonical), origins).kind === "elsewhere"
  );
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
  const [confirmed, setConfirmed] = useState(() =>
    confirmedElsewhere(values, origins)
  );
  const id = useId();
  const wrote = useOutsideChange(
    keyOf(values.canonical, values.canonicalElsewhere),
    () => {
      const held = typedText(values.canonical);
      setText(held);
      setEditing(held !== "");
      setConfirmed(confirmedElsewhere(values, origins));
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

/** A title for shared links that differs from the Google title. */
function SharedTitleRow({
  values,
  answer,
  context,
  writable,
  errors,
  onSet,
}: AdvancedProps): ReactNode {
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
      help="Shared links use the Google title. Turn this on only if you want a different one on LinkedIn, Slack and others."
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
                placeholder={answer?.title?.value ?? ""}
                value={typed}
                disabled={!writable}
                onChange={event => write("socialTitle", event.target.value)}
              />
              <SourceRow>
                {isTyped(typed) ? (
                  <Chip kind="typed">Typed for this page</Chip>
                ) : (
                  <>
                    <Chip>Automatic</Chip>
                    <span>same as the Google title</span>
                  </>
                )}
              </SourceRow>
            </>
          )}
          {has("socialDescription") && (
            <>
              <Textarea
                rows={2}
                aria-label="Description when shared"
                placeholder={answer?.description?.value ?? ""}
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
                  <>
                    <Chip>Automatic</Chip>
                    <span>same as the Google description</span>
                  </>
                )}
              </SourceRow>
            </>
          )}
        </>
      ) : undefined}
    </Row>
  );
}
