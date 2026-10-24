import { useEffect, useRef, useState } from 'react';
import { clearCustomBackground, loadCustomBackground, saveCustomBackground } from '../lib/customBg';
import type { LookStatus } from '../lib/look';
import type { BackgroundId, ThemeMode } from '../types';

export const looks: { id: BackgroundId; label: string }[] = [
  { id: 'none', label: 'Real' },
  { id: 'blur', label: 'Blur' },
  { id: 'office', label: 'Office' },
  { id: 'studio', label: 'Room' },
  { id: 'home', label: 'Home' },
  { id: 'custom', label: 'Photo' },
];

export function ThemeButton({ theme, onChange }: { theme: ThemeMode; onChange: (theme: ThemeMode) => void }) {
  const next = theme === 'dark' ? 'light' : 'dark';
  return (
    <button
      type="button"
      className="secondary slim theme-toggle"
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      onClick={() => onChange(next)}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}

function useHasCustomPhoto() {
  const [has, setHas] = useState(false);
  useEffect(() => {
    void loadCustomBackground().then((image) => setHas(Boolean(image)));
  }, []);
  return [has, setHas] as const;
}

export function LookChoices({
  value,
  onChange,
}: {
  value: BackgroundId;
  onChange: (background: BackgroundId) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [hasPhoto, setHasPhoto] = useHasCustomPhoto();
  const [error, setError] = useState('');

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      await saveCustomBackground(file);
      setHasPhoto(true);
      onChange('custom');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that image');
    }
  }

  return (
    <div className="look-block">
      <div className="look-row" role="group" aria-label="Your background">
        {looks.map((item) => (
          <button
            key={item.id}
            type="button"
            className={value === item.id ? 'on' : ''}
            aria-pressed={value === item.id}
            onClick={() => {
              if (item.id === 'custom' && !hasPhoto) {
                fileRef.current?.click();
                return;
              }
              onChange(item.id);
            }}
          >
            <i className={`swatch swatch-${item.id}`} />
            {item.label}
          </button>
        ))}
      </div>
      <div className="look-upload">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <button type="button" className="secondary slim" onClick={() => fileRef.current?.click()}>
          Upload photo
        </button>
        {hasPhoto && (
          <button
            type="button"
            className="textbtn"
            onClick={() => {
              void clearCustomBackground().then(() => {
                setHasPhoto(false);
                if (value === 'custom') onChange('none');
              });
            }}
          >
            Remove photo
          </button>
        )}
      </div>
      {error && <p className="warn-text">{error}</p>}
    </div>
  );
}

export function LookMenu({
  value,
  status,
  onChange,
}: {
  value: BackgroundId;
  status: LookStatus;
  onChange: (background: BackgroundId) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [hasPhoto, setHasPhoto] = useHasCustomPhoto();
  const [error, setError] = useState('');

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError('');
    try {
      await saveCustomBackground(file);
      setHasPhoto(true);
      onChange('custom');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not use that image');
    }
  }

  return (
    <div className="popover look-pop" role="menu" aria-label="Background">
      <p>Only your video changes. Everyone else stays on their real camera unless they pick a background too.</p>
      <div className="look-grid">
        {looks.map((item) => (
          <button
            key={item.id}
            type="button"
            className={value === item.id ? 'on' : ''}
            aria-pressed={value === item.id}
            onClick={() => {
              if (item.id === 'custom' && !hasPhoto) {
                fileRef.current?.click();
                return;
              }
              onChange(item.id);
            }}
          >
            <i className={`swatch swatch-${item.id}`} />
            <strong>{item.label}</strong>
          </button>
        ))}
      </div>
      <div className="look-upload">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
            event.target.value = '';
          }}
        />
        <button type="button" className="secondary slim" onClick={() => fileRef.current?.click()}>
          Upload your own photo
        </button>
        {hasPhoto && (
          <button
            type="button"
            className="textbtn"
            onClick={() => {
              void clearCustomBackground().then(() => {
                setHasPhoto(false);
                if (value === 'custom') onChange('none');
              });
            }}
          >
            Remove
          </button>
        )}
      </div>
      {error && <p className="warn-text">{error}</p>}
      {status === 'loading' && <p className="fine">Preparing your background. The real camera stays up until it is ready.</p>}
      {status === 'fallback' && <p className="fine">Could not separate you from the room, so your real camera stays in the frame.</p>}
    </div>
  );
}
