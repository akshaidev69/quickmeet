import { useEffect, useRef, useState } from 'react';
import { Logo, IconMic, IconMicOff, IconCam, IconCamOff } from './icons';
import { LookChoices, ThemeButton } from './LookControls';
import { safeName } from '../lib/code';
import { acquireMedia } from '../lib/media';
import { mountPreview } from '../lib/previewVideo';
import { colorFor, initials } from '../lib/people';
import { useSelfLook } from '../hooks/useSelfLook';
import type { Settings } from '../types';

type Props = {
  code: string;
  settings: Settings;
  onSettings: (settings: Settings) => void;
  onJoin: (stream: MediaStream) => void;
  onBack: () => void;
};

export function LobbyScreen({ code, settings, onSettings, onJoin, onBack }: Props) {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [opening, setOpening] = useState(true);
  const [warning, setWarning] = useState('');
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [nonce, setNonce] = useState(0);
  const previewRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handed = useRef(false);
  const name = safeName(settings.name);

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
    <main className="lobby">
      <section className="lobby-stage">
        <div className="preview">
          <div className="preview-slot" ref={previewRef} />
          {(!camOn || !camReady) && (
            <div className="avatar" style={{ background: colorFor(name) }}>
              {initials(name)}
            </div>
          )}
          <div className="nameplate">
            <span>
              {name}
              {micOn && micReady ? '' : ' · Muted'}
            </span>
          </div>
        </div>
        <LookChoices value={settings.background} onChange={(background) => onSettings({ ...settings, background })} />
        <p className="stage-hint">Real camera unless you pick a background. It changes only your video.</p>
        <MicMeter stream={stream} on={micOn && micReady} />
        <p className="stage-hint">
          {opening
            ? 'Checking your microphone…'
            : micOn && micReady
              ? 'The bar moves when your microphone hears you.'
              : 'Microphone is off.'}
        </p>
      </section>
      <section className="lobby-panel">
        <div className="brand">
          <Logo />
          <strong>QuickMeet</strong>
          <ThemeButton theme={settings.theme} onChange={(theme) => onSettings({ ...settings, theme })} />
        </div>
        <h1>Check your camera, then join</h1>
        <p className="code-lg">{code}</p>
        <label className="field">
          <span>Your name</span>
          <input
            value={settings.name}
            maxLength={40}
            placeholder="Your name"
            onChange={(event) => onSettings({ ...settings, name: event.target.value })}
          />
        </label>
        <div className="lobby-actions">
          <button
            type="button"
            className={opening || (micOn && micReady) ? 'toggle' : 'toggle off'}
            onClick={() => (micReady ? setMicOn((value) => !value) : setNonce((value) => value + 1))}
          >
            {micOn && micReady ? <IconMic /> : <IconMicOff />}
            <span>{opening ? 'Checking mic…' : !micReady ? 'Mic blocked' : micOn ? 'Mic on' : 'Mic off'}</span>
            <small>
              {opening ? 'One moment' : micOn && micReady ? 'People will hear you' : 'People will not hear you'}
            </small>
          </button>
          <button
            type="button"
            className={opening || (camOn && camReady) ? 'toggle' : 'toggle off'}
            onClick={() => (camReady ? setCamOn((value) => !value) : setNonce((value) => value + 1))}
          >
            {camOn && camReady ? <IconCam /> : <IconCamOff />}
            <span>{opening ? 'Checking camera…' : !camReady ? 'Camera blocked' : camOn ? 'Camera on' : 'Camera off'}</span>
            <small>
              {opening ? 'One moment' : camOn && camReady ? 'People will see you' : 'People will not see you'}
            </small>
          </button>
        </div>
        {warning && <p className="warn-text">{warning}</p>}
        <button type="button" className="primary xl" disabled={opening} onClick={join}>
          {opening ? 'Opening camera…' : 'Join meeting'}
        </button>
        <button type="button" className="textbtn back" onClick={onBack}>
          Back
        </button>
      </section>
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
    <span className="meter" aria-hidden="true">
      <span ref={bar} />
    </span>
  );
}
