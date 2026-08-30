/**
 * Folding every plugin's `contributes.jobs` into one list the runner can hold.
 *
 * ## Why this seam exists
 *
 * `defineJob` produces a value. Until something puts that value in the runtime
 * registry, the job type does not exist as far as a drain is concerned — and the
 * failure is completely silent. A plugin author calls `defineJob`, queues the
 * slug, gets an id back, and every pass thereafter defers the row because the
 * registry has never heard of the handler. Nothing errors. The queue looks
 * pending, the plugin looks installed, and the work never happens.
 *
 * That is worse than an unregistered component, which at least renders nothing
 * visible: a deferred row is retried forever, so the queue also grows.
 *
 * @module plugins/jobs/collect-jobs
 */

import type { NextlyServiceConfig } from "../../di/register";
import {
  normalizeJobSlug,
  type JobDefinition,
} from "../../domains/jobs/job-registry";
import { NextlyError } from "../../errors/nextly-error";
import type { PluginDefinition } from "../plugin-context";

/** A job definition resolved to what the registry needs, plus its provenance. */
export interface CollectedJob {
  definition: JobDefinition<never>;
  /** Declaring owner — `"app"` or the plugin name, for logs and collisions. */
  owner: string;
}

/**
 * Slugs core registers itself. A plugin may not redeclare one.
 *
 * Held as a namespace prefix rather than a list of exact slugs, so a core job
 * type added later is reserved without anyone remembering to add it here. Core's
 * own registrations bypass this fold entirely, so nothing legitimate is refused.
 */
const RESERVED_JOB_PREFIXES = ["releases:", "webhooks:", "nextly:"];

/**
 * Fold `config.jobs` and every plugin's `contributes.jobs` into one list.
 *
 * Pure — no database access, no registry.
 *
 * A DISABLED plugin contributes nothing. `initializePlugins` skips a disabled
 * plugin's init, services, hooks and events, so registering its handler anyway
 * would run code whose setup deliberately never happened, against whatever it
 * depends on being absent. That is worse than the alternative: a row queued
 * while the plugin was enabled is deferred while it is off and runs when it is
 * turned back on, because both the row and its dedupe key survive. Deferring is
 * recoverable; executing without initialization is not.
 *
 * Throws on a duplicate slug and on a slug in a reserved namespace. Both are
 * boot failures rather than warnings, for the reason the roles fold gives: which
 * handler wins would otherwise depend on plugin load order, and the loser would
 * simply never run with nothing anywhere to say so.
 */
export function collectJobs(
  config: NextlyServiceConfig,
  plugins: PluginDefinition[]
): CollectedJob[] {
  const seen = new Map<string, string>();
  const out: CollectedJob[] = [];

  const consider = (definition: JobDefinition<never>, owner: string): void => {
    // Normalised on the way in. `JobDefinition` is a public structural type, so
    // a definition can reach here without passing through `defineJob`, carrying
    // `" acme:export "` — which the registry would key verbatim while an enqueue
    // stores the trimmed form, leaving the row unable to find its own handler.
    // Two definitions differing only in whitespace would also both pass a
    // collision check that compared them raw.
    const slug = normalizeJobSlug(definition.slug);

    const previous = seen.get(slug);
    if (previous !== undefined) {
      throw NextlyError.invalidInput({
        message: `NEXTLY_JOB_COLLISION: job slug "${slug}" is declared by both "${previous}" and "${owner}". Job slugs must be unique.`,
        logContext: { slug, owner, previous },
      });
    }

    const reserved = RESERVED_JOB_PREFIXES.find(prefix =>
      slug.startsWith(prefix)
    );
    if (reserved !== undefined) {
      throw NextlyError.invalidInput({
        message: `NEXTLY_JOB_COLLISION: "${owner}" declares job slug "${slug}", but the "${reserved}" namespace is reserved for built-in job types.`,
        logContext: { slug, owner, reserved },
      });
    }

    seen.set(slug, owner);
    out.push({
      // Copied only when normalisation changed the slug; a well-formed
      // definition is collected as the object the plugin declared.
      definition:
        slug === definition.slug ? definition : { ...definition, slug },
      owner,
    });
  };

  for (const definition of config.jobs ?? []) {
    consider(definition, "app");
  }
  for (const plugin of plugins) {
    // `enabled` is optional and absent means enabled, so this tests for an
    // explicit `false` rather than for a truthy value.
    if (plugin.enabled === false) continue;
    for (const definition of plugin.contributes?.jobs ?? []) {
      consider(definition, plugin.name);
    }
  }

  return out;
}
