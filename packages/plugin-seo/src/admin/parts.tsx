/**
 * The small pieces the SEO panel is built from: the chip and line under a
 * field saying where its value comes from, a field's character count, the
 * plain link-style action, and a note.
 *
 * @module admin/parts
 */
import { Alert, AlertDescription } from "@nextlyhq/plugin-sdk/admin";
import { TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import type { SeoLevel, Sourced } from "../resolver/order";

/** Classes joined, without the empty ones. */
export function cx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** The chip that names a value's source. */
export function Chip({
  kind = "automatic",
  children,
}: {
  kind?: "automatic" | "typed" | "code";
  children: ReactNode;
}): ReactNode {
  return (
    // 12px, the smallest text the admin draws, so the chip stays readable.
    <span
      data-seo-chip={kind}
      className={cx(
        "rounded-[5px] px-[7px] py-px text-xs leading-[1.5] font-semibold whitespace-nowrap",
        kind === "typed" && "bg-foreground text-background",
        kind === "automatic" && "bg-secondary text-secondary-foreground",
        kind === "code" &&
          "border border-dashed border-muted-foreground text-foreground"
      )}
    >
      {children}
    </span>
  );
}

/** A button that reads as a link: one action beside a source. */
export function LinkAction({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}): ReactNode {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="cursor-pointer border-0 bg-transparent p-0 font-semibold text-foreground underline underline-offset-2 hover:decoration-2 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Pattern or code text, set in the code face. */
function Code({ children }: { children: ReactNode }): ReactNode {
  return (
    <code className="rounded bg-muted px-[5px] py-px font-mono text-xs whitespace-nowrap text-foreground">
      {children}
    </code>
  );
}

/** The line under a field: a chip and what it means. */
export function SourceRow({
  id,
  children,
}: {
  id?: string;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      id={id}
      className="flex flex-wrap items-center gap-2 text-xs leading-normal text-muted-foreground"
    >
      {children}
    </div>
  );
}

/** What a value is, beside its source: one of the page's text values. */
export type SourcedValue = "title" | "description" | "image" | "socialTitle";

/** What the panel knows to name a source: the type and its fields. */
export interface SourceNames {
  typeLabel: string;
  fieldLabels: Readonly<Record<string, string>>;
  /** What drew the page where a design gives its template level. */
  drawnBy?: "design" | "template";
}

/** What the site supplies for each value, as the source line names it. */
const SITE_DEFAULT: Record<SourcedValue, string> = {
  title: "the site's name",
  socialTitle: "the site's name",
  description: "the site's default description",
  image: "the site's default share image",
};

/**
 * Where an automatic value comes from, in words: the content type's
 * pattern, one of the page's own fields, the template or the site.
 */
export function AutomaticSource({
  sourced,
  value,
  names,
}: {
  sourced: Pick<Sourced<unknown>, "from" | "pattern" | "field">;
  value: SourcedValue;
  names: SourceNames;
}): ReactNode {
  return (
    <>
      <Chip kind={sourced.from === "code" ? "code" : "automatic"}>
        {sourced.from === "code" ? "Set in code" : "Automatic"}
      </Chip>
      <span>{sourceWords(sourced, value, names)}</span>
    </>
  );
}

/**
 * A type's name inside a sentence: "Blog post" becomes "blog post", while a
 * name that opens with an acronym, such as "SEO page", keeps its capitals.
 */
export function inSentence(name: string): string {
  const [first = "", second = ""] = name;
  return second !== "" &&
    second === second.toUpperCase() &&
    /[a-z]/i.test(second)
    ? name
    : first.toLowerCase() + name.slice(1);
}

/**
 * Where an automatic value comes from, decided once: the type's pattern, one
 * of the page's own fields, its template or design, its route's code, or
 * the site's default. Both ways a source is said, the chip's line and the
 * "Empty uses" sentence, word this one answer.
 */
export type SourceDescription =
  | { kind: "pattern"; type: string; pattern: string }
  | { kind: "field"; type: string; field: string }
  | { kind: "template"; design: boolean }
  | { kind: "code" }
  | { kind: "site"; what: string };

export function describeSource(
  sourced: Pick<Sourced<unknown>, "from" | "pattern" | "field">,
  value: SourcedValue,
  names: SourceNames
): SourceDescription {
  const level: SeoLevel = sourced.from;
  if (level === "pattern" && sourced.pattern !== undefined) {
    return { kind: "pattern", type: names.typeLabel, pattern: sourced.pattern };
  }
  if (level === "content" && sourced.field !== undefined) {
    return {
      kind: "field",
      type: inSentence(names.typeLabel),
      field: names.fieldLabels[sourced.field] ?? sourced.field,
    };
  }
  if (level === "template") {
    return { kind: "template", design: names.drawnBy === "design" };
  }
  if (level === "code") return { kind: "code" };
  return { kind: "site", what: SITE_DEFAULT[value] };
}

/** The words after the chip, for each level that can supply a value. */
function sourceWords(
  sourced: Pick<Sourced<unknown>, "from" | "pattern" | "field">,
  value: SourcedValue,
  names: SourceNames
): ReactNode {
  const source = describeSource(sourced, value, names);
  switch (source.kind) {
    case "pattern":
      return (
        <>
          from the{" "}
          <b className="font-semibold text-foreground">{source.type}</b> pattern{" "}
          <Code>{source.pattern}</Code>
        </>
      );
    case "field":
      return (
        <>
          from the {source.type}&apos;s{" "}
          <b className="font-semibold text-foreground">{source.field}</b>
        </>
      );
    case "template":
      return source.design
        ? "from this page's design"
        : "from this page's template";
    case "code":
      return "by this page's route. Anything you type here wins over it.";
    case "site":
      return source.what;
  }
}

/**
 * What an empty field falls back to, as one sentence: "Empty uses the Posts
 * pattern: {Title} | {Site name}", "Empty uses the post's summary".
 */
export function EmptyUses({
  sourced,
  value,
  names,
}: {
  sourced: Pick<Sourced<unknown>, "from" | "pattern" | "field">;
  value: SourcedValue;
  names: SourceNames;
}): ReactNode {
  const source = describeSource(sourced, value, names);
  switch (source.kind) {
    case "pattern":
      return (
        <>
          Empty uses the {source.type} pattern: <Code>{source.pattern}</Code>
        </>
      );
    case "field":
      return `Empty uses the ${source.type}'s ${inSentence(source.field)}`;
    case "template":
      return source.design
        ? "Empty uses this page's design"
        : "Empty uses this page's template";
    case "code":
      return "Empty uses what this page's route sets. Anything you type here wins over it.";
    case "site":
      return `Empty uses ${source.what}`;
  }
}

/** The admin's notice each tone is drawn as. */
const NOTE_VARIANTS = {
  plain: "info",
  warning: "warning",
  success: "success",
} as const;

/**
 * A note: the admin's own notice, plain, a warning, or the word that
 * something worked. A note says how things stand rather than interrupting,
 * so it is announced as a note, not as an alert.
 */
export function Note({
  tone = "plain",
  icon,
  children,
}: {
  tone?: "plain" | "warning" | "success";
  icon?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <Alert
      variant={NOTE_VARIANTS[tone]}
      role="note"
      // The icon sits straight inside, where the notice colours it by tone.
      className="px-3 py-2.5 text-[13px] leading-[1.45] [&>svg]:mt-px [&>svg]:size-4 [&>svg]:flex-none"
    >
      {icon ?? <TriangleAlert aria-hidden="true" />}
      <AlertDescription className="min-w-0 flex-1 text-[13px] leading-[1.45]">
        {children}
      </AlertDescription>
    </Alert>
  );
}

/** A field's character count against what Google shows, `58 / 60`. */
export function CharacterCount({
  id,
  count,
  limit,
}: {
  id?: string;
  count: number;
  limit: number;
}): ReactNode {
  const over = count > limit;
  return (
    <span
      id={id}
      data-over={over ? "true" : "false"}
      title={
        over ? `Google usually shows about ${limit} characters` : undefined
      }
      className={cx(
        "text-xs whitespace-nowrap tabular-nums",
        over ? "font-semibold text-warning-text" : "text-muted-foreground"
      )}
    >
      {count} / {limit}
    </span>
  );
}
