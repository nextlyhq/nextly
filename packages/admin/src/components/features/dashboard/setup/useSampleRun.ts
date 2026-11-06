"use client";

/**
 * The sample-content step's state on the card: the site's answer, a load
 * nobody has seen through, and what this person started from here.
 *
 * Three sources, read in this order:
 * - what this tab did (a load running, its outcome, a decline being saved),
 *   kept in the query cache rather than in the component, so it survives the
 *   card being drawn again: a remount, entering or leaving customise mode;
 * - the site's answer and its load, from the setup card's own data, which the
 *   server reads from the one site-wide record, so every tab, session and
 *   person sees the same load (`database/seeders/sample-content`);
 * - whether the project's route would let THIS person load (the probe), which
 *   only the admin can ask.
 *
 * Nothing here is retried on its own: a load is asked for once, and each next
 * one is the person's call. A load that failed is loaded again only once they
 * confirm that some content may already be there. The card's data is asked for
 * again whenever the dashboard regains focus while the step is drawn, and
 * after every answer from the server, so the step always shows the site's
 * current answer.
 *
 * @module components/features/dashboard/setup/useSampleRun
 */

import {
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import type {
  SampleRun,
  SampleSetupStep,
  SetupCardData,
  SetupStep,
} from "nextly/config";
import { useEffect, useRef } from "react";

import { DASHBOARD_LAYOUT_KEY } from "@admin/hooks/queries/useDashboardLayout";
import { isApiError } from "@admin/lib/api/parseApiError";
import { protectedApi } from "@admin/lib/api/protectedApi";
import {
  seedApi,
  type SampleStartAnswer,
  type SeedProbeResult,
} from "@admin/services/seedApi";

import { stepPresentation } from "./step-presentation";

const SETUP_PATH = "/dashboard/setup";

/** The probe's answer, shared by every card that asks it. */
const PROBE_KEY = ["seed", "probe"] as const;
/** What this tab did with sample content, kept across the card being drawn again. */
const SAMPLE_RUN_KEY = ["dashboard", "setup", "sample-run"] as const;
/** The last setup answer that could be read, kept for while a run is on show. */
const KEPT_SETUP_KEY = ["dashboard", "setup", "kept"] as const;

/**
 * What this tab did. `refresh` marks a change the card's data must be asked
 * for again over: taken by whichever card is drawn next, so a card drawn again
 * mid-request still asks.
 */
type SampleLocal =
  | { phase: "running" }
  /** A load this tab started, answered as held but not finished. */
  | { phase: "unfinished"; startedAt: string }
  | { phase: "loaded" }
  /** Continue was chosen: the outcome stays until the card's data shows the load. */
  | { phase: "continuing" }
  | { phase: "unrecorded"; run: string; startedAt: string; again?: boolean }
  | { phase: "recording"; run: string; startedAt: string }
  | { phase: "failed"; failure: string; startedAt?: string }
  | { phase: "confirming"; failure: string; startedAt?: string }
  | { phase: "declining" }
  /** Declined or recorded here, confirmed by the server: drawn done while the card asks again. */
  | { phase: "answered" }
  /** A start or decline the server refused, with why. */
  | { phase: "refused"; message: string };

type SampleCache = (SampleLocal & { refresh?: true }) | null;

/** What the step shows, from the three sources. */
export type SampleView =
  | { kind: "checking" }
  | { kind: "offer" }
  /** The site's answer could not be read: nothing offered. */
  | { kind: "unreadable" }
  | { kind: "running" }
  | { kind: "declining" }
  | { kind: "unfinished"; startedAt: string }
  | { kind: "failed"; failure: string; startedAt?: string; retry: boolean }
  | { kind: "confirming"; failure: string }
  | {
      kind: "unrecorded";
      run: string;
      startedAt: string;
      recording: boolean;
      again: boolean;
    }
  | { kind: "loaded"; continuing: boolean }
  | { kind: "done" };

export interface SampleRunState {
  view: SampleView;
  /** A refusal the server answered with, said once beside the step. */
  notice: string | undefined;
  /** Whether the project's route refuses this person, or its answer is not in: the step is not drawn open. */
  sampleRefused: boolean;
  /** Declined or recorded from this card and confirmed: the tile is drawn done. */
  answeredHere: boolean;
  /** Whether the project's route has answered the probe: until then `sampleRefused` is not final. */
  settled: boolean;
  /**
   * The card's data to draw: the latest, or while a run's state is on show and
   * the latest could not check setup, the last that could.
   */
  card: SetupCardData;
  /** True when `card` is the one kept because the latest could not check setup. */
  refreshFailed: boolean;
  /**
   * A load's outcome waits for the person to continue: the card shows it, in place of "You're
   * all set" if the site's answer already says so, until they do.
   */
  awaitingContinue: boolean;
  /** Whether the step's own panel is on show under the tiles. */
  panelShown: boolean;
  /** Where "Add your first entry" leads, while that step is open. */
  entryHref: string | undefined;
  load: () => void;
  /** Try again on a failed load: asks the person first, as some content may already be there. */
  askAgain: () => void;
  confirmAgain: () => void;
  cancelAgain: () => void;
  decline: () => void;
  record: () => void;
  continueOn: () => void;
}

function sampleStepOf(card: SetupCardData): SampleSetupStep | undefined {
  if (!card.setup.known) return undefined;
  return card.setup.steps.find(
    (step): step is SampleSetupStep => step.kind === "sample"
  );
}

function entryStepOf(
  card: SetupCardData
): Extract<SetupStep, { kind: "entry" }> | undefined {
  if (!card.setup.known) return undefined;
  return card.setup.steps.find(
    (step): step is Extract<SetupStep, { kind: "entry" }> =>
      step.kind === "entry"
  );
}

/** The site's load as the step shows it while this tab has nothing of its own. */
function serverView(
  run: SampleRun,
  retry: boolean
): Extract<SampleView, { kind: "unfinished" | "failed" | "unrecorded" }> {
  switch (run.state) {
    case "unfinished":
      return { kind: "unfinished", startedAt: run.startedAt };
    case "failed":
      return {
        kind: "failed",
        failure: run.failure,
        startedAt: run.startedAt,
        retry,
      };
    case "unrecorded":
      return {
        kind: "unrecorded",
        run: run.run,
        startedAt: run.startedAt,
        recording: false,
        again: false,
      };
  }
}

/** A local phase's view, where this tab's own state decides what the step shows. */
type LocalView<P extends SampleLocal["phase"]> = (
  local: Extract<SampleLocal, { phase: P }>,
  mayLoadAgain: boolean
) => SampleView | undefined;

/** What each of this tab's phases shows; a refusal shows the site's state, with its notice. */
const LOCAL_VIEWS: { [P in SampleLocal["phase"]]: LocalView<P> } = {
  running: () => ({ kind: "running" }),
  unfinished: local => ({ kind: "unfinished", startedAt: local.startedAt }),
  declining: () => ({ kind: "declining" }),
  loaded: () => ({ kind: "loaded", continuing: false }),
  continuing: () => ({ kind: "loaded", continuing: true }),
  unrecorded: local => ({
    kind: "unrecorded",
    run: local.run,
    startedAt: local.startedAt,
    recording: false,
    again: local.again === true,
  }),
  recording: local => ({
    kind: "unrecorded",
    run: local.run,
    startedAt: local.startedAt,
    recording: true,
    again: false,
  }),
  confirming: local => ({ kind: "confirming", failure: local.failure }),
  failed: (local, mayLoadAgain) => ({
    kind: "failed",
    failure: local.failure,
    ...(local.startedAt === undefined ? {} : { startedAt: local.startedAt }),
    retry: mayLoadAgain,
  }),
  answered: () => ({ kind: "done" }),
  refused: () => undefined,
};

function localView(
  local: SampleLocal | null,
  mayLoadAgain: boolean
): SampleView | undefined {
  if (local === null) return undefined;
  const view = LOCAL_VIEWS[local.phase] as LocalView<SampleLocal["phase"]>;
  return view(local, mayLoadAgain);
}

/** The site's answer as the step shows it, while this tab has nothing of its own to say. */
function siteView(
  step: SampleSetupStep | undefined,
  probe: SeedProbeResult | undefined,
  mayLoadAgain: boolean
): SampleView {
  if (step === undefined || step.status !== "open") return { kind: "done" };
  if (step.run !== undefined) return serverView(step.run, mayLoadAgain);
  if (step.unreadable) return { kind: "unreadable" };
  if (probe === undefined) return { kind: "checking" };
  if (probe.available) return { kind: "offer" };
  // Not known is not a no: nothing is offered, and the step stays open.
  return probe.unknown ? { kind: "unreadable" } : { kind: "done" };
}

/**
 * What the step shows. `mayLoadAgain` is whether this person may load and the
 * site still holds no entry: only then is a failed load offered Try again.
 */
function sampleView(
  local: SampleLocal | null,
  step: SampleSetupStep | undefined,
  probe: SeedProbeResult | undefined,
  mayLoadAgain: boolean
): SampleView {
  return localView(local, mayLoadAgain) ?? siteView(step, probe, mayLoadAgain);
}

/** The views with a panel of their own under the tiles. */
const PANEL_VIEWS: ReadonlySet<SampleView["kind"]> = new Set([
  "running",
  "unfinished",
  "failed",
  "confirming",
  "unrecorded",
  "loaded",
]);

/**
 * This tab's state after a start's answer. Every answer but a load's success asks for the card's
 * data again; a success reads nothing yet, as the outcome stays until the person continues, and a
 * read now could find setup all set and retire the card under it (Continue reads it again).
 */
function localAfter(answer: SampleStartAnswer): SampleCache {
  switch (answer.outcome) {
    case "loaded":
      return { phase: "loaded" };
    case "unfinished":
      return {
        phase: "unfinished",
        startedAt: answer.startedAt,
        refresh: true,
      };
    case "unrecorded":
      return {
        phase: "unrecorded",
        run: answer.run,
        startedAt: answer.startedAt,
        refresh: true,
      };
    case "failed":
      return {
        phase: "failed",
        failure: answer.failure,
        ...(answer.startedAt === undefined
          ? {}
          : { startedAt: answer.startedAt }),
        refresh: true,
      };
    case "refused":
      return { phase: "refused", message: answer.message, refresh: true };
  }
}

/** Each client's latest start, so an answer to an older one is set aside. */
const latestStart = new WeakMap<QueryClient, number>();

function nextStart(client: QueryClient): number {
  const next = (latestStart.get(client) ?? 0) + 1;
  latestStart.set(client, next);
  return next;
}

/** The cache entry this tab's own state is kept in. */
function writeLocal(client: QueryClient, next: SampleCache): void {
  client.setQueryData<SampleCache>(SAMPLE_RUN_KEY, next);
}

/**
 * Starts a load and keeps every outcome in the cache, whatever happens to the
 * card meanwhile: written there rather than in the component, so a card drawn
 * again reads the same state, and its answer lands though no card is drawn.
 */
async function startLoad(client: QueryClient, confirm: boolean): Promise<void> {
  // One at a time from this tab: a second press while one is on its way asks nothing.
  if (client.getQueryData<SampleCache>(SAMPLE_RUN_KEY)?.phase === "running") {
    return;
  }
  const asked = nextStart(client);
  writeLocal(client, { phase: "running" });
  const answer = await seedApi.start(confirm);
  // An answer to a start that a newer one has replaced never overwrites the newer one's.
  if (asked !== latestStart.get(client)) return;
  writeLocal(client, localAfter(answer));
}

/** A refusal's or failure's words, as the server said them. */
function wordsOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== ""
    ? error.message
    : fallback;
}

async function declineSite(client: QueryClient): Promise<void> {
  writeLocal(client, { phase: "declining" });
  try {
    await protectedApi.put(SETUP_PATH, { sample: "decline" });
    void client.invalidateQueries({ queryKey: DASHBOARD_LAYOUT_KEY });
    writeLocal(client, { phase: "answered", refresh: true });
  } catch (error) {
    writeLocal(client, {
      phase: "refused",
      message:
        isApiError(error) && error.status === 409
          ? wordsOf(error, "Someone has already answered sample content.")
          : "Your answer could not be saved. Try again.",
      refresh: true,
    });
  }
}

async function recordRun(
  client: QueryClient,
  run: string,
  startedAt: string
): Promise<void> {
  writeLocal(client, { phase: "recording", run, startedAt });
  try {
    await protectedApi.put(SETUP_PATH, { sample: { record: run } });
    void client.invalidateQueries({ queryKey: DASHBOARD_LAYOUT_KEY });
    writeLocal(client, { phase: "answered", refresh: true });
  } catch (error) {
    writeLocal(
      client,
      isApiError(error) && error.status === 409
        ? {
            phase: "refused",
            message: wordsOf(error, "That load was already answered."),
            refresh: true,
          }
        : { phase: "unrecorded", run, startedAt, again: true }
    );
  }
}

/**
 * The card's data to draw while a run's state is on show: the latest that
 * could check setup, so a later read that could not (a sibling step's check
 * failing) never takes the run's state off the card. Kept in the cache, so a
 * card drawn again keeps it too.
 */
function useKeptCard(
  card: SetupCardData,
  holding: boolean
): { card: SetupCardData; refreshFailed: boolean } {
  const client = useQueryClient();
  const kept = useQuery<SetupCardData | null>({
    queryKey: KEPT_SETUP_KEY,
    queryFn: () => null,
    enabled: false,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity,
  }).data;
  useEffect(() => {
    if (card.setup.known) client.setQueryData(KEPT_SETUP_KEY, card);
  }, [card, client]);
  if (card.setup.known || kept === null || kept === undefined) {
    return { card, refreshFailed: false };
  }
  const keptStep = sampleStepOf(kept);
  return holding || keptStep?.run !== undefined
    ? { card: kept, refreshFailed: true }
    : { card, refreshFailed: false };
}

/**
 * Whether the project's route refuses this person, for the steps the card draws. Only a refusal
 * or a missing route is a no, and only once the probe has answered (while it is on its way the
 * step is drawn "Checking…"); a probe that could not say is never read as one. Even a no
 * withholds the offer only: a load the site started, or one this tab is showing, keeps the step
 * drawn and setup open, whatever the probe says.
 */
function isSampleRefused(
  probe: SeedProbeResult | undefined,
  step: SampleSetupStep | undefined,
  local: SampleCache
): boolean {
  if (probe === undefined || probe.available || probe.unknown) return false;
  // A step whose site-wide answer could not be read is never absent: dropped, it could let
  // setup retire for good over an outage, whatever the route says of this person.
  if (step?.unreadable === true) return false;
  return (
    step?.run === undefined && (local === null || local.phase === "refused")
  );
}

/**
 * Asks the probe again, while its last answer was "not known" only: a no or a yes stands, and an
 * answer still on its way is not asked twice.
 */
function useProbeAgain(
  unknown: boolean,
  refetch: () => Promise<unknown>
): () => void {
  const latest = useRef({ unknown, refetch });
  latest.current = { unknown, refetch };
  return useRef(() => {
    if (latest.current.unknown) void latest.current.refetch();
  }).current;
}

/**
 * Asks for the card's data again whenever the dashboard regains focus while
 * `active`, so one person's answer reaches every other tab and person.
 */
function useRefreshOnFocus(active: boolean, refresh: () => void): void {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!active) return;
    const onFocus = () => {
      if (document.visibilityState !== "hidden") latest.current();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [active]);
}

/** This tab's own state, kept in the query cache so a card drawn again reads it. */
function useLocal(): SampleCache {
  return (
    useQuery<SampleCache>({
      queryKey: SAMPLE_RUN_KEY,
      queryFn: () => null,
      enabled: false,
      initialData: null,
      staleTime: Infinity,
      gcTime: Infinity,
    }).data ?? null
  );
}

/** Phases that end once the card's data shows the site's answer as it is now. */
const ENDS_ON_ANSWER: ReadonlySet<SampleLocal["phase"]> = new Set([
  "unfinished",
  "continuing",
  "answered",
  "refused",
  "failed",
  "unrecorded",
]);

/**
 * Takes a pending ask for the card's data, and ends a phase the site's answer has moved past:
 * Continue, a confirmed answer, a refusal, or a failure or record somebody since answered. Ended
 * only once the card's data is the site's as it is now, the step answered or no longer offered,
 * never on an earlier answer still in the cache.
 */
function useSettleLocal(
  local: SampleCache,
  latestCard: SetupCardData,
  refresh: () => void,
  refreshing: boolean
): void {
  const client = useQueryClient();
  useEffect(() => {
    if (local?.refresh !== true) return;
    const taken = { ...local };
    delete taken.refresh;
    writeLocal(client, taken);
    refresh();
  }, [local, client, refresh]);

  const latestStep = sampleStepOf(latestCard);
  const latestAnswered =
    latestCard.setup.known &&
    (latestStep === undefined || latestStep.status === "done");
  const phase = local?.phase;
  // A load held as not finished gives way too once the site's answer holds a load of its own.
  const latestHoldsRun = latestStep?.run !== undefined;
  useEffect(() => {
    if (refreshing || phase === undefined) return;
    const settled =
      latestAnswered || (phase === "unfinished" && latestHoldsRun);
    if (settled && ENDS_ON_ANSWER.has(phase)) writeLocal(client, null);
  }, [refreshing, latestAnswered, latestHoldsRun, phase, client]);
}

/** The step's actions, each writing this tab's state to the cache. */
function sampleActions(
  client: QueryClient,
  local: SampleCache,
  view: SampleView
): Pick<
  SampleRunState,
  | "load"
  | "askAgain"
  | "confirmAgain"
  | "cancelAgain"
  | "decline"
  | "record"
  | "continueOn"
> {
  return {
    load: () => void startLoad(client, false),
    askAgain: () => {
      if (view.kind !== "failed" || !view.retry) return;
      writeLocal(client, {
        phase: "confirming",
        failure: view.failure,
        ...(view.startedAt === undefined ? {} : { startedAt: view.startedAt }),
      });
    },
    confirmAgain: () => void startLoad(client, true),
    cancelAgain: () => {
      if (local?.phase !== "confirming") return;
      writeLocal(client, {
        phase: "failed",
        failure: local.failure,
        ...(local.startedAt === undefined
          ? {}
          : { startedAt: local.startedAt }),
      });
    },
    decline: () => void declineSite(client),
    record: () => {
      if (view.kind === "unrecorded" && !view.recording) {
        void recordRun(client, view.run, view.startedAt);
      }
    },
    continueOn: () => {
      if (local?.phase !== "loaded") return;
      // The arrangement's scope moves with the site's content, so the layout is read again.
      void client.invalidateQueries({ queryKey: DASHBOARD_LAYOUT_KEY });
      writeLocal(client, { phase: "continuing", refresh: true });
    },
  };
}

/**
 * The step's state and actions. `refresh` asks for the card's data again,
 * `refreshing` is whether it is on its way.
 */
export function useSampleRun(
  latestCard: SetupCardData,
  refresh: () => void,
  refreshing: boolean
): SampleRunState {
  const client = useQueryClient();
  const local = useLocal();
  const probeQuery = useQuery<SeedProbeResult>({
    queryKey: PROBE_KEY,
    queryFn: seedApi.probe,
    staleTime: Infinity,
    retry: false,
  });
  const probe = probeQuery.data;
  const probeUnknown = probe?.available === false && probe.unknown === true;
  const askProbeAgain = useProbeAgain(probeUnknown, probeQuery.refetch);
  // Asked again once per new reading of the card's data while it could not say: on the next
  // setup read, never in a loop on its own answer.
  useEffect(() => {
    askProbeAgain();
  }, [latestCard, askProbeAgain]);

  const { card, refreshFailed } = useKeptCard(latestCard, local !== null);
  const step = sampleStepOf(card);
  const entry = entryStepOf(card);
  const mayLoadAgain = probe?.available === true && entry?.status !== "done";
  const view = sampleView(local, step, probe, mayLoadAgain);

  useSettleLocal(local, latestCard, refresh, refreshing);
  // Not while a load runs, nor while its outcome waits for Continue: a read then could find
  // setup all set and retire the card under the outcome.
  useRefreshOnFocus(
    step?.status === "open" &&
      view.kind !== "running" &&
      local?.phase !== "loaded",
    () => {
      askProbeAgain();
      refresh();
    }
  );

  return {
    view,
    notice: local?.phase === "refused" ? local.message : undefined,
    sampleRefused: isSampleRefused(probe, step, local),
    awaitingContinue: local?.phase === "loaded",
    answeredHere: local?.phase === "answered",
    settled: probe !== undefined,
    card,
    refreshFailed,
    panelShown: PANEL_VIEWS.has(view.kind) || local?.phase === "refused",
    entryHref:
      entry?.status === "open" ? stepPresentation(entry).href : undefined,
    ...sampleActions(client, local, view),
  };
}
