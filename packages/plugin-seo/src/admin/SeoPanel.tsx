/**
 * The SEO panel: the page's preview on Google and when shared, its title and
 * description first, each showing what will be used and where it comes from,
 * and every other setting under Advanced.
 *
 * Drawn from props alone, so every surface that edits a page's SEO draws this
 * one panel: an entry's SEO tab hands it the document's values and writes
 * what it sets back to the document; another surface, such as a template's
 * settings, hands it its own.
 *
 * @module admin/SeoPanel
 */
import {
  Alert,
  AlertDescription,
  Input,
  navigateTo,
  Textarea,
} from "@nextlyhq/plugin-sdk/admin";
import { EyeOff, Lock } from "lucide-react";
import { useId, type ReactNode, type Ref } from "react";

import type { Sourced } from "../resolver/order";
import type { SeoTabContext } from "../tab/contract";
import {
  characters,
  DESCRIPTION_LIMIT,
  TITLE_LIMIT,
  type SeoProblem,
} from "../tab/problems";

import { AdvancedSection } from "./advanced";
import {
  CharacterCount,
  Chip,
  EmptyUses,
  inSentence,
  LinkAction,
  Note,
  SourceRow,
  type SourceNames,
} from "./parts";
import { PreviewCard } from "./previews";
import { copyFixes, useMakeFailure, type MakeFailure } from "./share-image-row";
import {
  isTyped,
  typedText,
  type ChosenImage,
  type PanelAnswers,
  type SeoPanelField,
  type SeoPanelValues,
} from "./values";

export interface SeoPanelProps {
  /** The page's levels and what names them, once read. */
  context: SeoTabContext | undefined;
  /** Whether the levels are being read, or could not be. */
  status: "ready" | "loading" | "failed";
  /** The page's answer, and its automatic one, from `panelAnswers`. */
  answers: PanelAnswers | undefined;
  /** The page's problems, from `seoProblems`. */
  problems: readonly SeoProblem[];
  /** The values the panel edits, as typed. */
  values: SeoPanelValues;
  /** The share image chosen for the page, where one is and has been read. */
  chosenImage: ChosenImage | undefined;
  /** Whether the values can be changed now. */
  writable: boolean;
  /** Why a value was refused when the page was saved, by field. */
  errors?: Partial<Record<SeoPanelField, string>>;
  /** Sets one value; `null` returns it to automatic. */
  onSet: (field: SeoPanelField, value: unknown) => void;
  /** Opens the media library to choose a share image. */
  onChooseImage?: () => void;
  /** The file of the share image shown while none is chosen, where read. */
  shownImageFile?: ChosenImage | undefined;
  /** Makes a share image of the right size; answers whether it did. */
  onMakeShareImage?: (() => Promise<string | undefined>) | undefined;
  /** Opens the page's own content at one of its fields. */
  onGoToField?: ((field: string) => void) | undefined;
  /** Whether Advanced starts open. Closed on a real page. */
  defaultAdvancedOpen?: boolean;
  /**
   * Where this page's check of what search engines received is, where it
   * has an address to check; no link is offered without one.
   */
  receivedHref?: string | undefined;
  /**
   * Which document and language the values are of: another one lets go of
   * what was being typed under Advanced and not stored yet.
   */
  documentKey?: string;
}

/** The values whose problems the Advanced section holds. */
const ADVANCED_VALUES: readonly string[] = ["structuredData", "image"];

export function SeoPanel(props: SeoPanelProps): ReactNode {
  const { context, answers, problems, values, writable, errors, onSet } = props;
  // Whether the last share image copy asked for from the notices failed.
  const makeFailure = useMakeFailure(values.ogImage);
  const names: SourceNames = {
    typeLabel: context?.typeLabel ?? "page",
    fieldLabels: context?.fieldLabels ?? {},
    ...(context?.drawnBy === undefined ? {} : { drawnBy: context.drawnBy }),
  };
  const answer = answers?.answer;
  return (
    <div className="flex flex-col gap-[18px] pt-4 pb-12">
      {context?.mayChange === false ? (
        <Note icon={<Lock className="size-4" />}>
          <b className="font-semibold">You can't change this page's SEO.</b> You
          can see what search engines and social networks are given. Ask someone
          who manages the site's SEO to change it.
        </Note>
      ) : null}
      {answer?.robots.from === "type" ? (
        <Note icon={<EyeOff className="size-4" />}>
          <b className="font-semibold">
            Every {inSentence(names.typeLabel)} page is hidden from search.
          </b>{" "}
          This page stays hidden whatever its own switch says. People can still
          share it.
        </Note>
      ) : null}
      <PreviewCard answer={answer} site={context?.site} status={props.status} />
      <ProblemNotices
        problems={problems}
        onMake={makerOf(props, makeFailure.track)}
        makeFailed={makeFailure.failed}
      />
      <PageTextField
        label="Title on Google"
        help="The blue link people click in Google's results. Google shows about 60 characters."
        typed={typedText(values.metaTitle)}
        used={answer?.title}
        automatic={answers?.automatic.title}
        limit={TITLE_LIMIT}
        value="title"
        names={names}
        problem={problems.find(p => p.value === "title")}
        error={errors?.metaTitle}
        writable={writable}
        onChange={next => onSet("metaTitle", next)}
      />
      <PageTextField
        multiline
        label="Description on Google"
        help="The grey text under the link. It doesn't change rankings, but it helps people decide to click."
        typed={typedText(values.metaDescription)}
        used={answer?.description}
        automatic={answers?.automatic.description}
        limit={DESCRIPTION_LIMIT}
        value="description"
        names={names}
        problem={problems.find(p => p.value === "description")}
        error={errors?.metaDescription}
        writable={writable}
        onChange={next => onSet("metaDescription", next)}
      />
      <AdvancedSection
        key={props.documentKey}
        errors={errors ?? {}}
        values={values}
        answer={answer}
        context={context}
        names={names}
        chosenImage={props.chosenImage}
        writable={writable}
        problemCount={
          problems.filter(p => ADVANCED_VALUES.includes(p.value)).length
        }
        defaultOpen={props.defaultAdvancedOpen ?? false}
        onSet={onSet}
        {...(props.onChooseImage === undefined
          ? {}
          : { onChooseImage: props.onChooseImage })}
        shownImageFile={props.shownImageFile}
        onMakeShareImage={props.onMakeShareImage}
        onGoToField={props.onGoToField}
      />
      {props.receivedHref === undefined ? null : (
        <ReceivedLink href={props.receivedHref} />
      )}
    </div>
  );
}

/**
 * Each problem the page has, as the admin's notice, under the previews: what
 * is wrong in one sentence, and for a share image networks can't show, the
 * one action that makes a copy that they can.
 */
/**
 * What makes a share image of the right size from the notices, where the
 * page's image is one a copy fixes and the person may change the page.
 */
function makerOf(
  props: SeoPanelProps,
  track: MakeFailure["track"]
): (() => void) | undefined {
  const make = props.onMakeShareImage;
  const fixable = copyFixes(props.context?.shareImage?.problems);
  // Only where the group declares a share image, as the Advanced row is.
  const declared = props.context?.fields.includes("ogImage") ?? true;
  if (!props.writable || make === undefined || !fixable || !declared) {
    return undefined;
  }
  // A copy that could not be made answers with no image: said beside the
  // notice, so trying again is a choice rather than a silent repeat.
  return () => track(make());
}

function ProblemNotices({
  problems,
  onMake,
  makeFailed,
}: {
  problems: readonly SeoProblem[];
  /** Makes a share image networks can show, where one would fix it. */
  onMake: (() => void) | undefined;
  /** Whether the last copy asked for could not be made. */
  makeFailed: boolean;
}): ReactNode {
  if (problems.length === 0) return null;
  return (
    <div className="grid gap-2">
      {problems.map((problem, index) => (
        <Alert
          key={`${problem.id}-${index}`}
          variant="warning"
          role="status"
          className="items-center px-3.5 py-2.5"
        >
          <AlertDescription className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[13px]">
            <span>{problem.text}</span>
            {problem.id === "share-image" && onMake !== undefined ? (
              <LinkAction onClick={onMake}>Make a share image</LinkAction>
            ) : null}
            {problem.id === "share-image" && makeFailed ? (
              <span className="basis-full font-medium text-danger-text">
                The share image couldn&apos;t be made. Try again, or choose
                another image under Advanced.
              </span>
            ) : null}
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}

/**
 * The way to the page's check of what search engines received, opened
 * within the admin like any of its own links.
 */
function ReceivedLink({ href }: { href: string }): ReactNode {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-xs leading-normal text-muted-foreground">
      <span>
        Want to see what Google and LinkedIn actually received for this page?
      </span>
      <a
        href={href}
        className="text-xs font-semibold text-foreground underline underline-offset-2 hover:decoration-2"
        onClick={event => {
          // A new tab or window is the browser's to open.
          if (event.metaKey || event.ctrlKey || event.shiftKey) return;
          event.preventDefault();
          navigateTo(href);
        }}
      >
        Check what search engines received
      </a>
    </div>
  );
}

/** Where a field's value comes from, with one way back once it is typed. */
function FieldSource({
  id,
  typed,
  automatic,
  value,
  names,
  problem,
  writable,
  onAutomatic,
}: {
  id: string;
  typed: string;
  automatic: Sourced<string> | undefined;
  value: "title" | "description";
  names: SourceNames;
  problem: SeoProblem | undefined;
  writable: boolean;
  onAutomatic: () => void;
}): ReactNode {
  if (isTyped(typed)) {
    return (
      <SourceRow id={id}>
        <Chip kind="typed">Typed for this page</Chip>
        <LinkAction disabled={!writable} onClick={onAutomatic}>
          Go back to automatic
        </LinkAction>
      </SourceRow>
    );
  }
  if (automatic !== undefined) {
    return (
      <SourceRow id={id}>
        <span>
          <EmptyUses sourced={automatic} value={value} names={names} />
        </span>
      </SourceRow>
    );
  }
  return (
    <SourceRow id={id}>
      <span className={problem && "font-medium text-warning-text"}>
        Nothing to use yet. {problem?.text}
      </span>
    </SourceRow>
  );
}

/** What a page's title or description field is handed. */
export interface SeoTextFieldProps {
  label: string;
  help: string;
  /** What is typed for the page, `""` for nothing. */
  value: string;
  /** The placeholder: the value used while nothing is typed. */
  placeholder: string;
  /** How long the value used is, in characters. */
  count: number;
  limit: number;
  /** The line under the field saying where the value comes from, by its id. */
  source: (id: string) => ReactNode;
  error?: string | undefined;
  writable: boolean;
  multiline?: boolean;
  /** The most characters the field takes, where it takes no more. */
  maxLength?: number;
  /**
   * Drawn as the SEO tab draws its two fields: "· optional" after the label,
   * the sentence read out but not shown, and no count, since the problems
   * above the fields say when a value is too long.
   */
  quiet?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  /** Sets the value; `null` returns it to automatic. */
  onChange: (next: string | null) => void;
}

/** What a title's or description's control is handed. */
function controlProps(
  id: string,
  value: string,
  placeholder: string,
  writable: boolean,
  error: string | undefined,
  onChange: (next: string | null) => void
) {
  const described = [`${id}-help`, `${id}-source`];
  if (error !== undefined) described.push(`${id}-error`);
  return {
    id,
    value,
    placeholder,
    disabled: !writable,
    "aria-describedby": described.join(" "),
    "aria-invalid": error !== undefined,
    // A field emptied is a field returned to automatic.
    onChange: (event: { target: { value: string } }) =>
      onChange(event.target.value === "" ? null : event.target.value),
  };
}

/** Why a field's value was refused at save, where it was. */
function FieldError({
  id,
  error,
}: {
  id: string;
  error: string | undefined;
}): ReactNode {
  if (!error) return null;
  return (
    <p
      id={id}
      role="alert"
      className="m-0 text-xs font-medium text-danger-text"
    >
      {error}
    </p>
  );
}

/** A field's label, with "· optional" beside it where it is drawn quiet. */
function FieldLabel({
  id,
  label,
  optional,
}: {
  id: string;
  label: string;
  optional: boolean;
}): ReactNode {
  return (
    <span className="text-sm">
      <label htmlFor={id} className="font-medium text-foreground">
        {label}
      </label>
      {/* Beside the label rather than in it, so the field is named by its
          label alone. */}
      {optional ? (
        <span className="text-muted-foreground"> · optional</span>
      ) : null}
    </span>
  );
}

/** The sentence under a label: shown, or only read out where drawn quiet. */
function helpClass(quiet: boolean): string {
  return quiet
    ? "sr-only"
    : "m-0 text-[12.5px] leading-[1.45] text-muted-foreground";
}

/**
 * A page's title or description: a count of what will be used, one plain
 * sentence, the field with the automatic value as its placeholder, and the
 * line saying where the value comes from. Every surface that edits a page's
 * SEO draws its title and description with it.
 */
export function SeoTextField({
  label,
  help,
  value,
  placeholder,
  count,
  limit,
  source,
  error,
  writable,
  multiline = false,
  maxLength,
  inputRef,
  onChange,
  quiet = false,
}: SeoTextFieldProps): ReactNode {
  const id = useId();
  const field = controlProps(id, value, placeholder, writable, error, onChange);
  const limited = maxLength === undefined ? {} : { maxLength };
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2.5">
        <FieldLabel id={id} label={label} optional={quiet} />
        {quiet ? null : <CharacterCount count={count} limit={limit} />}
      </div>
      <p id={`${id}-help`} className={helpClass(quiet)}>
        {help}
      </p>
      {multiline ? (
        <Textarea {...field} {...limited} rows={3} />
      ) : (
        <Input {...field} {...limited} ref={inputRef} />
      )}
      {source(`${id}-source`)}
      <FieldError id={`${id}-error`} error={error} />
    </div>
  );
}

/**
 * The tab's title or description: the shared field, saying where the value
 * comes from with one action back to automatic once typed.
 */
function PageTextField({
  label,
  help,
  typed,
  used,
  automatic,
  limit,
  value,
  names,
  problem,
  error,
  writable,
  multiline = false,
  onChange,
}: {
  label: string;
  help: string;
  typed: string;
  used: Sourced<string> | undefined;
  automatic: Sourced<string> | undefined;
  limit: number;
  value: "title" | "description";
  names: SourceNames;
  problem: SeoProblem | undefined;
  error: string | undefined;
  writable: boolean;
  multiline?: boolean;
  onChange: (next: string | null) => void;
}): ReactNode {
  return (
    <SeoTextField
      label={label}
      help={help}
      value={typed}
      placeholder={automatic?.value ?? ""}
      // Counted as the problems are, so an emoji counts once.
      count={used === undefined ? 0 : characters(used.value)}
      limit={limit}
      error={error}
      writable={writable}
      multiline={multiline}
      onChange={onChange}
      quiet
      source={id => (
        <FieldSource
          id={id}
          typed={typed}
          automatic={automatic}
          value={value}
          names={names}
          problem={problem}
          writable={writable}
          onAutomatic={() => onChange(null)}
        />
      )}
    />
  );
}
