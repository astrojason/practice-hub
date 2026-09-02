import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { load } from "@tauri-apps/plugin-store";
import { ErrorModal } from "./ErrorModal";

const STORE_KEY = "gp-library";
const NIGHTLY_SCAN_HOUR = 3;
const NIGHTLY_SCAN_MINUTE = 0;

interface NightlyScanStatus {
  last_run_ms: number;
  success: boolean;
}

interface Props {
  onBack: () => void;
}

function nextScheduledRun(): Date {
  const next = new Date();
  next.setHours(NIGHTLY_SCAN_HOUR, NIGHTLY_SCAN_MINUTE, 0, 0);
  if (next.getTime() <= Date.now()) next.setDate(next.getDate() + 1);
  return next;
}

export function SettingsView({ onBack }: Props) {
  const [launchdEnabled, setLaunchdEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRun, setLastRun] = useState<NightlyScanStatus | null>(null);
  const [lastRunChecked, setLastRunChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadLaunchdState() {
      try {
        const store = await load(STORE_KEY);
        const cachedIntent = await store.get<boolean>("launchdEnabled");
        if (!cancelled && typeof cachedIntent === "boolean") {
          setLaunchdEnabled(cachedIntent);
        }

        const installed = await invoke<boolean>("is_launchd_agent_installed");
        if (!cancelled) setLaunchdEnabled(installed);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    async function loadLastRun() {
      try {
        const status = await invoke<NightlyScanStatus | null>("nightly_scan_last_run");
        if (!cancelled) setLastRun(status);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLastRunChecked(true);
      }
    }

    loadLaunchdState();
    loadLastRun();
    return () => { cancelled = true; };
  }, []);

  async function persistIntent(enabled: boolean) {
    const store = await load(STORE_KEY);
    await store.set("launchdEnabled", enabled);
    await store.save();
  }

  async function handleLaunchdChange(enabled: boolean) {
    const previous = launchdEnabled;
    setLaunchdEnabled(enabled);
    setUpdating(true);

    try {
      await invoke(enabled ? "install_launchd_agent" : "uninstall_launchd_agent");
    } catch (err) {
      setLaunchdEnabled(previous);
      setError(err instanceof Error ? err.message : String(err));
      setUpdating(false);
      return;
    }

    try {
      await persistIntent(enabled);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="settings-view">
      <div className="settings-header">
        <button className="back-button" onClick={onBack} disabled={updating}>← Back</button>
        <h2>Settings</h2>
      </div>

      <section className="settings-card">
        <div className="settings-card-copy">
          <h3>Guitar Pro library</h3>
          <p>
            Run the library scan every day at 3:00 AM, even when Practice Hub is closed.
            Output is written to <code>~/Library/Logs/practice-hub/nightly-gp-scan.log</code>.
          </p>
        </div>
        <label className="settings-toggle">
          <input
            type="checkbox"
            checked={launchdEnabled}
            disabled={loading || updating}
            onChange={(event) => handleLaunchdChange(event.target.checked)}
          />
          <span>Run nightly scan automatically (launchd)</span>
        </label>
        {loading && <p className="settings-status">Checking launchd status…</p>}
        {updating && <p className="settings-status">Updating launchd agent…</p>}
        {lastRun && (
          <p className={`settings-status${lastRun.success ? "" : " error"}`}>
            Last run {new Date(lastRun.last_run_ms).toLocaleString()} — {lastRun.success ? "succeeded" : "failed"}
          </p>
        )}
        {!lastRun && lastRunChecked && launchdEnabled && (
          <p className="settings-status">Hasn't run yet.</p>
        )}
        {launchdEnabled && (
          <p className="settings-status">Next run: {nextScheduledRun().toLocaleString()}</p>
        )}
      </section>

      {error && <ErrorModal error={error} onDismiss={() => setError(null)} />}
    </div>
  );
}
