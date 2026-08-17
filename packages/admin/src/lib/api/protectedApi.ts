import { fetcher } from "./fetcher";

export const protectedApi = {
  get: <T>(path: string, options = {}) => fetcher<T>(path, options, true),
  post: <T>(path: string, body: unknown, options = {}) =>
    fetcher<T>(
      path,
      {
        ...options,
        method: "POST",
        body: JSON.stringify(body),
      },
      true
    ),
  // PUT, for a write whose result depends only on the body and not on how many
  // times it is sent. The rolling autosave row is the case that needed it: the
  // same snapshot sent twice must leave one recovery point, not two.
  put: <T>(path: string, body: unknown, options = {}) =>
    fetcher<T>(
      path,
      {
        ...options,
        method: "PUT",
        body: JSON.stringify(body),
      },
      true
    ),
  patch: <T>(path: string, body: unknown, options = {}) =>
    fetcher<T>(
      path,
      {
        ...options,
        method: "PATCH",
        body: JSON.stringify(body),
      },
      true
    ),
  delete: <T>(path: string, body?: unknown, options = {}) =>
    fetcher<T>(
      path,
      {
        ...options,
        method: "DELETE",
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      true
    ),
};
