import { engine, type SoundFontPreset } from "./audio";

const DB = "ph-fretboard";
const STORE = "soundfonts";

export interface LoadedFont {
  id: string;
  name: string;
  presets: SoundFontPreset[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(`Couldn't open the SoundFont store: ${req.error?.message ?? "unknown error"}`));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(req.error?.message ?? "SoundFont store error"));
  });
}

/** Names of the SoundFonts the person has added. */
export async function listUserFonts(): Promise<string[]> {
  const db = await openDb();
  return (await request(db.transaction(STORE).objectStore(STORE).getAllKeys())).map(String);
}

export async function addUserFont(file: File): Promise<string> {
  if (!/\.sf2$/i.test(file.name)) throw new Error(`${file.name} is not a .sf2 SoundFont file.`);
  const data = await file.arrayBuffer();
  const db = await openDb();
  await request(db.transaction(STORE, "readwrite").objectStore(STORE).put(data, file.name));
  return file.name;
}

export async function removeUserFont(name: string): Promise<void> {
  const db = await openDb();
  await request(db.transaction(STORE, "readwrite").objectStore(STORE).delete(name));
}

/** Load the bundled SoundFont ("bundled") or one the person added, making it the sample source. */
export async function loadFont(id: string): Promise<LoadedFont> {
  let data: ArrayBuffer;
  let name: string;
  if (id === "bundled") {
    const res = await fetch(`${import.meta.env.BASE_URL}soundfonts/GeneralUser-GS.sf2`);
    if (!res.ok) throw new Error(`Couldn't load the bundled SoundFont (${res.status} ${res.statusText}).`);
    data = await res.arrayBuffer();
    name = "GeneralUser GS";
  } else {
    const db = await openDb();
    const stored = await request<ArrayBuffer | undefined>(db.transaction(STORE).objectStore(STORE).get(id));
    if (!stored) throw new Error(`The SoundFont ${id} is no longer stored. Add it again.`);
    data = stored;
    name = id.replace(/\.sf2$/i, "");
  }
  const presets = await engine.loadSoundFont(data, id);
  if (presets.length === 0) throw new Error(`${name} loaded but has no instruments this app can play.`);
  return { id, name, presets };
}
