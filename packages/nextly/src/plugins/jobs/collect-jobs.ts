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
import type { JobDefinition } from "../../domains/jobs/job-registry";
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
 * Pure — no database access, no registry. Runs over ALL plugins including
 * disabled ones, so which job types exist does not change with an environment
 * flag; a job queued while a plugin was enabled must still find its handler
 * after the flag flips, or the row is deferred forever exactly as if the plugin
 * had never declared it.
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
    const { slug } = definition;

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
    out.push({ definition, owner });
  };

  for (const definition of config.jobs ?? []) {
    consider(definition, "app");
  }
  for (const plugin of plugins) {
    for (const definition of plugin.contributes?.jobs ?? []) {
      consider(definition, plugin.name);
    }
  }

  return out;
}
