/**
 * The services a plugin reaches through `ctx.services`, as the methods meant
 * for it and nothing else.
 *
 * A core service is a class instance, and its instance carries what its
 * methods run on: the database adapter, the Drizzle handle, sub-services,
 * the logger. Handing a plugin the instance, or a proxy that passes its
 * properties through, handed it all of that, and the adapter is the live
 * database handle the raw-SQL listing withholds. A facade is a new frozen
 * object holding one bound function per allowlisted method, so a property
 * that is not a listed method is simply absent, and a method added to a
 * service later stays out of plugins' reach until someone lists it.
 *
 * @module plugins/service-facade
 */

/**
 * A frozen object exposing exactly `methods` of `target`, each calling the
 * target's own method (looked up when called) with the target as `this`.
 */
export function methodFacade<T extends object, const K extends keyof T>(
  target: T,
  methods: readonly K[]
): Pick<T, K> {
  const facade: Partial<Record<K, unknown>> = {};
  for (const name of methods) {
    facade[name] = (...args: unknown[]): unknown =>
      (Reflect.get(target, name) as (...a: unknown[]) => unknown).apply(
        target,
        args
      );
  }
  return Object.freeze(facade) as Pick<T, K>;
}
