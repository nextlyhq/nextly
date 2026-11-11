export interface BuilderHistory<T> {
  readonly states: readonly T[];
  readonly index: number;
  readonly key: string | null;
  readonly limit: number;
}

export function createHistory<T>(initial: T, limit = 200): BuilderHistory<T> {
  return { states: [initial], index: 0, key: null, limit };
}

export function currentState<T>(history: BuilderHistory<T>): T {
  return history.states[history.index] as T;
}

export function commit<T>(history: BuilderHistory<T>, _next: T, _key?: string): BuilderHistory<T> {
  return history;
}

export function undo<T>(history: BuilderHistory<T>): BuilderHistory<T> {
  return history;
}

export function redo<T>(history: BuilderHistory<T>): BuilderHistory<T> {
  return history;
}

export function canUndo<T>(history: BuilderHistory<T>): boolean {
  return history.index > 0;
}

export function canRedo<T>(history: BuilderHistory<T>): boolean {
  return history.index < history.states.length - 1;
}
