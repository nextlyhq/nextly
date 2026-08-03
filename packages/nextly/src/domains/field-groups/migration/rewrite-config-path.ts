/**
 * Rewrites the directory segment a registry row's `config_path` records.
 *
 * The value is composed as `<dir>/<slug>.ts`, so the segment being renamed is
 * always the leading one. That is what makes this safe to do by string: the
 * rewrite is anchored to the start and to a following separator, so a project
 * directory legitimately called `my-components/` is untouched, and so is a
 * `components/` appearing deeper in a path.
 *
 * A value that does not start with the segment is returned unchanged rather
 * than repaired. This runs over rows written by older versions, and a path this
 * module does not recognise is one it has no business reshaping.
 *
 * @module domains/field-groups/migration/rewrite-config-path
 */

/**
 * Swap a leading directory segment.
 *
 * Direction is the argument order, so a rollback is the same call with `from`
 * and `to` exchanged.
 */
export function rewriteConfigPath(
  value: unknown,
  from: string,
  to: string
): unknown {
  if (typeof value !== "string") return value;
  const prefix = `${from}/`;
  if (!value.startsWith(prefix)) return value;
  return `${to}/${value.slice(prefix.length)}`;
}
