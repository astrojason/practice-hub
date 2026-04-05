import { useCallback, useEffect, useState } from "react";
import { LazyStore } from "@tauri-apps/plugin-store";

const KEY_NAME = "openai_api_key";

const store = new LazyStore("practice-hub.json");

export function useOpenAIKey() {
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    store
      .get<string>(KEY_NAME)
      .then((val) => {
        if (!cancelled) {
          setApiKey(val ?? null);
          setLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const saveKey = useCallback(async (key: string) => {
    setApiKey(key);
    try {
      await store.set(KEY_NAME, key);
      await store.save();
    } catch (e) {
      console.error("Failed to persist OpenAI key:", e);
    }
  }, []);

  const clearKey = useCallback(async () => {
    await store.delete(KEY_NAME);
    await store.save();
    setApiKey(null);
  }, []);

  return { apiKey, loaded, saveKey, clearKey };
}
