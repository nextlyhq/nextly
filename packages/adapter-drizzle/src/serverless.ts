/**
 * Database pools inside Vercel functions: the defaults a pool takes there, and
 * handing the pool to `@vercel/functions` so idle connections are closed
 * before a function instance is suspended.
 *
 * On Vercel's Fluid compute a function instance serves many requests and is
 * suspended between them. A suspended instance keeps its open connections,
 * since the timers that would close them do not run while it is suspended, so
 * a pool of ten connections that stay open for thirty seconds holds a small
 * database's connection limit across a handful of instances. Vercel's answer
 * is a small pool, a short idle timeout, and `attachDatabasePool(pool)`, which
 * keeps the instance alive until the pool's idle connections have closed.
 *
 * Lives in the adapter package because the PostgreSQL and MySQL adapters both
 * ask these questions and neither may import the other. Each adapter imports
 * `@vercel/functions` itself and passes the import in as `load`: the package
 * is an optional peer of each adapter, so the import has to be resolved from
 * the adapter that declares it.
 *
 * @module serverless
 * @since 1.0.0
 */
import type { AdapterLogger } from "./types/config";

/** An environment to read, `process.env` by default. */
type Env = Readonly<Record<string, string | undefined>>;

/**
 * The pool a Vercel function takes when neither the adapter config nor the
 * `DB_POOL_*` variables say otherwise: at most three connections, none held
 * open, and an idle connection closed after five seconds. Each setting the
 * config or the environment gives replaces only its own field.
 */
export const SERVERLESS_POOL_DEFAULTS: Readonly<{
  max: number;
  min: number;
  idleTimeoutMs: number;
}> = Object.freeze({ max: 3, min: 0, idleTimeoutMs: 5000 });

/**
 * Whether this process runs on Vercel, in a function or in a build: Vercel
 * sets `VERCEL` in both.
 *
 * Read from the environment each time it is asked, as `isNextBuildPhase` is,
 * so a module loaded before the environment is complete still answers.
 */
export function isVercelFunction(env: Env = process.env): boolean {
  const value = env.VERCEL;
  return value !== undefined && value !== "";
}

/** Hands one pool to `attachDatabasePool`, warning rather than throwing. */
export type AttachPool = (pool: object) => void;

/** What {@link loadVercelPoolAttacher} needs from its adapter. */
export interface VercelPoolAttacherOptions {
  /** Imports `@vercel/functions/db-connections`, from the adapter's package. */
  load: () => Promise<unknown>;
  /** The database, as the warnings name it. */
  dialect: string;
  /** The adapter's logger; the console when it has none. */
  logger?: AdapterLogger | undefined;
  /** The environment to read; `process.env` by default. */
  env?: Env | undefined;
}

/** The package an app installs for the pool to be attached. */
const VERCEL_FUNCTIONS_PACKAGE = "@vercel/functions";

function warn(options: VercelPoolAttacherOptions, message: string): void {
  const text = `[nextly] ${message}`;
  if (options.logger?.warn) options.logger.warn(text);
  else console.warn(text);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `attachDatabasePool` from an imported module, as ESM or as the CommonJS
 * module `@vercel/functions` is, whose exports may arrive on `default`.
 */
function attachFunctionIn(mod: unknown): ((pool: object) => void) | undefined {
  // The module's own export first, and `default` only when it has none.
  return (
    attachFunctionOn(mod) ??
    (typeof mod === "object" && mod !== null
      ? attachFunctionOn(Reflect.get(mod, "default"))
      : undefined)
  );
}

/** `attachDatabasePool` on one object, bound to it; `undefined` when absent. */
function attachFunctionOn(
  candidate: unknown
): ((pool: object) => void) | undefined {
  if (typeof candidate !== "object" || candidate === null) return undefined;
  const attach: unknown = Reflect.get(candidate, "attachDatabasePool");
  if (typeof attach !== "function") return undefined;
  return pool => {
    Reflect.apply(attach, candidate, [pool]);
  };
}

/**
 * On Vercel, the function that attaches a pool with `@vercel/functions`;
 * off Vercel, or when the package cannot be loaded, `undefined`.
 *
 * Asked once per connect, before the first pool is built, so a connect that
 * builds several pools while it retries loads the package and warns once.
 * Never throws: a pool that cannot be attached still serves, with the short
 * idle timeout it was given, so a missing or refused package is a warning.
 */
export async function loadVercelPoolAttacher(
  options: VercelPoolAttacherOptions
): Promise<AttachPool | undefined> {
  if (!isVercelFunction(options.env)) return undefined;

  let attach: ((pool: object) => void) | undefined;
  try {
    attach = attachFunctionIn(await options.load());
  } catch (error) {
    warn(
      options,
      `Running on Vercel without ${VERCEL_FUNCTIONS_PACKAGE}, so the ${options.dialect} pool is not attached and a suspended function instance can keep its idle connections open. Install ${VERCEL_FUNCTIONS_PACKAGE} in the app to attach it (${messageOf(error)}).`
    );
    return undefined;
  }
  if (attach === undefined) {
    warn(
      options,
      `The installed ${VERCEL_FUNCTIONS_PACKAGE} has no attachDatabasePool, so the ${options.dialect} pool is not attached. Upgrade it to 2.2.8 or later.`
    );
    return undefined;
  }

  const attachDatabasePool = attach;
  return pool => {
    try {
      attachDatabasePool(pool);
    } catch (error) {
      warn(
        options,
        `${VERCEL_FUNCTIONS_PACKAGE} could not attach the ${options.dialect} pool, so a suspended function instance can keep its idle connections open (${messageOf(error)}).`
      );
    }
  };
}
