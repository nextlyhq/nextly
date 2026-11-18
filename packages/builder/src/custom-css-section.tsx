"use client";

/**
 * Advanced › Custom CSS: one block's own CSS, for a person who may change the
 * site's code, and the line the Style tab shows about it for everyone.
 *
 * The box holds a draft. Leaving it or pressing Apply checks the draft with
 * the host's checker (`BlockCustomCssAccess.check`, the one the server judges
 * the save by): CSS it accepts is stored on the block in one update, so one
 * undo takes it back; CSS it refuses is stored nowhere, and each refused line
 * is listed under the box with its reason. A change to the block's CSS from
 * anywhere else, an undo among them, puts the box back to what the block
 * holds.
 *
 * The Style tab's line reads only whether the block holds CSS. A person
 * without the permission is told it is there and who can change it, never
 * what it says.
 *
 * @module custom-css-section
 */
import { Button, Textarea } from "@nextlyhq/ui";
import * as React from "react";

import {
  CUSTOM_CSS_KEY,
  CUSTOM_CSS_SECTION,
  CUSTOM_CSS_SETTING,
  customCssOp,
  type BlockCustomCssAccess,
} from "./custom-css";
import type { EditorState } from "./editor-state";
import { HeldByLock } from "./held-by-lock";
import {
  designReadOnlyReason,
  lockViewOf,
  type BlockInspection,
} from "./inspector";
import type { PanelSection } from "./panel-section";
import { SettingSlot } from "./settings-filter";

/** Said when the editor refuses the write, as Advanced's other fields say it. */
const NOT_SAVED =
  "That change could not be saved. A very long value can push the page past its size limit; otherwise the block may have changed since you opened this tab.";

// design-lint-ok: CSS shown to the author as an example to write, not a
// colour the panel is drawn with.
const SELECTOR_EXAMPLE = "selector { color: red; }";

/** What a block stores as its CSS, read as text; anything else is none. */
function storedCss(stored: unknown): string | undefined {
  return typeof stored === "string" ? stored : undefined;
}

/**
 * Advanced's Custom CSS section, for a person `access` is given to; none for
 * anyone else. The builder's own row, last in the tab: folded until opened
 * even while it holds CSS (its dot still shows), and held like HTML while the
 * design is locked.
 */
export function customCssSections({
  access,
  block,
  stored,
  editor,
  active,
  heldBy,
}: {
  access: BlockCustomCssAccess | undefined;
  block: Pick<BlockInspection, "nodeId" | "hasCustomCss">;
  /** The block's stored CSS, if it holds any. */
  stored: unknown;
  editor: EditorState;
  /** Whether the Advanced tab is the one showing. */
  active: boolean;
  /** The lock reason's id while the design is locked; else undefined. */
  heldBy: string | undefined;
}): PanelSection[] {
  if (access === undefined) return [];
  return [
    {
      key: CUSTOM_CSS_KEY,
      label: CUSTOM_CSS_SECTION,
      holdsValue: block.hasCustomCss,
      opensWithValue: false,
      body: (
        <SettingSlot ids={[CUSTOM_CSS_SETTING]}>
          <HeldByLock reasonId={heldBy}>
            <CustomCssSection
              // Keyed by node, so a draft stays with its own block.
              key={`${block.nodeId}:custom-css`}
              nodeId={block.nodeId}
              stored={stored}
              editor={editor}
              access={access}
              active={active}
            />
          </HeldByLock>
        </SettingSlot>
      ),
    },
  ];
}

/**
 * Stores the box's text on the block if it may be stored, and answers what to
 * list under the box: the refused lines, the reason a write was refused, or
 * nothing once it is stored or nothing changed.
 */
function storeDraft({
  text,
  held,
  access,
  editor,
  nodeId,
}: {
  text: string;
  held: string | undefined;
  access: BlockCustomCssAccess;
  editor: EditorState;
  nodeId: string;
}): readonly string[] {
  // White space alone is no CSS: the block holds none.
  const next = text.trim() === "" ? undefined : text;
  if (next === held) return [];
  const refused = next === undefined ? [] : access.check(next);
  if (refused.length > 0) return refused;
  // Asked of the live document, as every write in the panel asks.
  const locked = designReadOnlyReason(
    editor.document,
    nodeId,
    lockViewOf(editor)
  );
  if (locked !== undefined) return [locked];
  return editor.apply(customCssOp(nodeId, text)) === null ? [NOT_SAVED] : [];
}

/**
 * Runs `leave` when the tab holding the box goes off screen, and when the box
 * goes away while it is on screen, with what the box holds then.
 */
function useOnLeave(active: boolean, leave: () => void): void {
  const latest = React.useRef(leave);
  latest.current = leave;
  const onScreen = React.useRef(active);
  React.useEffect(() => {
    const was = onScreen.current;
    onScreen.current = active;
    if (was && !active) latest.current();
  }, [active]);
  React.useEffect(
    () => () => {
      if (onScreen.current) latest.current();
    },
    []
  );
}

/**
 * The box, its hint, Apply and the refused lines, for the block `nodeId`.
 * Keyed by the block where it is drawn, so a draft never moves to another.
 */
function CustomCssSection({
  nodeId,
  stored,
  editor,
  access,
  active,
}: {
  nodeId: string;
  /** The block's stored CSS, if it holds any. */
  stored: unknown;
  editor: EditorState;
  access: BlockCustomCssAccess;
  /** Whether the Advanced tab is the one showing. */
  active: boolean;
}): React.JSX.Element {
  const id = React.useId();
  const held = storedCss(stored);
  const [draft, setDraft] = React.useState(held ?? "");
  const [problems, setProblems] = React.useState<readonly string[]>([]);
  // The block's CSS changed under the box, by an undo, a redo or this box's
  // own write: the box shows what the block now holds, and nothing it says
  // about an earlier draft stays.
  React.useEffect(() => {
    setDraft(held ?? "");
    setProblems([]);
  }, [held]);

  const commit = (): void =>
    setProblems(storeDraft({ text: draft, held, access, editor, nodeId }));
  // Checked when the author looks away (the tabs move on `mousedown`, before
  // the blur), and when the box goes away while on screen, as Advanced's
  // other fields are written.
  useOnLeave(active, commit);

  const hintId = `${id}-hint`;
  const problemsId = `${id}-problems`;
  return (
    <div className="nx-custom-css">
      <p id={hintId} className="nx-custom-css__hint">
        Write <code>selector</code> for this block:{" "}
        <code>{SELECTOR_EXAMPLE}</code>. Applies to this block only, on every
        device.
      </p>
      <Textarea
        value={draft}
        aria-label={CUSTOM_CSS_SECTION}
        aria-describedby={
          problems.length === 0 ? hintId : `${hintId} ${problemsId}`
        }
        aria-invalid={problems.length === 0 ? undefined : true}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        rows={6}
        className="nx-custom-css__box"
        onChange={event => setDraft(event.target.value)}
        onBlur={commit}
      />
      {/* Under the box and above the refused lines, so a list appearing as
          the box is left moves no button the pointer is on its way to. */}
      <div className="nx-custom-css__actions">
        <Button type="button" size="sm" variant="outline" onClick={commit}>
          Apply
        </Button>
      </div>
      {problems.length === 0 ? null : (
        <div id={problemsId} role="alert" className="nx-custom-css__problems">
          <ul>
            {problems.map((problem, at) => (
              // Two refusals can read the same, so their place keeps them apart.
              <li key={`${String(at)}:${problem}`}>{problem}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * The line at the top of the Style tab while the block holds custom CSS.
 * With the permission it links to the box ("Edit" asks the panel for the
 * setting, which shows Advanced, opens the section and focuses the box);
 * without it, it says who can change the CSS, and nothing of what it says.
 */
export function CustomCssStyleLine({
  nodeId,
  hasCustomCss,
  access,
  editor,
}: {
  nodeId: string;
  hasCustomCss: boolean;
  access: BlockCustomCssAccess | undefined;
  editor: Pick<EditorState, "askSetting">;
}): React.JSX.Element | null {
  if (!hasCustomCss) return null;
  // The way to the box, where the editor can take the author to a setting.
  const ask = editor.askSetting;
  if (access === undefined) {
    return (
      <p className="nx-settings-note nx-custom-css-line">
        This block also has custom CSS, set by someone who can change site code.
      </p>
    );
  }
  if (ask === undefined) {
    return (
      <p className="nx-settings-note nx-custom-css-line">
        This block also has custom CSS.
      </p>
    );
  }
  return (
    <p className="nx-settings-note nx-custom-css-line">
      {"This block also has custom CSS · "}
      <button
        type="button"
        className="nx-settings-note__link"
        onClick={() => ask(nodeId, { tab: "advanced", id: CUSTOM_CSS_SETTING })}
      >
        Edit
      </button>
    </p>
  );
}
