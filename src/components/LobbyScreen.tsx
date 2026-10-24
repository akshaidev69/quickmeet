import { useEffect, useRef, useState } from 'react';
import { Logo, IconMic, IconMicOff, IconCam, IconCamOff, IconLook } from './icons';
import { LookMenu, ThemeButton } from './LookControls';
import { safeName } from '../lib/code';
import { acquireMedia, deviceLabel, listDevices, type DeviceLists } from '../lib/media';
import { mountPreview } from '../lib/previewVideo';
import { colorFor, initials } from '../lib/people';
import { useSelfLook } from '../hooks/useSelfLook';
import type { Settings } from '../types';

type Props = {
  code: string;
  asHost?: boolean;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  onJoin: (stream: MediaStream) => void;
  onBack: () => void;
};

export function LobbyScreen({ code, asHost = false, settings, onSettings, onJoin, onBack }: Props) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [opening, setOpening] = useState(true);
  const [warning, setWarning] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [nonce, setNonce] = useState(0);
  const [lookOpen, setLookOpen] = useState(false);
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], cams: [], speakers: [] });
  const previewRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handed = useRef(false);
  const name = safeName(settings.name);

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

  const micReady = Boolean(stream?.getAudioTracks().length);
  const camReady = Boolean(stream?.getVideoTracks().length);
  const look = useSelfLook(camOn && camReady, settings.background);

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

  function join() {
    handed.current = true;
    onJoin(streamRef.current ?? new MediaStream());
  }

  return (
    <main className="lobby meet-lobby">
      <header className="lobby-top">
        <div className="lobby-top-brand">
          <Logo size={26} />
          <strong>LetsConnect</strong>
          <code>{code}</code>
        </div>
        <ThemeButton theme={settings.theme} onChange={(theme) => onSettings({ ...settings, theme })} />
      </header>

      <div className="lobby-body">
        <section className="lobby-stage">
          <div className="preview meet-preview">
            <div className="preview-slot" ref={previewRef} />
            {(!camOn || !camReady) && (
              <div className="preview-empty">
                {warning ? (
                  <>
                    <strong>{camReady ? 'Camera off' : 'Camera unavailable'}</strong>
                    <p>{warning}</p>
                    {!camReady && (
                      <button type="button" className="secondary slim" onClick={() => setNonce((value) => value + 1)}>
                        Try again
                      </button>
                    )}
                  </>
                ) : (
                  <div className="avatar" style={{ background: colorFor(name) }}>
                    {initials(name)}
                  </div>
                )}
              </div>
            )}
            <div className="nameplate">
              <span>
                {name}
                {micOn && micReady ? '' : ' · Muted'}
              </span>
            </div>
            <div className="preview-controls">
              <button
                type="button"
                className={micOn && micReady ? 'round-ctl' : 'round-ctl off'}
                aria-label={micOn ? 'Turn microphone off' : 'Turn microphone on'}
                onClick={() => (micReady ? setMicOn((value) => !value) : setNonce((value) => value + 1))}
              >
                {micOn && micReady ? <IconMic /> : <IconMicOff />}
              </button>
              <button
                type="button"
                className={camOn && camReady ? 'round-ctl' : 'round-ctl off'}
                aria-label={camOn ? 'Turn camera off' : 'Turn camera on'}
                onClick={() => (camReady ? setCamOn((value) => !value) : setNonce((value) => value + 1))}
              >
                {camOn && camReady ? <IconCam /> : <IconCamOff />}
              </button>
              <div className="cmdwrap">
                <button
                  type="button"
                  className={settings.background !== 'none' || lookOpen ? 'round-ctl live' : 'round-ctl'}
                  aria-label="Background effects"
                  onClick={() => setLookOpen((value) => !value)}
                >
                  <IconLook />
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
            </div>
          </div>

          <div className="device-row">
            <label>
              <span>Microphone</span>
              <select
                value={settings.micId}
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
            </label>
            <label>
              <span>Speaker</span>
              <select
                value={settings.speakerId}
                onChange={(event) => onSettings({ ...settings, speakerId: event.target.value })}
              >
                <option value="">Default speaker</option>
                {devices.speakers.map((device, index) => (
                  <option key={device.deviceId || index} value={device.deviceId}>
                    {deviceLabel(device, index, 'Speaker')}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Camera</span>
              <select
                value={settings.camId}
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
            </label>
          </div>
          <MicMeter stream={stream} on={micOn && micReady} />
        </section>

        <section className="lobby-panel meet-join">
          <p className="ready-kicker">Meeting · {code}</p>
          <h1>{asHost ? 'Ready to start?' : 'Ready to join?'}</h1>
          <p className="ready-sub">
            {opening
              ? 'Checking your camera and microphone\u2026'
              : asHost
                ? 'You are the host. Start the meeting, then share the link ? guests wait until you admit them.'
                : 'You will knock first. The host or a co-host admits you into the room.'}
          </p>
          <label className="field">
            <span>Your name</span>
            <input
              value={settings.name}
              maxLength={40}
              placeholder="How people see you"
              onChange={(event) => onSettings({ ...settings, name: event.target.value })}
            />
          </label>
          {warning && <p className="warn-text">{warning}</p>}
          <button type="button" className="primary xl ask-join" disabled={opening} onClick={join}>
            {opening ? 'Opening camera\u2026' : asHost ? 'Start meeting' : 'Ask to join'}
          </button>
          <button type="button" className="secondary join-other" onClick={onBack}>
            {asHost ? 'Back to home' : 'Other ways to join'}
          </button>
          <p className="ready-note">Use headphones if another LetsConnect window is open on this computer.</p>
        </section>
      </div>
    </main>
  );
}

function MicMeter({ stream, on }: { stream: MediaStream | null; on: boolean }) {
  const bar = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    if (!track || !on) return;
    const ctx = new AudioContext();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
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
      if (bar.current) bar.current.style.transform = `scaleX(${0.06 + level})`;
      frame = requestAnimationFrame(tick);
    };
    void ctx.resume();
    tick();
    return () => {
      cancelAnimationFrame(frame);
      void ctx.close();
    };
  }, [on, stream]);
  return (
    <span className="meter lobby-meter" aria-hidden="true">
      <span ref={bar} />
    </span>
  );
}
