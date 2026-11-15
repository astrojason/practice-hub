import { useEffect, useState, type ReactNode } from "react";
import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/16/solid";
import { usePendingSessionModalKey } from "../../lib/sessionModalRequest";

interface Props {
  title: string;
  completedCount: number;
  totalCount: number;
  /** Rendered in the header row itself, beside the count (e.g. a Start button); clicking it doesn't toggle the group. */
  headerAction?: ReactNode;
  /** Item keys shown in this group; the group expands when a session modal is requested for one of them. */
  itemKeys?: string[];
  children: ReactNode;
}

export function ItemGroup({ title, completedCount, totalCount, headerAction, itemKeys, children }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const pendingKey = usePendingSessionModalKey();
  useEffect(() => {
    if (pendingKey && itemKeys?.includes(pendingKey)) setCollapsed(false);
  }, [pendingKey, itemKeys]);
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
