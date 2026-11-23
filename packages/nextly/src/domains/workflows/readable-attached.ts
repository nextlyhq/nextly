/**
 * The collections and Singles a workflow holds that a caller may read, by slug.
 *
 * One rule for two readers: the waiting list and its scope judge what can wait for the caller
 * from it, and the admin's workspace answer carries it, so the admin asks for a document's review
 * state, and whether anything can wait for its reader, only where a workflow can hold something.
 * Collections and Singles share one namespace of slugs, so one ask covers both.
 *
 * With no workflow attached anywhere it answers at once, with no read at all.
 *
 * @module domains/workflows/readable-attached
 * @experimental
 */

import {
  readableEntities,
  type ReadAccessCaller,
} from "../../auth/entity-read-access";

import { registeredWorkflows } from "./registry";

/** Every collection and Single some registered workflow holds, by slug, each once. */
export function attachedEntitySlugs(): string[] {
  const slugs = new Set<string>();
  for (const registered of registeredWorkflows()) {
    for (const slug of registered.collections) slugs.add(slug);
    for (const slug of registered.singles) slugs.add(slug);
  }
  return [...slugs];
}

/** The attached collections and Singles `caller` may read, by slug. */
export async function readableAttachedEntities(
  caller: ReadAccessCaller
): Promise<Set<string>> {
  const attached = attachedEntitySlugs();
  if (attached.length === 0) return new Set();
  return readableEntities(attached, caller);
}
