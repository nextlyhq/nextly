/**
 * Making a share image, as the SEO panel follows it: one state for both
 * places a copy can be asked for, the notice above the fields and the share
 * image row under Advanced, so each says the same thing about the same copy.
 *
 * While a copy is being made, both buttons wait and say so, and a second
 * click asks for nothing: the route reads, crops and uploads, which takes a
 * moment, and a second request would add a second copy to the media library.
 * Once it is made, the place it was asked from says so; once it could not be,
 * that place says why, in the route's own words where it gave any.
 *
 * @module admin/share-image-making
 */
import { apiErrorMessage } from "@nextlyhq/plugin-sdk/admin";
import { useRef, useState } from "react";

import { imageIdOf } from "./values";

/** Where a copy was asked for: the notice above the fields, or the row. */
export type MakePlace = "notice" | "row";

/** The picture a share image was made from, as the panel names it. */
export interface MadeFrom {
  /** Its name in a sentence, such as `cover image`. */
  name: string;
  /** Whether it is one of the page's own fields, shown on the page. */
  onPage: boolean;
}

/** A share image made in this visit: its id, its picture and where it was asked. */
export interface MadeCopy {
  id: string;
  from: MadeFrom;
  at: MakePlace;
}

/** A copy that could not be made, and why, where the route said. */
export interface MakeFailure {
  /** The route's own reason, where it gave one. */
  reason: string | undefined;
}

/** The share image being made, made or refused, and the action that asks. */
export interface ShareImageMaking {
  /** Whether a copy is being made now. */
  busy: boolean;
  /** The copy made in this visit, said only while it is the page's image. */
  made: MadeCopy | undefined;
  /**
   * Why the last copy asked for from `place` could not be made, said only
   * while the page's image is still the one it was asked from: choosing
   * another image lets it go, and asking again from there clears it. Each
   * place says its own, where the click happened.
   */
  failureAt: (place: MakePlace) => MakeFailure | undefined;
  /**
   * Asks for a copy from one place; nothing while one is being made. Absent
   * where none can be made.
   */
  make: ((at: MakePlace, from: MadeFrom) => void) | undefined;
}

/** The copy asked for, with the page's image at the time. */
interface Asked<T> {
  image: string | null;
  value: T;
}

/** A refusal as a person reads it, or none where it carries no words. */
function reasonOf(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined;
  const reason = apiErrorMessage(error, "").trim();
  return reason === "" ? undefined : reason;
}

/**
 * The panel's one state for making share images, over the page's current
 * image and the action that makes one (answering the copy's id, none where
 * it set no copy, or a refusal saying why).
 */
export function useShareImageMaking(
  ogImage: unknown,
  onMake: (() => Promise<string | undefined>) | undefined
): ShareImageMaking {
  const image = imageIdOf(ogImage) ?? null;
  const [busy, setBusy] = useState(false);
  // Read and set in the same tick as the click, so a second click before
  // the first re-render still asks for nothing.
  const inFlight = useRef(false);
  const [made, setMade] = useState<Asked<MadeCopy> | undefined>(undefined);
  const [failed, setFailed] = useState<
    Partial<Record<MakePlace, Asked<MakeFailure>>>
  >({});
  const fail = (at: MakePlace, value: Asked<MakeFailure>) =>
    setFailed(was => ({ ...was, [at]: value }));
  const make =
    onMake &&
    ((at: MakePlace, from: MadeFrom) => {
      if (inFlight.current) return;
      inFlight.current = true;
      setBusy(true);
      setFailed(({ [at]: _cleared, ...others }) => others);
      const askedFor = image;
      // A maker that throws before it answers is a refusal like any other,
      // so the buttons are freed and the failure said.
      let asked: Promise<string | undefined>;
      try {
        asked = onMake();
      } catch (error) {
        asked = Promise.reject(
          error instanceof Error ? error : new Error(String(error))
        );
      }
      void asked
        .then(
          id => {
            if (id === undefined) {
              fail(at, { image: askedFor, value: { reason: undefined } });
            } else {
              setMade({ image: id, value: { id, from, at } });
            }
          },
          (error: unknown) => {
            fail(at, { image: askedFor, value: { reason: reasonOf(error) } });
          }
        )
        .finally(() => {
          inFlight.current = false;
          setBusy(false);
        });
    });
  return {
    busy,
    made: made !== undefined && made.image === image ? made.value : undefined,
    failureAt: place => {
      const asked = failed[place];
      return asked !== undefined && asked.image === image
        ? asked.value
        : undefined;
    },
    make,
  };
}

/** What a copy that couldn't be made says, with the route's reason. */
export function failureText(failure: MakeFailure, next: string): string {
  return failure.reason === undefined
    ? `The share image couldn't be made. ${next}`
    : `The share image couldn't be made: ${withStop(failure.reason)} ${next}`;
}

/** A sentence ending in its stop, once. */
function withStop(sentence: string): string {
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** What a button that makes a share image reads, while making one or not. */
export function makeLabel(busy: boolean): string {
  return busy ? "Making…" : "Make a share image";
}

/** What is said while a copy is being made. */
export const MAKING_TEXT = "Making a 1200 × 630 share image…";
