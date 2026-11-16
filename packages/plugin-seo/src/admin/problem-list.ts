/**
 * The problem list as a screen reads it: the kept list, checked over the
 * whole site once as the screen opens where it was never checked whole or
 * its last full check is a day old, and again whenever a person asks. One
 * hook for the Problems screen and the Overview's health card, so both show
 * the same list, checked by the same rule.
 *
 * @module admin/problem-list
 */
import {
  toastMutationResult,
  usePluginRoute,
  usePluginRouteMutation,
} from "@nextlyhq/plugin-sdk/admin";
import { useEffect, useRef, useState } from "react";

import {
  PROBLEMS_CHECK_ROUTE_PATH,
  PROBLEMS_ROUTE_PATH,
  type ProblemListBody,
} from "../problems/contract";
import { SEO_PLUGIN_NAME } from "../settings/contract";

/** What the check route answers: the list it leaves, and what it did. */
type CheckBody = ProblemListBody & { message: string };

/** The list, how its reads and checks went, and the way to check again. */
export interface CheckedProblemList {
  /** The newest list: a check's answer until a newer read arrives. */
  list: ProblemListBody | undefined;
  /** Whether the first read is still on its way. */
  reading: boolean;
  /** Whether a check of the whole site is running. */
  checking: boolean;
  /** Why the last read or check failed, or `null`. */
  failed: Error | null;
  /** Checks the whole site again; `announce` says what it did in a toast. */
  check: (announce?: boolean) => void;
}

/** The problem list, checked once as it opens where a full check is due. */
export function useCheckedProblemList(): CheckedProblemList {
  const read = usePluginRoute<ProblemListBody>({
    plugin: SEO_PLUGIN_NAME,
    path: PROBLEMS_ROUTE_PATH,
    // Pages change elsewhere in the admin, so each visit reads afresh.
    staleTime: 0,
  });
  const recheck = usePluginRouteMutation<undefined, CheckBody>({
    plugin: SEO_PLUGIN_NAME,
    path: PROBLEMS_CHECK_ROUTE_PATH,
    invalidates: [PROBLEMS_ROUTE_PATH],
  });
  // The list a check answered, with the read it was answered over: shown
  // until a read newer than that one arrives, so a refresh that fails never
  // puts the older list back.
  const [checked, setChecked] = useState<
    { list: ProblemListBody; over: ProblemListBody | undefined } | undefined
  >();
  const list =
    checked !== undefined && read.data === checked.over
      ? checked.list
      : (read.data ?? checked?.list);

  const check = (announce = true) => {
    const over = read.data;
    void recheck.write().then(answer => {
      if (answer === undefined) return;
      setChecked({ list: answer, over });
      if (announce) toastMutationResult(answer.message, []);
    });
  };

  // A list a day old, or never checked whole, is checked once as it opens.
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current || read.data?.due !== true) return;
    asked.current = true;
    check();
  });

  return {
    list,
    reading: read.pending,
    checking: recheck.pending,
    failed: recheck.error ?? read.error,
    check,
  };
}
