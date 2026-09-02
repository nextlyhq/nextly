/**
 * Which workflow each collection's documents move through.
 *
 * ## Why this is a registry rather than a lookup on the collection
 *
 * The read path cannot reach the loaded config. `getCollection` returns the
 * PERSISTED record — the row in `dynamic_collections`, whose `status` is a
 * boolean — and the query services hold no route to `nextly.config.ts` at all.
 * Threading one through three services, their constructors and every caller is
 * a larger change than declaring a workflow warrants, so the config registers
 * what it declared and the read path asks.
 *
 * ## What happens when registration has not run
 *
 * A collection nobody registered answers with the default workflow, and that
 * fallback is safe in the direction that matters. The default declares one
 * public state named `published`, so a public read filters to it and a document
 * sitting in a custom state — `in_review`, `legal_hold` — is EXCLUDED rather
 * than served. An unregistered custom workflow therefore hides content it
 * should have shown; it never shows content it should have hidden.
 *
 * That asymmetry is why the fallback is a constant rather than a throw. A read
 * path that refuses when a registry is unpopulated turns a boot-order problem
 * into an outage, and this one is reached by tests, scripts and partial boots
 * that have no config to register from.
 *
 * @module domains/collections/services/collection-workflows
 */

import {
  DEFAULT_WORKFLOW,
  type ContentWorkflow,
} from "../../../lib/content-states";

const workflowsBySlug = new Map<string, ContentWorkflow>();

/**
 * Record the workflow a collection declared.
 *
 * Called once per collection as the config is loaded. Re-registering the same
 * slug REPLACES, because a reload of the config is the same collection saying
 * something new rather than a second collection of the same name.
 */
export function registerCollectionWorkflow(
  slug: string,
  workflow: ContentWorkflow
): void {
  workflowsBySlug.set(slug, workflow);
}

/** The workflow this collection's documents move through. */
export function workflowForCollection(slug: string): ContentWorkflow {
  return workflowsBySlug.get(slug) ?? DEFAULT_WORKFLOW;
}

/**
 * Forget every registration.
 *
 * For tests and for a config reload, which must not leave a collection's old
 * workflow answering after its declaration changed.
 */
export function clearCollectionWorkflows(): void {
  workflowsBySlug.clear();
}
