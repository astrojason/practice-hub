export interface LocalStorageJSONResult<T> {
  value: T;
  error: string | null;
}

export function readLocalStorageJSON<T>(key: string, fallback: T): LocalStorageJSONResult<T> {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return { value: fallback, error: null };
    return { value: JSON.parse(raw) as T, error: null };
  } catch (err) {
    return {
      value: fallback,
      error: `Couldn't read "${key}" from local storage — using default. (${err instanceof Error ? err.message : String(err)})`,
    };
  }
}

export function writeLocalStorageJSON<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}
