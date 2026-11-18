"use client";

/**
 * Taking the author to a setting someone asked for from outside the panel,
 * as a page check's item asks for the setting that fixes it: the panel shows
 * the setting's tab, opens its section, clears a search that would hide it,
 * and puts the cursor in its field.
 *
 * Once per ask: the editor counts each ask (`settingAsked.seq`), so a press
 * on the same item again asks again, while the panel drawn again for any
 * other reason moves nothing. The setting's section is read from the
 * settings index, the same answer "Find a setting" uses, so the section
 * opened is the one the row is drawn in.
 *
 * @module asked-setting
 */
import * as React from "react";

import type { SettingAsked } from "./editor-asks";
import { withSectionFold } from "./panel-folds";
import { usePanelFolds } from "./panel-folds-context";
import { useFilterState } from "./settings-filter";
import { filtering, type SettingEntry } from "./settings-index";

/** How long the field is looked for while its section opens, in ms. */
const LOOK_FOR = 1000;
/** How often it is looked for meanwhile. */
const LOOK_EVERY = 25;

/** The field a setting's row is drawn with, where it is on screen. */
function fieldOf(root: HTMLElement, setting: string): HTMLElement | null {
  const row = [
    ...root.querySelectorAll<HTMLElement>(".nx-setting[data-setting]"),
  ].find(each => (each.dataset.setting ?? "").split(" ").includes(setting));
  if (row === undefined || row.closest("[hidden]") !== null) return null;
  // A field to type in first, then any control: a bound row's bind button
  // comes before its field.
  return (
    row.querySelector<HTMLElement>(
      "textarea:not([disabled]), input:not([type=hidden]):not([disabled]), [contenteditable=true]"
    ) ??
    row.querySelector<HTMLElement>(
      "button:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex='-1'])"
    )
  );
}

/**
 * Put the cursor in the setting's field once it is drawn, looking again
 * while its section opens; `done` is called either way, and the returned
 * function stops the looking.
 */
function focusWhenDrawn(
  root: React.RefObject<HTMLElement | null>,
  setting: string,
  done: () => void
): () => void {
  let waited = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const look = (): void => {
    const field = root.current === null ? null : fieldOf(root.current, setting);
    if (field !== null) {
      field.scrollIntoView({ block: "nearest" });
      field.focus();
      done();
      return;
    }
    waited += LOOK_EVERY;
    if (waited >= LOOK_FOR) {
      done();
      return;
    }
    timer = setTimeout(look, LOOK_EVERY);
  };
  timer = setTimeout(look, 0);
  return () => clearTimeout(timer);
}

/** What the panel lends the ask. */
export interface AskedSettingHost {
  /** The ask, where there is one. */
  readonly asked: SettingAsked | undefined;
  /** The block the panel shows, or `undefined` while it shows none. */
  readonly nodeId: string | undefined;
  /** Show a tab. */
  readonly choose: (tab: string) => void;
  /** The block's settings, as the settings index lists them. */
  readonly entries: () => readonly SettingEntry[];
  /** The panel, which the setting's field is looked for in. */
  readonly root: React.RefObject<HTMLElement | null>;
}

/** Answer an ask for one of the shown block's settings, once per ask. */
export function useAskedSetting(host: AskedSettingHost): void {
  const { change } = usePanelFolds();
  const filter = useFilterState();
  // Read at the ask rather than tracked: the panel's own changes are no ask.
  const latest = React.useRef({ host, change, filter });
  latest.current = { host, change, filter };
  const answered = React.useRef<number | undefined>(undefined);
  const { asked, nodeId } = host;
  React.useEffect(() => {
    if (asked === undefined || asked.id !== nodeId) return;
    if (asked.seq === answered.current) return;
    const now = latest.current;
    now.host.choose(asked.tab);
    if (filtering(now.filter)) {
      now.filter.setQuery("");
      now.filter.setOnlyChanged(false);
    }
    const entry = now.host
      .entries()
      .find(each => each.tab === asked.tab && each.id === asked.setting);
    if (entry !== undefined && entry.sectionLabel !== "") {
      now.change(folds =>
        withSectionFold(folds, asked.tab, entry.sectionLabel, true)
      );
    }
    // Answered once the field is reached or given up on, not once looked
    // for: an effect run again (React's StrictMode does so at once) stops
    // the looking first, and an ask marked answered then would never be.
    return focusWhenDrawn(now.host.root, asked.setting, () => {
      answered.current = asked.seq;
    });
  }, [asked, nodeId]);
}
