export type ItemType = "song" | "exercise" | "studymaterial";

export type ItemKey = `song-${number}` | `exercise-${number}` | `studymaterial-${number}`;

export function makeItemKey(type: ItemType, id: number): ItemKey {
  return `${type}-${id}` as ItemKey;
}

export function parseItemKey(key: string): { type: ItemType; id: number } | null {
  const match = /^(song|exercise|studymaterial)-(\d+)$/.exec(key);
  if (!match) return null;
  return { type: match[1] as ItemType, id: Number(match[2]) };
}
