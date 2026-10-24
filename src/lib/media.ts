export type AcquireResult = {
  stream: MediaStream;
  video: boolean;
  audio: boolean;
  warning?: string;
};

export type DeviceLists = {
  mics: MediaDeviceInfo[];
  cams: MediaDeviceInfo[];
  speakers: MediaDeviceInfo[];
};

type AcquireOptions = {
  micId: string;
  camId: string;
  wantMic: boolean;
  wantCam: boolean;
  noise: boolean;
};

function audioConstraints(opts: AcquireOptions, exact: boolean): MediaTrackConstraints | boolean {
  return {
    echoCancellation: true,
    noiseSuppression: opts.noise,
    autoGainControl: true,
    ...(exact && opts.micId ? { deviceId: { exact: opts.micId } } : {}),
  };
}

function videoConstraints(opts: AcquireOptions, exact: boolean): MediaTrackConstraints | boolean {
  return {
    width: { ideal: 960 },
    height: { ideal: 540 },
    frameRate: { ideal: 30, max: 30 },
    ...(exact && opts.camId ? { deviceId: { exact: opts.camId } } : {}),
  };
}

function applyEnabled(stream: MediaStream, opts: AcquireOptions) {
  stream.getAudioTracks().forEach((track) => {
    track.enabled = opts.wantMic;
  });
  stream.getVideoTracks().forEach((track) => {
    try {
      track.contentHint = 'motion';
    } catch {
      /* ignore */
    }
    track.enabled = opts.wantCam;
  });
}

async function tryGet(audio: boolean | MediaTrackConstraints, video: boolean | MediaTrackConstraints) {
  return navigator.mediaDevices.getUserMedia({ audio, video });
}

export async function acquireMedia(opts: AcquireOptions): Promise<AcquireResult> {
  if (!window.isSecureContext) {
    return {
      stream: new MediaStream(),
      video: false,
      audio: false,
      warning: 'The camera only opens on localhost, or on an https address. You can still use chat.',
    };
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      stream: new MediaStream(),
      video: false,
      audio: false,
      warning: 'This browser cannot open a camera or microphone. You can still use chat.',
    };
  }

  const attempts: Array<{ audio: boolean | MediaTrackConstraints; video: boolean | MediaTrackConstraints }> = [
    { audio: audioConstraints(opts, true), video: videoConstraints(opts, true) },
    { audio: audioConstraints(opts, false), video: videoConstraints(opts, false) },
    { audio: audioConstraints(opts, false), video: false },
    { audio: false, video: videoConstraints(opts, false) },
  ];

  let lastError = '';
  for (const attempt of attempts) {
    try {
      const stream = await tryGet(attempt.audio, attempt.video);
      applyEnabled(stream, opts);
      const video = stream.getVideoTracks().length > 0;
      const audio = stream.getAudioTracks().length > 0;
      let warning: string | undefined;
      if (!video && !audio) warning = 'Camera and microphone are blocked. You can still use chat.';
      else if (!video) warning = 'Camera is blocked. Others will hear you, but not see you.';
      else if (!audio) warning = 'Microphone is blocked. Others will see you, but not hear you.';
      return { stream, video, audio, warning };
    } catch (error) {
      lastError = error instanceof Error ? error.name : 'Error';
    }
  }

  const denied = lastError === 'NotAllowedError' || lastError === 'PermissionDeniedError';
  return {
    stream: new MediaStream(),
    video: false,
    audio: false,
    warning: denied
      ? 'Camera and microphone are blocked. Allow them in the browser bar, then use Retry in settings. Chat still works.'
      : 'No camera or microphone was found. Chat still works.',
  };
}

export async function listDevices(): Promise<DeviceLists> {
  if (!navigator.mediaDevices?.enumerateDevices) {
    return { mics: [], cams: [], speakers: [] };
  }
  const all = await navigator.mediaDevices.enumerateDevices();
  return {
    mics: all.filter((device) => device.kind === 'audioinput'),
    cams: all.filter((device) => device.kind === 'videoinput'),
    speakers: all.filter((device) => device.kind === 'audiooutput'),
  };
}

export function deviceLabel(device: MediaDeviceInfo, index: number, kind: string) {
  return device.label || `${kind} ${index + 1}`;
}
