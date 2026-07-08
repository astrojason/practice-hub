import { useState } from "react";
import { PencilSquareIcon } from "@heroicons/react/16/solid";
import { SessionModal } from "../session/SessionModal";
import { SongEditForm } from "../session/forms/SongEditForm";
import type { Song } from "../../api/types";

interface Props {
  token: string;
  song: Song;
}

export function BrowseSongRow({ token, song }: Props) {
  const [current, setCurrent] = useState(song);
  const [editOpen, setEditOpen] = useState(false);

  return (
    <div className="browse-row">
      <div className="browse-row-info">
        <span className="browse-row-name">{current.name}</span>
        <span className="browse-row-sub">{current.artist_name}</span>
      </div>
      <div className="browse-row-actions">
        <button className="btn-ghost" onClick={() => setEditOpen(true)} title="Edit">
          <PencilSquareIcon className="icon" />
        </button>
      </div>

      {editOpen && (
        <SessionModal title={`Edit: ${current.name}`} onClose={() => setEditOpen(false)}>
          <SongEditForm
            token={token}
            song={current}
            onSuccess={(updated) => {
              setCurrent(updated);
              setEditOpen(false);
            }}
            onCancel={() => setEditOpen(false)}
          />
        </SessionModal>
      )}
    </div>
  );
}
