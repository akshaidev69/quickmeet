import { useEffect, useState } from 'react';
import { downloadBlob, type RecordFile } from '../lib/record';

type Props = {
  files: RecordFile[];
  onClose: () => void;
};

export function RecordingsDialog({ files, onClose }: Props) {
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const file of files) next[file.key] = URL.createObjectURL(file.blob);
    setUrls(next);
    return () => {
      Object.values(next).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [files]);

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div
        className="modal recordings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="recordings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="recordings-title">Recording ready</h2>
          <button type="button" className="textbtn" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="hint">
          Play here in LetsConnect if Windows will not open WebM. ZIP was also downloaded when packing succeeded.
        </p>
        <div className="recordings-grid">
          {files.map((file) => (
            <article key={file.key} className="recording-card">
              <strong>{file.label}</strong>
              {urls[file.key] ? (
                <video src={urls[file.key]} controls playsInline preload="metadata" />
              ) : (
                <p className="empty">Preparing preview…</p>
              )}
              <button type="button" className="secondary slim" onClick={() => downloadBlob(file.blob, file.name)}>
                Save {file.name}
              </button>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
