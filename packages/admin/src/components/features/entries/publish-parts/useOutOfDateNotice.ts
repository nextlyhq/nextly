"use client";

/**
 * The notice after a publish that left translations out of date: told the overview as it stood
 * before the publish, it reads the overview afresh once the publish is done, and says which
 * languages and how many fields are now out of date, each with a link to translate it.
 *
 * The fresh read is the server's own answer after the publish, not a forecast: a field goes out
 * of date when its source's live value moves, which only the publish does.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module components/features/entries/publish-parts/useOutOfDateNotice
 */

import { useCallback, useRef, useState } from "react";

import type { LanguageLabel } from "../publishAllOutcomes";

import {
  newlyOutOfDate,
  outOfDateNotice,
  type OutOfDateNoticeContent,
  type TranslationOverview,
} from "./out-of-date";

export interface UseOutOfDateNoticeOptions {
  /** The site's languages, in order, where the document is translated; otherwise none. */
  languages: readonly string[];
  labelOf: LanguageLabel;
  /** The editor's own address, which the links add a language and its source to. */
  editorPath: string;
  /** Reads the document's translation overview afresh. */
  readOverview: () => Promise<TranslationOverview | undefined>;
}

export interface OutOfDateNoticeState {
  /** The notice, or null when there is nothing to say. */
  notice: OutOfDateNoticeContent | null;
  /**
   * Says what a publish of `published` left out of date, against the overview `before` it. A
   * later publish replaces what an earlier one said; a failed read says nothing.
   */
  afterPublish: (args: {
    before: TranslationOverview | undefined;
    published: readonly string[];
    /** The language the links translate from: the one just published. */
    source: string;
  }) => Promise<void>;
  dismiss: () => void;
}

export function useOutOfDateNotice({
  languages,
  labelOf,
  editorPath,
  readOverview,
}: UseOutOfDateNoticeOptions): OutOfDateNoticeState {
  const [notice, setNotice] = useState<OutOfDateNoticeContent | null>(null);
  // Which publish is being answered, so a slower read for an earlier one never overwrites it.
  const latest = useRef(0);
  const afterPublish = useCallback<OutOfDateNoticeState["afterPublish"]>(
    async ({ before, published, source }) => {
      const asked = ++latest.current;
      setNotice(null);
      let after: TranslationOverview | undefined;
      try {
        after = await readOverview();
      } catch {
        // The publish went through; only the notice about it is lost.
        return;
      }
      if (asked !== latest.current || languages.length <= 1) return;
      setNotice(
        outOfDateNotice({
          counts: newlyOutOfDate({ languages, published, before, after }),
          labelOf,
          editorPath,
          source,
        })
      );
    },
    [languages, labelOf, editorPath, readOverview]
  );
  const dismiss = useCallback(() => setNotice(null), []);
  return { notice, afterPublish, dismiss };
}
