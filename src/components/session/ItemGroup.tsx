import { useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/16/solid";

interface Props {
  title: string;
  completedCount: number;
  totalCount: number;
  /** Rendered in the header row itself, beside the count (e.g. a Start button); clicking it doesn't toggle the group. */
  headerAction?: ReactNode;
  children: ReactNode;
}

export function ItemGroup({ title, completedCount, totalCount, headerAction, children }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const allDone = totalCount > 0 && completedCount === totalCount;

  return (
    <section className={`item-group ${allDone ? "all-done" : ""}`}>
      <div className="item-group-header">
        <button className="item-group-toggle" onClick={() => setCollapsed((c) => !c)}>
          <span className="item-group-title">{title}</span>
          <span className="item-group-count">
            {completedCount}/{totalCount}
          </span>
          <span className="item-group-chevron">
            {collapsed ? <ChevronRightIcon className="icon-sm" /> : <ChevronDownIcon className="icon-sm" />}
          </span>
        </button>
        {headerAction}
      </div>
      {!collapsed && <div className="item-group-body">{children}</div>}
    </section>
  );
}
