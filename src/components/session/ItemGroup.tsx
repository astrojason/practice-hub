import { useState, type ReactNode } from "react";

interface Props {
  title: string;
  completedCount: number;
  totalCount: number;
  children: ReactNode;
}

export function ItemGroup({ title, completedCount, totalCount, children }: Props) {
  const [collapsed, setCollapsed] = useState(false);
  const allDone = totalCount > 0 && completedCount === totalCount;

  return (
    <section className={`item-group ${allDone ? "all-done" : ""}`}>
      <button
        className="item-group-header"
        onClick={() => setCollapsed((c) => !c)}
      >
        <span className="item-group-title">{title}</span>
        <span className="item-group-count">
          {completedCount}/{totalCount}
        </span>
        <span className="item-group-chevron">{collapsed ? "▶" : "▼"}</span>
      </button>
      {!collapsed && <div className="item-group-body">{children}</div>}
    </section>
  );
}
