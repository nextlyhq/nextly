/**
 * Synchronous view for the Query Loop (spec §10). Given an already-resolved QueryResult,
 * it renders the config / error / empty state, or expands the template slot once per item
 * — threading each `item` into RenderNode so bound props resolve at any depth. Sync so it
 * is testable via renderToStaticMarkup; the async fetch lives in QueryLoop.
 */
import type { ReactNode } from "react";

import type { BlockRegistry } from "../../core/registry";
import { DEFAULT_SLOT, type BlockNode } from "../../core/types";
import type { RemotePatternInput } from "../../core/url-policy";
import type { DataProvider } from "../dataProvider";
import { RenderNode } from "../RenderNode";

import { loopGridStyle } from "./grid";
import type { QueryBudget } from "./runQuery";
import type { QueryResult } from "./types";

export interface QueryLoopViewProps {
  node: BlockNode;
  registry: BlockRegistry;
  dataProvider?: DataProvider;
  /** Hosts this page may load media from; forwarded to nested blocks. */
  remotePatterns?: readonly RemotePatternInput[];
  className: string;
  result: QueryResult;
  budget: QueryBudget;
  /** The document's node classes, threaded on to each rendered template node. */
  classes?: ReadonlyMap<string, string>;
  /**
   * The ref id whose reusable block this loop lives in, when it lives in one.
   *
   * Every template node rendered here is inside that block, so it is named from the ref exactly as
   * the loop's own ancestors are. Stopping the scope at the loop would name the template from bare
   * ids and put back the collision one level down.
   */
  refScope?: string;
}

export function QueryLoopView({
  refScope,
  node,
  registry,
  dataProvider,
  remotePatterns,
  className,
  result,
  budget,
  classes,
}: QueryLoopViewProps): ReactNode {
  const template = node.slots?.[DEFAULT_SLOT] ?? [];

  if (result.skipped) {
    return (
      <div className={className} data-nx-query-loop="config">
        Configure a collection to load entries.
      </div>
    );
  }
  if (result.error) {
    return (
      <div className={className} data-nx-query-loop="error">
        Could not load entries.
      </div>
    );
  }
  if (result.items.length === 0) {
    return (
      <div className={className} data-nx-query-loop="empty">
        No entries found.
      </div>
    );
  }

  return (
    <div
      className={className}
      data-nx-query-loop="list"
      style={loopGridStyle(node.props)}
    >
      {result.items.map((item, i) => (
        <div
          key={typeof item.id === "string" ? item.id : i}
          data-nx-loop-item={i}
        >
          {template.map(child => (
            <RenderNode
              key={child.id}
              node={child}
              registry={registry}
              dataProvider={dataProvider}
              remotePatterns={remotePatterns}
              item={item}
              budget={budget}
              classes={classes}
              refScope={refScope}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
