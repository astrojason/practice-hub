import { useCallback, useRef, useState } from "react";
import { createSongSection, updateSongSection, deleteSongSection } from "../../api/client";

export interface Region {
  id: string;
  name: string;
  start: number;
  end: number;
  playbackSpeed: number;
  speedIncreasePercent: number;
  speedIncreaseInterval: number;
  increaseEnabled: boolean;
  createdAt: number;
  section_id?: number;
  /** "1% better every day" — nudge this region's saved speed up 1% each new day it's practiced, capped at 100%. */
  dailyBoostEnabled?: boolean;
  /** Local YYYY-MM-DD the boost last checked/applied — prevents more than one nudge per day. */
  lastBoostDate?: string;
}

function createRegionId(): string {
  return `region-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

interface NewRegionParams {
  name: string;
  start: number;
  end: number;
  playbackSpeed: number;
  speedIncreasePercent: number;
  speedIncreaseInterval: number;
  increaseEnabled: boolean;
}

interface Options {
  token?: string;
  songId?: number;
  /** A region create/delete/rename call to the server failed — the local list still updates. */
  onServerError: (message: string) => void;
}

/**
 * Saved loop regions: the list, its DB-backed song-section sync, and CRUD.
 * Applying a region to the player's live loop/speed controls is a MediaPlayer
 * concern (it touches ~10 other pieces of UI state) and stays there — this
 * hook only owns the region list itself and its server sync. Persisting the
 * list into the current preset is also the caller's responsibility (it needs
 * to happen at a specific point relative to the caller's own status-text
 * updates), so this hook doesn't call it itself.
 */
export function useRegions({ token, songId, onServerError }: Options) {
  const [regions, setRegionsState] = useState<Region[]>([]);
  const [activeRegionId, setActiveRegionIdState] = useState<string | null>(null);
  const regionsRef = useRef<Region[]>([]);
  const activeRegionIdRef = useRef<string | null>(null);

  // Regions checked for sequence playback — separate from `activeRegionId`,
  // which is the single region currently applied to the live loop controls.
  const [selectedIds, setSelectedIdsState] = useState<string[]>([]);
  const selectedIdsRef = useRef<string[]>([]);

  const setActiveRegionId = useCallback((id: string | null) => {
    setActiveRegionIdState(id);
    activeRegionIdRef.current = id;
  }, []);

  const setSelectedIds = useCallback((ids: string[]) => {
    setSelectedIdsState(ids);
    selectedIdsRef.current = ids;
  }, []);

  const toggleSelected = useCallback((id: string) => {
    const next = selectedIdsRef.current.includes(id)
      ? selectedIdsRef.current.filter(x => x !== id)
      : [...selectedIdsRef.current, id];
    setSelectedIds(next);
  }, [setSelectedIds]);

  const createRegion = useCallback(async (params: NewRegionParams): Promise<Region> => {
    let sectionId: number | undefined;
    if (token && songId) {
      try {
        const section = await createSongSection(token, songId, {
          name: params.name,
          start_seconds: params.start,
          end_seconds: params.end,
        });
        sectionId = section.id;
      } catch (err) {
        onServerError(`Failed to save region to server: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    const newRegion: Region = {
      id: createRegionId(),
      name: params.name,
      start: params.start,
      end: params.end,
      playbackSpeed: params.playbackSpeed,
      speedIncreasePercent: params.speedIncreasePercent,
      speedIncreaseInterval: params.speedIncreaseInterval,
      increaseEnabled: params.increaseEnabled,
      createdAt: Date.now(),
      section_id: sectionId,
    };
    const next = [...regionsRef.current, newRegion];
    setRegionsState(next);
    regionsRef.current = next;
    setActiveRegionId(null);
    return newRegion;
  }, [token, songId, onServerError, setActiveRegionId]);

  const removeRegion = useCallback((id: string) => {
    const region = regionsRef.current.find(r => r.id === id);
    const next = regionsRef.current.filter(r => r.id !== id);
    setRegionsState(next);
    regionsRef.current = next;
    if (activeRegionIdRef.current === id) setActiveRegionId(null);
    if (selectedIdsRef.current.includes(id)) setSelectedIds(selectedIdsRef.current.filter(x => x !== id));
    if (token && region?.section_id) {
      deleteSongSection(token, region.section_id).catch(err => {
        onServerError(`Failed to delete region from server: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }, [token, onServerError, setActiveRegionId, setSelectedIds]);

  const renameRegionAt = useCallback((id: string, name: string) => {
    const region = regionsRef.current.find(r => r.id === id);
    const next = regionsRef.current.map(r => r.id === id ? { ...r, name } : r);
    setRegionsState(next);
    regionsRef.current = next;
    if (token && region?.section_id) {
      updateSongSection(token, region.section_id, { name }).catch(err => {
        onServerError(`Failed to rename region on server: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }, [token, onServerError]);

  /** Update an existing region's fields in place (e.g. new loop bounds from editing it). */
  const updateRegionAt = useCallback((id: string, patch: Partial<Omit<Region, "id" | "createdAt" | "section_id">>) => {
    const region = regionsRef.current.find(r => r.id === id);
    const next = regionsRef.current.map(r => r.id === id ? { ...r, ...patch } : r);
    setRegionsState(next);
    regionsRef.current = next;
    if (token && region?.section_id) {
      const serverPatch: { name?: string; start_seconds?: number; end_seconds?: number } = {};
      if (patch.name !== undefined) serverPatch.name = patch.name;
      if (patch.start !== undefined) serverPatch.start_seconds = patch.start;
      if (patch.end !== undefined) serverPatch.end_seconds = patch.end;
      if (Object.keys(serverPatch).length > 0) {
        updateSongSection(token, region.section_id, serverPatch).catch(err => {
          onServerError(`Failed to update region on server: ${err instanceof Error ? err.message : String(err)}`);
        });
      }
    }
  }, [token, onServerError]);

  /** Replace the whole list — used when applying a stored preset. */
  const loadRegions = useCallback((next: Region[] | undefined) => {
    const list = Array.isArray(next) ? [...next] : [];
    setRegionsState(list);
    regionsRef.current = list;
    setActiveRegionId(null);
    setSelectedIds([]);
  }, [setActiveRegionId, setSelectedIds]);

  return {
    regions,
    regionsRef,
    activeRegionId,
    activeRegionIdRef,
    setActiveRegionId,
    selectedIds,
    selectedIdsRef,
    setSelectedIds,
    toggleSelected,
    createRegion,
    removeRegion,
    renameRegionAt,
    updateRegionAt,
    loadRegions,
  };
}
