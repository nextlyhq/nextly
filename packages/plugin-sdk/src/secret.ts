const REDACTED = "[redacted]";

/**
 * @experimental A secret value that auto-redacts at every common leak vector —
 * `JSON.stringify` (`toJSON`), `String()`/template interpolation (`toString`),
 * and `console.log`/`util.inspect` (the node inspect symbol). The real value is
 * available only via the explicit, greppable `.reveal()`. Wrap secret config /
 * env values (D37): `secret(process.env.API_KEY)`.
 */
export class Secret<T = string> {
  readonly #value: T;
  constructor(value: T) {
    this.#value = value;
  }
  /** Return the underlying secret value. The only way to read it. */
  reveal(): T {
    return this.#value;
  }
  toJSON(): string {
    return REDACTED;
  }
  toString(): string {
    return REDACTED;
  }
  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}

/** @experimental Wrap a value so it redacts unless explicitly `.reveal()`ed (D37). */
export function secret<T>(value: T): Secret<T> {
  return new Secret(value);
}

/** @experimental True if `value` is a {@link Secret}. */
export function isSecret(value: unknown): value is Secret<unknown> {
  return value instanceof Secret;
}
