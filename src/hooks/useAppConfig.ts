import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

/** The machine-specific settings saved with the app (src-tauri `AppConfig`). */
export interface AppConfig {
  admin: boolean;
  gp_library_root: string;
  instrumenta_python: string;
  cron_jobs_dir: string;
}

const DEFAULT_CONFIG: AppConfig = { admin: false, gp_library_root: "", instrumenta_python: "", cron_jobs_dir: "" };

/**
 * Loads the app's config file. Outside the desktop app (a plain browser, as in development and
 * the tests) there is no file, so the defaults apply: admin features off. A config file that
 * can't be read or isn't valid is reported in `error`.
 */
export function useAppConfig() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG);
  const [path, setPath] = useState("");
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!("__TAURI_INTERNALS__" in window)) return Promise.resolve();
    return invoke<{ config: AppConfig; path: string } | null>("get_app_config")
      .then((r) => {
        if (r) {
          setConfig({ ...DEFAULT_CONFIG, ...r.config });
          setPath(r.path);
        }
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { config, path, error, clearError: () => setError(null), reload };
}
