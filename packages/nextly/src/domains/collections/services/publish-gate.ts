/**
 * The question a publish or unpublish asks before it writes anything, of whatever governs
 * publishing beyond access: workflows, say, which hold a part until it is approved.
 *
 * Core asks it; it decides nothing itself. With nothing registered every part may move. A gate is
 * registered in the container as `publishGate`.
 *
 * @experimental Until publishing per language is complete.
 *
 * @module domains/collections/services/publish-gate
 */
import { container } from "../../../di/container";

import type { PublishDirection } from "./publish-parts";

/** One part of an entry a publish or unpublish moves: a language, or the shared part. */
export type PublishPart =
  | { kind: "language"; locale: string }
  | { kind: "shared" };

/** What a gate is asked: every part the request would move, the added shared part included. */
export interface PublishGateQuestion {
  collection: string;
  entryId: string;
  direction: PublishDirection;
  parts: readonly PublishPart[];
  /** The caller, where one is known; trusted code has none. */
  userId?: string;
}

/** A part a gate holds back, and why, as the caller is told. */
export interface PublishGateRefusal {
  part: PublishPart;
  message: string;
}

/** Whatever decides, beyond access, whether parts of an entry may move now. */
export interface PublishGate {
  /** The parts held back, or none. Asked once per request, before anything is written. */
  refusals(
    question: PublishGateQuestion
  ): Promise<readonly PublishGateRefusal[]>;
}

/** The gate when none is registered: every part may move. */
const OPEN_GATE: PublishGate = { refusals: () => Promise.resolve([]) };

/** The gate publishing asks: the registered one, else one that holds nothing back. */
export function publishGate(): PublishGate {
  return container.has("publishGate")
    ? container.get<PublishGate>("publishGate")
    : OPEN_GATE;
}
