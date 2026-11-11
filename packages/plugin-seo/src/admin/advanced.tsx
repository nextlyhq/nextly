/**
 * The SEO panel's Advanced section: hiding the page from search, its official
 * address, a different title when shared, and the share image. Closed until
 * a person opens it; a count beside its name says how many of the page's
 * problems are inside.
 *
 * @module admin/advanced
 */
import { Button, Checkbox, Input, Switch, Textarea } from "@nextlyhq/ui";
import { Check, ChevronDown, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import type { SeoAnswer } from "../resolver/order";
import { checkCanonical, storedCanonical } from "../tab/canonical";
import type { SeoTabContext } from "../tab/contract";
import { absoluteAddress, fileNameOf } from "../tab/display";
import { thingsToFix } from "../tab/problems";

import {
  AutomaticSource,
  Chip,
  cx,
  LinkAction,
  Note,
  SourceRow,
  type SourceNames,
} from "./parts";
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
  /** How many of the page's problems are in this section. */
  problemCount: number;
  defaultOpen: boolean;
  onSet: (field: SeoPanelField, value: unknown) => void;
  /** Opens the media library; absent where no image can be chosen. */
  onChooseImage?: () => void;
}

export function AdvancedSection(props: AdvancedProps): ReactNode {
  const [open, setOpen] = useState(props.defaultOpen);
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
function StructuredDataRow({
  values,
  context,
  writable,
  onSet,
}: AdvancedProps): ReactNode {
  const id = useId();
  const structured = context?.structuredData;
  if (structured === undefined) return null;
  const chosen = typedText(values.structuredDataType);
  return (
    <Row
      label="Structured data type"
      labelId={`${id}-label`}
      help="Tells Google what kind of page this is, so it can show details like the author and date. Only types Google still shows are offered."
      control={
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
          className="h-9 min-w-[210px] cursor-pointer rounded-md border border-input bg-background px-3 text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">{structured.automatic.label} · automatic</option>
          {structured.offered.map(type => (
            <option key={type.key} value={type.key}>
              {type.label}
            </option>
          ))}
        </select>
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
  hosts: readonly string[]
): boolean {
  if (values.canonicalElsewhere === true) return true;
  return (
    checkCanonical(typedText(values.canonical), hosts).kind === "elsewhere"
  );
}

/** One row of the section: its label and sentence, a control, and below. */
function Row({
  label,
  labelId,
  help,
  control,
  children,
}: {
  label: string;
  labelId?: string;
  help: string;
  control?: ReactNode;
  children?: ReactNode;
}): ReactNode {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 border-t border-border-subtle p-3.5">
      <div>
        <div id={labelId} className="text-[13px] font-semibold text-foreground">
          {label}
        </div>
        <p className="m-0 mt-0.5 text-[12.5px] leading-[1.45] text-muted-foreground">
          {help}
        </p>
      </div>
      {control ?? <span />}
      {children === undefined ? null : (
        <div className="col-span-full grid gap-2">{children}</div>
      )}
    </div>
  );
}

/** The small outlined button rows use. */
function RowButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="h-7 px-2.5 text-xs"
    >
      {children}
    </Button>
  );
}

function HideRow({ values, writable, onSet }: AdvancedProps): ReactNode {
  const label = "Hide this page from search";
  return (
    <Row
      label={label}
      help="Search engines won't list it, and it leaves the sitemap. Anyone with the link can still open it."
      control={
        <Switch
          aria-label={label}
          checked={values.noindex === true}
          disabled={!writable}
          onCheckedChange={checked => onSet("noindex", checked)}
        />
      }
    />
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
  onSet,
}: AdvancedProps): ReactNode {
  const typed = typedText(values.canonical);
  const hosts = context?.site.hosts ?? [];
  const [editing, setEditing] = useState(typed !== "");
  const [text, setText] = useState(typed);
  const [confirmed, setConfirmed] = useState(() =>
    confirmedElsewhere(values, hosts)
  );
  const id = useId();
  const wrote = useOutsideChange(
    keyOf(values.canonical, values.canonicalElsewhere),
    () => {
      const held = typedText(values.canonical);
      setText(held);
      setEditing(held !== "");
      setConfirmed(confirmedElsewhere(values, hosts));
    }
  );
  const write = (next: string, elsewhere: boolean) => {
    const stored = storedCanonical(next, hosts, elsewhere);
    wrote(keyOf(stored.canonical, stored.canonicalElsewhere));
    onSet("canonical", stored.canonical);
    onSet("canonicalElsewhere", stored.canonicalElsewhere);
  };
  const own = context?.levels.address;
  return (
    <Row
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
            aria-invalid={checkCanonical(text, hosts).kind === "bad"}
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
              hosts={hosts}
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
  hosts,
  confirmed,
  disabled,
  onConfirm,
}: {
  text: string;
  hosts: readonly string[];
  confirmed: boolean;
  disabled: boolean;
  onConfirm: (confirmed: boolean) => void;
}): ReactNode {
  const check = checkCanonical(text, hosts);
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

/** The image the row shows: the one chosen, else the automatic one. */
function shownImage(
  chosen: boolean,
  chosenImage: ChosenImage | undefined,
  automatic: ChosenImage | undefined
): ChosenImage | undefined {
  return chosen ? chosenImage : automatic;
}

/** The image's thumbnail, name and size. */
function ImageSummary({
  shown,
}: {
  shown: ChosenImage | undefined;
}): ReactNode {
  if (shown === undefined) {
    return <div className="text-muted-foreground">No share image yet.</div>;
  }
  const size =
    shown.width !== undefined && shown.height !== undefined
      ? `${shown.width} × ${shown.height}`
      : undefined;
  return (
    <>
      <div className="break-all">{shown.filename ?? fileNameOf(shown.url)}</div>
      {size === undefined ? null : (
        <div className="font-mono text-xs text-muted-foreground">{size}</div>
      )}
    </>
  );
}

/** The picture shown when someone shares the page. */
function ShareImageRow({
  values,
  answer,
  chosenImage,
  names,
  writable,
  onSet,
  onChooseImage,
}: AdvancedProps): ReactNode {
  const chosen = values.ogImage !== null && values.ogImage !== undefined;
  const image = answer?.image;
  const shown = shownImage(
    chosen,
    chosenImage,
    image && { ...image.value, filename: fileNameOf(image.value.url) }
  );
  const choose =
    onChooseImage === undefined ? undefined : (
      <RowButton disabled={!writable} onClick={onChooseImage}>
        {shown === undefined ? "Choose an image" : "Choose another image"}
      </RowButton>
    );
  return (
    <Row
      label="Share image"
      help="The picture shown when someone shares this page on LinkedIn, X, Slack and others."
      control={choose}
    >
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative h-[62px] w-[88px] flex-none overflow-hidden rounded-md bg-muted">
          {shown && (
            <img
              src={shown.url}
              alt={shown.alt ?? ""}
              className="size-full object-cover"
            />
          )}
        </div>
        <div className="min-w-0 text-[13px] leading-normal text-foreground">
          <ImageSummary shown={shown} />
          <SourceRow>
            {chosen ? (
              <>
                <Chip kind="typed">Chosen for this page</Chip>
                <LinkAction
                  disabled={!writable}
                  onClick={() => onSet("ogImage", null)}
                >
                  Go back to automatic
                </LinkAction>
              </>
            ) : (
              image && (
                <AutomaticSource sourced={image} value="image" names={names} />
              )
            )}
          </SourceRow>
        </div>
      </div>
    </Row>
  );
}
