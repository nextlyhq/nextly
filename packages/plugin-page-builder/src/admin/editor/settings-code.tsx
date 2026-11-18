"use client";

/**
 * Page settings' Code tab: code added to this page only, in the head and at
 * the end of the body, checked and explained exactly as Site code is.
 *
 * The code is checked as site code is checked (the site code route's dry
 * run, with the policy the site sends read now), and kept in the page's
 * document as one edit, so it is saved with the page: in its draft on Save,
 * live on Publish, and in its history. What can't be stored is named and
 * nothing is kept; what the site's security policy would block is shown,
 * and kept only once the person says they understand. The key they
 * acknowledged is the one over the policy the site declared, which the
 * server judges every write against.
 *
 * @module admin/editor/settings-code
 */
import type { DocumentCode } from "@nextlyhq/blocks-engine";
import { Button } from "@nextlyhq/ui";
import { useRef, useState, type JSX, type RefObject } from "react";

import {
  checkSiteCode,
  readLivePolicy,
  type SiteCodeDraft,
} from "../site-code-client";

import {
  PLACES,
  PlaceEditor,
  PolicyFindings,
  Review,
  stepAfter,
  type Step,
} from "./site-code-settings";

/** The tab's one line about what it is. */
const PAGE_CODE_INTRO =
  "Code added to this page only. Site-wide code lives in Site settings.";

/** What the tab edits: the page's code, and the edit that changes it. */
export interface PageCodeTabProps {
  readonly value: DocumentCode | undefined;
  /** Answers whether the edit was made. */
  readonly set: (next: DocumentCode | null) => boolean;
  /** Whether the page takes edits now. */
  readonly writable: boolean;
}

/** The code as the page holds it, for the boxes. */
function textOf(value: DocumentCode | undefined): {
  head: string;
  body: string;
} {
  return { head: value?.head ?? "", body: value?.body ?? "" };
}

/**
 * The code to keep: none where both places are empty, else the text, with
 * the key of the declared policy's findings where the person acknowledged
 * them.
 */
function keptCode(
  text: { head: string; body: string },
  acknowledged: string | null
): DocumentCode | null {
  if (text.head === "" && text.body === "") return null;
  return acknowledged === null
    ? { ...text }
    : { ...text, acknowledgedCsp: acknowledged };
}

/**
 * The key the server holds an acknowledgement to: the findings of the policy
 * the site declared, which is the one it judges every write against. Asked
 * of the same check, without the live policy.
 */
async function declaredKey(text: {
  head: string;
  body: string;
}): Promise<string | null> {
  return (await checkSiteCode({ ...text, scope: "page" })).cspKey;
}

/** The tab's state: the text, where it stands, and what can be done. */
function usePageCodeFlow({ value, set }: PageCodeTabProps) {
  const [text, setText] = useState(() => textOf(value));
  const [step, setStep] = useState<Step>({ kind: "edit" });
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [kept, setKept] = useState(false);
  const stored = textOf(value);
  const unchanged = text.head === stored.head && text.body === stored.body;

  const keep = async (acknowledged: boolean): Promise<void> => {
    const key = acknowledged ? await declaredKey(text) : null;
    if (set(keptCode(text, key))) setKept(true);
    setStep({ kind: "edit" });
  };
  const check = async (): Promise<void> => {
    const livePolicy = await readLivePolicy();
    const draft: SiteCodeDraft = {
      ...text,
      scope: "page",
      ...(livePolicy === undefined ? {} : { livePolicy }),
    };
    const next = stepAfter(await checkSiteCode(draft), draft);
    if (next === "save") await keep(false);
    else setStep(next);
  };
  const run = (work: () => Promise<void>): void => {
    setWorking(true);
    setProblem(null);
    setKept(false);
    work().then(
      () => setWorking(false),
      (reason: unknown) => {
        setWorking(false);
        setProblem(
          reason instanceof Error
            ? reason.message
            : "The code could not be checked."
        );
      }
    );
  };
  return {
    text,
    setText: (next: { head: string; body: string }): void => {
      setKept(false);
      setText(next);
    },
    step,
    working,
    problem,
    kept,
    unchanged,
    check: (): void => run(check),
    keep: (acknowledged: boolean): void => run(() => keep(acknowledged)),
    back: (): void => setStep({ kind: "edit" }),
  };
}

/** The Code tab. */
export function PageCodeTab(props: PageCodeTabProps): JSX.Element {
  const flow = usePageCodeFlow(props);
  const firstRefusal = useRef<HTMLLIElement>(null);
  return (
    <div className="space-y-4" data-page-code="">
      <p className="text-sm text-muted-foreground">{PAGE_CODE_INTRO}</p>
      {flow.step.kind === "csp" ? (
        <PolicyFindings
          checked={flow.step.checked}
          working={flow.working}
          problem={flow.problem}
          onBack={flow.back}
          onSave={() => flow.keep(true)}
          saveLabel="Keep anyway"
        />
      ) : flow.step.kind === "review" ? (
        <Review
          checked={flow.step.checked}
          working={flow.working}
          problem={flow.problem}
          onBack={flow.back}
          onSave={() => flow.keep(false)}
          saveLabel="Keep code"
        />
      ) : (
        <CodeBoxes
          flow={flow}
          refused={flow.step.kind === "edit" ? flow.step.refused : undefined}
          firstRefusal={firstRefusal}
          writable={props.writable}
        />
      )}
    </div>
  );
}

/** The two boxes, and the check that keeps them with the page. */
function CodeBoxes({
  flow,
  refused,
  firstRefusal,
  writable,
}: {
  flow: ReturnType<typeof usePageCodeFlow>;
  refused: Extract<Step, { kind: "edit" }>["refused"];
  firstRefusal: RefObject<HTMLLIElement | null>;
  writable: boolean;
}): JSX.Element {
  const firstPlace = PLACES.find(
    place => (refused?.[place.slot].refusals.length ?? 0) > 0
  )?.slot;
  return (
    <>
      {PLACES.map(place => (
        <PlaceEditor
          key={place.slot}
          place={place.slot}
          label={place.label}
          value={flow.text[place.slot]}
          onChange={value =>
            flow.setText({ ...flow.text, [place.slot]: value })
          }
          refusals={refused?.[place.slot].refusals ?? []}
          firstRefusal={place.slot === firstPlace ? firstRefusal : undefined}
          working={flow.working || !writable}
        />
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          onClick={flow.check}
          disabled={flow.working || flow.unchanged || !writable}
        >
          Check and keep
        </Button>
        <p role="status" className="text-xs text-muted-foreground">
          {flow.problem ??
            (refused !== undefined
              ? "Nothing was kept."
              : flow.kept
                ? "Kept with the page. Save or Publish to store it."
                : "Checked first. Nothing runs inside the builder.")}
        </p>
      </div>
    </>
  );
}
