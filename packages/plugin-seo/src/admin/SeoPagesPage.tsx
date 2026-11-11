/**
 * The Pages and addresses screen: every public address the site knows of,
 * where it comes from, and whether its SEO reaches the page. A page built in
 * code has no entry, so its SEO is set here, by address, in a panel beside
 * the list.
 *
 * @module admin/SeoPagesPage
 */
import {
  apiErrorMessage,
  Button,
  navigateTo,
  usePluginRoute,
} from "@nextlyhq/plugin-sdk/admin";
import { useMemo, useRef, useState, type JSX } from "react";

import { ADDRESSES_ROUTE_PATH, type SiteAddress } from "../code-pages/contract";
import { SEO_PLUGIN_NAME } from "../settings/contract";

import { CodePagePanel, SOURCE_LABELS } from "./code-page-panel";
import { PagesStyles } from "./pages-styles";
import {
  countsOf,
  FILTERS,
  hostOf,
  shownAddresses,
  type FilterKey,
} from "./pages-view";
import { ROOT, SeoStyles } from "./styles";

/** The list the addresses route answers with. */
interface AddressesBody {
  items: SiteAddress[];
}

/** The Pages and addresses screen, as the admin mounts it. */
export function SeoPagesPage(): JSX.Element {
  const addresses = usePluginRoute<AddressesBody>({
    plugin: SEO_PLUGIN_NAME,
    path: ADDRESSES_ROUTE_PATH,
    // Entries and routes change elsewhere: read afresh each visit.
    staleTime: 0,
  });
  let body: JSX.Element;
  if (addresses.data !== undefined) {
    body = <AddressesScreen items={addresses.data.items} />;
  } else if (addresses.error) {
    body = (
      <p className="nx-seo-alert" role="alert">
        The site's addresses could not be read.{" "}
        {apiErrorMessage(addresses.error)}
      </p>
    );
  } else {
    body = (
      <p className="nx-seo-state" role="status">
        Reading the site's addresses…
      </p>
    );
  }
  return (
    <div className={`${ROOT} nx-seo-page`}>
      <SeoStyles />
      <PagesStyles />
      {body}
    </div>
  );
}

/** Whether search engines list the address, as a small label. */
function Standing({ item }: { item: SiteAddress }): JSX.Element {
  switch (item.standing) {
    case "not-connected":
      return (
        <span
          className="nx-seo-pill nc"
          title="The route doesn't call the SEO function yet"
        >
          Not connected
        </span>
      );
    case "type-hidden":
      return (
        <span
          className="nx-seo-pill t"
          title={`All ${item.from.toLowerCase()} are hidden in SEO settings`}
        >
          Hidden · all {item.from.toLowerCase()}
        </span>
      );
    case "hidden":
      return (
        <span className="nx-seo-pill t" title="Hidden on this address">
          Hidden
        </span>
      );
    case "listed":
      return <span className="nx-seo-pill">Listed</span>;
  }
}

/** Where an entry is edited in the admin. */
function entryHref(entry: NonNullable<SiteAddress["entry"]>): string {
  return entry.kind === "single"
    ? `/admin/singles/${encodeURIComponent(entry.slug)}`
    : `/admin/collections/${encodeURIComponent(entry.slug)}/${encodeURIComponent(entry.id)}`;
}

/** The list, its filters, and the panel of the address being edited. */
function AddressesScreen({ items }: { items: SiteAddress[] }): JSX.Element {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const editButtons = useRef(new Map<string, HTMLButtonElement>());
  const counts = useMemo(() => countsOf(items), [items]);
  const shown = useMemo(
    () => shownAddresses(items, filter, query),
    [items, filter, query]
  );
  const editing = items.find(item => item.path === open);
  const host =
    items.map(item => hostOf(item.canonical)).find(Boolean) ??
    (typeof window === "undefined" ? "the site" : window.location.host);

  const close = () => {
    const was = open;
    setOpen(null);
    // Back to the button that opened the panel.
    if (was !== null) editButtons.current.get(was)?.focus();
  };

  return (
    <>
      <div className={editing === undefined ? undefined : "nx-seo-shifted"}>
        <div className="nx-seo-head">
          <div>
            <h1>Pages and addresses</h1>
            <p>
              Every public address on {host}: from entries, from pages built in
              code, and from addresses a dynamic route declares. Pages with no
              entry get their SEO here.
            </p>
          </div>
        </div>
        <div className="nx-seo-body">
          <div className="nx-seo-sum">
            <span>
              <b>{counts.all}</b> addresses
            </span>
            <span>
              <b>{counts.entries}</b> from entries
            </span>
            <span>
              <b>{counts.built}</b> built routes
            </span>
            <span>
              <b>{counts.dynamic}</b> declared by dynamic routes
            </span>
            {counts.notConnected > 0 ? (
              <span className="warn">
                <b>{counts.notConnected}</b> not connected
              </span>
            ) : null}
          </div>
          <div className="nx-seo-find">
            <input
              type="search"
              placeholder="Find an address"
              aria-label="Find an address"
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
            <div className="nx-seo-seg" role="group" aria-label="Show">
              {FILTERS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={filter === key}
                  onClick={() => setFilter(key)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {shown.length === 0 ? (
            <div className="nx-seo-tbox nx-seo-empty">
              <b>No addresses match.</b>
              <p className="nx-seo-help">
                Try part of the address, like /blog.
              </p>
            </div>
          ) : (
            <div className="nx-seo-tbox nx-seo-tscroll">
              <table className="nx-seo-tbl nx-seo-atbl">
                <thead>
                  <tr>
                    <th className="w-addr">Address</th>
                    <th>Title on Google</th>
                    <th className="w-src">Source</th>
                    <th className="w-search">Search</th>
                    <th className="w-act">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(item => (
                    <tr
                      key={item.path}
                      className={open === item.path ? "on" : ""}
                    >
                      <td className="nx-seo-addr-cell">
                        <b>{item.path}</b>
                        <span>{item.name}</span>
                      </td>
                      <td className="nx-seo-title">{item.title ?? "—"}</td>
                      <td className="nx-seo-srcl">
                        {SOURCE_LABELS[item.source]}
                        <span>{item.from}</span>
                      </td>
                      <td>
                        <Standing item={item} />
                      </td>
                      <td className="nx-seo-act">
                        {item.entry !== undefined ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              if (item.entry) navigateTo(entryHref(item.entry));
                            }}
                          >
                            Open entry
                          </Button>
                        ) : (
                          <Button
                            ref={element => {
                              if (element) {
                                editButtons.current.set(item.path, element);
                              } else {
                                editButtons.current.delete(item.path);
                              }
                            }}
                            type="button"
                            variant="outline"
                            size="sm"
                            aria-expanded={open === item.path}
                            onClick={() =>
                              setOpen(open === item.path ? null : item.path)
                            }
                          >
                            Edit SEO
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      {editing?.seo !== undefined ? (
        <CodePagePanel
          key={editing.path}
          item={editing}
          host={host}
          onClose={close}
        />
      ) : null}
    </>
  );
}
