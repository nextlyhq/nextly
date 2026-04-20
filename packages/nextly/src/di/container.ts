/**
 * Lightweight Dependency Injection Container
 *
 * ~50 lines, SWC-compatible (no decorators), zero external dependencies.
 *
 * Usage:
 * ```typescript
 * import { container } from '@revnixhq/nextly';
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
    this.factories.set(name, () => {
      if (!this.singletons.has(name)) {
        this.singletons.set(name, factory());
      }
      return this.singletons.get(name) as T;
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
