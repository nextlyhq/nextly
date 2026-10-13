/**
 * Lightweight Dependency Injection Container
 *
 * ~50 lines, SWC-compatible (no decorators), zero external dependencies.
 *
 * Usage:
 * ```typescript
 * import { container } from 'nextly';
 *
 * // Register singleton
 * container.registerSingleton('db', () => createDatabase(config));
 *
 * // Register factory (new instance per get)
 * container.register('requestService', () => new RequestService());
 *
 * // Get service
 * const db = container.get<Database>('db');
 * ```
 */

export type Factory<T> = () => T;

export class Container {
  private singletons = new Map<string, unknown>();
  private factories = new Map<string, Factory<unknown>>();
  private parent?: Container;

  constructor(parent?: Container) {
    this.parent = parent;
  }

  /**
   * Register a factory that creates a new instance each time get() is called.
   */
  register<T>(name: string, factory: Factory<T>): this {
    this.factories.set(name, factory);
    return this;
  }

  /**
   * Register a factory that creates a singleton instance (lazily initialized).
   */
  registerSingleton<T>(name: string, factory: Factory<T>): this {
    // The map, not `this`: after `detach` the registration lives in another
    // container, and its instance has to be cached there, beside the
    // factories it moved with, rather than in the emptied one.
    const singletons = this.singletons;
    this.factories.set(name, () => {
      if (!singletons.has(name)) {
        singletons.set(name, factory());
      }
      return singletons.get(name);
    });
    return this;
  }

  /**
   * Get a service by name. Throws if not registered.
   */
  get<T>(name: string): T {
    const factory = this.factories.get(name);
    if (factory) {
      return factory() as T;
    }
    if (this.parent) {
      return this.parent.get<T>(name);
    }

    // Enhanced error message in development
    if (process.env.NODE_ENV === "development") {
      const registered = Array.from(this.factories.keys());
      const registeredList =
        registered.length > 0 ? registered.join(", ") : "(none)";
      throw new Error(
        `Service "${name}" is not registered in container. Registered services: ${registeredList}`
      );
    }

    throw new Error(`Service "${name}" is not registered in container`);
  }

  /**
   * Check if a service is registered.
   */
  has(name: string): boolean {
    return this.factories.has(name) || (this.parent?.has(name) ?? false);
  }

  /**
   * Create a child scope container for request-scoped services.
   */
  createScope(): Container {
    return new Container(this);
  }

  /**
   * Clear all registrations and singletons (useful for testing).
   */
  clear(): void {
    this.singletons.clear();
    this.factories.clear();
  }

  /**
   * Move every registration, and every instance already built, into a new
   * container, and leave this one empty, as `clear` would.
   *
   * For code that must go on reaching the services it was started with after
   * the container has been emptied for someone else: a plugin whose teardown
   * runs only once the next registration begins. The moved singletons are the
   * same instances, so a connection opened before is the one used after.
   */
  detach(): Container {
    const detached = new Container(this.parent);
    detached.singletons = this.singletons;
    detached.factories = this.factories;
    this.singletons = new Map();
    this.factories = new Map();
    return detached;
  }

  /**
   * Take back what `detach` moved out, for as long as the code it was moved
   * aside for needs every lookup to find it: the teardown of plugins a
   * cleared registration left running, which reaches some services through
   * this container itself rather than its contexts' own resolvers. A name
   * registered here since keeps its own registration. Each restored singleton
   * is the same instance, cached in the map it moved with. `withdraw` takes
   * them out again.
   */
  restore(detached: Container): void {
    for (const [name, factory] of detached.factories) {
      if (!this.factories.has(name)) this.factories.set(name, factory);
    }
  }

  /**
   * Take out again what `restore` put back from `detached`, and nothing else:
   * a name goes only while its registration here is still the one restored
   * from it. A service registered since, under a new name or over a restored
   * one, belongs to whoever registered it and stays, which `clear` would not
   * leave.
   */
  withdraw(detached: Container): void {
    for (const [name, factory] of detached.factories) {
      if (this.factories.get(name) === factory) this.factories.delete(name);
    }
  }
}

/**
 * Global container instance.
 * Use this for application-wide service registration.
 *
 * Stored on `globalThis` to survive ESM module duplication in Next.js/Turbopack,
 * which can instantiate the same module in separate server layers (RSC, SSR).
 */
const globalForNextly = globalThis as unknown as {
  __nextly_container?: Container;
};
export const container = (globalForNextly.__nextly_container ??=
  new Container());
