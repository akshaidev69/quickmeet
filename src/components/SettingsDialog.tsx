import { useEffect, useState } from 'react';
import { LookChoices, ThemeButton } from './LookControls';
import { deviceLabel, listDevices, type DeviceLists } from '../lib/media';
import type { Settings } from '../types';

type Props = {
  settings: Settings;
  onChange: (settings: Settings) => void;
  onClose: () => void;
  onRetry?: () => void;
};

export function SettingsDialog({ settings, onChange, onClose, onRetry }: Props) {
  const [devices, setDevices] = useState<DeviceLists>({ mics: [], cams: [], speakers: [] });
  const speakers =
    typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

  useEffect(() => {
    void listDevices().then(setDevices);
  }, []);

  function patch(partial: Partial<Settings>) {
    onChange({ ...settings, ...partial });
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="settings-title">Audio and video</h2>
          <button type="button" className="textbtn" onClick={onClose}>
            Close
          </button>
        </header>
        <label className="field">
          <span>Your name</span>
          <input
            value={settings.name}
            maxLength={40}
            onChange={(event) => patch({ name: event.target.value })}
          />
        </label>
        <div className="field">
          <span>Appearance</span>
          <ThemeButton theme={settings.theme} onChange={(theme) => patch({ theme })} />
        </div>
        <div className="field">
          <span>Your background</span>
          <LookChoices value={settings.background} onChange={(background) => patch({ background })} />
          <p className="hint">Starts on your real camera. A background changes only your video.</p>
        </div>
        <label className="field">
          <span>Microphone</span>
          <select value={settings.micId} onChange={(event) => patch({ micId: event.target.value })}>
            <option value="">System default</option>
            {devices.mics.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {deviceLabel(device, index, 'Microphone')}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Camera</span>
          <select value={settings.camId} onChange={(event) => patch({ camId: event.target.value })}>
            <option value="">System default</option>
            {devices.cams.map((device, index) => (
              <option key={device.deviceId} value={device.deviceId}>
                {deviceLabel(device, index, 'Camera')}
              </option>
            ))}
          </select>
        </label>
        {speakers && (
          <label className="field">
            <span>Speaker</span>
            <select value={settings.speakerId} onChange={(event) => patch({ speakerId: event.target.value })}>
              <option value="">System default</option>
              {devices.speakers.map((device, index) => (
                <option key={device.deviceId} value={device.deviceId}>
                  {deviceLabel(device, index, 'Speaker')}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={settings.noiseSuppression}
            onChange={(event) => patch({ noiseSuppression: event.target.checked })}
          />
          <span>Reduce background noise</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.mirror}
            onChange={(event) => patch({ mirror: event.target.checked })}
          />
          <span>Mirror my video. Other people still see it the normal way.</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.sounds}
            onChange={(event) => patch({ sounds: event.target.checked })}
          />
          <span>Play a soft sound when someone joins or sends a chat</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.instantJoin}
            onChange={(event) => patch({ instantJoin: event.target.checked })}
          />
          <span>Skip the camera check and join immediately next time</span>
        </label>
        {onRetry && (
          <button type="button" className="secondary" onClick={onRetry}>
            Retry camera and microphone
          </button>
        )}
      </div>
    </div>
  );
}
