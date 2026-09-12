/**
 * CORE's own resolver-answered sources: the `system:` door.
 *
 * ## Why a resolver rather than a query compiler
 *
 * A collection source compiles to the Direct API, which is possible because a
 * collection IS a table and every access rule that governs it is expressible as
 * a filter. Nothing else Nextly knows works that way: a release is not a row in
 * a collection table, a translation gap is a relationship BETWEEN rows, and
 * both are governed by a service that already decides who may see them.
 *
 * 🔴 So a system source hands the question to that service rather than
 * rebuilding it. The resolver receives the caller and passes it on; it never
 * adds a `where` clause of its own. A second authorization implementation is
 * the specific defect this shape exists to prevent -- one that agrees with the
 * service on the day it is written and drifts afterwards, silently, because
 * both look correct in isolation.
 *
 * ## Why registration is PUSHED by the domain
 *
 * The releases domain registers its own source; this module knows nothing about
 * releases. Inverting that -- widgets importing every domain that has something
 * to publish -- would make this package depend on nearly the whole codebase to
 * offer a card, and would make a domain unable to ship a source without editing
 * a file it does not own. The collection sources already work this way.
 *
 * ## Why this is a door rather than a store
 *
 * The store, the resolver signature and the rule about which kinds may carry a
 * resolver all live in `resolved-sources.ts`, because `plugin:` sources are
 * answered exactly the same way and two stores would be two answers to "what
 * answers this id". What survives here is the one thing that is genuinely
 * system-specific: a caller reaching for THIS function is publishing core's own
 * source, and a `plugin:` id arriving at it is a mistake worth refusing by name
 * rather than quietly accepting through the generic door.
 *
 * @module domains/widgets/system-sources
 */

import { NextlyError } from "../../errors/nextly-error";

import {
  clearResolvers,
  registerResolvedSource,
  sourceResolver,
  type SourceResolver,
} from "./resolved-sources";
import type { WidgetSource } from "./sources";

/**
 * Answers one system source's query, for one caller.
 *
 * An alias rather than a second declaration: a plugin's resolver and core's are
 * handed the same two values and return the same result, and spelling that
 * twice is how the two would come to differ.
 */
export type SystemSourceResolver = SourceResolver;

/**
 * A source this door may publish: one whose kind is literally `"system"`.
 *
 * Narrower than `WidgetSource` on purpose, and narrower than the generic
 * registrar accepts: the resolver store is keyed by id alone, so core
 * publishing under a `plugin:` id would put its source where a plugin fold is
 * entitled to replace it.
 */
export type SystemWidgetSource = WidgetSource & { kind: "system" };

/**
 * Publish a system source and the function that answers it, together.
 *
 * 🔴 And only a SYSTEM source, checked at runtime rather than left to the type.
 * The type states the rule for a TypeScript caller; this states it for
 * JavaScript and for a cast. Refused BEFORE the generic registrar, so a
 * rejected registration writes neither store.
 */
export function registerSystemSource(
  source: SystemWidgetSource,
  resolve: SystemSourceResolver
): void {
  if (source?.kind !== "system") {
    throw NextlyError.invalidInput({
      message:
        `Invalid widget source: ${String(source?.id)}: a resolver may only be ` +
        `registered for a "system:" source, not kind "${String(source?.kind)}"`,
    });
  }
  registerResolvedSource(source, resolve);
}

/** The resolver for `sourceId`, or `undefined` when nothing answers it. */
export function systemResolver(
  sourceId: string
): SystemSourceResolver | undefined {
  return sourceResolver(sourceId);
}

/**
 * Forget every registered resolver.
 *
 * For tests, which register sources into a store that outlives a single file,
 * and for the boot reset. Clears EVERY resolver rather than the system ones
 * alone: they share a store, and a reset that took one kind would leave the
 * other answering for a boot that is over.
 */
export function clearSystemResolvers(): void {
  clearResolvers();
}
