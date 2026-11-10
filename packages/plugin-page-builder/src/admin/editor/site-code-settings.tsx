"use client";

/**
 * Settings → Site → Code: the code every published page carries, in its head
 * and at the end of its body.
 *
 * What is saved is described in plain words until Edit code opens the code
 * itself. A save checks the code on the server first: what can't be stored is
 * named under the place it is in and nothing is saved; what the site's
 * security policy would block is shown, with what to add to the policy, and
 * is saved only once the person says they understand; with no policy known
 * the person is told so before saving, rather than shown a pass.
 *
 * @module admin/editor/site-code-settings
 * @experimental
 */
import { SITE_CODE_POLICY_DOCS_HREF } from "@nextlyhq/builder/shell";
import { usePluginRoute } from "@nextlyhq/plugin-sdk/admin";
import {
  Alert,
  AlertDescription,
  Button,
  Checkbox,
  Textarea,
} from "@nextlyhq/ui";
import { Check, Copy, Info, Loader2, TriangleAlert } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type ReactNode,
  type RefObject,
} from "react";

import {
  PAGE_BUILDER_PLUGIN_NAME,
  SITE_CODE_ROUTE_PATH,
  type SiteCodeChecked,
  type SiteCodeRead,
} from "../../library-contract";
import type { CspAddition, CspFinding } from "../../site-code/csp";
import { SITE_CODE_LIMITS } from "../../site-code/limits";
import {
  checkSiteCode,
  readLivePolicy,
  saveSiteCode,
  type SiteCodeDraft,
} from "../site-code-client";

/** The two places site code goes, in the order a page has them. */
const PLACES = [
  { slot: "head", label: "Head" },
  { slot: "body", label: "End of body" },
] as const;

type Place = (typeof PLACES)[number]["slot"];

/** Where the section is: shown, being edited, or being checked before a save. */
type Step =
  | { readonly kind: "view"; readonly saved?: SiteCodeChecked }
  | { readonly kind: "edit"; readonly refused?: SiteCodeChecked }
  | {
      readonly kind: "csp";
      readonly checked: SiteCodeChecked;
      readonly draft: SiteCodeDraft;
    }
  | {
      // Saveable, with something to see first: what won't be kept, what a
      // Report-Only policy reports, or that no policy is known.
      readonly kind: "review";
      readonly checked: SiteCodeChecked;
      readonly draft: SiteCodeDraft;
    };

/** What the section tells the Site tab while the code is open. */
export interface SiteCodeSectionProps {
  /** Open with changes not yet saved: leaving asks first. */
  readonly onEditingChange: (editing: boolean) => void;
  /** A save is in flight: leaving waits for it. */
  readonly onSavingChange: (saving: boolean) => void;
  /** The code is open, so the other Site sections step aside. */
  readonly onOpenChange: (open: boolean) => void;
}

/** Whether no policy was known to check the code against. */
function noPolicyKnown(checked: SiteCodeChecked): boolean {
  return checked.csp.every(policy => !policy.check.checked);
}

/** Whether a check has anything to show before a save it allows. */
function worthAReview(checked: SiteCodeChecked): boolean {
  return (
    noPolicyKnown(checked) ||
    notesOf(checked).length > 0 ||
    findingsOf(checked).length > 0
  );
}

/**
 * Where a check leads: back to the code with what it refused, to what a
 * policy blocks, to what is worth seeing before saving, or straight to a save.
 */
function stepAfter(
  checked: SiteCodeChecked,
  draft: SiteCodeDraft
): Step | "save" {
  if (checked.head.refusals.length + checked.body.refusals.length > 0) {
    return { kind: "edit", refused: checked };
  }
  if (checked.cspKey !== null) return { kind: "csp", checked, draft };
  return worthAReview(checked) ? { kind: "review", checked, draft } : "save";
}

/** Why a check or a save failed, in words. */
function failureOf(reason: unknown): string {
  return reason instanceof Error
    ? reason.message
    : "The site code could not be saved.";
}

/**
 * Tell the Site tab what the section is doing: open (the other sections step
 * aside), changed (leaving asks first) and saving (leaving waits). Taken off
 * the tab, by a breakpoint step that has it to itself, it leaves nothing open.
 */
function useTellTheTab(
  { onEditingChange, onSavingChange, onOpenChange }: SiteCodeSectionProps,
  state: { open: boolean; changed: boolean; working: boolean }
): void {
  useEffect(() => onOpenChange(state.open), [state.open, onOpenChange]);
  useEffect(
    () => onEditingChange(state.changed),
    [state.changed, onEditingChange]
  );
  useEffect(
    () => onSavingChange(state.working),
    [state.working, onSavingChange]
  );
  useEffect(
    () => () => {
      onOpenChange(false);
      onEditingChange(false);
      onSavingChange(false);
    },
    [onOpenChange, onEditingChange, onSavingChange]
  );
}

/** The section's read, its step, the code as typed, and what can be done. */
function useSiteCodeFlow(props: SiteCodeSectionProps) {
  const read = usePluginRoute<SiteCodeRead>({
    plugin: PAGE_BUILDER_PLUGIN_NAME,
    path: SITE_CODE_ROUTE_PATH,
    staleTime: 0,
  });
  const [step, setStep] = useState<Step>({ kind: "view" });
  const [text, setText] = useState({ head: "", body: "" });
  // The version the open code was read at; a save made since refuses it.
  const [version, setVersion] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const stored = read.data;
  const unchanged =
    text.head === (stored?.head ?? "") && text.body === (stored?.body ?? "");
  useTellTheTab(props, {
    open: step.kind !== "view",
    changed: step.kind !== "view" && (step.kind !== "edit" || !unchanged),
    working,
  });

  const save = async (
    draft: SiteCodeDraft,
    acknowledgeCsp: string | null
  ): Promise<void> => {
    const saved = await saveSiteCode(draft, version, acknowledgeCsp);
    read.refetch();
    setStep({ kind: "view", saved });
  };
  // Every save is checked first, with the policy the site sends read now.
  const check = async (): Promise<void> => {
    const livePolicy = await readLivePolicy();
    const draft: SiteCodeDraft = {
      head: text.head,
      body: text.body,
      ...(livePolicy === undefined ? {} : { livePolicy }),
    };
    const next = stepAfter(await checkSiteCode(draft), draft);
    if (next === "save") await save(draft, null);
    else setStep(next);
  };
  const run = (work: () => Promise<void>): void => {
    setWorking(true);
    setProblem(null);
    work().then(
      () => setWorking(false),
      (reason: unknown) => {
        setWorking(false);
        setProblem(failureOf(reason));
      }
    );
  };
  return {
    read,
    step,
    text,
    setText,
    working,
    problem,
    edit: (): void => {
      // Never from a read being refreshed: it may predate a save.
      // Nor from one whose refresh failed: what it holds may be stale.
      if (stored === undefined || read.fetching || read.error !== null) return;
      setText({ head: stored.head, body: stored.body });
      setVersion(stored.version);
      setProblem(null);
      setStep({ kind: "edit" });
    },
    back: (): void => setStep({ kind: "edit" }),
    cancel: (): void => setStep({ kind: "view" }),
    check: (): void => run(check),
    save: (draft: SiteCodeDraft, acknowledgeCsp: string | null): void =>
      run(() => save(draft, acknowledgeCsp)),
  };
}

type SiteCodeFlow = ReturnType<typeof useSiteCodeFlow>;

/** The site's code, in Settings → Site. */
export function SiteCodeSection(props: SiteCodeSectionProps): JSX.Element {
  const flow = useSiteCodeFlow(props);
  const sectionRef = useRef<HTMLElement>(null);
  const open = flow.step.kind !== "view";
  // Opened, the other sections step aside: the tab starts again from its
  // top, the banner whole above the code, rather than where it was scrolled.
  useEffect(() => {
    if (!open) return;
    const tab = sectionRef.current?.closest('[role="tabpanel"]');
    if (tab instanceof HTMLElement) tab.scrollTop = 0;
  }, [open]);
  return (
    <section
      ref={sectionRef}
      aria-labelledby="settings-code-title"
      className="space-y-2"
    >
      <h3 id="settings-code-title" className="text-sm font-semibold">
        Code
      </h3>
      <p className="text-sm text-muted-foreground">
        Added to every published page: analytics, tag managers, verification
        tags.
      </p>
      {flow.read.data === undefined ? (
        <ReadState read={flow.read} />
      ) : (
        <StepView flow={flow} stored={flow.read.data} />
      )}
    </section>
  );
}

/** What the section shows at its step. */
function StepView({
  flow,
  stored,
}: {
  flow: SiteCodeFlow;
  stored: SiteCodeRead;
}): JSX.Element {
  const { step, working, problem } = flow;
  switch (step.kind) {
    case "view":
      return (
        <Summary
          stored={stored}
          saved={step.saved}
          refresh={flow.read}
          onEdit={flow.edit}
        />
      );
    case "edit":
      return (
        <Editor
          text={flow.text}
          onText={flow.setText}
          refused={step.refused}
          policyDeclared={stored.policyDeclared}
          working={working}
          problem={problem}
          onCancel={flow.cancel}
          onSave={flow.check}
        />
      );
    case "csp":
      return (
        <PolicyFindings
          checked={step.checked}
          working={working}
          problem={problem}
          onBack={flow.back}
          onSave={() => flow.save(step.draft, step.checked.cspKey)}
        />
      );
    case "review":
      return (
        <Review
          checked={step.checked}
          working={working}
          problem={problem}
          onBack={flow.back}
          onSave={() => flow.save(step.draft, null)}
        />
      );
  }
}

/** While the stored code is read, or why it could not be. */
function ReadState({
  read,
}: {
  read: ReturnType<typeof usePluginRoute<SiteCodeRead>>;
}): JSX.Element | null {
  if (read.error === null) return null;
  return (
    <div className="flex items-center gap-3 text-sm">
      <span>{"The site's code could not be loaded."}</span>
      <Button type="button" variant="outline" size="sm" onClick={read.refetch}>
        Retry
      </Button>
    </div>
  );
}

/** A count of elements, in words: "1 element", "3 elements". */
function elements(count: number): string {
  return `${count} ${count === 1 ? "element" : "elements"}`;
}

/** What is saved, in plain words, with the way into the code. */
function Summary({
  stored,
  saved,
  refresh,
  onEdit,
}: {
  stored: SiteCodeRead;
  saved: SiteCodeChecked | undefined;
  /**
   * The read, refreshed: the code opens only once it has answered, so never
   * from what may predate a save; a failed refresh offers Retry.
   */
  refresh: Pick<
    ReturnType<typeof usePluginRoute<SiteCodeRead>>,
    "fetching" | "error" | "refetch"
  >;
  onEdit: () => void;
}): JSX.Element {
  const empty =
    stored.described.head.length === 0 && stored.described.body.length === 0;
  return (
    <div className="space-y-3">
      {refresh.error === null ? null : (
        <div className="flex items-center gap-3 text-sm">
          <span>
            {
              "The site's code could not be read again, so it can't be edited yet."
            }
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={refresh.refetch}
          >
            Retry
          </Button>
        </div>
      )}
      {saved === undefined ? null : (
        <StatusRow
          icon={<Check className="size-4 text-success" aria-hidden="true" />}
          title="Site code saved"
          role="status"
        >
          It runs on every published page from the next visit.{" "}
          {elements(saved.head.elements)} in the head, {saved.body.elements} at
          the end of the body.
        </StatusRow>
      )}
      <dl className="divide-y rounded-md border text-sm">
        {PLACES.map(place => (
          <div key={place.slot} className="flex gap-3 px-3 py-2.5">
            <dt className="w-24 shrink-0 font-medium">{place.label}</dt>
            <dd className="text-muted-foreground">
              {stored.described[place.slot].length === 0
                ? "Nothing yet"
                : stored.described[place.slot].join(", ")}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={onEdit}
          disabled={refresh.fetching || refresh.error !== null}
        >
          {empty ? "Add code" : "Edit code"}
        </Button>
        <LastChanged stored={stored} />
      </div>
    </div>
  );
}

/** "Last changed 6 November by …", where the code has been saved. */
function LastChanged({ stored }: { stored: SiteCodeRead }): JSX.Element | null {
  if (stored.changedAt === null) return null;
  const at = new Date(stored.changedAt);
  if (Number.isNaN(at.getTime())) return null;
  const sameYear = at.getFullYear() === new Date().getFullYear();
  const day = at.toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    ...(sameYear ? {} : { year: "numeric" }),
  });
  return (
    <span className="text-xs text-muted-foreground">
      Last changed {day}
      {stored.changedBy === null ? "" : ` by ${stored.changedBy}`}
    </span>
  );
}

/** The two places' code, the warning above them, and Save. */
function Editor({
  text,
  onText,
  refused,
  policyDeclared,
  working,
  problem,
  onCancel,
  onSave,
}: {
  text: { head: string; body: string };
  onText: (text: { head: string; body: string }) => void;
  refused: SiteCodeChecked | undefined;
  policyDeclared: boolean;
  working: boolean;
  problem: string | null;
  onCancel: () => void;
  onSave: () => void;
}): JSX.Element {
  const firstRefusal = useRef<HTMLLIElement>(null);
  // Each check that refuses moves focus to the first thing it refused, so a
  // keyboard or screen reader user hears why nothing was saved.
  useEffect(() => {
    if (refused !== undefined) firstRefusal.current?.focus();
  }, [refused]);
  const firstPlace = PLACES.find(
    place => (refused?.[place.slot].refusals.length ?? 0) > 0
  )?.slot;
  return (
    <div className="space-y-4">
      <Alert variant="warning">
        <TriangleAlert className="size-4" aria-hidden="true" />
        <AlertDescription>
          <strong className="font-semibold">
            Code here runs on every page, with the access of whoever views it.
          </strong>{" "}
          Only add code from sources you trust.
        </AlertDescription>
      </Alert>
      {PLACES.map(place => (
        <PlaceEditor
          key={place.slot}
          place={place.slot}
          label={place.label}
          value={text[place.slot]}
          onChange={value => onText({ ...text, [place.slot]: value })}
          refusals={refused?.[place.slot].refusals ?? []}
          firstRefusal={place.slot === firstPlace ? firstRefusal : undefined}
          working={working}
        />
      ))}
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          aria-hidden="true"
          className={`size-2 shrink-0 rounded-full ${policyDeclared ? "bg-success" : "bg-muted-foreground"}`}
        />
        {policyDeclared
          ? "Checked against the policy this site declares, and the one it sends."
          : "Checked against the policy the site sends, if it sends one."}
      </p>
      <Actions
        hint={
          refused === undefined
            ? "Saving checks the code first. Nothing runs inside the admin or in previews."
            : "Nothing was saved."
        }
        working={working}
        problem={problem}
      >
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={working}
        >
          Cancel
        </Button>
        <Button type="button" onClick={onSave} disabled={working}>
          Save code
        </Button>
      </Actions>
    </div>
  );
}

/** One place's code, its length, and what in it can't be stored. */
function PlaceEditor({
  place,
  label,
  value,
  onChange,
  refusals,
  firstRefusal,
  working,
}: {
  place: Place;
  label: string;
  value: string;
  onChange: (value: string) => void;
  refusals: readonly string[];
  firstRefusal: RefObject<HTMLLIElement | null> | undefined;
  /** A check or save is in flight with this text: it can't change under it. */
  working: boolean;
}): JSX.Element {
  const id = useId();
  const refusedId = `${id}-refused`;
  const countId = `${id}-count`;
  const over = value.length > SITE_CODE_LIMITS.slotChars;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
        </label>
        <span
          id={countId}
          className={`text-xs ${over ? "text-destructive" : "text-muted-foreground"}`}
        >
          {value.length.toLocaleString()} of{" "}
          {SITE_CODE_LIMITS.slotChars.toLocaleString()} characters
        </span>
      </div>
      <Textarea
        id={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        readOnly={working}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        rows={place === "head" ? 8 : 4}
        aria-invalid={refusals.length > 0 || over}
        aria-describedby={
          refusals.length > 0 ? `${countId} ${refusedId}` : countId
        }
        // Red-edged while it holds what can't be stored, as its list below.
        className={`resize-y bg-muted/40 font-mono text-xs leading-relaxed ${refusals.length > 0 || over ? "border-destructive" : ""}`}
      />
      {refusals.length === 0 ? null : (
        <div
          id={refusedId}
          className="rounded-md border border-l-4 border-l-destructive bg-destructive-50 p-3 text-sm dark:bg-destructive-950"
        >
          <p className="mb-1 font-medium text-destructive-900 dark:text-destructive-100">
            {"This can't be saved yet"}
          </p>
          <ul className="list-disc space-y-0.5 pl-5">
            {refusals.map((refusal, index) => (
              <li
                key={`${index}-${refusal}`}
                ref={index === 0 ? firstRefusal : undefined}
                tabIndex={index === 0 ? -1 : undefined}
                className="outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {refusal}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** An ordinal in words for a place's element: "1st", "2nd", "11th". */
function ordinal(index: number): string {
  const n = index + 1;
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** One block, with every policy that makes it. */
interface Seen {
  finding: CspFinding;
  readonly sources: string[];
}

/** The findings of every policy checked, each block once with its sources. */
function findingsOf(checked: SiteCodeChecked): Seen[] {
  const seen = new Map<string, Seen>();
  for (const { source, check } of checked.csp) {
    if (!check.checked) continue;
    for (const finding of check.findings) {
      const key = `${finding.slot} ${finding.index} ${finding.directive} ${finding.message}`;
      const known = seen.get(key);
      if (known === undefined) {
        seen.set(key, { finding, sources: [source] });
        continue;
      }
      if (!known.sources.includes(source)) known.sources.push(source);
      // A block one policy enforces is a block, whatever another reports.
      if (finding.level === "error") known.finding = finding;
    }
  }
  return [...seen.values()];
}

/** What to add to one policy: which it is, and a line per directive. */
interface AllowGroup {
  readonly label: string;
  readonly lines: readonly string[];
}

/** A policy known to the check, in words. */
const POLICY_WORDS: Readonly<
  Record<SiteCodeChecked["csp"][number]["source"], string>
> = {
  declared: "the policy this site declares",
  live: "the policy the site sends",
};

/** One directive's addition as the line a policy is given. */
function lineOf({ directive, sources }: CspAddition): string {
  return `${directive} ${sources.join(" ")}`;
}

/** A group of advice, with the part of its header it names, if any. */
interface PartGroup extends AllowGroup {
  readonly part: string;
}

/**
 * One check's additions, grouped by the header's policy they are for, and
 * named by its place wherever the header carries several, even when only
 * one of them needs anything.
 */
function groupsOfCheck({
  source,
  additions,
  policies,
}: SiteCodeChecked["csp"][number]): PartGroup[] {
  const byPolicy = new Map<number, string[]>();
  for (const addition of additions) {
    byPolicy.set(addition.policy, [
      ...(byPolicy.get(addition.policy) ?? []),
      lineOf(addition),
    ]);
  }
  return [...byPolicy].map(([policy, lines]) => {
    const part = policies > 1 ? `, the ${ordinal(policy)} in its header` : "";
    return { label: `${POLICY_WORDS[source]}${part}`, part, lines };
  });
}

/**
 * What to add, kept with the policy it is for: the declared and the sent
 * policy, and each policy of a header carrying several, are given apart,
 * since one's needs added to another would widen it for nothing. Advice the
 * same for both, to the same part, is given once, for the site's policy.
 */
function allowGroupsOf(checked: SiteCodeChecked): AllowGroup[] {
  const groups = checked.csp.flatMap(groupsOfCheck);
  const [first, second, ...rest] = groups;
  if (first === undefined || second === undefined || rest.length > 0) {
    return groups;
  }
  return sameAdvice(first, second)
    ? [{ label: `the site's policy${first.part}`, lines: first.lines }]
    : groups;
}

/** Whether two groups give the same advice, to the same part of a header. */
function sameAdvice(first: PartGroup, second: PartGroup): boolean {
  return (
    first.part === second.part &&
    first.lines.join("\n") === second.lines.join("\n")
  );
}

/**
 * A finding's message as the start of a line: capitalised, unless it starts
 * with an address, which is shown as written.
 */
function sentence(message: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(message)) return message;
  return message.charAt(0).toUpperCase() + message.slice(1);
}

/** Each block or report once: where, why, and which policy makes it. */
function FindingsList({
  findings,
}: {
  findings: readonly Seen[];
}): JSX.Element {
  return (
    <ul className="mb-3 divide-y border-y text-sm">
      {findings.map(({ finding, sources }) => (
        <li
          key={`${finding.slot}-${finding.index}-${finding.directive}-${finding.message}`}
          className="flex flex-wrap gap-x-3 gap-y-0.5 py-2"
        >
          <span className="w-40 shrink-0 text-muted-foreground">
            {finding.slot === "head" ? "Head" : "End of body"},{" "}
            {ordinal(finding.index)} element
          </span>
          <span className="min-w-0 flex-1 break-words">
            {sentence(finding.message)}
            {finding.level === "warning" ? " (reported only)" : ""}
          </span>
          <span className="whitespace-nowrap text-xs text-muted-foreground">
            {finding.directive} · {sources.join(", ")}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** What the sanitiser left out of each place, as "Head: …" lines. */
function notesOf(checked: SiteCodeChecked): string[] {
  return PLACES.flatMap(place =>
    checked[place.slot].notes.map(note => `${place.label}: ${note}`)
  );
}

/** What won't be kept, said before the save rather than after it. */
function NotesRow({
  checked,
}: {
  checked: SiteCodeChecked;
}): JSX.Element | null {
  const notes = notesOf(checked);
  if (notes.length === 0) return null;
  return (
    <StatusRow
      icon={
        <Info className="size-4 text-muted-foreground" aria-hidden="true" />
      }
      title="Some of what you wrote won't be kept"
    >
      {notes.join(" ")}
    </StatusRow>
  );
}

/** What the site's policy would block, and the choice to save anyway. */
function PolicyFindings({
  checked,
  working,
  problem,
  onBack,
  onSave,
}: {
  checked: SiteCodeChecked;
  working: boolean;
  problem: string | null;
  onBack: () => void;
  onSave: () => void;
}): JSX.Element {
  const [understood, setUnderstood] = useState(false);
  const understoodId = useId();
  const findings = findingsOf(checked);
  const allow = allowGroupsOf(checked);
  return (
    <div className="space-y-3">
      <NotesRow checked={checked} />
      <div className="rounded-lg border border-l-4 border-l-warning p-4">
        <h4 className="mb-1.5 text-base font-semibold">
          {"The site's security policy would block some of this code"}
        </h4>
        <p className="mb-3 text-sm text-muted-foreground">
          {
            "Pages keep loading, but these parts won't run until the policy allows them."
          }
        </p>
        <FindingsList findings={findings} />
        {allow.length === 0 ? null : (
          <div className="mb-3 space-y-2 rounded-md bg-muted p-3 text-sm text-muted-foreground">
            {allow.map(group => (
              <ToAllow key={group.label} group={group} />
            ))}
            <a
              href={SITE_CODE_POLICY_DOCS_HREF}
              target="_blank"
              rel="noreferrer"
              className="inline-block font-medium text-foreground underline underline-offset-4"
            >
              How site code and your policy work
            </a>
          </div>
        )}
        <div className="flex items-start gap-2 text-sm">
          <Checkbox
            id={understoodId}
            checked={understood}
            onCheckedChange={value => setUnderstood(value === true)}
            className="mt-0.5"
          />
          <label htmlFor={understoodId}>
            {
              "I understand this code won't run on pages until the policy allows it."
            }
          </label>
        </div>
      </div>
      <Actions working={working} problem={problem}>
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={working}
        >
          Back to the code
        </Button>
        <Button
          type="button"
          onClick={onSave}
          disabled={!understood || working}
        >
          Save anyway
        </Button>
      </Actions>
    </div>
  );
}

/** "To allow it, add to the site's policy: …", with a Copy button. */
function ToAllow({ group }: { group: AllowGroup }): JSX.Element {
  const [copied, setCopied] = useState(false);
  const { lines } = group;
  const copy = (): void => {
    void navigator.clipboard?.writeText(lines.join("; ")).then(
      () => setCopied(true),
      () => setCopied(false)
    );
  };
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span>
          <strong className="font-medium text-foreground">To allow it,</strong>{" "}
          add to {group.label}:
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={copy}
          aria-label={copied ? "Copied" : `Copy what to add to ${group.label}`}
        >
          {copied ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Copy className="size-4" aria-hidden="true" />
          )}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <ul className="space-y-1">
        {lines.map(line => (
          <li key={line}>
            <code className="break-words rounded bg-background px-1 py-0.5 font-mono text-xs text-foreground">
              {line}
            </code>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * What is worth seeing before a save the check allows: what won't be kept,
 * what a Report-Only policy would report, and, said plainly rather than
 * shown as a pass, that no policy is known.
 */
function Review({
  checked,
  working,
  problem,
  onBack,
  onSave,
}: {
  checked: SiteCodeChecked;
  working: boolean;
  problem: string | null;
  onBack: () => void;
  onSave: () => void;
}): JSX.Element {
  const reported = findingsOf(checked);
  return (
    <div className="space-y-3">
      <NotesRow checked={checked} />
      {reported.length === 0 ? null : (
        <div className="rounded-lg border p-4">
          <h4 className="mb-1.5 text-base font-semibold">
            {"The site's report-only policy would report some of this code"}
          </h4>
          <p className="mb-3 text-sm text-muted-foreground">
            It blocks nothing, but reports these parts each time they run.
          </p>
          <FindingsList findings={reported} />
        </div>
      )}
      {noPolicyKnown(checked) ? (
        <StatusRow
          icon={
            <Info className="size-4 text-muted-foreground" aria-hidden="true" />
          }
          title="No security policy is known for this site, so nothing was checked against one"
        >
          {
            "The code is otherwise ready to save. If your site sends a Content Security Policy, declare it in the page builder's settings so code is checked against it."
          }
        </StatusRow>
      ) : null}
      <Actions working={working} problem={problem}>
        <Button
          type="button"
          variant="outline"
          onClick={onBack}
          disabled={working}
        >
          Back to the code
        </Button>
        <Button type="button" onClick={onSave} disabled={working}>
          Save code
        </Button>
      </Actions>
    </div>
  );
}

/** A bordered row: an icon, a line, and what it means. */
function StatusRow({
  icon,
  title,
  role,
  children,
}: {
  icon: ReactNode;
  title: string;
  role?: "status";
  children: ReactNode;
}): JSX.Element {
  return (
    <div role={role} className="flex gap-2.5 rounded-md border p-3">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="space-y-0.5">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

/**
 * The buttons, with a hint before them and why a save failed: a footer held to
 * the bottom of the tab as its content scrolls, so a long check never leaves
 * Save out of view or apart from what it saves. It spans the tab's padding,
 * with the dialog's own spacing below it; a sticky box keeps inside its
 * scroller's padding, so it is held that padding lower to sit on the edge.
 */
function Actions({
  hint,
  working,
  problem,
  children,
}: {
  hint?: string;
  working: boolean;
  problem: string | null;
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="sticky -bottom-6 z-10 -mx-6 -mb-6 space-y-2 border-t bg-background px-6 pb-6 pt-4">
      {/* The hint takes what room is left and wraps; the buttons stay
          together on its line. */}
      <div className="flex items-center gap-4">
        <span className="min-w-0 flex-1 text-xs text-muted-foreground">
          {hint}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {working ? (
            <Loader2
              className="size-4 animate-spin text-muted-foreground"
              aria-label="Checking"
            />
          ) : null}
          {children}
        </div>
      </div>
      {problem === null ? null : (
        <p role="alert" className="text-right text-sm text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}
