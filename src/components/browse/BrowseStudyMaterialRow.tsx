import { useState } from "react";
import { BookmarkIcon, BookmarkSlashIcon, ChevronDownIcon, ChevronRightIcon, PencilSquareIcon, PlusIcon } from "@heroicons/react/16/solid";
import { SessionModal } from "../session/SessionModal";
import { StudyMaterialEditForm } from "../session/forms/StudyMaterialEditForm";
import { AddChildStudyMaterialForm } from "../session/forms/AddChildStudyMaterialForm";
import { ErrorModal } from "../ErrorModal";
import { toggleUserStudyMaterial } from "../../api/client";
import type { DashboardStudyMaterial } from "../../api/types";

interface Props {
  token: string;
  material: DashboardStudyMaterial;
  isChild?: boolean;
}

export function BrowseStudyMaterialRow({ token, material, isChild }: Props) {
  const [current, setCurrent] = useState(material);
  const [children, setChildren] = useState<DashboardStudyMaterial[]>(material.child_study_materials ?? []);
  const [collapsed, setCollapsed] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const hasChildren = children.length > 0;
  const inList = current.meta.user_study_material != null;

  async function handleToggle() {
    if (toggling) return;
    setToggling(true);
    setToggleError(null);
    try {
      const response = await toggleUserStudyMaterial(token, current.id);
      const updatedMeta =
        response.id === current.id
          ? response.meta
          : (response.child_study_materials ?? []).find((c) => c.id === current.id)?.meta ?? {
              user_study_material: null,
              sessions: [],
            };
      setCurrent((prev) => ({ ...prev, meta: updatedMeta }));
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : String(err));
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="browse-group">
      <div className={`browse-row ${isChild ? "browse-row--child" : ""}`}>
        <div className="browse-row-info">
          <span className="browse-row-name">{current.name}</span>
        </div>
        <div className="browse-row-actions">
          {hasChildren && (
            <button
              className="btn-ghost"
              onClick={() => setCollapsed((v) => !v)}
              title={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed ? <ChevronRightIcon className="icon-sm" /> : <ChevronDownIcon className="icon-sm" />}
            </button>
          )}
          <button
            className="btn-ghost"
            onClick={handleToggle}
            title={inList ? "Remove from my study materials" : "Add to my study materials"}
          >
            {inList ? <BookmarkIcon className="icon" /> : <BookmarkSlashIcon className="icon" />}
          </button>
          <button className="btn-ghost" onClick={() => setAddChildOpen((v) => !v)} title="Add child">
            <PlusIcon className="icon" />
          </button>
          <button className="btn-ghost" onClick={() => setEditOpen(true)} title="Edit">
            <PencilSquareIcon className="icon" />
          </button>
        </div>
      </div>

      {addChildOpen && (
        <div className="add-child-form-wrap">
          <AddChildStudyMaterialForm
            token={token}
            parentStudyMaterialId={current.id}
            onSuccess={(child) => {
              setChildren((prev) => [...prev, child]);
              setCollapsed(false);
              setAddChildOpen(false);
            }}
            onCancel={() => setAddChildOpen(false)}
          />
        </div>
      )}

      {editOpen && (
        <SessionModal title={`Edit: ${current.name}`} onClose={() => setEditOpen(false)}>
          <StudyMaterialEditForm
            token={token}
            material={current}
            onSuccess={(_id, name, url, type) => {
              setCurrent((prev) => ({ ...prev, name, url, type }));
              setEditOpen(false);
            }}
            onCancel={() => setEditOpen(false)}
          />
        </SessionModal>
      )}

      {!collapsed &&
        children.map((child) => (
          <BrowseStudyMaterialRow key={child.id} token={token} material={child} isChild />
        ))}

      {toggleError && <ErrorModal error={toggleError} onDismiss={() => setToggleError(null)} />}
    </div>
  );
}
