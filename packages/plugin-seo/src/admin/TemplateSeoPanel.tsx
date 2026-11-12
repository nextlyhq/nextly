/**
 * The SEO panel on a Page Builder design: the rule every page the design
 * draws follows, where the page's own text does not say otherwise.
 *
 * The same preview, fields and rows the SEO tab draws, with variables in
 * place of typed text: a title is written `{Post title} | {Site name}` and
 * stored as the design's own metadata, which the Page Builder fills for each
 * page. The preview is the answer one of the type's pages gets with the
 * design as it is being edited, worked out by the route the page's head is
 * worked out by. A change is one edit of the design, undone with the editor's
 * Undo and saved with it.
 *
 * Hiding from search, the official address and structured data stay with the
 * page and its content type, so the panel offers none of them.
 *
 * @module admin/TemplateSeoPanel
 */
import {
  useDocumentLocale,
  useReportUnsavedWork,
} from "@nextlyhq/plugin-sdk/admin";
import { Input, Switch } from "@nextlyhq/ui";
import { Info } from "lucide-react";
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { resolveOrder, type SeoAnswer } from "../resolver/order";
import type { PatternField } from "../settings/contract";
import { SITE_NAME_TOKEN } from "../settings/patterns";
import { DESCRIPTION_LIMIT, TITLE_LIMIT } from "../tab/problems";
import type { TemplateContext } from "../template/contract";
import {
  ruleOfText,
  textOfRule,
  type RuleSegment,
} from "../template/rule-text";

import { CharacterCount, inSentence, Note } from "./parts";
import { PreviewCard } from "./previews";
import { Row, RowButton } from "./rows";
import { ROOT, SeoStyles } from "./styles";
import { useTemplateContext } from "./use-template-context";

/** A design's own metadata, as the Page Builder stores it. */
export interface DesignSeo {
  title?: RuleSegment[];
  description?: RuleSegment[];
  socialTitle?: RuleSegment[];
  image?: { $bind: string; [option: string]: unknown };
}

/** What the rule still being typed is reported as unsaved work under. */
const UNSAVED_RULE = "seo-template-rule";

/** The rule as the panel edits it: text with variables. */
interface RuleDraft {
  title: string;
  description: string;
  shareDiff: boolean;
  socialTitle: string;
  /** The image field the share image is taken from; null for automatic. */
  image: string | null;
}

/** The rule's text fields, which a variable is added to. */
type RuleField = "title" | "description" | "socialTitle";

export interface TemplateSeoPanelProps {
  /** The collection the design draws, and the one entry an own design draws. */
  draws: { collection: string; entryId: string | null };
  /** The design's own metadata, and the edit that changes it. */
  seo: { value: DesignSeo | undefined; set: (next: DesignSeo | null) => void };
  /** The design as it is being edited. */
  design: Readonly<Record<string, unknown>>;
  writable: boolean;
  setBadge: (badge: { count: number; label: string } | null) => void;
  /**
   * The editor's hold on an edit not made yet: the rule still being typed is
   * made before the document is stored.
   */
  holdEdit?: (make: () => void) => () => void;
}

/** The draft a stored rule is edited as. */
function draftOf(
  value: DesignSeo | undefined,
  fields: readonly PatternField[]
): RuleDraft {
  return {
    title: textOfRule(value?.title, fields).text,
    description: textOfRule(value?.description, fields).text,
    shareDiff: value?.socialTitle !== undefined,
    socialTitle: textOfRule(value?.socialTitle, fields).text,
    image: typeof value?.image?.$bind === "string" ? value.image.$bind : null,
  };
}

/**
 * One of the draft's texts as stored: the stored segments themselves where
 * the text is the one they read as, so what a binding says beyond a variable
 * (a fallback, a format, another source) is kept until the text is changed.
 */
function segmentsOf(
  text: string,
  stored: readonly RuleSegment[] | undefined,
  fields: readonly PatternField[]
): RuleSegment[] {
  if (stored !== undefined && textOfRule(stored, fields).text === text) {
    return [...stored];
  }
  return ruleOfText(text, fields).segments;
}

/**
 * The draft as the design stores it, over the rule `stored`; nothing where
 * it sets nothing.
 */
function ruleOf(
  draft: RuleDraft,
  fields: readonly PatternField[],
  stored: DesignSeo | undefined
): DesignSeo | null {
  const was: DesignSeo = stored ?? {};
  const rule: DesignSeo = defined({
    title: segmentsOf(draft.title, was.title, fields),
    description: segmentsOf(draft.description, was.description, fields),
    image: imageRuleOf(draft.image, was.image),
  });
  if (draft.shareDiff) {
    rule.socialTitle = segmentsOf(draft.socialTitle, was.socialTitle, fields);
  }
  return Object.keys(rule).length === 0 ? null : rule;
}

/** `rule` without the parts it leaves unset: no text, or no image. */
function defined(rule: DesignSeo): DesignSeo {
  return Object.fromEntries(
    Object.entries(rule).filter(
      ([, value]) =>
        value !== undefined && !(Array.isArray(value) && value.length === 0)
    )
  );
}

/** The share image rule for `field`, the stored options kept for the same one. */
function imageRuleOf(
  field: string | null,
  stored: DesignSeo["image"]
): DesignSeo["image"] {
  if (field === null) return undefined;
  return stored?.$bind === field ? stored : { $bind: field };
}

/** The variables a field's text names that no field fills. */
function unknownIn(text: string, fields: readonly PatternField[]): string[] {
  return ruleOfText(text, fields).unknown;
}

/** The answer a page gets with the rule, before its own text wins. */
function previewAnswer(
  context: TemplateContext | undefined
): SeoAnswer | undefined {
  const levels = context?.previewed?.levels;
  if (levels === undefined) return undefined;
  // The page's own text left out, so the preview shows what the rule gives.
  return resolveOrder({ ...levels, page: {} });
}

/** A title without the site's name at its end, as a shared card shows it. */
function withoutSiteName(text: string, siteName: string | undefined): string {
  const names = [`{${SITE_NAME_TOKEN}}`, siteName].filter(
    (name): name is string => name !== undefined && name !== ""
  );
  for (const name of names) {
    const at = text.lastIndexOf(name);
    if (at > 0 && at + name.length === text.length) {
      return text.slice(0, at).replace(/\s*[|—·-]\s*$/, "");
    }
  }
  return text;
}

/** The design handed to the route: as edited, with `rule` as its metadata. */
function designWith(
  design: Readonly<Record<string, unknown>>,
  rule: DesignSeo | null | undefined
): Record<string, unknown> {
  const settings =
    typeof design.settings === "object" && design.settings !== null
      ? (design.settings as Record<string, unknown>)
      : {};
  const { seo: _replaced, ...others } = settings;
  return {
    ...design,
    settings:
      rule === null || rule === undefined ? others : { ...others, seo: rule },
  };
}

/**
 * The rule as it is being edited, read again when the stored rule changes
 * from outside (the editor's Undo), and the edit that stores a draft: once,
 * and only where it differs from what is stored.
 */
function useRuleDraft(
  seo: TemplateSeoPanelProps["seo"],
  fields: readonly PatternField[] | undefined,
  holdEdit: TemplateSeoPanelProps["holdEdit"]
) {
  const [draft, setDraft] = useState<RuleDraft | undefined>(undefined);
  // What the panel last stored, so a change from outside is told apart from
  // the panel's own.
  const stored = useRef<string | undefined>(undefined);
  const valueKey = JSON.stringify(seo.value ?? null);
  useEffect(() => {
    if (fields === undefined || stored.current === valueKey) return;
    stored.current = valueKey;
    setDraft(draftOf(seo.value, fields));
  }, [fields, valueKey, seo.value]);
  const commit = (next: RuleDraft): void => {
    if (fields === undefined) return;
    const value = ruleOf(next, fields, seo.value);
    const key = JSON.stringify(value);
    if (key === stored.current) return;
    stored.current = key;
    seo.set(value);
  };
  const latest = useRef({ draft, commit });
  latest.current = { draft, commit };
  const pending =
    draft !== undefined &&
    fields !== undefined &&
    JSON.stringify(ruleOf(draft, fields, seo.value)) !== valueKey;
  useHeldDraft(latest, holdEdit, pending);
  return { draft, setDraft, commit };
}

/**
 * A rule still being typed, kept from being lost: stored as the panel
 * closes (closing the Settings dialog takes the field away without its
 * blur), and before the document is stored, through the editor's hold; and
 * said to be unsaved work until then, so the save shortcut offers to store
 * it.
 */
function useHeldDraft(
  latest: {
    current: {
      draft: RuleDraft | undefined;
      commit: (next: RuleDraft) => void;
    };
  },
  holdEdit: TemplateSeoPanelProps["holdEdit"],
  pending: boolean
): void {
  useReportUnsavedWork(UNSAVED_RULE, pending);
  useEffect(() => {
    const make = (): void => {
      const { draft, commit } = latest.current;
      if (draft !== undefined) commit(draft);
    };
    const release = holdEdit?.(make);
    return () => {
      release?.();
      make();
    };
  }, [holdEdit, latest]);
}

/** How many variables the draft names that no field fills, beside the tab's label. */
function useProblemBadge(
  draft: RuleDraft | undefined,
  fields: readonly PatternField[] | undefined,
  setBadge: TemplateSeoPanelProps["setBadge"]
): void {
  const problems =
    draft === undefined || fields === undefined
      ? 0
      : [
          draft.title,
          draft.description,
          draft.shareDiff ? draft.socialTitle : "",
        ]
          .map(text => unknownIn(text, fields).length)
          .reduce((sum, count) => sum + count, 0);
  useEffect(() => {
    setBadge(
      problems === 0
        ? null
        : { count: problems, label: `${String(problems)} to fix` }
    );
  }, [problems, setBadge]);
}

export function TemplateSeoPanel(props: TemplateSeoPanelProps): ReactNode {
  const { draws, seo, design, writable, setBadge } = props;
  const [previewWith, setPreviewWith] = useState<string | null>(draws.entryId);
  // The fields the type offers, once read; the rule is read with them.
  const [fields, setFields] = useState<PatternField[] | undefined>(undefined);
  const { draft, setDraft, commit } = useRuleDraft(seo, fields, props.holdEdit);
  const rule =
    draft === undefined || fields === undefined
      ? seo.value
      : ruleOf(draft, fields, seo.value);
  // The language being edited: its pages, rules and values are previewed.
  const locale = useDocumentLocale()?.code;
  const request = useMemo(
    () => ({
      collection: draws.collection,
      ...(previewWith === null ? {} : { entryId: previewWith }),
      ...(locale === undefined ? {} : { locale }),
      document: designWith(design, rule),
    }),
    [design, draws.collection, previewWith, locale, rule]
  );
  const { context, status } = useTemplateContext(request);
  useEffect(() => {
    if (context !== undefined) setFields(context.fields);
  }, [context]);
  useProblemBadge(draft, fields, setBadge);

  if (context === undefined || draft === undefined || fields === undefined) {
    return (
      <p className="m-0 pt-4 text-[13px] text-muted-foreground">
        {status === "failed"
          ? "The template's SEO could not be read just now."
          : "Reading this template's SEO…"}
      </p>
    );
  }
  return (
    <RuleEditor
      context={context}
      status={status}
      draft={draft}
      writable={writable}
      previewWith={context.previewed?.id ?? null}
      ownDesign={draws.entryId !== null}
      onPreviewWith={setPreviewWith}
      onChange={setDraft}
      onCommit={commit}
    />
  );
}

/** What the rule editor is handed. */
interface RuleEditorProps {
  context: TemplateContext;
  status: "ready" | "loading" | "failed";
  draft: RuleDraft;
  writable: boolean;
  previewWith: string | null;
  ownDesign: boolean;
  onPreviewWith: (id: string) => void;
  onChange: (next: RuleDraft) => void;
  onCommit: (next: RuleDraft) => void;
}

/** The panel once the type and the rule are read. */
function RuleEditor(props: RuleEditorProps): ReactNode {
  const { context, status, draft, writable, onChange, onCommit } = props;
  const id = useId();
  const answer = previewAnswer(context);
  const one = inSentence(context.typeLabel);
  const inputs = useRef<Partial<Record<RuleField, HTMLInputElement | null>>>(
    {}
  );
  // The field a variable is added to: the one last in focus.
  const focused = useRef<RuleField>("title");
  const set = (field: RuleField, text: string): RuleDraft => ({
    ...draft,
    [field]: text,
  });
  const insert = (token: string): void => {
    const field = focused.current;
    const input = inputs.current[field];
    const text = `{${token}}`;
    const current = draft[field];
    const start = input?.selectionStart ?? current.length;
    const end = input?.selectionEnd ?? start;
    const next = set(
      field,
      current.slice(0, start) + text + current.slice(end)
    );
    onChange(next);
    onCommit(next);
    // Back to the field, just after what was added.
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(start + text.length, start + text.length);
    });
  };
  const textProps = (field: RuleField) => ({
    value: draft[field],
    disabled: !writable,
    className: "font-mono text-[13px]",
    onFocus: () => {
      focused.current = field;
    },
    onChange: (event: { target: { value: string } }) =>
      onChange(set(field, event.target.value)),
    onBlur: () => onCommit(draft),
  });
  return (
    <div className="flex flex-col gap-[18px] pt-4 pb-12">
      <SeoStyles />
      <Note icon={<Info className="size-4" />}>
        {props.ownDesign ? (
          <>
            These are rules for <b className="font-semibold">this {one}</b>,
            which this design draws. Its own text in its SEO tab still wins.
          </>
        ) : (
          <>
            These are rules for{" "}
            <b className="font-semibold">every {one} that uses this template</b>
            , {context.count} {context.count === 1 ? "page" : "pages"}. Each{" "}
            {one}&apos;s own text in its SEO tab still wins.
          </>
        )}
      </Note>
      <PreviewCard
        answer={answer}
        site={context.site}
        // A failed read again is said, over the last answer read.
        status={
          status === "failed"
            ? "failed"
            : answer !== undefined
              ? "ready"
              : "loading"
        }
        sharedTitleTyped={draft.shareDiff && draft.socialTitle.trim() !== ""}
        heading={
          <PreviewWith
            id={`${id}-with`}
            context={context}
            one={one}
            value={props.previewWith}
            onChange={props.onPreviewWith}
          />
        }
      />
      <RuleText
        id={`${id}-title`}
        label="Title on Google"
        count={answer?.title?.value.length ?? 0}
        limit={TITLE_LIMIT}
        unknown={unknownIn(draft.title, context.fields)}
      >
        <Input
          id={`${id}-title`}
          ref={input => {
            inputs.current.title = input;
          }}
          {...textProps("title")}
        />
      </RuleText>
      <RuleText
        id={`${id}-desc`}
        label="Description on Google"
        count={answer?.description?.value.length ?? 0}
        limit={DESCRIPTION_LIMIT}
        unknown={unknownIn(draft.description, context.fields)}
      >
        <Input
          id={`${id}-desc`}
          ref={input => {
            inputs.current.description = input;
          }}
          {...textProps("description")}
        />
      </RuleText>
      <Variables
        tokens={[...context.fields.map(field => field.token), SITE_NAME_TOKEN]}
        writable={writable}
        onInsert={insert}
      />
      <div className="overflow-hidden rounded-[10px] border border-border [&>*:first-child]:border-t-0">
        <SharedTitleRow
          id={`${id}-share`}
          draft={draft}
          context={context}
          writable={writable}
          textProps={textProps("socialTitle")}
          inputRef={input => {
            inputs.current.socialTitle = input;
          }}
          onSwitch={on => {
            const next = { ...draft, shareDiff: on };
            onChange(next);
            onCommit(next);
            if (on) focused.current = "socialTitle";
          }}
        />
      </div>
      <div className="overflow-hidden rounded-[10px] border border-border [&>*:first-child]:border-t-0">
        <ShareImageRule
          id={`${id}-image`}
          draft={draft}
          context={context}
          writable={writable}
          onChoose={image => {
            const next = { ...draft, image };
            onChange(next);
            onCommit(next);
          }}
        />
      </div>
      <p className="m-0 text-[12.5px] leading-[1.45] text-muted-foreground">
        Hiding from search, official address and structured data are set per{" "}
        {one} and per content type, not per template.
      </p>
    </div>
  );
}

/** "Preview with": the page of the type the preview is worked out for. */
function PreviewWith({
  id,
  context,
  one,
  value,
  onChange,
}: {
  id: string;
  context: TemplateContext;
  one: string;
  value: string | null;
  onChange: (id: string) => void;
}): ReactNode {
  return (
    <span className={`${ROOT} flex min-w-0 items-center gap-2`}>
      <label
        htmlFor={id}
        className="text-xs font-semibold whitespace-nowrap text-muted-foreground"
      >
        Preview with
      </label>
      <select
        id={id}
        className="nx-seo-select min-w-0"
        value={value ?? ""}
        disabled={context.entries.length === 0}
        onChange={event => onChange(event.target.value)}
      >
        {context.entries.length === 0 ? (
          <option value="">No published {one} yet</option>
        ) : null}
        {context.entries.map(entry => (
          <option key={entry.id} value={entry.id}>
            {entry.label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** The variables, each added where the person was typing. */
function Variables({
  tokens,
  writable,
  onInsert,
}: {
  tokens: readonly string[];
  writable: boolean;
  onInsert: (token: string) => void;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[12.5px] text-muted-foreground">
        Click to add to the field you&apos;re in:
      </span>
      {tokens.map(token => (
        <button
          key={token}
          type="button"
          disabled={!writable}
          className="cursor-pointer rounded-md border border-border bg-card px-2 py-[3px] font-mono text-xs text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
          // Kept from taking focus, so the field typed in keeps its caret.
          onMouseDown={event => event.preventDefault()}
          onClick={() => onInsert(token)}
        >
          {`{${token}}`}
        </button>
      ))}
    </div>
  );
}

/** One of the rule's text fields: its label and count, and what it names wrongly. */
function RuleText({
  id,
  label,
  count,
  limit,
  unknown,
  children,
}: {
  id: string;
  label: string;
  count: number;
  limit: number;
  unknown: readonly string[];
  children: ReactNode;
}): ReactNode {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2.5">
        <label
          htmlFor={id}
          className="text-[13px] font-semibold text-foreground"
        >
          {label}
        </label>
        <CharacterCount count={count} limit={limit} />
      </div>
      {children}
      {unknown.length === 0 ? null : (
        <p role="alert" className="m-0 text-xs font-medium text-warning-text">
          {unknown.map(token => `{${token}}`).join(", ")}{" "}
          {unknown.length === 1
            ? "names no field, so it is"
            : "name no field, so they are"}{" "}
          shown as written.
        </p>
      )}
    </div>
  );
}

/** "Different title when shared": its switch, and the rule once on. */
function SharedTitleRow({
  id,
  draft,
  context,
  writable,
  textProps,
  inputRef,
  onSwitch,
}: {
  id: string;
  draft: RuleDraft;
  context: TemplateContext;
  writable: boolean;
  textProps: Record<string, unknown>;
  inputRef: (input: HTMLInputElement | null) => void;
  onSwitch: (on: boolean) => void;
}): ReactNode {
  const label = "Different title when shared";
  const shared = previewAnswer(context)?.socialTitle?.value;
  return (
    <Row
      label={label}
      labelId={`${id}-label`}
      help="Optional. Shared links use the Google title unless you set a rule here."
      control={
        <Switch
          aria-label={label}
          checked={draft.shareDiff}
          disabled={!writable}
          onCheckedChange={onSwitch}
        />
      }
    >
      {draft.shareDiff ? (
        <>
          <Input
            ref={inputRef}
            aria-labelledby={`${id}-label`}
            placeholder={withoutSiteName(draft.title, context.site.name)}
            {...textProps}
          />
          <p className="m-0 text-[12.5px] leading-[1.45] text-muted-foreground">
            {draft.socialTitle.trim() === "" ? (
              "Empty: the Google title is used. The variables above work here too."
            ) : (
              <>
                Shared as:{" "}
                <b className="font-semibold text-foreground">{shared ?? "…"}</b>
              </>
            )}
          </p>
        </>
      ) : undefined}
    </Row>
  );
}

/** The share image's rule: which of the page's images, or automatic. */
function ShareImageRule({
  id,
  draft,
  context,
  writable,
  onChoose,
}: {
  id: string;
  draft: RuleDraft;
  context: TemplateContext;
  writable: boolean;
  onChoose: (field: string | null) => void;
}): ReactNode {
  const [changing, setChanging] = useState(false);
  const chosen = context.imageFields.find(field => field.name === draft.image);
  const one = inSentence(context.typeLabel);
  return (
    <Row
      label="Share image"
      help={
        chosen === undefined
          ? `Automatic: the ${one}'s own image, else the site's. Made 1200 × 630 when it isn't.`
          : `The ${one}'s {${chosen.label}}, made 1200 × 630 when it isn't.`
      }
      control={
        context.imageFields.length === 0 ? undefined : (
          <RowButton
            disabled={!writable}
            onClick={() => setChanging(!changing)}
          >
            Change
          </RowButton>
        )
      }
    >
      {changing ? (
        <label
          className={`${ROOT} grid gap-1 text-[12.5px] text-muted-foreground`}
        >
          <span>Take the share image from</span>
          <select
            id={`${id}-field`}
            className="nx-seo-select"
            value={draft.image ?? ""}
            disabled={!writable}
            onChange={event => {
              onChoose(event.target.value === "" ? null : event.target.value);
              setChanging(false);
            }}
          >
            <option value="">Automatic</option>
            {context.imageFields.map(field => (
              <option key={field.name} value={field.name}>
                {field.label}
              </option>
            ))}
          </select>
        </label>
      ) : undefined}
    </Row>
  );
}
