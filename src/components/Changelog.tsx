import { invoke } from '@tauri-apps/api/core';
import { useEffect, useState } from 'react';
import { ArrowLeftIcon } from '@heroicons/react/16/solid';

interface Entry { hash: string; message: string; date: string; }

interface Props {
  onBack: () => void;
}

export function Changelog({ onBack }: Props) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    invoke<Entry[]>('get_changelog')
      .then(setEntries)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  return (
    <div style={{ padding: '1.5rem', fontFamily: 'monospace', overflowY: 'auto', height: '100vh' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.5rem' }}>
        <button onClick={onBack} className="btn-ghost" style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <ArrowLeftIcon style={{ width: '1rem', height: '1rem' }} />
          Back
        </button>
        <h2 style={{ margin: 0 }}>Changelog</h2>
      </div>
      {error && (
        <p style={{ color: '#c04040' }}>Failed to load changelog: {error}</p>
      )}
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {entries.map(e => (
          <li key={e.hash} style={{ marginBottom: '0.5rem', lineHeight: 1.6 }}>
            <span style={{ opacity: 0.6 }}>{e.date}</span>{' '}
            <code style={{ background: 'rgba(255,255,255,0.08)', padding: '0.1em 0.4em', borderRadius: '3px' }}>{e.hash}</code>{' '}
            {e.message}
          </li>
        ))}
        {entries.length === 0 && !error && (
          <li style={{ opacity: 0.5 }}>Loading…</li>
        )}
      </ul>
    </div>
  );
}
