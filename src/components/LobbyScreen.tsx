import { useEffect, useRef, useState, type ReactNode } from 'react';
import { saveCustomBackground } from '../lib/customBg';
import { Logo, IconMic, IconMicOff, IconCam, IconCamOff, IconLook, IconShield, IconSettings, IconShare } from './icons';
import { LookMenu, ThemeButton } from './LookControls';
import { loadRoomDisplayName, saveRoomDisplayName, safeName } from '../lib/code';
import { acquireMedia, deviceLabel, listDevices, type DeviceLists } from '../lib/media';
import { mountPreview } from '../lib/previewVideo';
import { colorFor, initials } from '../lib/people';
import { loadActiveRoom } from '../lib/storage';
import { useSelfLook } from '../hooks/useSelfLook';
import { useToasts } from '../hooks/useToasts';
import { ComingSoonModal } from './ComingSoonModal';
import type { BackgroundId, Settings } from '../types';

type Props = {
  code: string;
  asHost?: boolean;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  onJoin: (stream: MediaStream) => void;
  onBack: () => void;
};

const BG_CHIPS: { id: BackgroundId; label: string; swatch?: BackgroundId }[] = [
  { id: 'none', label: 'Off' },
  { id: 'blur', label: 'Light blur' },
  { id: 'blurStrong', label: 'Strong blur' },
  { id: 'office', label: 'Office', swatch: 'office' },
  { id: 'studio', label: 'Room', swatch: 'studio' },
  { id: 'home', label: 'Home', swatch: 'home' },
];

function backgroundLabel(id: BackgroundId) {
  if (id === 'none') return 'None';
  if (id === 'blur') return 'Blur';
  if (id === 'custom') return 'Photo';
  const chip = BG_CHIPS.find((item) => item.id === id);
  return chip?.label ?? 'Effect';
}

export function LobbyScreen({ code, asHost = false, settings, onSettings, onJoin, onBack }: Props) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [opening, setOpening] = useState(true);
  const [warning, setWarning] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [lookOpen, setLookOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], cams: [], speakers: [] });
  const [roomLive, setRoomLive] = useState<boolean | null>(null);
  const [soundPlaying, setSoundPlaying] = useState(false);
  const [soundHeard, setSoundHeard] = useState<'yes' | 'no' | null>(null);
  const [camMeta, setCamMeta] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bgFileRef = useRef<HTMLInputElement>(null);
  const handed = useRef(false);
  const [displayName, setDisplayName] = useState(() => loadRoomDisplayName(code, settings.name));
  const [soon, setSoon] = useState<'present' | null>(null);
  const { toasts } = useToasts();
  const name = safeName(displayName);
  const activeRoom = loadActiveRoom();
  const meetingTitle = activeRoom?.code === code ? activeRoom.title?.trim() || '' : '';
  const connection = useConnectionStatus();

  useEffect(() => {
    setDisplayName(loadRoomDisplayName(code, settings.name));
  }, [code, settings.name]);

  useEffect(() => {
    void listDevices().then(setDevices);
  }, [nonce, stream]);

  useEffect(() => {
    let cancel = false;
    let local: MediaStream | null = null;
    setOpening(true);
    void acquireMedia({
      micId: settings.micId,
      camId: settings.camId,
      wantMic: true,
      wantCam: true,
      noise: settings.noiseSuppression,
    }).then((result) => {
      if (cancel || handed.current) {
        result.stream.getTracks().forEach((track) => track.stop());
        return;
      }
      local = result.stream;
      streamRef.current = result.stream;
      setStream(result.stream);
      setWarning(result.warning || '');
      setMicOn(result.audio);
      setCamOn(result.video);
      setOpening(false);
    });
    return () => {
      cancel = true;
      if (!handed.current && local) {
        local.getTracks().forEach((track) => track.stop());
        if (streamRef.current === local) streamRef.current = null;
      }
    };
  }, [nonce, settings.camId, settings.micId, settings.noiseSuppression]);

  useEffect(() => {
    return () => {
      if (!handed.current) streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    stream?.getAudioTracks().forEach((track) => {
      track.enabled = micOn;
    });
  }, [micOn, stream]);

  useEffect(() => {
    stream?.getVideoTracks().forEach((track) => {
      track.enabled = camOn;
    });
  }, [camOn, stream]);

  useEffect(() => {
    const track = stream?.getVideoTracks()[0];
    if (!track) {
      setCamMeta('');
      return;
    }
    const read = () => {
      const s = track.getSettings();
      const w = s.width;
      const h = s.height;
      const fps = s.frameRate ? `${Math.round(s.frameRate)} fps` : '';
      const res = w && h ? `${w}×${h}` : '';
      const mirror = settings.mirror ? 'Mirror on' : 'Mirror off';
      setCamMeta([res, fps, mirror].filter(Boolean).join(' · '));
    };
    read();
    track.addEventListener('ended', read);
    return () => track.removeEventListener('ended', read);
  }, [settings.mirror, stream]);

  useEffect(() => {
    let cancel = false;
    void fetch(`/api/rooms/${encodeURIComponent(code)}`)
      .then((res) => {
        if (!cancel) setRoomLive(res.ok);
      })
      .catch(() => {
        if (!cancel) setRoomLive(null);
      });
    return () => {
      cancel = true;
    };
  }, [code]);

  const micReady = Boolean(stream?.getAudioTracks().length);
  const camReady = Boolean(stream?.getVideoTracks().length);
  const look = useSelfLook(camOn && camReady, settings.background);
  const permissionBlocked = isPermissionDenied(warning);

  useEffect(() => {
    const parent = previewRef.current;
    if (!parent) return;
    return mountPreview(parent, stream, {
      mirror: settings.mirror,
      recordOff: !camOn,
      conceal: Boolean(look.canvas),
    });
  }, [camOn, look.canvas, settings.mirror, stream]);

  useEffect(() => {
    const parent = previewRef.current;
    const canvas = look.canvas;
    if (!parent || !canvas) return;
    canvas.className = `fx-canvas${settings.mirror ? ' mirror' : ''}`;
    parent.appendChild(canvas);
    return () => {
      if (canvas.parentElement === parent) canvas.remove();
    };
  }, [look.canvas, settings.mirror]);

  function join(mode: 'full' | 'audio') {
    if (mode === 'audio') {
      setCamOn(false);
      streamRef.current?.getVideoTracks().forEach((track) => {
        track.enabled = false;
      });
    }
    handed.current = true;
    onJoin(streamRef.current ?? new MediaStream());
  }

  function onTestSound() {
    setSoundHeard(null);
    void playTestTone(settings.speakerId, {
      onStart: () => setSoundPlaying(true),
      onEnd: () => setSoundPlaying(false),
    });
  }

  const primaryLabel = opening
    ? 'Opening camera?'
    : asHost
      ? 'Start meeting'
      : 'Join now';

  return (
    <main className="lobby meet-lobby">
      <header className="prejoin-top lobby-top">
        <div className="prejoin-brand lobby-top-brand">
          <Logo size={28} />
          <strong>LetsConnect</strong>
        </div>
        <div className="prejoin-top-end">
          <span className="prejoin-trust-pill">
            <IconShield />
            Peer-to-peer · encrypted in transit
          </span>
          <div className="prejoin-avatar" style={{ background: colorFor(name) }} aria-hidden="true">
            {initials(name)}
          </div>
        </div>
      </header>

      <div className="prejoin-body lobby-body">
        <section className="prejoin-stage lobby-stage">
          <div className="prejoin-preview preview meet-preview">
            <div className="preview-slot" ref={previewRef} />
            {(!camOn || !camReady) && (
              <div className="preview-empty">
                {warning && !camReady ? (
                  <>
                    <strong>Camera unavailable</strong>
                    <p>{warning}</p>
                    <button type="button" className="secondary slim" onClick={() => setNonce((value) => value + 1)}>
                      Try again
                    </button>
                  </>
                ) : (
                  <div className="avatar" style={{ background: colorFor(name) }}>
                    {initials(name)}
                  </div>
                )}
              </div>
            )}

            <PrejoinMicPill stream={stream} micOn={micOn && micReady} micReady={micReady} />

            <span className="prejoin-bg-pill">Background: {backgroundLabel(settings.background)}</span>

            <div className="prejoin-preview-controls preview-controls">
              <button
                type="button"
                className={`prejoin-ctl round-ctl${micOn && micReady ? '' : ' off'}`}
                aria-label={micOn ? 'Turn microphone off' : 'Turn microphone on'}
                onClick={() => (micReady ? setMicOn((value) => !value) : setNonce((value) => value + 1))}
              >
                {micOn && micReady ? <IconMic /> : <IconMicOff />}
                <span>{micOn && micReady ? 'Mic on' : 'Mic off'}</span>
              </button>
              <button
                type="button"
                className={`prejoin-ctl round-ctl${camOn && camReady ? '' : ' off'}`}
                aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
                onClick={() => (camReady ? setCamOn((value) => !value) : setNonce((value) => value + 1))}
              >
                {camOn && camReady ? <IconCam /> : <IconCamOff />}
                <span>{camOn && camReady ? 'Camera on' : 'Camera off'}</span>
              </button>
              <div className="cmdwrap">
                <button
                  type="button"
                  className={`prejoin-ctl round-ctl${settings.background !== 'none' || lookOpen ? ' live' : ''}`}
                  aria-label="Background effects"
                  aria-expanded={lookOpen}
                  onClick={() => {
                    setSettingsOpen(false);
                    setLookOpen((value) => !value);
                  }}
                >
                  <IconLook />
                  <span>Effects</span>
                </button>
                {lookOpen && (
                  <LookMenu
                    value={settings.background}
                    status={look.status}
                    onChange={(background) => {
                      onSettings({ ...settings, background });
                      setLookOpen(false);
                    }}
                  />
                )}
              </div>
              <div className="cmdwrap">
                <button
                  type="button"
                  className={`prejoin-ctl round-ctl${settingsOpen ? ' live' : ''}`}
                  aria-label="Settings"
                  aria-expanded={settingsOpen}
                  onClick={() => {
                    setLookOpen(false);
                    setSettingsOpen((value) => !value);
                  }}
                >
                  <IconSettings />
                  <span>Settings</span>
                </button>
                {settingsOpen && (
                  <div className="popover prejoin-settings-pop" role="dialog" aria-label="Pre-join settings">
                    <p className="prejoin-settings-title">Audio &amp; display</p>
                    <label className="prejoin-check">
                      <input
                        type="checkbox"
                        checked={settings.noiseSuppression}
                        onChange={(event) => onSettings({ ...settings, noiseSuppression: event.target.checked })}
                      />
                      Noise suppression
                    </label>
                    <label className="prejoin-check">
                      <input
                        type="checkbox"
                        checked={settings.mirror}
                        onChange={(event) => onSettings({ ...settings, mirror: event.target.checked })}
                      />
                      Mirror my video
                    </label>
                    <label className="prejoin-check">
                      <input
                        type="checkbox"
                        checked={settings.sounds}
                        onChange={(event) => onSettings({ ...settings, sounds: event.target.checked })}
                      />
                      Meeting sounds
                    </label>
                    <ThemeButton theme={settings.theme} onChange={(theme) => onSettings({ ...settings, theme })} />
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="prejoin-devices">
            <article className="prejoin-device-card">
              <header>
                <IconMic />
                <span>Microphone</span>
              </header>
              <select
                value={settings.micId}
                aria-label="Microphone"
                onChange={(event) => {
                  onSettings({ ...settings, micId: event.target.value });
                  setNonce((value) => value + 1);
                }}
              >
                <option value="">Default microphone</option>
                {devices.mics.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {deviceLabel(device, index, 'Mic')}
                  </option>
                ))}
              </select>
              <MicLevelBars stream={stream} on={micOn && micReady} />
            </article>

            <article className="prejoin-device-card">
              <header>
                <span className="prejoin-speaker-icon" aria-hidden="true">
                  ?
                </span>
                <span>Speaker</span>
              </header>
              <select
                value={settings.speakerId}
                aria-label="Speaker"
                onChange={(event) => onSettings({ ...settings, speakerId: event.target.value })}
              >
                <option value="">Default speaker</option>
                {devices.speakers.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {deviceLabel(device, index, 'Speaker')}
                  </option>
                ))}
              </select>
              <button type="button" className="prejoin-test-sound" disabled={soundPlaying} onClick={onTestSound}>
                {soundPlaying ? 'Playing…' : 'Play test sound'}
              </button>
            </article>

            <article className="prejoin-device-card">
              <header>
                <IconCam />
                <span>Camera</span>
              </header>
              <select
                value={settings.camId}
                aria-label="Camera"
                onChange={(event) => {
                  onSettings({ ...settings, camId: event.target.value });
                  setNonce((value) => value + 1);
                }}
              >
                <option value="">Default camera</option>
                {devices.cams.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {deviceLabel(device, index, 'Camera')}
                  </option>
                ))}
              </select>
              <p className="prejoin-cam-meta">{camMeta || (camReady ? 'Camera ready' : 'No camera')}</p>
            </article>
          </div>

          <div className="prejoin-bg-panel">
            <p className="prejoin-bg-title">
              Background: <span>Pick a look before you join</span>
            </p>
            <div className="prejoin-bg-chips" role="group" aria-label="Background">
              {BG_CHIPS.map((chip) => (
                <button
                  key={chip.id}
                  type="button"
                  className={settings.background === chip.id ? 'on' : ''}
                  aria-pressed={settings.background === chip.id}
                  onClick={() => onSettings({ ...settings, background: chip.id })}
                >
                  {chip.swatch ? <i className={`swatch swatch-${chip.swatch}`} aria-hidden="true" /> : null}
                  {chip.label}
                </button>
              ))}
              <button
                type="button"
                className={settings.background === 'custom' ? 'on' : ''}
                aria-pressed={settings.background === 'custom'}
                onClick={() => bgFileRef.current?.click()}
              >
                +
              </button>
              <input
                ref={bgFileRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (!file) return;
                  void saveCustomBackground(file).then(() => onSettings({ ...settings, background: 'custom' }));
                }}
              />
            </div>
          </div>
        </section>

        <section className="prejoin-aside lobby-panel meet-join">
          {roomLive && !asHost ? (
            <p className="prejoin-live-kicker">
              <i className="prejoin-live-dot" aria-hidden="true" />
              Meeting in progress
            </p>
          ) : null}

          <h1>{asHost ? 'Ready to start?' : 'Ready to join?'}</h1>
          {meetingTitle ? <p className="prejoin-meeting-title">{meetingTitle}</p> : null}
          <p className="prejoin-code-line">
            Meeting code <code className="prejoin-code">{code}</code>
          </p>

          <p className="prejoin-presence">
            {roomLive && !asHost ? 'Others may already be in the call.' : "You'll be the first — others can join with the link."}
          </p>

          <label className="field prejoin-name-field">
            <span>Your name</span>
            <input
              value={displayName}
              maxLength={40}
              placeholder="How people see you"
              onChange={(event) => {
                const next = event.target.value;
                setDisplayName(next);
                saveRoomDisplayName(code, next);
              }}
            />
          </label>

          <ul className="prejoin-checklist" aria-label="Join readiness">
            <ChecklistRow
              ok={camReady && camOn}
              warn={camReady && !camOn}
              title="Camera works"
              detail={camReady ? (camOn ? 'Good to go' : 'Camera is off') : 'Allow camera access'}
            />
            <ChecklistRow
              ok={micReady && micOn}
              warn={micReady && !micOn}
              title="Microphone works"
              detail={micReady ? (settings.noiseSuppression ? 'Noise suppression on' : 'Mic ready') : 'Allow microphone access'}
            />
            <ChecklistRow
              ok={soundHeard === 'yes'}
              warn={soundHeard === 'no'}
              pending={soundHeard === null && !soundPlaying}
              title="Test sound"
              detail={
                soundHeard === 'yes'
                  ? 'Speaker check passed'
                  : soundHeard === 'no'
                    ? 'Try another speaker or volume'
                    : 'Did you hear the test sound? Check your speaker before joining.'
              }
              action={
                <span className="prejoin-sound-answer">
                  <button type="button" onClick={() => setSoundHeard('yes')}>
                    Yes
                  </button>
                  <span aria-hidden="true">·</span>
                  <button type="button" onClick={() => setSoundHeard('no')}>
                    No
                  </button>
                </span>
              }
            />
            <ChecklistRow
              ok
              title="Connection"
              detail={
                connection.detail
                  ? `Connection is good. ${connection.detail}`
                  : 'Ready for video when you join'
              }
            />
          </ul>

          {warning && !permissionBlocked ? <p className="warn-text">{warning}</p> : null}

          <div className="prejoin-actions lobby-cta">
            <button type="button" className="primary xl prejoin-join-primary" disabled={opening} onClick={() => join('full')}>
              {primaryLabel}
            </button>
            <div className="prejoin-secondary-actions">
              <button type="button" className="secondary" disabled={opening} onClick={() => join('audio')}>
                Join audio only
              </button>
              <button
                type="button"
                className="secondary prejoin-present"
                disabled={opening}
                onClick={() => setSoon('present')}
              >
                <IconShare />
                Join &amp; present
              </button>
            </div>
            <button type="button" className="textbtn prejoin-back" onClick={onBack}>
              {asHost ? 'Back to home' : 'Other ways to join'}
            </button>
          </div>

          {permissionBlocked ? <PermissionHelp /> : null}
        </section>
      </div>

      {soon === 'present' && <ComingSoonModal kind="present" onClose={() => setSoon(null)} />}

      {toasts.length > 0 && (
        <div className="toasts meet-lobby-toasts" aria-live="polite">
          {toasts.map((item) => (
            <div key={item.id} className="toast">
              {item.text}
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function ChecklistRow({
  ok,
  warn,
  pending,
  title,
  detail,
  action,
}: {
  ok?: boolean;
  warn?: boolean;
  pending?: boolean;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  const state = ok ? 'ok' : warn ? 'warn' : pending ? 'pending' : 'idle';
  return (
    <li className={`prejoin-check-item ${state}`}>
      <span className="prejoin-check-icon" aria-hidden="true" />
      <div className="prejoin-check-copy">
        <strong>{title}</strong>
        <span>{detail}</span>
      </div>
      {action}
    </li>
  );
}

function useConnectionStatus() {
  const [detail, setDetail] = useState('');
  useEffect(() => {
    type NetConn = {
      rtt?: number;
      effectiveType?: string;
      downlink?: number;
      addEventListener: (type: string, fn: () => void) => void;
      removeEventListener: (type: string, fn: () => void) => void;
    };
    const conn = (navigator as Navigator & { connection?: NetConn }).connection;
    if (!conn) return;
    const refresh = () => {
      const parts: string[] = [];
      if (typeof conn.rtt === 'number' && conn.rtt > 0) parts.push(`${Math.round(conn.rtt)} ms`);
      if (typeof conn.downlink === 'number' && conn.downlink > 0) parts.push(`${conn.downlink} Mbps`);
      setDetail(parts.join(' · ') || 'Ready');
    };
    refresh();
    conn.addEventListener('change', refresh);
    return () => conn.removeEventListener('change', refresh);
  }, []);
  return { detail };
}

function isPermissionDenied(warning: string) {
  return /permission|denied|blocked|not allowed/i.test(warning);
}

async function playTestTone(
  sinkId: string,
  hooks?: { onStart?: () => void; onEnd?: () => void },
) {
  hooks?.onStart?.();
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = 880;
    gain.gain.value = 0.08;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const dest = ctx.createMediaStreamDestination();
    gain.connect(dest);
    const audio = new Audio();
    audio.srcObject = dest.stream;
    const sink = audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (sinkId && sink.setSinkId) await sink.setSinkId(sinkId).catch(() => undefined);
    await audio.play().catch(() => undefined);
    await ctx.resume();
    osc.start();
    window.setTimeout(() => {
      osc.stop();
      void ctx.close();
      audio.srcObject = null;
      hooks?.onEnd?.();
    }, 450);
  } catch {
    hooks?.onEnd?.();
  }
}

function PermissionHelp() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'your browser';
  return (
    <aside className="permission-help prejoin-permission" role="note">
      <strong>Camera or mic blocked?</strong>
      <ol>
        <li>
          Click the <strong>lock icon</strong> left of the address bar in {browser}.
        </li>
        <li>
          Set Camera and Microphone to <strong>Allow</strong>, then reload.
        </li>
      </ol>
    </aside>
  );
}

function PrejoinMicPill({
  stream,
  micOn,
  micReady,
}: {
  stream: MediaStream | null;
  micOn: boolean;
  micReady: boolean;
}) {
  const barsRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track || !micOn || !micReady) return;
    const ctx = new AudioContext();
    const clone = track.clone();
    const source = ctx.createMediaStreamSource(new MediaStream([clone]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const delta = (value - 128) / 128;
        sum += delta * delta;
      }
      const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
      if (barsRef.current) barsRef.current.style.setProperty('--mic-level', String(0.15 + level * 0.85));
      frame = requestAnimationFrame(tick);
    };
    void ctx.resume();
    tick();
    return () => {
      cancelAnimationFrame(frame);
      clone.stop();
      void ctx.close();
    };
  }, [micOn, micReady, stream]);

  const label = !micReady ? 'Mic unavailable' : micOn ? 'Mic is picking you up' : 'Mic is muted';

  return (
    <span className="prejoin-mic-pill">
      {micOn && micReady ? <IconMic /> : <IconMicOff />}
      <span>{label}</span>
      <span className="prejoin-mic-bars" ref={barsRef} aria-hidden="true">
        <i />
        <i />
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

function MicLevelBars({ stream, on }: { stream: MediaStream | null; on: boolean }) {
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track || !on) return;
    const ctx = new AudioContext();
    const clone = track.clone();
    const source = ctx.createMediaStreamSource(new MediaStream([clone]));
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let frame = 0;
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const value of data) {
        const delta = (value - 128) / 128;
        sum += delta * delta;
      }
      const level = Math.min(1, Math.sqrt(sum / data.length) * 4);
      if (bar.current) bar.current.style.transform = `scaleX(${0.08 + level * 0.92})`;
      frame = requestAnimationFrame(tick);
    };
    void ctx.resume();
    tick();
    return () => {
      cancelAnimationFrame(frame);
      clone.stop();
      void ctx.close();
    };
  }, [on, stream]);
  return (
    <span className="prejoin-mic-meter meter" aria-hidden="true">
      <span ref={bar} />
    </span>
  );
}
