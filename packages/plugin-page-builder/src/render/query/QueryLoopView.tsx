/**
 * Synchronous view for the Query Loop (spec §10). Given an already-resolved QueryResult,
 * it renders the config / error / empty state, or expands the template slot once per item
 * — threading each `item` into RenderNode so bound props resolve at any depth. Sync so it
 * is testable via renderToStaticMarkup; the async fetch lives in QueryLoop.
 */
import type { ReactNode } from "react";

import type { BlockRegistry } from "../../core/registry";
import { DEFAULT_SLOT, type BlockNode } from "../../core/types";
import type { DataProvider } from "../dataProvider";
import { RenderNode } from "../RenderNode";

import type { QueryBudget } from "./runQuery";
import type { QueryResult } from "./types";

export interface QueryLoopViewProps {
  node: BlockNode;
  registry: BlockRegistry;
  dataProvider?: DataProvider;
  className: string;
  result: QueryResult;
  budget: QueryBudget;
}

export function QueryLoopView({
  node,
  registry,
  dataProvider,
  className,
  result,
  budget,
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
    <div className={className} data-nx-query-loop="list">
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
              item={item}
              budget={budget}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
