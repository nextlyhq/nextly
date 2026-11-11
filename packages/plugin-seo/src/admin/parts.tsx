/**
 * The small pieces the SEO panel is built from: the chip and line under a
 * field saying where its value comes from, a field's character count, the
 * plain link-style action, and a note.
 *
 * @module admin/parts
 */
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
    <span
      data-seo-chip={kind}
      className={cx(
        "rounded-[5px] px-[7px] py-px text-[11px] leading-[1.5] font-semibold whitespace-nowrap",
        kind === "typed" && "bg-foreground text-background",
        kind === "automatic" && "bg-muted text-foreground",
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
export function Code({ children }: { children: ReactNode }): ReactNode {
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

/** The words after the chip, for each level that can supply a value. */
function sourceWords(
  sourced: Pick<Sourced<unknown>, "from" | "pattern" | "field">,
  value: SourcedValue,
  names: SourceNames
): ReactNode {
  const level: SeoLevel = sourced.from;
  if (level === "pattern" && sourced.pattern !== undefined) {
    return (
      <>
        from the{" "}
        <b className="font-semibold text-foreground">{names.typeLabel}</b>{" "}
        pattern <Code>{sourced.pattern}</Code>
      </>
    );
  }
  if (level === "content" && sourced.field !== undefined) {
    return (
      <>
        from the {names.typeLabel.toLowerCase()}&apos;s{" "}
        <b className="font-semibold text-foreground">
          {names.fieldLabels[sourced.field] ?? sourced.field}
        </b>
      </>
    );
  }
  if (level === "template") return "from this page's template";
  if (level === "code")
    return "by this page's route. Anything you type here wins over it.";
  return SITE_DEFAULT[value];
}

/** A boxed note: a plain one, or a warning. */
export function Note({
  tone = "plain",
  icon,
  children,
}: {
  tone?: "plain" | "warning";
  icon?: ReactNode;
  children: ReactNode;
}): ReactNode {
  return (
    <div
      className={cx(
        "flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[13px] leading-[1.45] text-foreground",
        tone === "warning"
          ? "border-warning-border bg-warning-surface"
          : "border-border bg-muted"
      )}
    >
      <span
        aria-hidden="true"
        className={cx(
          "mt-px flex-none",
          tone === "warning" ? "text-warning-text" : "text-muted-foreground"
        )}
      >
        {icon ?? <TriangleAlert className="size-4" />}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
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
