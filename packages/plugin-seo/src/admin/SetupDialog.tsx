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
  DialogTitle,
  Input,
} from "@nextlyhq/plugin-sdk/admin";
import { useId, useState, type JSX } from "react";

import { SETUP_STEPS, type SeoContentType } from "../settings/contract";
import { productionAddressProblem } from "../settings/production-addresses";

import {
  AI_CHOICES,
  AI_CHOICES_NOTE,
  ChoiceCards,
  SITE_KIND_CHOICES,
} from "./choices";
import { MediaChoice } from "./MediaChoice";
import { attentionItems, type SettingsDraft } from "./settings-draft";
import { Icon, ROOT } from "./styles";
import type { TabId, TabProps } from "./tabs";

/** The step the dialog is on: one of the three, or the end. */
type Step = 1 | 2 | 3 | "done";

/** What first-time setup is handed by the screen it opens over. */
export interface SetupDialogProps extends TabProps {
  open: boolean;
  /** The step to start on: the first not yet answered. */
  firstStep: Step;
  types: readonly SeoContentType[];
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

/** The step after `step`, and how many steps that counts as done. */
const nextOf = (step: 1 | 2 | 3): Step =>
  step === 3 ? "done" : ((step + 1) as 2 | 3);

/** The first step: the site's name and its production address. */
function NameStep({ draft, change }: TabProps): JSX.Element {
  const nameId = useId();
  const addressId = useId();
  const address = draft.productionAddresses[0] ?? "";
  const problem =
    address.trim() === "" ? null : productionAddressProblem(address);
  return (
    <>
      <div className="nx-seo-field">
        <label className="nx-seo-label" htmlFor={nameId}>
          Site name
        </label>
        <Input
          id={nameId}
          value={draft.siteName}
          aria-describedby={`${nameId}-help`}
          onChange={event => {
            const siteName = event.target.value;
            change(current => ({ ...current, siteName }));
          }}
        />
        <p className="nx-seo-help" id={`${nameId}-help`}>
          Used at the end of titles and when pages are shared.
        </p>
      </div>
      <div className="nx-seo-field">
        <label className="nx-seo-label" htmlFor={addressId}>
          Production address
        </label>
        <Input
          id={addressId}
          className="nx-seo-mono"
          value={address}
          placeholder="https://"
          aria-invalid={problem !== null}
          aria-describedby={`${addressId}-help`}
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
        {problem === null ? null : <p className="nx-seo-error">{problem}</p>}
        <p className="nx-seo-help" id={`${addressId}-help`}>
          The address people visit. Any other address, like a preview or a test
          copy, is kept out of search.
        </p>
      </div>
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
      <div className="nx-seo-field" role="group" aria-labelledby={aiId}>
        <span className="nx-seo-label" id={aiId}>
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
        <p className="nx-seo-help">{AI_CHOICES_NOTE}</p>
      </div>
    </>
  );
}

/** The third step: the logo and the default share image. */
function ImagesStep({ draft, change }: TabProps): JSX.Element {
  return (
    <>
      <MediaChoice
        label="Logo"
        shape="square"
        value={draft.logo}
        onChange={logo => change(current => ({ ...current, logo }))}
        emptyHelp="Square works best, at least 112 × 112."
      />
      <MediaChoice
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
  close,
}: {
  draft: SettingsDraft;
  types: readonly SeoContentType[];
  close: (tab?: TabId) => void;
}): JSX.Element {
  const items = attentionItems(draft, types);
  if (items.length === 0) {
    return (
      <div className="nx-seo-minilist">
        <div>
          <span className="nx-seo-okc">
            <Icon name="check" />
          </span>
          <span className="grow">Nothing needs attention right now.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="nx-seo-minilist">
      {items.map(item => (
        <div key={item.text}>
          <span className="nx-seo-warnc">
            <Icon name="warn" />
          </span>
          <span className="grow">{item.text}</span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => close(item.tab)}
          >
            {item.fix}
          </Button>
        </div>
      ))}
    </div>
  );
}

/** The questions of `step`, or what needs attention at the end. */
function StepBody({
  step,
  draft,
  change,
  types,
  close,
}: TabProps & {
  step: Step;
  types: readonly SeoContentType[];
  close: (tab?: TabId) => void;
}): JSX.Element {
  if (step === 1) return <NameStep draft={draft} change={change} />;
  if (step === 2) return <KindStep draft={draft} change={change} />;
  if (step === 3) return <ImagesStep draft={draft} change={change} />;
  return (
    <>
      <AttentionList draft={draft} types={types} close={close} />
      <p className="nx-seo-help">Nothing here stops you publishing.</p>
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
      <span className="nx-seo-help">
        Step {step} of {SETUP_STEPS}
      </span>
      <div className="nx-seo-row">
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
      <DialogContent size="lg" className={`${ROOT} nx-seo-dialog`}>
        <div className="nx-seo-dlg-head">
          <DialogTitle asChild>
            <h2>{shown.title}</h2>
          </DialogTitle>
          <DialogDescription asChild>
            <p>{shown.lead}</p>
          </DialogDescription>
        </div>
        {step === "done" ? null : (
          <div className="nx-seo-steps" aria-hidden="true">
            {Array.from({ length: SETUP_STEPS }, (_, index) => (
              <span key={index} className={index < step ? "on" : undefined} />
            ))}
          </div>
        )}
        <div className="nx-seo-dlg-body">
          {failure === null ? null : (
            <p className="nx-seo-error" role="alert">
              Not saved. {failure}
            </p>
          )}
          <StepBody
            step={step}
            draft={draft}
            change={change}
            types={types}
            close={close}
          />
        </div>
        <div className="nx-seo-dlg-foot">
          <StepFooter
            step={step}
            saving={saving}
            blocked={blocked}
            setStep={setStep}
            advance={from => void advance(from)}
            finish={finish}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
