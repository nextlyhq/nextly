/**
 * First-time setup: three short questions over the SEO screen, then what
 * needs attention first, and on to the section's Overview. Each step's answers are saved as it moves on, and
 * every answer stays editable in the settings, so closing it part-way loses
 * nothing.
 *
 * @module admin/SetupDialog
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldShell,
  Input,
  Stepper,
} from "@nextlyhq/plugin-sdk/admin";
import { CheckCircle2, CircleAlert } from "lucide-react";
import { useId, useState, type JSX } from "react";

import type { SeoContentType } from "../settings/contract";
import { productionAddressProblem } from "../settings/production-addresses";

import {
  AI_CHOICES,
  AI_CHOICES_NOTE,
  ChoiceCards,
  SITE_KIND_CHOICES,
} from "./choices";
import { MediaChoice } from "./MediaChoice";
import { attentionItems, type SettingsDraft } from "./settings-draft";
import { ControlNote } from "./settings-parts";
import type { TabId, TabProps } from "./tabs";

/** The step the dialog is on: one of the three, or the end. */
type Step = 1 | 2 | 3 | "done";

/** What first-time setup is handed by the screen it opens over. */
export interface SetupDialogProps extends TabProps {
  open: boolean;
  /** The step to start on: the first not yet answered. */
  firstStep: Step;
  types: readonly SeoContentType[];
  /** The production addresses the server names, which win where set. */
  serverAddresses: readonly string[];
  /** Saves the draft as it stands, and resolves once it is stored. */
  save: (next: SettingsDraft) => Promise<boolean>;
  /** Why the last save failed, said in the dialog too; null when none did. */
  failure: string | null;
  /** Closes the dialog; `tab` is where to land after the last step. */
  close: (tab?: TabId) => void;
  /** Ends setup on the SEO section's Overview, where it leads. */
  finish: () => void;
}

const TITLES: Record<Step, { title: string; lead: string }> = {
  1: {
    title: "Set up SEO",
    lead: "Three quick questions. You can change every answer later in SEO settings.",
  },
  2: {
    title: "What kind of site is this?",
    lead: "This decides which details Google gets about your pages.",
  },
  3: {
    title: "Logo and share image",
    lead: "Both appear when your pages show up on Google or are shared.",
  },
  done: {
    title: "You're set up",
    lead: "These need attention first.",
  },
};

/** Each step's name, as the stepper shows it. */
const STEP_LABELS = ["Name", "Kind of site", "Images"] as const;

/** The step after `step`, and how many steps that counts as done. */
const nextOf = (step: 1 | 2 | 3): Step =>
  step === 3 ? "done" : ((step + 1) as 2 | 3);

/** The first step: the site's name and its production address. */
function NameStep({
  draft,
  change,
  serverAddresses,
}: TabProps & { serverAddresses: readonly string[] }): JSX.Element {
  const address = draft.productionAddresses[0] ?? "";
  const problem =
    address.trim() === "" ? null : productionAddressProblem(address);
  return (
    <>
      <FieldShell
        label="Site name"
        description="Used at the end of titles and when pages are shared."
        width="fill"
      >
        <Input
          value={draft.siteName}
          onChange={event => {
            const siteName = event.target.value;
            change(current => ({ ...current, siteName }));
          }}
        />
      </FieldShell>
      {serverAddresses.length > 0 ? (
        <FieldShell
          label="Production address"
          description="Set by NEXTLY_PRODUCTION_ADDRESSES on the server."
          width="fill"
        >
          <Input
            className="bg-muted font-mono text-[13px]"
            value={serverAddresses.join(", ")}
            readOnly
          />
        </FieldShell>
      ) : (
        <FieldShell
          label="Production address"
          description="The address people visit. Any other address, like a preview or a test copy, is kept out of search."
          error={problem ?? undefined}
          width="fill"
        >
          <Input
            className="font-mono text-[13px]"
            value={address}
            placeholder="https://"
            onChange={event => {
              const first = event.target.value;
              change(current => ({
                ...current,
                productionAddresses: [
                  first,
                  ...current.productionAddresses.slice(1),
                ],
              }));
            }}
          />
        </FieldShell>
      )}
    </>
  );
}

/** The second step: the kind of site, and what AI tools may do. */
function KindStep({ draft, change }: TabProps): JSX.Element {
  const aiId = useId();
  return (
    <>
      <ChoiceCards
        name="seo-setup-kind"
        label="Kind of site"
        choices={SITE_KIND_CHOICES}
        value={draft.siteKind}
        columns={2}
        onChange={siteKind => change(current => ({ ...current, siteKind }))}
      />
      <div className="grid gap-2" role="group" aria-labelledby={aiId}>
        <span className="text-sm font-semibold text-foreground" id={aiId}>
          AI tools reading your site
        </span>
        <ChoiceCards
          name="seo-setup-ai"
          label="AI tools"
          choices={AI_CHOICES}
          value={draft.aiCrawlers}
          onChange={aiCrawlers =>
            change(current => ({ ...current, aiCrawlers }))
          }
        />
        <ControlNote>{AI_CHOICES_NOTE}</ControlNote>
      </div>
    </>
  );
}

/** The third step: the logo and the default share image. */
function ImagesStep({ draft, change }: TabProps): JSX.Element {
  return (
    <>
      <MediaChoice
        layout="stacked"
        label="Logo"
        shape="square"
        value={draft.logo}
        onChange={logo => change(current => ({ ...current, logo }))}
        emptyHelp="Square works best, at least 112 × 112."
      />
      <MediaChoice
        layout="stacked"
        label="Default share image"
        value={draft.image}
        onChange={image => change(current => ({ ...current, image }))}
        emptyHelp="Used when a page has no image of its own. 1200 × 630 shows in full everywhere."
      />
    </>
  );
}

/** What needs attention first, each with the way to its fix. */
function AttentionList({
  draft,
  types,
  serverAddresses,
  close,
}: {
  draft: SettingsDraft;
  types: readonly SeoContentType[];
  serverAddresses: readonly string[];
  close: (tab?: TabId) => void;
}): JSX.Element {
  const items = attentionItems(draft, types, serverAddresses);
  if (items.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-foreground">
        <CheckCircle2 className="size-4 text-success-text" aria-hidden="true" />
        Nothing needs attention right now.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border rounded-md border border-border">
      {items.map(item => (
        <li key={item.text} className="flex items-center gap-3 px-3 py-2.5">
          <CircleAlert
            className="size-4 shrink-0 text-warning-text"
            aria-hidden="true"
          />
          <span className="grow text-sm text-foreground">{item.text}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => close(item.tab)}
          >
            {item.fix}
          </Button>
        </li>
      ))}
    </ul>
  );
}

/** The questions of `step`, or what needs attention at the end. */
function StepBody({
  step,
  draft,
  change,
  types,
  serverAddresses,
  close,
}: TabProps & {
  step: Step;
  types: readonly SeoContentType[];
  serverAddresses: readonly string[];
  close: (tab?: TabId) => void;
}): JSX.Element {
  if (step === 1) {
    return (
      <NameStep
        draft={draft}
        change={change}
        serverAddresses={serverAddresses}
      />
    );
  }
  if (step === 2) return <KindStep draft={draft} change={change} />;
  if (step === 3) return <ImagesStep draft={draft} change={change} />;
  return (
    <>
      <AttentionList
        draft={draft}
        types={types}
        serverAddresses={serverAddresses}
        close={close}
      />
      <ControlNote>Nothing here stops you publishing.</ControlNote>
    </>
  );
}

/** The dialog's buttons: back and on through the steps, or out at the end. */
function StepFooter({
  step,
  saving,
  blocked,
  setStep,
  advance,
  finish,
}: {
  step: Step;
  saving: boolean;
  blocked: boolean;
  setStep: (step: Step) => void;
  advance: (from: 1 | 2 | 3) => void;
  finish: () => void;
}): JSX.Element {
  if (step === "done") {
    return (
      <>
        <Button type="button" variant="ghost" onClick={() => setStep(1)}>
          Start again
        </Button>
        <Button type="button" onClick={finish}>
          Go to the overview
        </Button>
      </>
    );
  }
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        disabled={step === 1 || saving}
        onClick={() => setStep(step === 3 ? 2 : 1)}
      >
        Back
      </Button>
      <div className="ml-auto flex items-center gap-2">
        {step === 3 ? (
          <Button
            type="button"
            variant="ghost"
            disabled={saving}
            onClick={() => advance(3)}
          >
            Skip for now
          </Button>
        ) : null}
        <Button
          type="button"
          disabled={saving || blocked}
          onClick={() => advance(step)}
        >
          {saving ? "Saving…" : step === 3 ? "Finish" : "Next"}
        </Button>
      </div>
    </>
  );
}

/** First-time setup, over the SEO settings. */
export function SetupDialog({
  open,
  firstStep,
  draft,
  change,
  types,
  serverAddresses,
  save,
  failure,
  close,
  finish,
}: SetupDialogProps): JSX.Element {
  const [step, setStep] = useState<Step>(firstStep);
  const [saving, setSaving] = useState(false);
  const shown = TITLES[step];
  const address = draft.productionAddresses[0] ?? "";
  const blocked =
    step === 1 &&
    serverAddresses.length === 0 &&
    address.trim() !== "" &&
    productionAddressProblem(address) !== null;

  /** Save this step's answers and how far setup got, then move on. */
  const advance = async (from: 1 | 2 | 3) => {
    setSaving(true);
    const saved = await save({
      ...draft,
      setupStep: Math.max(draft.setupStep, from),
      setupDismissed: false,
    });
    setSaving(false);
    if (saved) setStep(nextOf(from));
  };

  /**
   * Close part-way: keep the answers given, and offer setup again later. It
   * closes whether or not that is saved, so a person who may only read the
   * settings is never kept in it.
   */
  const finishLater = async () => {
    close();
    if (step !== "done") await save({ ...draft, setupDismissed: true });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        if (!next) void finishLater();
      }}
    >
      {/* Held within the screen's height, scrolling inside, so a step taller
          than a phone's screen still reaches its buttons. */}
      <DialogContent
        size="lg"
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
      >
        <DialogHeader>
          <DialogTitle>{shown.title}</DialogTitle>
          <DialogDescription>{shown.lead}</DialogDescription>
        </DialogHeader>
        {step === "done" ? null : (
          <Stepper
            aria-label="Setup steps"
            current={step - 1}
            steps={STEP_LABELS.map(label => ({ label }))}
          />
        )}
        <div className="grid gap-5">
          {failure === null ? null : (
            <p className="text-sm font-medium text-danger-text" role="alert">
              Not saved. {failure}
            </p>
          )}
          <StepBody
            step={step}
            draft={draft}
            change={change}
            types={types}
            serverAddresses={serverAddresses}
            close={close}
          />
        </div>
        <DialogFooter className="items-center sm:justify-between">
          <StepFooter
            step={step}
            saving={saving}
            blocked={blocked}
            setStep={setStep}
            advance={from => void advance(from)}
            finish={finish}
          />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
