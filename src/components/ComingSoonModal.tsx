type Kind = 'present' | 'rooms';

const COPY: Record<Kind, { title: string; points: string[] }> = {
  present: {
    title: 'Join & present',
    points: [
      'Share slides or your screen as you enter the meeting',
      'Your presentation opens on the main stage for everyone',
      'You stay in control of camera, mic, and who can see the slides',
    ],
  },
  rooms: {
    title: 'Breakout rooms',
    points: [
      'Split one meeting into smaller rooms for group work',
      'Host and co-hosts can move people between rooms',
      'Bring everyone back to the main room when you are ready',
    ],
  },
};

type Props = {
  kind: Kind;
  onClose: () => void;
};

export function ComingSoonModal({ kind, onClose }: Props) {
  const copy = COPY[kind];
  return (
    <div className="modal-back coming-soon-back" role="presentation" onClick={onClose}>
      <div
        className="modal coming-soon-modal"
        role="dialog"
        aria-labelledby="coming-soon-title"
        onClick={(event) => event.stopPropagation()}
      >
        <p className="coming-soon-kicker">Coming soon</p>
        <h2 id="coming-soon-title">{copy.title}</h2>
        <p className="hint">This is on the LetsConnect roadmap. Here is what it will do when it ships.</p>
        <ul className="coming-soon-list">
          {copy.points.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <button type="button" className="primary coming-soon-ok" onClick={onClose}>
          Got it
        </button>
      </div>
    </div>
  );
}
