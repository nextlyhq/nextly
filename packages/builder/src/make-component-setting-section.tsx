"use client";

/**
 * "Make this a setting of the component", in a placement's inspector: the
 * component's props a field could fill that are not settings yet, each with
 * the field picker. A pick asks the host to add the setting, named after the
 * field, and binds this placement's new setting to that field in one edit;
 * the host writes the component with the page's next save.
 *
 * @module make-component-setting-section
 */
import {
  settingBindingKey,
  type BlockDocument,
  type BuilderOp,
  type ComponentDocument,
} from "@nextlyhq/blocks-engine";
import { Popover, PopoverContent, PopoverTrigger } from "@nextlyhq/ui";
import { Check, Database } from "lucide-react";
import * as React from "react";

import { BindingPicker, pickOp } from "./binding-picker";
import type { ContentServices } from "./content-controls";
import {
  settingCandidates,
  type SettingCandidate,
} from "./make-component-setting";

/** What the section needs of the placement and the editor. */
export interface MakeSettingPlacement {
  readonly nodeId: string;
  readonly componentId: string;
  /** The component's name, as the panel titles it. */
  readonly label: string;
  /** How many pages place the component, where the library can say. */
  readonly usedOn: number | undefined;
  /** The component, or `undefined` where it could not be read. */
  readonly definition: ComponentDocument | undefined;
  /** Whether the lookup held the component, as the panel's rows read it. */
  readonly definitionFound: boolean;
  /** Whether the placement is locked, which offers no new setting. */
  readonly locked: boolean;
  readonly document: BlockDocument;
  readonly services: ContentServices | undefined;
  /** Apply one op as an edit; `false` where the editor refused it. */
  readonly onApply: (op: BuilderOp) => boolean;
}

/** A pick, as the field picker hands it. */
type Picked = Parameters<typeof pickOp>[1];

/** What a pick said: the setting made, or why not. */
interface MadeNote {
  readonly text: string;
  readonly tone: "kept" | "refused";
}

/** The note under a row, in the binding notes' look. */
function RowNote({ note }: { note: MadeNote }): React.JSX.Element {
  return (
    <p className="nx-binding-note" data-tone={note.tone} role="status">
      {note.tone === "kept" ? <Check aria-hidden="true" size={14} /> : null}
      <span>{note.text}</span>
    </p>
  );
}

/** Said where the editor refused the binding's edit. */
const EDIT_REFUSED = "The page refused this edit, so nothing changed.";

/** What the section says the change reaches, once, above its rows. */
function reachLine(label: string, usedOn: number | undefined): string {
  const where =
    usedOn === undefined
      ? `${label} is placed on other pages too`
      : `${label} is used on ${usedOn} ${usedOn === 1 ? "page" : "pages"}`;
  return `${where}. A new setting keeps showing what each one shows now, until a page binds it or sets it.`;
}

/**
 * The section, or nothing where the host adds no settings or the component
 * has nothing left to offer.
 */
export function MakeSettingSection(
  props: MakeSettingPlacement
): React.JSX.Element | null {
  const headingId = React.useId();
  const candidates = React.useMemo(
    () =>
      props.definition === undefined || !props.definitionFound || props.locked
        ? []
        : settingCandidates(props.definition),
    [props.definition, props.definitionFound, props.locked]
  );
  // Said by the section, not the row: a setting made leaves the list, as
  // it is a setting now, and its row with it.
  const [note, setNote] = React.useState<MadeNote | null>(null);
  if (props.services?.makeComponentSetting === undefined) return null;
  if (candidates.length === 0 && note === null) return null;
  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="nx-inspector__heading">
        Make this a setting of the component
      </h3>
      <p className="nx-inspector__note">
        {reachLine(props.label, props.usedOn)}
      </p>
      <div className="nx-inspector__fields">
        {candidates.map(candidate => (
          <CandidateRow
            key={`${props.nodeId}:${candidate.nodeId}:${candidate.propPath}`}
            placement={props}
            candidate={candidate}
            onNote={setNote}
          />
        ))}
      </div>
      {note === null ? null : <RowNote note={note} />}
    </section>
  );
}

/** One prop the placement may make a setting, with its picker. */
function CandidateRow({
  placement,
  candidate,
  onNote,
}: {
  placement: MakeSettingPlacement;
  candidate: SettingCandidate;
  /** Say what a pick came to, under the section. */
  onNote: (note: MadeNote) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const setNote = onNote;
  const [pending, setPending] = React.useState(false);
  // The document as the editor holds it when the host answers: the bind is
  // planned against that, so an edit made meanwhile stays.
  const latest = React.useRef(placement.document);
  latest.current = placement.document;
  const mounted = React.useRef(true);
  React.useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const make = async (picked: Picked): Promise<void> => {
    const ask = placement.services?.makeComponentSetting;
    if (ask === undefined) return;
    setPending(true);
    let answer: Awaited<ReturnType<typeof ask>>;
    try {
      answer = await ask({
        componentId: placement.componentId,
        nodeId: candidate.nodeId,
        propPath: candidate.propPath,
        label: picked.label,
      });
    } catch {
      answer = { refusal: "The setting could not be added. Try again." };
    }
    // A row gone meanwhile holds a document the editor no longer does, and a
    // bind planned against it would undo what the author did since: the
    // answer is dropped, and the host's plan, bound by nothing, with it.
    if (!mounted.current) return;
    setPending(false);
    if ("refusal" in answer) {
      setNote({ text: answer.refusal, tone: "refused" });
      return;
    }
    const { op } = pickOp(
      {
        document: latest.current,
        nodeId: placement.nodeId,
        prop: settingBindingKey(answer.settingId),
        clearsOnBind: undefined,
        entryLink: undefined,
      },
      picked,
      undefined
    );
    if (op === null || !placement.onApply(op)) {
      setNote({ text: EDIT_REFUSED, tone: "refused" });
      return;
    }
    setNote({
      text: `“${picked.label}” is a setting of ${placement.label} now, bound to that field here. The change to ${placement.label} is saved with the page.`,
      tone: "kept",
    });
  };

  const name = candidate.label;
  return (
    <div className="nx-binding-row">
      <div className="nx-binding-row__field">
        <span className="nx-inspector__label">{name}</span>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="nx-binding-row__bind"
            aria-label={`Make ${name} a setting, bound to a field`}
            title={`Make ${name} a setting, bound to a field`}
            disabled={pending}
            data-open={open ? "" : undefined}
          >
            <Database aria-hidden="true" size={14} />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="nx-binding-popover">
          <BindingPicker
            prop={{
              name: `${candidate.nodeId}.${candidate.propPath}`,
              schema: { ...candidate.schema, label: name },
              value: candidate.value,
              supported: true,
              options: [],
              offered: true,
              readOnly: false,
            }}
            blockLabel={placement.label}
            document={placement.document}
            nodeId={placement.nodeId}
            services={placement.services}
            current={undefined}
            entryLink={undefined}
            onPick={picked => {
              setOpen(false);
              void make(picked);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
