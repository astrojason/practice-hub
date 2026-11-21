import { useCallback, useEffect, useRef, useState } from "react";
import type { SoundFontPreset } from "../../lib/fretboard/audio";
import type { FretSettings } from "../../lib/fretboard/settings";
import { addUserFont, listUserFonts, loadFont, removeUserFont } from "../../lib/fretboard/soundfonts";

/**
 * Keeps the SoundFont the settings point at loaded (the bundled one by default)
 * and lists the ones the person has added. Failures are reported through `onError`.
 */
export function useSoundFont(settings: FretSettings, update: (p: Partial<FretSettings>) => void, onError: (m: string) => void) {
  const [presets, setPresets] = useState<SoundFontPreset[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [userFonts, setUserFonts] = useState<string[]>([]);
  const failed = useRef<string | null>(null);
  const wanted = settings.instrument === "sf" ? settings.soundFont : null;

  const fail = useCallback((err: unknown) => onError(err instanceof Error ? err.message : String(err)), [onError]);

  useEffect(() => {
    listUserFonts().then(setUserFonts).catch(fail);
  }, [fail]);

  useEffect(() => {
    if (!wanted || wanted === loadedId || failed.current === wanted) return;
    let cancelled = false;
    setLoading(true);
    loadFont(wanted)
      .then((font) => {
        if (cancelled) return;
        setPresets(font.presets);
        setLoadedId(font.id);
        const has = font.presets.some((p) => p.bank === settings.preset[0] && p.program === settings.preset[1]);
        if (!has) {
          const first = font.presets.find((p) => p.guitar) ?? font.presets[0];
          update({ preset: [first.bank, first.program] });
        }
      })
      .catch((err) => {
        failed.current = wanted;
        fail(err);
        update({ instrument: "steel", soundFont: "bundled" });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, loadedId]);

  const add = useCallback(
    async (file: File) => {
      try {
        const name = await addUserFont(file);
        setUserFonts(await listUserFonts());
        failed.current = null;
        update({ instrument: "sf", soundFont: name });
      } catch (err) {
        fail(err);
      }
    },
    [fail, update],
  );

  const remove = useCallback(
    async (name: string) => {
      try {
        await removeUserFont(name);
        setUserFonts(await listUserFonts());
        if (settings.soundFont === name) update({ soundFont: "bundled" });
      } catch (err) {
        fail(err);
      }
    },
    [fail, settings.soundFont, update],
  );

  return { presets, loading, ready: wanted !== null && wanted === loadedId, userFonts, add, remove };
}
