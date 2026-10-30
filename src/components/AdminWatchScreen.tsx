import { useEffect, useRef } from 'react';
import { useRoom } from '../hooks/useRoom';
import { loadSettings } from '../lib/storage';
import { colorFor, initials } from '../lib/people';
import { Logo } from './icons';

type Props = {
  code: string;
  onLeave: () => void;
};

export function AdminWatchScreen({ code, onLeave }: Props) {
  const settings = loadSettings();
  const room = useRoom({
    code,
    name: 'Operator',
    stream: null,
    micOn: false,
    camOn: false,
    hand: false,
    sharing: false,
    recording: false,
    claimHost: false,
    silent: true,
    onMeetingEnded: onLeave,
  });

  const tiles = room.peers.flatMap((peer) => {
    const items: { id: string; name: string; stream: MediaStream | null; show: boolean }[] = [
      {
        id: `${peer.id}-cam`,
        name: peer.name,
        stream: peer.camera,
        show: peer.camOn && Boolean(peer.camera?.getVideoTracks().length),
      },
    ];
    if (peer.screen?.getVideoTracks().some((track) => track.readyState === 'live')) {
      items.push({
        id: `${peer.id}-screen`,
        name: `${peer.name}'s screen`,
        stream: peer.screen,
        show: true,
      });
    }
    return items;
  });

  return (
    <main className="admin-watch">
      <header className="admin-watch-top">
        <div className="admin-brand">
          <Logo size={24} />
          <div>
            <strong>Silent watch · {code}</strong>
            <p>People in the call cannot see that you joined.</p>
          </div>
        </div>
        <div className="admin-top-actions">
          <span className="hint">
            {room.gate === 'denied'
              ? 'Could not join this room'
              : room.gate === 'admitted'
                ? `${room.peers.length} visible ${room.peers.length === 1 ? 'person' : 'people'}`
                : 'Connecting…'}
          </span>
          <button type="button" className="secondary" onClick={onLeave}>
            Leave quietly
          </button>
        </div>
      </header>

      <section className="admin-watch-stage" data-empty={tiles.length === 0 ? '1' : '0'}>
        {tiles.length === 0 ? (
          <p className="hint">Waiting for video from the call…</p>
        ) : (
          tiles.map((tile) => <WatchTile key={tile.id} name={tile.name} stream={tile.stream} show={tile.show} />)
        )}
      </section>

      {room.peers.map((peer) => (
        <WatchAudio key={peer.id} stream={peer.audio} sinkId={settings.speakerId} />
      ))}

      <aside className="admin-watch-chat">
        <h2>Chat</h2>
        {room.chat.length === 0 ? (
          <p className="hint">No messages yet.</p>
        ) : (
          <ul>
            {room.chat
              .filter((item) => !item.system)
              .slice(-40)
              .map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong>
                  <span>{item.text}</span>
                </li>
              ))}
          </ul>
        )}
      </aside>
    </main>
  );
}

function WatchTile({ name, stream, show }: { name: string; stream: MediaStream | null; show: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.muted = true;
    void el.play().catch(() => undefined);
  }, [stream, show]);
  const letters = initials(name.replace(/'s screen$/, ''));
  return (
    <article className="admin-watch-tile" data-kind={name.endsWith('screen') ? 'screen' : 'camera'}>
      <video ref={ref} autoPlay playsInline muted hidden={!show} />
      {!show ? (
        <div className="admin-watch-avatar" style={{ background: colorFor(name) }}>
          {letters}
        </div>
      ) : null}
      <span>{name}</span>
    </article>
  );
}

function WatchAudio({ stream, sinkId }: { stream: MediaStream | null; sinkId?: string }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = stream;
    el.muted = false;
    el.volume = 1;
    const withSink = el as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (sinkId && withSink.setSinkId) void withSink.setSinkId(sinkId).catch(() => undefined);
    void el.play().catch(() => undefined);
  }, [sinkId, stream]);
  return <audio ref={ref} autoPlay />;
}
