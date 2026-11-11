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
import { Input, Textarea } from "@nextlyhq/ui";
import { EyeOff } from "lucide-react";
import { useId, type ReactNode } from "react";

import type { Sourced } from "../resolver/order";
import type { SeoTabContext } from "../tab/contract";
import {
  DESCRIPTION_LIMIT,
  TITLE_LIMIT,
  type SeoProblem,
} from "../tab/problems";

import { AdvancedSection } from "./advanced";
import {
  AutomaticSource,
  CharacterCount,
  Chip,
  inSentence,
  LinkAction,
  Note,
  SourceRow,
  type SourceNames,
} from "./parts";
import { PreviewCard } from "./previews";
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
  onMakeShareImage?: (() => Promise<boolean>) | undefined;
  /** Opens the page's own content at one of its fields. */
  onGoToField?: ((field: string) => void) | undefined;
  /** Whether Advanced starts open. Closed on a real page. */
  defaultAdvancedOpen?: boolean;
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
  const names: SourceNames = {
    typeLabel: context?.typeLabel ?? "page",
    fieldLabels: context?.fieldLabels ?? {},
  };
  const answer = answers?.answer;
  return (
    <div className="flex flex-col gap-[18px] pt-4 pb-12">
      {answer?.robots.from === "type" ? (
        <Note icon={<EyeOff className="size-4" />}>
          <b className="font-semibold">
            Every {inSentence(names.typeLabel)} page is hidden from search.
          </b>{" "}
          This page stays hidden whatever its own switch says. People can still
          share it.
        </Note>
      ) : null}
      <PreviewCard
        answer={answer}
        site={context?.site}
        status={props.status}
        sharedTitleTyped={isTyped(values.socialTitle)}
      />
      <SeoTextField
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
      <SeoTextField
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
        <AutomaticSource sourced={automatic} value={value} names={names} />
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

/** What the title's or the description's control is handed. */
function fieldProps(
  id: string,
  typed: string,
  automatic: Sourced<string> | undefined,
  writable: boolean,
  error: string | undefined,
  onChange: (next: string | null) => void
) {
  const described = [`${id}-help`, `${id}-source`];
  if (error !== undefined) described.push(`${id}-error`);
  return {
    id,
    value: typed,
    placeholder: automatic?.value ?? "",
    disabled: !writable,
    "aria-describedby": described.join(" "),
    "aria-invalid": error !== undefined,
    // A field emptied is a field returned to automatic.
    onChange: (event: { target: { value: string } }) =>
      onChange(event.target.value === "" ? null : event.target.value),
  };
}

/**
 * The title or the description: a count of what will be used, one plain
 * sentence, the field with the automatic value as its placeholder, and where
 * the value comes from, with one action back to automatic once typed.
 */
function SeoTextField({
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
  const id = useId();
  const field = fieldProps(id, typed, automatic, writable, error, onChange);
  const Control = multiline ? Textarea : Input;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2.5">
        <label
          htmlFor={id}
          className="text-[13px] font-semibold text-foreground"
        >
          {label}
        </label>
        <CharacterCount count={used?.value.length ?? 0} limit={limit} />
      </div>
      <p
        id={`${id}-help`}
        className="m-0 text-[12.5px] leading-[1.45] text-muted-foreground"
      >
        {help}
      </p>
      <Control {...field} {...(multiline ? { rows: 3 } : {})} />
      <FieldSource
        id={`${id}-source`}
        typed={typed}
        automatic={automatic}
        value={value}
        names={names}
        problem={problem}
        writable={writable}
        onAutomatic={() => onChange(null)}
      />
      {error && (
        <p
          id={`${id}-error`}
          role="alert"
          className="m-0 text-xs font-medium text-danger-text"
        >
          {error}
        </p>
      )}
    </div>
  );
}
