/**
 * What the author asked the inspector to take them to, held beside the
 * editor's document: a list's sort row, from its canvas note, and a block's
 * setting, from a page check's item. Each ask selects the block first, so the
 * inspector answering it is the block's own, and is counted, so a second
 * press on the same thing asks again. Editor state only: never stored, and
 * no step of the history.
 *
 * @module editor-asks
 */
import { useCallback, useMemo, useState } from "react";

import { useRestartOn } from "./editor-history";
import type { SettingTab } from "./inspector/settings-index";

/** A setting of a block's panel: its tab, and its id in the settings index. */
export interface AskedSetting {
  readonly tab: SettingTab;
  readonly id: string;
}

/** One ask to be taken to a block's setting. */
export interface SettingAsked {
  /** The block's id. */
  readonly id: string;
  readonly tab: SettingTab;
  /** The setting's id, as the settings index names it. */
  readonly setting: string;
  readonly seq: number;
}

/** The asks as the editor's state carries them; an ask not made is absent. */
export interface EditorAsks {
  sortFieldAsked?: { readonly id: string; readonly seq: number };
  askSortField: (id: string) => void;
  settingAsked?: SettingAsked;
  askSetting: (id: string, setting: AskedSetting) => void;
}

/** The asks, and the way to make each, selecting through `select`. */
export function useEditorAsks(
  select: (id: string) => void,
  session?: unknown
): EditorAsks {
  const [sortFieldAsked, setSortFieldAsked] =
    useState<EditorAsks["sortFieldAsked"]>(undefined);
  const [settingAsked, setSettingAsked] = useState<SettingAsked | undefined>(
    undefined
  );
  // An ask is about a block of the session's document: a new session (an
  // editor state started again on another document) has none.
  useRestartOn(session, () => {
    setSortFieldAsked(undefined);
    setSettingAsked(undefined);
  });
  const askSortField = useCallback(
    (id: string) => {
      select(id);
      setSortFieldAsked(current => ({ id, seq: (current?.seq ?? 0) + 1 }));
    },
    [select]
  );
  const askSetting = useCallback(
    (id: string, setting: AskedSetting) => {
      select(id);
      setSettingAsked(current => ({
        id,
        tab: setting.tab,
        setting: setting.id,
        seq: (current?.seq ?? 0) + 1,
      }));
    },
    [select]
  );
  return useMemo(
    () => ({
      ...(sortFieldAsked === undefined ? {} : { sortFieldAsked }),
      askSortField,
      ...(settingAsked === undefined ? {} : { settingAsked }),
      askSetting,
    }),
    [sortFieldAsked, askSortField, settingAsked, askSetting]
  );
}
