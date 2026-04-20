import { fetcher } from "./fetcher";

export const publicApi = {
  get: <T>(path: string, options = {}) => fetcher<T>(path, options, false),
  post: <T>(path: string, body: unknown, options = {}) =>
    fetcher<T>(
      path,
      {
        ...options,
        method: "POST",
        body: JSON.stringify(body),
      },
      false
    ),
};
