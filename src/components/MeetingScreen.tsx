import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type RefObject } from 'react';
import {
  IconCam,
  IconCamOff,
  IconCaptions,
  IconChat,
  IconHand,
  IconLeave,
  IconLook,
  IconMic,
  IconMicOff,
  IconMore,
  IconPeople,
  IconPin,
  IconShare,
  IconSmile,
  Logo,
} from './icons';
import { LookMenu, ThemeButton } from './LookControls';
import { useSelfLook } from '../hooks/useSelfLook';
import { safeName } from '../lib/code';
import { acquireMedia } from '../lib/media';
import { getPreviewVideo, mountPreview } from '../lib/previewVideo';
import { colorFor, initials } from '../lib/people';
import {
  createRecorder,
  downloadRecordZip,
  recordFiles,
  type RecordCast,
  type RecordFile,
} from '../lib/record';
import { buildCatchUp, type CatchUpEvent } from '../lib/meetingIntel';
import { beep } from '../lib/sound';
import { useCaptions } from '../hooks/useCaptions';
import { useRoom, type RemotePeer } from '../hooks/useRoom';
import { useToasts } from '../hooks/useToasts';
import { SettingsDialog } from './SettingsDialog';
import { RecordingsDialog } from './RecordingsDialog';
import type { Settings } from '../types';

type Props = {
  code: string;
  asHost?: boolean;
  settings: Settings;
  initialStream: MediaStream | null;
  onSettings: (settings: Settings) => void;
  onLeave: () => void;
};

type Layout = 'grid' | 'speaker' | 'sidebar';
type Panel = 'chat' | 'people' | 'catchup' | null;
type Popover = 'react' | 'more' | 'leave' | 'look' | null;
type Dialog = 'settings' | 'shortcuts' | 'details' | 'poll' | 'facecast' | 'recordings' | 'catchup' | 'receipt' | null;

type TileModel = {
  key: string;
  peerId: string;
  name: string;
  kind: 'camera' | 'screen';
  stream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  hand: boolean;
  you: boolean;
  speaking: boolean;
  mirrored: boolean;
  connection?: RTCPeerConnectionState | 'new';
  showVideo: boolean;
};

const reactions = [
  ['\u{1F44D}', 'Thumbs up'],
  ['\u{1F44F}', 'Clap'],
  ['\u{2764}\u{FE0F}', 'Heart'],
  ['\u{1F602}', 'Laugh'],
  ['\u{1F62E}', 'Wow'],
  ['\u{1F389}', 'Celebrate'],
] as const;

const shortcuts = [
  ['M', 'Turn microphone on or off'],
  ['V', 'Turn camera on or off'],
  ['S', 'Share your screen, or stop sharing'],
  ['H', 'Raise or lower your hand'],
  ['C', 'Open or close chat'],
  ['P', 'Open or close the people list'],
  ['R', 'Open reactions'],
  ['K', 'Turn captions on or off'],
  ['F', 'Full screen'],
  ['L', 'Leave the meeting'],
  ['B', 'Choose a background for your video'],
  ['?', 'Show these shortcuts'],
  ['Esc', 'Close what is open'],
];

function cx(...parts: Array<string | false | undefined>) {
  return parts.filter(Boolean).join(' ');
}

function hasVideo(stream: MediaStream | null) {
  return Boolean(stream?.getVideoTracks().length);
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function gridClass(count: number) {
  if (count <= 1) return 'grid c1';
  if (count === 2) return 'grid c2';
  if (count === 3) return 'grid three';
  if (count === 4) return 'grid c2 rows2';
  if (count <= 9) return 'grid cols3';
  if (count <= 16) return 'grid cols4';
  if (count <= 25) return 'grid cols5';
  return 'grid cols6';
}

function inviteLink(code: string) {
  const url = new URL(location.href);
  url.searchParams.set('room', code);
  return url.toString();
}

function useLoudest(
  items: { id: string; track: MediaStreamTrack | null }[],
  preferId: string | null,
) {
  const [active, setActive] = useState<string | null>(null);
  const key = items.map((item) => `${item.id}:${item.track?.id ?? ''}:${item.track?.enabled ? 1 : 0}`).join('|');
  useEffect(() => {
    const live = items.filter((item) => item.track && item.track.readyState === 'live' && item.track.enabled);
    if (!live.length) {
      setActive(null);
      return;
    }
    const ctx = new AudioContext();
    // Clone tracks ? wiring the live WebRTC track into Web Audio mutes <audio> playback in Chromium / Android WebView.
    const clones: MediaStreamTrack[] = [];
    const analysers = live.map((item) => {
      const clone = item.track!.clone();
      clones.push(clone);
      const source = ctx.createMediaStreamSource(new MediaStream([clone]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.35;
      source.connect(analyser);
      return { id: item.id, analyser, data: new Uint8Array(analyser.fftSize) };
    });
    let current: string | null = null;
    let holdUntil = 0;
    const timer = window.setInterval(() => {
      void ctx.resume();
      let best = '';
      let bestValue = 0;
      let preferValue = 0;
      for (const item of analysers) {
        item.analyser.getByteTimeDomainData(item.data);
        let sum = 0;
        for (const value of item.data) {
          const delta = value - 128;
          sum += delta * delta;
        }
        const rms = Math.sqrt(sum / item.data.length);
        if (rms > bestValue) {
          bestValue = rms;
          best = item.id;
        }
        if (preferId && item.id === preferId) preferValue = rms;
      }
      const time = Date.now();
      // Prefer host/admin whenever they are clearly speaking.
      const next =
        preferId && preferValue > 6.5 ? preferId : bestValue > 6.5 ? best : '';
      if (next) {
        current = next;
        holdUntil = time + 2400;
        setActive(next);
      } else if (current && time > holdUntil) {
        current = null;
        setActive(null);
      }
    }, 90);
    return () => {
      window.clearInterval(timer);
      clones.forEach((track) => track.stop());
      void ctx.close();
    };
    // The key captures the track list for this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, preferId]);
  return active;
}

export function MeetingScreen({ code, asHost = false, settings, initialStream, onSettings, onLeave }: Props) {
  const { toasts, push: toast } = useToasts();
  const [stream, setStream] = useState<MediaStream | null>(initialStream);
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const [micOn, setMicOn] = useState(initialStream ? initialStream.getAudioTracks().some((track) => track.enabled) : true);
  const [camOn, setCamOn] = useState(initialStream ? initialStream.getVideoTracks().some((track) => track.enabled) : true);
  const [hand, setHand] = useState(false);
  const [recording, setRecording] = useState(false);
  const [captionsOn, setCaptionsOn] = useState(false);
  const [layout, setLayout] = useState<Layout>('grid');
  const [panel, setPanel] = useState<Panel>(null);
  const [popover, setPopover] = useState<Popover>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [castIds, setCastIds] = useState<string[]>([]);
  const [castScreens, setCastScreens] = useState(true);
  const castRef = useRef<RecordCast>({ peerIds: [], includeScreens: true, includeAudioFromOthers: true });
  const [pin, setPin] = useState<string | null>(null);
  const [unread, setUnread] = useState(0);
  const [hear, setHear] = useState(false);
  const [pollHidden, setPollHidden] = useState(false);
  const [hideAlone, setHideAlone] = useState(false);
  const [hideTip, setHideTip] = useState(() => sessionStorage.getItem('lc-tip') === '1');
  const [chatText, setChatText] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [deviceNonce, setDeviceNonce] = useState(0);
  const [recordReady, setRecordReady] = useState<RecordFile[] | null>(null);
  const [joinedAt] = useState(() => Date.now());

  const started = useRef(Date.now());
  const downSince = useRef(Date.now());
  const seenAt = useRef<Record<string, number>>({});
  const beeped = useRef(new Set<string>());
  const handsSeen = useRef(new Set<string>());
  const handsReady = useRef(false);
  const reactionSeen = useRef(new Set<string>());
  const [bursts, setBursts] = useState<{ id: string; emoji: string; x: number; drift: number; scale: number; delay: number }[]>([]);
  const chatCount = useRef(0);
  const lastCaption = useRef(0);
  const streamRef = useRef<MediaStream | null>(initialStream);
  const skipAcquire = useRef(Boolean(initialStream));
  const screenRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const roomRef = useRef<HTMLElement>(null);
  const chatInput = useRef<HTMLInputElement>(null);
  const chatEnd = useRef<HTMLDivElement>(null);
  const recorderRef = useRef<ReturnType<typeof createRecorder>>(null);
  const audioTracksRef = useRef<() => MediaStreamTrack[]>(() => []);
  const sharing = Boolean(screenStream?.getVideoTracks().some((track) => track.readyState === 'live'));
  streamRef.current = stream;
  screenRef.current = screenStream;
  const look = useSelfLook(Boolean(stream?.getVideoTracks().length) && camOn, settings.background);
  const sendStream = useMemo(() => {
    if (!stream) return null;
    if (!look.track) return stream;
    return new MediaStream([...stream.getAudioTracks(), look.track]);
  }, [look.track, stream]);

  const hostCastHandler = useRef<(cast: RecordCast, active: boolean) => void>(() => undefined);
  const hostIdRef = useRef<string | null>(null);
  const chatRef = useRef<{ name: string; text: string; ts: number; system?: boolean }[]>([]);

  const {
    myId,
    status,
    gate,
    waiting,
    peers,
    chat,
    reactions: reactionItems,
    caption,
    kickedBy,
    hostId,
    coHostIds,
    ask,
    poll,
    hostCastActive,
    dismissAsk,
    sendChat,
    sendReaction,
    sendCaption,
    kick,
    moderate,
    retry,
    setScreenTrack,
    admit,
    deny,
    setCohost,
    publishCast,
    createPoll,
    vote,
    endPoll,
  } = useRoom({
    code,
    name: settings.name,
    stream: sendStream,
    micOn,
    camOn,
    hand,
    sharing,
    recording,
    claimHost: asHost,
    onForceMute: (kind) => {
      if (kind === 'mic') setMicOn(false);
      else setCamOn(false);
      toast(kind === 'mic' ? 'The host turned your microphone off.' : 'The host turned your camera off.');
    },
    onHostCast: (cast, active) => hostCastHandler.current(cast, active),
  });

  // Each person captions their own mic and shares text instantly.
  const { supported: captionSupported, error: captionError } = useCaptions(
    captionsOn && micOn,
    (text, isFinal) => {
      const time = Date.now();
      if (!isFinal && time - lastCaption.current < 40) return;
      lastCaption.current = time;
      sendCaption(text);
    },
  );

  const name = safeName(settings.name);
  const isHost = hostId === myId;
  const isCoHost = coHostIds.includes(myId);
  const canModerate = isHost || isCoHost;
  const canRecord = canModerate;
  const hostPeer = peers.find((peer) => peer.id === hostId);
  hostIdRef.current = hostId;
  chatRef.current = chat;
  const hasMic = Boolean(stream?.getAudioTracks().length);
  const hasCam = Boolean(stream?.getVideoTracks().length);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (skipAcquire.current) {
      skipAcquire.current = false;
      return;
    }
    let cancel = false;
    void acquireMedia({
      micId: settings.micId,
      camId: settings.camId,
      wantMic: micOn,
      wantCam: camOn,
      noise: settings.noiseSuppression,
    }).then((result) => {
      if (cancel) {
        result.stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const previous = streamRef.current;
      if (previous && previous !== result.stream) previous.getTracks().forEach((track) => track.stop());
      streamRef.current = result.stream;
      setStream(result.stream);
      if (result.warning) toast(result.warning);
      if (!result.audio) setMicOn(false);
      if (!result.video) setCamOn(false);
    });
    return () => {
      cancel = true;
    };
    // Mic and camera toggles must not request devices again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceNonce, settings.camId, settings.micId, settings.noiseSuppression]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      screenRef.current?.getTracks().forEach((track) => track.stop());
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder) {
        void recorder.stop().then((bundle) => {
          const total = bundle.host.size + bundle.room.size + bundle.screen.size + bundle.chat.size;
          if (total) void downloadRecordZip(bundle, code);
        });
      }
    };
  }, [code]);

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
    setScreenTrack(screenStream);
  }, [screenStream, setScreenTrack]);

  useEffect(() => {
    const wantShare = new URLSearchParams(location.search).get('share') === '1';
    if (!wantShare) return;
    const url = new URL(location.href);
    url.searchParams.delete('share');
    history.replaceState(history.state, '', url);
    const timer = window.setTimeout(() => {
      void toggleShare();
    }, 600);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!kickedBy) return;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
  }, [kickedBy]);

  useEffect(() => {
    if (canModerate && waiting.length > 0) setPanel('people');
  }, [canModerate, waiting.length]);

  useEffect(() => {
    if (!captionsOn) return;
    if (!captionSupported || captionError === 'unsupported') {
      setCaptionsOn(false);
      toast('Live captions need Chrome or Edge on HTTPS.');
      return;
    }
    if (captionError === 'denied') {
      setCaptionsOn(false);
      toast('Allow microphone access to use captions.');
      return;
    }
    if (captionError === 'failed') toast('Captions could not start. Try again.');
  }, [captionError, captionSupported, captionsOn, toast]);

  useEffect(() => {
    if (!settings.sounds) {
      chat.forEach((message) => beeped.current.add(message.id));
      return;
    }
    for (const message of chat) {
      if (beeped.current.has(message.id)) continue;
      beeped.current.add(message.id);
      if (Date.now() - message.ts > 5000) continue;
      if (message.system && message.text.endsWith('joined')) beep('join');
      if (!message.system && message.from !== myId) beep('chat');
    }
  }, [chat, myId, settings.sounds]);

  useEffect(() => {
    const raised = new Set<string>();
    if (hand) raised.add(myId);
    peers.forEach((peer) => {
      if (peer.hand) raised.add(peer.id);
    });
    if (!handsReady.current) {
      handsSeen.current = raised;
      handsReady.current = true;
      return;
    }
    for (const id of raised) {
      if (handsSeen.current.has(id)) continue;
      handsSeen.current.add(id);
      if (settings.sounds) beep('hand');
      if (id === myId) toast('You raised your hand');
      else {
        const peer = peers.find((item) => item.id === id);
        if (peer) toast(`${peer.name} raised a hand`);
      }
    }
    for (const id of [...handsSeen.current]) {
      if (!raised.has(id)) handsSeen.current.delete(id);
    }
  }, [hand, myId, peers, settings.sounds, toast]);

  useEffect(() => {
    for (const item of reactionItems) {
      if (reactionSeen.current.has(item.id)) continue;
      reactionSeen.current.add(item.id);
      if (settings.sounds) beep('react');
      const pack = Array.from({ length: 8 }, (_, index) => ({
        id: `${item.id}-${index}`,
        emoji: item.emoji,
        x: 18 + Math.random() * 64,
        drift: (Math.random() - 0.5) * 90,
        scale: 0.85 + Math.random() * 0.55,
        delay: index * 55 + Math.random() * 40,
      }));
      setBursts((current) => [...current, ...pack].slice(-64));
      window.setTimeout(() => {
        setBursts((current) => current.filter((burst) => !burst.id.startsWith(`${item.id}-`)));
      }, 2800);
    }
  }, [reactionItems, settings.sounds]);

  useEffect(() => {
    const fresh = chat.slice(chatCount.current);
    chatCount.current = chat.length;
    if (panel === 'chat') {
      setUnread(0);
      return;
    }
    const count = fresh.filter((message) => !message.system && message.from !== myId).length;
    if (count) setUnread((value) => value + count);
  }, [chat, myId, panel]);

  useEffect(() => {
    if (panel === 'chat') {
      chatInput.current?.focus();
      chatEnd.current?.scrollIntoView({ block: 'end' });
    }
  }, [chat.length, panel]);

  useEffect(() => {
    if (poll) setPollHidden(false);
  }, [poll?.id]);

  const loudest = useLoudest(
    [
      { id: myId, track: micOn ? stream?.getAudioTracks()[0] ?? null : null },
      ...peers.map((peer) => ({
        id: peer.id,
        track: peer.micOn ? peer.audio?.getAudioTracks()[0] ?? null : null,
      })),
    ],
    hostId,
  );

  audioTracksRef.current = () => {
    const selected = new Set(castRef.current.peerIds);
    const tracks: MediaStreamTrack[] = [];
    const mic = stream?.getAudioTracks()[0];
    if (mic && selected.has(myId)) tracks.push(mic);
    if (castRef.current.includeScreens) {
      screenStream?.getAudioTracks().forEach((track) => tracks.push(track));
    }
    peers.forEach((peer) => {
      if (!selected.has(peer.id)) return;
      peer.audio?.getAudioTracks().forEach((track) => tracks.push(track));
    });
    return tracks;
  };

  if (status === 'connected') downSince.current = 0;
  else if (!downSince.current) downSince.current = now;
  for (const peer of peers) {
    if (!seenAt.current[peer.id]) seenAt.current[peer.id] = now;
  }

  async function copyLink() {
    const link = inviteLink(code);
    try {
      await navigator.clipboard.writeText(link);
      toast('Invite link copied.');
    } catch {
      toast(link);
    }
  }

  async function toggleShare() {
    if (screenStream) {
      screenStream.getTracks().forEach((track) => track.stop());
      setScreenStream(null);
      try {
        const { stopNativeScreenShare } = await import('../lib/nativeScreenShare');
        await stopNativeScreenShare();
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      const { isNativeApp } = await import('../lib/native');
      const { nativeScreenShareAvailable, startNativeScreenShare } = await import('../lib/nativeScreenShare');
      if (isNativeApp() && (await nativeScreenShareAvailable())) {
        const display = await startNativeScreenShare();
        display.getVideoTracks()[0]?.addEventListener('ended', () => {
          display.getTracks().forEach((track) => track.stop());
          setScreenStream((current) => (current === display ? null : current));
          void import('../lib/nativeScreenShare').then((mod) => mod.stopNativeScreenShare()).catch(() => undefined);
        });
        setScreenStream(display);
        toast('Sharing your screen.');
        return;
      }
    } catch (error) {
      if (error instanceof Error && /denied|permission|cancel/i.test(error.message)) {
        toast('Screen share canceled.');
        return;
      }
    }

    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
      toast('Screen share is not available on this device.');
      return;
    }
    try {
      let display: MediaStream;
      try {
        display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          toast('Screen share canceled.');
          return;
        }
        display = await navigator.mediaDevices.getDisplayMedia({ video: true });
      }
      display.getVideoTracks()[0]?.addEventListener('ended', () => {
        display.getTracks().forEach((track) => track.stop());
        setScreenStream((current) => (current === display ? null : current));
      });
      setScreenStream(display);
      toast('Sharing your screen.');
    } catch {
      toast('Could not share the screen. Allow screen capture when prompted.');
    }
  }

  function openFaceCast() {
    const everyone = [myId, ...peers.map((peer) => peer.id)];
    setCastIds((current) => (current.length ? current.filter((id) => everyone.includes(id)) : everyone));
    setCastScreens(sharing || peers.some((peer) => peer.sharing));
    setDialog('facecast');
  }

async function toggleRecord() {
    if (!canRecord) return;
    if (recorderRef.current) {
      toast('Finishing 4 playable videos...');
      const bundle = await recorderRef.current.stop();
      recorderRef.current = null;
      setRecording(false);
      publishCast(castRef.current, false);
      const total = bundle.host.size + bundle.room.size + bundle.screen.size + bundle.chat.size;
      if (!total) {
        toast('Recording was empty - try again for at least a few seconds.');
        return;
      }
      const files = recordFiles(bundle, code);
      setRecordReady(files);
      setDialog('recordings');
      try {
        await downloadRecordZip(bundle, code);
        toast('ZIP downloaded. Preview below if your PC will not open WebM.');
      } catch {
        toast('ZIP pack failed - use Save on each preview instead.');
      }
      return;
    }
    openFaceCast();
  }


  function startFaceCast(next: RecordCast) {
    if (!canRecord || !stageRef.current) return;
    castRef.current = next;
    setCastIds(next.peerIds);
    setCastScreens(next.includeScreens);
    const recorder = createRecorder(stageRef.current, () => audioTracksRef.current(), next, {
      getHostId: () => hostIdRef.current,
      getChat: () =>
        chatRef.current.map((message) => ({
          name: message.name,
          text: message.text,
          ts: message.ts,
          system: message.system,
        })),
    });
    if (!recorder) {
      toast('This browser cannot record the meeting.');
      return;
    }
    recorderRef.current = recorder;
    setRecording(true);
    setDialog(null);
    publishCast(next, true);
    toast('Recording 4 cuts: host, room, screen, chat. Stop to download the ZIP.');
  }

  function applyCast(next: RecordCast, broadcast = true) {
    castRef.current = next;
    setCastIds(next.peerIds);
    setCastScreens(next.includeScreens);
    recorderRef.current?.setCast(next);
    if (broadcast && canRecord && recording) publishCast(next, true);
  }

  function toggleCastPerson(id: string) {
    const current = castRef.current;
    const peerIds = current.peerIds.includes(id)
      ? current.peerIds.filter((item) => item !== id)
      : [...current.peerIds, id];
    applyCast({ ...current, peerIds });
  }

  hostCastHandler.current = (cast, active) => {
    if (recording && canRecord) return;
    if (!active) {
      if (recording) toast('FaceCast direction stopped.');
      return;
    }
    applyCast(cast, false);
    if (recording) toast('FaceCast people updated by host/co-host.');
  };

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await roomRef.current?.requestFullscreen();
    } catch {
      toast('Full screen is not available.');
    }
  }

  async function popOut() {
    const video = localVideoRef.current;
    if (!video || !camOn) {
      toast('Turn your camera on to pop out your video.');
      return;
    }
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      toast('Could not open the small video window.');
    }
  }

  function togglePanel(next: Panel) {
    setPopover(null);
    setPanel((current) => (current === next ? null : next));
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = chatText.trim();
    if (!text) return;
    sendChat(text);
    setChatText('');
  }

  const uiRef = useRef({
    dialog,
    popover,
    panel,
    captionsOn,
    leave: onLeave,
    toggleShare,
    toggleFullscreen,
    togglePanel,
  });
  uiRef.current = { dialog, popover, panel, captionsOn, leave: onLeave, toggleShare, toggleFullscreen, togglePanel };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const ui = uiRef.current;
      if (event.key === 'Escape') {
        if (ui.dialog) setDialog(null);
        else if (ui.popover) setPopover(null);
        else if (ui.panel) setPanel(null);
        return;
      }
      if (typing || ui.dialog || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const run = (action: () => void) => {
        event.preventDefault();
        setPopover(null);
        action();
      };
      if (key === 'm') run(() => setMicOn((value) => !value));
      else if (key === 'v') run(() => setCamOn((value) => !value));
      else if (key === 's') run(() => void ui.toggleShare());
      else if (key === 'h') run(() => setHand((value) => !value));
      else if (key === 'c') run(() => ui.togglePanel('chat'));
      else if (key === 'p') run(() => ui.togglePanel('people'));
      else if (key === 'r') run(() => setPopover('react'));
      else if (key === 'b') run(() => setPopover('look'));
      else if (key === 'k') run(() => setCaptionsOn((value) => !value));
      else if (key === 'f') run(() => void ui.toggleFullscreen());
      else if (key === 'l') {
        event.preventDefault();
        if (ui.popover === 'leave') ui.leave();
        else setPopover('leave');
      } else if (event.key === '?') run(() => setDialog('shortcuts'));
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const catchUpEvents = useMemo(() => {
    const hands = [
      ...(hand ? [name] : []),
      ...peers.filter((peer) => peer.hand).map((peer) => peer.name),
    ];
    return buildCatchUp({
      joinedAt,
      chat,
      airtime: {},
      names: Object.fromEntries([[myId, name], ...peers.map((peer) => [peer.id, peer.name] as const)]),
      hands,
      sharing: [
        ...(sharing ? [name] : []),
        ...peers.filter((peer) => peer.sharing).map((peer) => peer.name),
      ],
    });
  }, [chat, hand, joinedAt, myId, name, peers, sharing]);

  const youTile: TileModel = {
    key: `cam:${myId}`,
    peerId: myId,
    name,
    kind: 'camera',
    stream,
    micOn: micOn && hasMic,
    camOn: camOn && hasCam,
    hand,
    you: true,
    speaking: loudest === myId,
    mirrored: settings.mirror,
    showVideo: camOn && hasCam,
  };
  const cameras: TileModel[] = [
    youTile,
    ...peers.map((peer) => ({
      key: `cam:${peer.id}`,
      peerId: peer.id,
      name: peer.name,
      kind: 'camera' as const,
      stream: peer.camera,
      micOn: peer.micOn,
      camOn: peer.camOn,
      hand: peer.hand,
      you: false,
      speaking: loudest === peer.id,
      mirrored: false,
      connection: peer.connection,
      showVideo: peer.camOn && hasVideo(peer.camera),
    })),
  ];
  const screens: TileModel[] = [
    ...(sharing
      ? [
          {
            key: `screen:${myId}`,
            peerId: myId,
            name: `${name}'s screen`,
            kind: 'screen' as const,
            stream: screenStream,
            micOn: true,
            camOn: true,
            hand: false,
            you: true,
            speaking: false,
            mirrored: false,
            showVideo: hasVideo(screenStream),
          },
        ]
      : []),
    ...peers
      .filter((peer) => peer.sharing || hasVideo(peer.screen))
      .map((peer) => ({
        key: `screen:${peer.id}`,
        peerId: peer.id,
        name: `${peer.name}'s screen`,
        kind: 'screen' as const,
        stream: peer.screen,
        micOn: true,
        camOn: true,
        hand: false,
        you: false,
        speaking: false,
        mirrored: false,
        showVideo: hasVideo(peer.screen),
      })),
  ];

  function renderTile(tile: TileModel) {
    const slow = tile.connection && tile.connection !== 'connected' && now - (seenAt.current[tile.peerId] || now) > 8000;
    const role =
      tile.kind === 'screen'
        ? 'Screen'
        : tile.you
          ? isHost
            ? 'Host'
            : isCoHost
              ? 'Co-host'
              : 'You'
          : tile.peerId === hostId
            ? 'Host'
            : coHostIds.includes(tile.peerId)
              ? 'Co-host'
              : 'Guest';
    return (
      <Tile
        key={tile.key}
        tile={tile}
        role={role}
        pinned={pin === tile.key}
        localRef={tile.you && tile.kind === 'camera' ? localVideoRef : undefined}
        lookCanvas={tile.you && tile.kind === 'camera' ? look.canvas : null}
        casted={recording && castIds.includes(tile.peerId) && tile.kind === 'camera'}
        slow={Boolean(slow)}
        onPin={() => setPin((current) => (current === tile.key ? null : tile.key))}
        onRetry={() => retry(tile.peerId)}
      />
    );
  }

  const recorders = [recording ? 'You' : null, ...peers.filter((peer) => peer.recording).map((peer) => peer.name)].filter(
    (item): item is string => Boolean(item),
  );
  const recordingText =
    recorders.length === 0
      ? ''
      : recording
        ? `FaceCast \u00b7 ${castIds.length} face${castIds.length === 1 ? '' : 's'}`
        : `${recorders.join(', ')} recording`;
  const serverMessage =
    status === 'connected'
      ? ''
      : status === 'reconnecting'
        ? 'Reconnecting to the meeting server\u2026'
        : now - downSince.current > 8000
          ? 'Cannot reach the meeting server. Keep the terminal that started the app open, then refresh.'
          : 'Connecting to the meeting server\u2026';
  const sharers = [
    sharing ? 'You are sharing your screen' : null,
    ...peers.filter((peer) => peer.sharing).map((peer) => `${peer.name} is sharing their screen`),
  ].filter((item): item is string => Boolean(item));

  if (kickedBy) {
    return (
      <main className="home kicked">
        <section className="card narrow">
          <h1>{kickedBy} removed you from the meeting</h1>
          <p>You can join again with the same link · the host will need to admit you again.</p>
          <button type="button" className="primary" onClick={onLeave}>
            Back to home
          </button>
        </section>
      </main>
    );
  }

  if (gate === 'denied') {
    return (
      <main className="home kicked">
        <section className="card narrow">
          <h1>The host did not let you in</h1>
          <p>Ask them for a new invite, or try again later.</p>
          <button type="button" className="primary" onClick={onLeave}>
            Back to home
          </button>
        </section>
      </main>
    );
  }

  if (gate === 'waiting' || gate === 'connecting') {
    return (
      <WaitingRoom
        code={code}
        name={name}
        gate={gate}
        asHost={asHost}
        stream={stream}
        camOn={camOn}
        micOn={micOn}
        theme={settings.theme}
        onTheme={(theme) => onSettings({ ...settings, theme })}
        onCam={() => setCamOn((value) => !value)}
        onMic={() => setMicOn((value) => !value)}
        onLeave={onLeave}
        onCopy={() => void copyLink()}
      />
    );
  }

  const mainTile =
    cameras.find((tile) => tile.key === pin) ||
    cameras.find((tile) => tile.speaking) ||
    cameras.find((tile) => !tile.you) ||
    cameras[0];
  const otherTiles = cameras.filter((tile) => tile.key !== mainTile.key);
  const raisedHands = [
    ...(hand ? [{ id: myId, name: `${name} (You)` }] : []),
    ...peers.filter((peer) => peer.hand).map((peer) => ({ id: peer.id, name: peer.name })),
  ];
  const handPill =
    raisedHands.length === 0
      ? null
      : raisedHands.length === 1
        ? raisedHands[0].name.replace(' (You)', '')
        : `${raisedHands[0].name.replace(' (You)', '')} +${raisedHands.length - 1}`;

  return (
    <main className="room room-meet" ref={roomRef}>
      <header className="topbar">
        <div className="top-id">
          <Logo size={22} />
          <strong className="desk-only">LetsConnect</strong>
          <code className="meet-code">{code}</code>
          <button type="button" className="secondary slim desk-only" onClick={() => void copyLink()}>
            Copy link
          </button>
        </div>
        <div className="top-mid desk-only">
          <span className="time">{formatElapsed(now - started.current)}</span>
          {isHost ? (
            <span className="pill">Host</span>
          ) : isCoHost ? (
            <span className="pill">Co-host</span>
          ) : hostPeer ? (
            <span className="pill">Host: {hostPeer.name}</span>
          ) : null}
          {recordingText && (
            <span className="recpill">
              <i />
              {recordingText}
            </span>
          )}
          {handPill && (
            <button type="button" className="hand-pill" title="Hands raised" onClick={() => setPanel('people')}>
              <IconHand />
              <span>{handPill}</span>
            </button>
          )}
        </div>
        <div className="top-actions">
          <button
            type="button"
            className={panel === 'catchup' ? 'top-icon on' : 'top-icon'}
            title="Catch-Up"
            aria-label="Catch-Up"
            onClick={() => setPanel((value) => (value === 'catchup' ? null : 'catchup'))}
          >
            <span className="desk-only">Catch-Up</span>
            <span className="phone-only top-icon-label">Up</span>
          </button>
          <button
            type="button"
            className={panel === 'people' ? 'top-icon on' : 'top-icon'}
            title="People"
            aria-label="People"
            onClick={() => setPanel((value) => (value === 'people' ? null : 'people'))}
          >
            <IconPeople />
            <em>{peers.length + 1}</em>
          </button>
          <button
            type="button"
            className={panel === 'chat' ? 'top-icon on' : 'top-icon'}
            title="Chat"
            aria-label="Chat"
            onClick={() => setPanel((value) => (value === 'chat' ? null : 'chat'))}
          >
            <IconChat />
            {unread > 0 && <em className="badge">{unread}</em>}
          </button>
          <span className="desk-only">
            <ThemeButton theme={settings.theme} onChange={(theme) => onSettings({ ...settings, theme })} />
          </span>
          <div className="seg desk-only" aria-label="Layout">
            {screens.length ? (
              <span className="pill">Presentation</span>
            ) : (
              <>
                <button type="button" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>
                  Grid
                </button>
                <button type="button" aria-pressed={layout === 'speaker'} onClick={() => setLayout('speaker')}>
                  Speaker
                </button>
                <button type="button" aria-pressed={layout === 'sidebar'} onClick={() => setLayout('sidebar')}>
                  Sidebar
                </button>
              </>
            )}
          </div>
        </div>
      </header>

      <div className="banners">
        {serverMessage && <div className="banner warn">{serverMessage}</div>}
        {canModerate && waiting.length > 0 && (
          <AdmitBanner
            waiting={waiting}
            onReview={() => setPanel('people')}
            onAdmit={admit}
            onDeny={deny}
            onAdmitAll={() => waiting.forEach((person) => admit(person.id))}
          />
        )}
        {!canRecord && hostCastActive && !recording && (
          <div className="banner info">
            <span>A host or co-host is directing FaceCast · only their chosen faces go into the marketing cut.</span>
          </div>
        )}
        {hear && (
          <div className="banner ask">
            <span>Click to hear other people.</span>
            <button
              type="button"
              className="primary slim"
              onClick={() => {
                setHear(false);
                document.querySelectorAll('audio').forEach((element) => void element.play().catch(() => undefined));
              }}
            >
              Hear people
            </button>
          </div>
        )}
        {sharers.length > 0 && (
          <div className="banner share">
            <span>{sharers.join('. ')}.</span>
            {sharing && (
              <button type="button" onClick={() => void toggleShare()}>
                Stop sharing
              </button>
            )}
          </div>
        )}
        {peers.length === 0 && !hideAlone && (
          <div className="banner info">
            <span>You are the host. Copy the link · people who open it wait until you admit them.</span>
            <button type="button" onClick={() => void copyLink()}>
              Copy link
            </button>
            <button type="button" className="textbtn" onClick={() => setHideAlone(true)}>
              Hide
            </button>
          </div>
        )}
        {peers.length > 0 && !hideTip && (
          <div className="banner info">
            <span>Use headphones if two meeting windows are on this computer, or the microphones will echo.</span>
            <button
              type="button"
              onClick={() => {
                sessionStorage.setItem('lc-tip', '1');
                setHideTip(true);
              }}
            >
              Got it
            </button>
          </div>
        )}
        {ask && (
          <div className="banner ask">
            <span>
              {ask.fromName} is asking you to turn your {ask.kind === 'mic' ? 'microphone' : 'camera'} on.
            </span>
            <button
              type="button"
              className="primary slim"
              onClick={() => {
                if (ask.kind === 'mic') setMicOn(true);
                else setCamOn(true);
                dismissAsk();
              }}
            >
              Turn it on
            </button>
            <button type="button" onClick={dismissAsk}>
              Not now
            </button>
          </div>
        )}
      </div>

      <div className="room-body">
        <div className="stage" ref={stageRef}>
          {screens.length > 0 ? (
            <div className="present">
              <div className={screens.length > 1 ? 'present-main split' : 'present-main'}>{screens.map(renderTile)}</div>
              <div className="strip">{cameras.map(renderTile)}</div>
            </div>
          ) : layout === 'grid' || cameras.length < 2 ? (
            <div className={gridClass(cameras.length)}>{cameras.map(renderTile)}</div>
          ) : (
            <div className={layout === 'sidebar' ? 'sidebar' : 'speaker'}>
              <div className="present-main">{renderTile(mainTile)}</div>
              <div className="strip">{otherTiles.map(renderTile)}</div>
            </div>
          )}
          {caption && (
            <div className="captions" aria-live="polite">
              <strong>{caption.name}</strong>
              <span>{caption.text}</span>
            </div>
          )}
          {bursts.length > 0 && (
            <div className="react-fountain" aria-hidden="true">
              {bursts.map((burst) => (
                <span
                  key={burst.id}
                  className="react-bubble"
                  style={{
                    left: `${burst.x}%`,
                    ['--drift' as string]: `${burst.drift}px`,
                    ['--scale' as string]: String(burst.scale),
                    animationDelay: `${burst.delay}ms`,
                  }}
                >
                  {burst.emoji}
                </span>
              ))}
            </div>
          )}
          {poll && !pollHidden && (
            <PollCard
              poll={poll}
              myId={myId}
              canEnd={poll.owner === myId || canModerate}
              onVote={vote}
              onEnd={endPoll}
              onHide={() => setPollHidden(true)}
            />
          )}
        </div>

        {panel && (
          <aside className="side" aria-label={panel === 'chat' ? 'Chat' : panel === 'catchup' ? 'Catch-Up' : 'People'}>
            <div className="side-tabs">
              <button type="button" aria-pressed={panel === 'catchup'} onClick={() => setPanel('catchup')}>
                Catch-Up
              </button>
              <button type="button" aria-pressed={panel === 'chat'} onClick={() => setPanel('chat')}>
                Chat
              </button>
              <button type="button" aria-pressed={panel === 'people'} onClick={() => setPanel('people')}>
                People ({peers.length + 1}
                {canModerate && waiting.length ? ` · ${waiting.length} waiting` : ''})
              </button>
              <button type="button" className="textbtn" onClick={() => setPanel(null)}>
                Close
              </button>
            </div>
            {panel === 'catchup' ? (
              <CatchUpPanel events={catchUpEvents} onOpenChat={() => setPanel('chat')} />
            ) : panel === 'chat' ? (
              <div className="chat">
                <div className="messages">
                  {chat.length === 0 && <p className="empty">No messages yet. Say hello.</p>}
                  {chat.map((message) =>
                    message.system ? (
                      <p key={message.id} className="system">
                        {message.text}
                      </p>
                    ) : (
                      <article key={message.id} className={message.from === myId ? 'bubble mine' : 'bubble'}>
                        {message.from !== myId && <strong>{message.name}</strong>}
                        <p>{message.text}</p>
                        <time>
                          {new Date(message.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </time>
                      </article>
                    ),
                  )}
                  <div ref={chatEnd} />
                </div>
                <form className="composer" onSubmit={sendMessage}>
                  <input
                    ref={chatInput}
                    value={chatText}
                    maxLength={2000}
                    placeholder="Message everyone"
                    aria-label="Message everyone"
                    onChange={(event) => setChatText(event.target.value)}
                  />
                  <button type="submit" className="primary slim" disabled={!chatText.trim()}>
                    Send
                  </button>
                </form>
              </div>
            ) : (
              <PeopleList
                youName={name}
                youMic={micOn && hasMic}
                youCam={camOn && hasCam}
                youHand={hand}
                youSharing={sharing}
                isHost={isHost}
                canModerate={canModerate}
                hostId={hostId}
                coHostIds={coHostIds}
                myId={myId}
                peers={peers}
                waiting={waiting}
                confirmRemove={confirmRemove}
                onConfirm={setConfirmRemove}
                onPin={(id) => setPin((current) => (current === `cam:${id}` ? null : `cam:${id}`))}
                pin={pin}
                onRetry={retry}
                onModerate={moderate}
                onKick={kick}
                onAdmit={admit}
                onDeny={deny}
                onCohost={setCohost}
              />
            )}
          </aside>
        )}
      </div>

      {canRecord && recording && (
        <CastDirector
          people={[
            { id: myId, name: `${name} (You)` },
            ...peers.map((peer) => ({ id: peer.id, name: peer.name })),
          ]}
          selected={castIds}
          includeScreens={castScreens}
          hasScreens={sharing || peers.some((peer) => peer.sharing)}
          onToggle={toggleCastPerson}
          onScreens={() => applyCast({ ...castRef.current, includeScreens: !castRef.current.includeScreens })}
          onOpen={() => openFaceCast()}
        />
      )}

      {peers.map((peer) => (
        <RemoteAudio key={peer.id} stream={peer.audio} sinkId={settings.speakerId} onBlocked={() => setHear(true)} />
      ))}

      {popover && <button type="button" className="backdrop" aria-label="Close menu" onClick={() => setPopover(null)} />}

      <footer className="controls">
        <div className="cgroup meet-core">
          <Cmd
            label={!hasMic ? 'No mic' : micOn ? 'Mic' : 'Muted'}
            shortcut="M"
            danger={!micOn || !hasMic}
            pressed={micOn && hasMic}
            onClick={() => (hasMic ? setMicOn((value) => !value) : setDialog('settings'))}
          >
            {micOn && hasMic ? <IconMic /> : <IconMicOff />}
          </Cmd>
          <Cmd
            label={!hasCam ? 'No cam' : camOn ? 'Camera' : 'Cam off'}
            shortcut="V"
            danger={!camOn || !hasCam}
            pressed={camOn && hasCam}
            onClick={() => (hasCam ? setCamOn((value) => !value) : setDialog('settings'))}
          >
            {camOn && hasCam ? <IconCam /> : <IconCamOff />}
          </Cmd>
          <Cmd
            label={sharing ? 'Stop screen' : 'Screen'}
            shortcut="S"
            live={sharing}
            pressed={sharing}
            onClick={() => void toggleShare()}
          >
            <IconShare />
          </Cmd>
          <Cmd
            className="phone-only"
            label={hand ? 'Lower' : 'Hand'}
            shortcut="H"
            live={hand}
            pressed={hand}
            tone={hand ? 'hand' : undefined}
            onClick={() => setHand((value) => !value)}
          >
            <IconHand />
          </Cmd>
        </div>
        <div className="cgroup meet-tools desk-only">
          <Cmd
            label={hand ? 'Lower' : 'Hand'}
            shortcut="H"
            live={hand}
            pressed={hand}
            tone={hand ? 'hand' : undefined}
            onClick={() => setHand((value) => !value)}
          >
            <IconHand />
          </Cmd>
          <div className="cmdwrap">
            <Cmd label="React" shortcut="R" live={popover === 'react'} onClick={() => setPopover((value) => (value === 'react' ? null : 'react'))}>
              <IconSmile />
            </Cmd>
            {popover === 'react' && (
              <div className="popover react-pop" role="menu" aria-label="Reactions">
                {reactions.map(([emoji, label]) => (
                  <button
                    key={emoji}
                    type="button"
                    aria-label={label}
                    onClick={() => {
                      sendReaction(emoji);
                      setPopover(null);
                    }}
                  >
                    <span>{emoji}</span>
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Cmd
            label={captionsOn ? 'Captions on' : 'Captions'}
            shortcut="K"
            live={captionsOn}
            pressed={captionsOn}
            onClick={() => {
              if (!captionsOn && !captionSupported) {
                toast('Live captions need Chrome or Edge on HTTPS.');
                return;
              }
              if (!captionsOn && !micOn) {
                toast('Turn your mic on so captions can hear you.');
              }
              setCaptionsOn((value) => !value);
            }}
          >
            <IconCaptions />
          </Cmd>
          <div className="cmdwrap">
            <Cmd
              label="Look"
              shortcut="B"
              live={settings.background !== 'none' || popover === 'look'}
              pressed={settings.background !== 'none'}
              onClick={() => setPopover((value) => (value === 'look' ? null : 'look'))}
            >
              <IconLook />
            </Cmd>
            {popover === 'look' && (
              <LookMenu
                value={settings.background}
                status={look.status}
                onChange={(background) => onSettings({ ...settings, background })}
              />
            )}
          </div>
        </div>
        <div className="cgroup meet-panels">
          <Cmd
            className="desk-only"
            label={unread ? `Chat ${unread}` : 'Chat'}
            shortcut="C"
            live={panel === 'chat'}
            badge={unread}
            onClick={() => togglePanel('chat')}
          >
            <IconChat />
          </Cmd>
          <Cmd
            className="desk-only"
            label={`People ${peers.length + 1}`}
            shortcut="P"
            live={panel === 'people'}
            onClick={() => togglePanel('people')}
          >
            <IconPeople />
          </Cmd>
          <div className="cmdwrap">
            <Cmd label="More" live={popover === 'more'} onClick={() => setPopover((value) => (value === 'more' ? null : 'more'))}>
              <IconMore />
            </Cmd>
            {popover === 'more' && (
              <div className="popover more-pop" role="menu">
                {canRecord && (
                  <>
                    <p className="more-label">Record</p>
                    <MenuButton
                      icon={<IconRecord />}
                      title={recording ? 'Stop & download ZIP' : 'FaceCast'}
                      hint={recording ? '4 videos: host, room, screen, chat' : 'Record 4 marketing cuts'}
                      danger={recording}
                      onClick={() => {
                        setPopover(null);
                        void toggleRecord();
                      }}
                    />
                    {recording && (
                      <MenuButton
                        icon={<IconPeople />}
                        title="Edit cast"
                        hint="Who appears in the file"
                        onClick={() => {
                          setPopover(null);
                          openFaceCast();
                        }}
                      />
                    )}
                  </>
                )}
                <p className="more-label phone-only">Quick</p>
                <MenuButton
                  className="phone-only"
                  icon={<IconSmile />}
                  title="React"
                  hint="Send a reaction"
                  onClick={() => {
                    setPopover('react');
                  }}
                />
                <MenuButton
                  className="phone-only"
                  icon={<IconCaptions />}
                  title={captionsOn ? 'Captions on' : 'Captions'}
                  hint="Live captions"
                  onClick={() => {
                    setPopover(null);
                    if (!captionsOn && !captionSupported) {
                      toast('Live captions need Chrome or Edge on HTTPS.');
                      return;
                    }
                    setCaptionsOn((value) => !value);
                  }}
                />
                <MenuButton
                  className="phone-only"
                  icon={<IconLook />}
                  title="Background"
                  hint="Blur or replace"
                  onClick={() => setPopover('look')}
                />
                <p className="more-label">View</p>
                <MenuButton
                  icon={<IconExpand />}
                  title="Full screen"
                  hint="F"
                  onClick={() => {
                    setPopover(null);
                    void toggleFullscreen();
                  }}
                />
                <MenuButton
                  icon={<IconPip />}
                  title="Pop-out video"
                  hint="Keep me on top"
                  onClick={() => {
                    setPopover(null);
                    void popOut();
                  }}
                />
                {(canModerate || poll) && <p className="more-label">Meeting</p>}
                {canModerate && (
                  <MenuButton
                    icon={<IconPoll />}
                    title={poll ? 'New poll' : 'Start poll'}
                    hint="Quick vote"
                    onClick={() => {
                      setPopover(null);
                      setDialog('poll');
                    }}
                  />
                )}
                {poll && (
                  <MenuButton
                    icon={<IconPoll />}
                    title={pollHidden ? 'Show poll' : 'Hide poll'}
                    hint={poll.question}
                    onClick={() => {
                      setPollHidden((value) => !value);
                      setPopover(null);
                    }}
                  />
                )}
                <p className="more-label">Settings</p>
                <MenuButton
                  icon={<IconGear />}
                  title="Devices"
                  hint="Mic, camera, speaker"
                  onClick={() => {
                    setPopover(null);
                    setDialog('settings');
                  }}
                />
                <MenuButton
                  icon={<IconKeys />}
                  title="Shortcuts"
                  hint="Keyboard keys"
                  onClick={() => {
                    setPopover(null);
                    setDialog('shortcuts');
                  }}
                />
                {canModerate && (
                  <MenuButton
                    icon={<IconInfo />}
                    title="Meeting info"
                    hint="Code & invite link"
                    onClick={() => {
                      setPopover(null);
                      setDialog('details');
                    }}
                  />
                )}
                <MenuButton
                  icon={<IconBell />}
                  title={settings.sounds ? 'Sounds on' : 'Sounds off'}
                  hint="Join & chat alerts"
                  onClick={() => onSettings({ ...settings, sounds: !settings.sounds })}
                />
              </div>
            )}
          </div>
        </div>
        <div className="cgroup leave-group">
          <div className="cmdwrap">
            <button
              type="button"
              className="leave"
              aria-label="Leave"
              title="Leave (L)"
              aria-keyshortcuts="L"
              onClick={() => setPopover((value) => (value === 'leave' ? null : 'leave'))}
            >
              <IconLeave />
              <span>Leave</span>
            </button>
            {popover === 'leave' && (
              <div className="popover confirm leave-confirm" role="dialog" aria-label="Leave meeting">
                <div className="leave-confirm-icon" aria-hidden="true">
                  <IconLeave />
                </div>
                <div className="leave-confirm-copy">
                  <strong>Leave meeting?</strong>
                  <p>You can rejoin anytime with the same link.</p>
                </div>
                <div className="leave-confirm-actions">
                  <button type="button" className="secondary leave-stay" onClick={() => setPopover(null)}>
                    Stay
                  </button>
                  <button type="button" className="primary danger-btn leave-go" onClick={onLeave}>
                    Leave
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </footer>

      <div className="toasts" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className="toast">
            {item.text}
          </div>
        ))}
      </div>

      {dialog === 'settings' && (
        <SettingsDialog
          settings={settings}
          onChange={onSettings}
          onClose={() => setDialog(null)}
          onRetry={() => setDeviceNonce((value) => value + 1)}
        />
      )}
      {dialog === 'shortcuts' && <ShortcutsDialog onClose={() => setDialog(null)} />}
      {dialog === 'details' && canModerate && (
        <DetailsDialog
          code={code}
          isHost={isHost}
          hostName={isHost ? name : hostPeer?.name || 'Waiting for the host'}
          status={status}
          peers={peers}
          onCopy={() => void copyLink()}
          onRetry={retry}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'poll' && canModerate && (
        <PollDialog
          onClose={() => setDialog(null)}
          onCreate={(question, options) => {
            createPoll(question, options);
            setPollHidden(false);
          }}
        />
      )}
      {dialog === 'recordings' && recordReady && (
        <RecordingsDialog files={recordReady} onClose={() => setDialog(null)} />
      )}
      {dialog === 'facecast' && canRecord && (
        <FaceCastDialog
          recording={recording}
          people={[
            {
              id: myId,
              name,
              role: isHost ? 'Host' : isCoHost ? 'Co-host' : 'You',
              you: true,
            },
            ...peers.map((peer) => ({
              id: peer.id,
              name: peer.name,
              role:
                peer.id === hostId ? 'Host' : coHostIds.includes(peer.id) ? 'Co-host' : 'Guest',
              you: false,
            })),
          ]}
          selected={castIds}
          includeScreens={castScreens}
          hasScreens={sharing || peers.some((peer) => peer.sharing)}
          onClose={() => setDialog(null)}
          onConfirm={(next) => {
            if (recording) {
              applyCast(next, true);
              setDialog(null);
              toast('FaceCast cut updated · file follows this live.');
              return;
            }
            startFaceCast(next);
          }}
          director
        />
      )}
    </main>
  );
}

function Cmd({
  label,
  shortcut,
  pressed,
  danger,
  live,
  tone,
  badge,
  className,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  danger?: boolean;
  live?: boolean;
  tone?: 'hand';
  badge?: number;
  className?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx('cmd', danger && 'danger', live && 'live', tone === 'hand' && 'hand-live', className)}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onClick}
    >
      {children}
      <span>{label}</span>
      {badge ? <em className="badge">{badge}</em> : null}
    </button>
  );
}

function MenuButton({
  icon,
  title,
  hint,
  danger,
  className,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  danger?: boolean;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button type="button" className={cx('menu-row', danger && 'danger', className)} onClick={onClick}>
      <span className="menu-ico" aria-hidden="true">
        {icon}
      </span>
      <span className="menu-copy">
        <strong>{title}</strong>
        {hint ? <small>{hint}</small> : null}
      </span>
    </button>
  );
}

function MenuSvg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

function IconRecord() {
  return (
    <MenuSvg>
      <circle cx="12" cy="12" r="7" />
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </MenuSvg>
  );
}

function IconExpand() {
  return (
    <MenuSvg>
      <path d="M9 3H3v6" />
      <path d="M15 3h6v6" />
      <path d="M21 15v6h-6" />
      <path d="M3 15v6h6" />
    </MenuSvg>
  );
}

function IconPip() {
  return (
    <MenuSvg>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="11" width="7" height="6" rx="1" />
    </MenuSvg>
  );
}

function IconPoll() {
  return (
    <MenuSvg>
      <path d="M5 19V10" />
      <path d="M12 19V5" />
      <path d="M19 19v-7" />
    </MenuSvg>
  );
}

function IconGear() {
  return (
    <MenuSvg>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
    </MenuSvg>
  );
}

function IconKeys() {
  return (
    <MenuSvg>
      <rect x="3" y="7" width="18" height="12" rx="2" />
      <path d="M7 11h2M11 11h2M15 11h2M8 15h8" />
    </MenuSvg>
  );
}

function IconInfo() {
  return (
    <MenuSvg>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 10v6" />
      <circle cx="12" cy="7" r="0.8" fill="currentColor" stroke="none" />
    </MenuSvg>
  );
}

function IconBell() {
  return (
    <MenuSvg>
      <path d="M7 10a5 5 0 0 1 10 0c0 4 1.5 5 1.5 5H5.5S7 14 7 10z" />
      <path d="M10 18a2 2 0 0 0 4 0" />
    </MenuSvg>
  );
}

function Tile({
  tile,
  role,
  pinned,
  localRef,
  lookCanvas,
  casted,
  slow,
  onPin,
  onRetry,
}: {
  tile: TileModel;
  role: string;
  pinned: boolean;
  localRef?: RefObject<HTMLVideoElement | null>;
  lookCanvas?: HTMLCanvasElement | null;
  casted?: boolean;
  slow: boolean;
  onPin: () => void;
  onRetry: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const localCamera = tile.you && tile.kind === 'camera';
  const letters = initials(tile.name.replace(/'s screen$/, ''));
  const color = colorFor(tile.you ? tile.name : tile.name);
  const trackKey = tile.stream?.getTracks().map((track) => track.id).join(',') ?? '';
  useEffect(() => {
    if (localCamera) {
      const parent = slotRef.current;
      if (!parent) return;
      if (localRef) localRef.current = getPreviewVideo();
      return mountPreview(parent, tile.stream, {
        mirror: tile.mirrored,
        recordName: tile.name,
        recordOff: !tile.showVideo,
        conceal: Boolean(lookCanvas),
        recordPeer: tile.peerId,
        recordRole: role,
        recordColor: color,
        recordInitials: letters,
      });
    }
    const element = ref.current;
    if (!element) return;
    element.srcObject = tile.stream;
    if (tile.showVideo) void element.play().catch(() => undefined);
    return undefined;
  }, [color, letters, localCamera, localRef, lookCanvas, role, tile.mirrored, tile.name, tile.peerId, tile.showVideo, tile.stream, trackKey]);

  useEffect(() => {
    if (!localCamera || !lookCanvas) return;
    const parent = slotRef.current;
    if (!parent) return;
    lookCanvas.className = cx('fx-canvas', tile.mirrored && 'mirror');
    lookCanvas.dataset.recVideo = '1';
    lookCanvas.dataset.recKind = 'camera';
    lookCanvas.dataset.recName = tile.name;
    lookCanvas.dataset.recPeer = tile.peerId;
    lookCanvas.dataset.recRole = role;
    lookCanvas.dataset.recOff = tile.showVideo ? '0' : '1';
    lookCanvas.dataset.recColor = color;
    lookCanvas.dataset.recInitials = letters;
    const video = getPreviewVideo();
    video.dataset.recVideo = '0';
    parent.appendChild(lookCanvas);
    return () => {
      if (lookCanvas.parentElement === parent) lookCanvas.remove();
      video.dataset.recVideo = '1';
    };
  }, [color, letters, localCamera, lookCanvas, role, tile.mirrored, tile.name, tile.peerId, tile.showVideo]);
  const connecting =
    tile.kind === 'camera' && tile.connection && tile.connection !== 'connected'
      ? tile.connection === 'failed'
        ? 'Cannot reach them'
        : slow
          ? 'Still connecting…'
          : 'Connecting…'
      : '';

  return (
    <article className={cx('tile', tile.speaking && 'speaking', pinned && 'pinned', casted && 'casted')}>
      {localCamera ? (
        <div className="local-slot" ref={slotRef} />
      ) : (
        <video
          ref={ref}
          data-rec-video="1"
          data-rec-name={tile.name}
          data-rec-kind={tile.kind}
          data-rec-peer={tile.peerId}
          data-rec-role={role}
          data-rec-off={tile.showVideo ? '0' : '1'}
          data-rec-color={color}
          data-rec-initials={letters}
          className={cx('fit-contain', !tile.showVideo && 'is-off')}
          autoPlay
          muted
          playsInline
        />
      )}
      {!tile.showVideo && (
        <div className="avatar" style={{ background: color }}>
          {tile.kind === 'screen' ? 'Screen' : letters}
        </div>
      )}
      {tile.kind === 'screen' && !tile.showVideo && <p className="share-wait">Waiting for the screen…</p>}
      {casted && <div className="castflag">In FaceCast</div>}
      {(tile.hand || (tile.kind === 'camera' && !tile.micOn)) && (
        <div className="tile-badges">
          {tile.kind === 'camera' && !tile.micOn && (
            <div className="mute-badge" title="Muted" aria-label="Muted">
              <IconMicOff />
            </div>
          )}
          {tile.hand && (
            <div className="hand-badge" title="Hand raised" aria-label="Hand raised">
              <IconHand />
              <span>Hand raised</span>
            </div>
          )}
        </div>
      )}
      <div className="nameplate">
        {tile.kind === 'camera' && !tile.micOn && (
          <span className="nameplate-mic" aria-hidden="true">
            <IconMicOff />
          </span>
        )}
        <span>
          {tile.name}
          {tile.you && tile.kind === 'camera' ? ' (You)' : ''}
          {tile.kind === 'camera' ? ` \u00b7 ${role}` : ''}
          {tile.speaking ? ' \u00b7 Speaking' : ''}
          {pinned ? ' \u00b7 Pinned' : ''}
        </span>
      </div>
      {connecting && (
        <div className="connline">
          <span>{connecting}</span>
          {(tile.connection === 'failed' || slow) && !tile.you && (
            <button type="button" onClick={onRetry}>
              Try again
            </button>
          )}
        </div>
      )}
      <button type="button" className={cx('pinbtn', pinned && 'on')} onClick={onPin}>
        <IconPin />
        {pinned ? 'Unpin' : 'Pin'}
      </button>
    </article>
  );
}

function RemoteAudio({
  stream,
  sinkId,
  onBlocked,
}: {
  stream: MediaStream | null;
  sinkId: string;
  onBlocked: () => void;
}) {
  const ref = useRef<HTMLAudioElement>(null);
  const blockedRef = useRef(onBlocked);
  blockedRef.current = onBlocked;
  const key =
    stream
      ?.getAudioTracks()
      .map((track) => `${track.id}:${track.readyState}:${track.enabled ? 1 : 0}`)
      .join(',') ?? '';
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    stream?.getAudioTracks().forEach((track) => {
      if (track.readyState === 'live') track.enabled = true;
    });
    element.muted = false;
    element.volume = 1;
    element.autoplay = true;
    element.srcObject = stream;
    const withSink = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (sinkId && withSink.setSinkId) void withSink.setSinkId(sinkId).catch(() => undefined);
    const tryPlay = () => {
      void element.play().catch(() => blockedRef.current());
    };
    tryPlay();
    const onGesture = () => tryPlay();
    window.addEventListener('pointerdown', onGesture, { once: true });
    window.addEventListener('keydown', onGesture, { once: true });
    return () => {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    };
  }, [key, sinkId, stream]);
  return <audio ref={ref} autoPlay playsInline preload="auto" />;
}

function PeopleList({
  youName,
  youMic,
  youCam,
  youHand,
  youSharing,
  isHost,
  canModerate,
  hostId,
  coHostIds,
  myId,
  peers,
  waiting,
  confirmRemove,
  onConfirm,
  onPin,
  pin,
  onRetry,
  onModerate,
  onKick,
  onAdmit,
  onDeny,
  onCohost,
}: {
  youName: string;
  youMic: boolean;
  youCam: boolean;
  youHand: boolean;
  youSharing: boolean;
  isHost: boolean;
  canModerate: boolean;
  hostId: string | null;
  coHostIds: string[];
  myId: string;
  peers: RemotePeer[];
  waiting: { id: string; name: string }[];
  confirmRemove: string | null;
  onConfirm: (id: string | null) => void;
  onPin: (id: string) => void;
  pin: string | null;
  onRetry: (id: string) => void;
  onModerate: (id: string, action: 'mute-mic' | 'mute-cam' | 'ask-mic' | 'ask-cam') => void;
  onKick: (id: string) => void;
  onAdmit: (id: string) => void;
  onDeny: (id: string) => void;
  onCohost: (id: string, on: boolean) => void;
}) {
  const rows = [
    {
      id: myId,
      name: youName,
      micOn: youMic,
      camOn: youCam,
      hand: youHand,
      sharing: youSharing,
      you: true,
      connection: 'connected' as const,
    },
    ...peers.map((peer) => ({ ...peer, you: false })),
  ];
  const hands = rows.filter((row) => row.hand);
  return (
    <div className="people">
      {canModerate && waiting.length > 0 && (
        <div className="admit-panel">
          <div className="admit-panel-head">
            <strong>Waiting to join</strong>
            <span>{waiting.length}</span>
          </div>
          <ul className="admit-list">
            {waiting.map((person) => (
              <li key={person.id} className="admit-card">
                <span className="avatar sm" style={{ background: colorFor(person.name) }}>
                  {initials(person.name)}
                </span>
                <div className="admit-meta">
                  <strong>{person.name}</strong>
                  <small>Knocking at the door</small>
                </div>
                <div className="admit-actions">
                  <button type="button" className="admit-yes" onClick={() => onAdmit(person.id)}>
                    Admit
                  </button>
                  <button type="button" className="admit-no" onClick={() => onDeny(person.id)}>
                    Deny
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {waiting.length > 1 && (
            <button type="button" className="admit-all" onClick={() => waiting.forEach((person) => onAdmit(person.id))}>
              Admit everyone
            </button>
          )}
        </div>
      )}
      {hands.length > 0 && (
        <div className="hands">
          <strong>Hands raised ({hands.length})</strong>
          <ul>
            {hands.map((row) => (
              <li key={row.id}>{row.name}</li>
            ))}
          </ul>
        </div>
      )}
      {rows.map((row) => {
        const role =
          row.id === hostId ? 'Host' : coHostIds.includes(row.id) ? 'Co-host' : row.you ? 'You' : 'Guest';
        const label = row.you ? `${row.name} (You)` : row.name;
        const canControl =
          canModerate && !row.you && row.id !== hostId && (isHost || !coHostIds.includes(row.id));
        return (
          <article key={row.id} className="person">
            <div className="avatar sm" style={{ background: colorFor(row.you ? youName : row.name) }}>
              {initials(row.you ? youName : row.name)}
            </div>
            <div className="person-main">
              <div className="person-title">
                <strong>{label}</strong>
                <em className={role === 'Host' || role === 'Co-host' ? 'role-badge' : 'role-soft'}>{role}</em>
              </div>
              <span>
                {[
                  row.connection !== 'connected' ? (row.connection === 'failed' ? 'Cannot reach' : 'Connecting…') : '',
                  row.micOn ? 'Mic on' : 'Mic off',
                  row.camOn ? 'Cam on' : 'Cam off',
                  row.hand ? 'Hand up' : '',
                  row.sharing ? 'Sharing' : '',
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
              <div className="person-actions">
                <button type="button" className="pact" onClick={() => onPin(row.id)} title="Pin">
                  {pin === `cam:${row.id}` ? 'Unpin' : 'Pin'}
                </button>
                {!row.you && row.connection !== 'connected' && (
                  <button type="button" className="pact" onClick={() => onRetry(row.id)} title="Retry connection">
                    Retry
                  </button>
                )}
                {canControl && (
                  <button
                    type="button"
                    className="pact"
                    title={row.micOn ? 'Turn microphone off' : 'Ask to unmute'}
                    onClick={() => onModerate(row.id, row.micOn ? 'mute-mic' : 'ask-mic')}
                  >
                    {row.micOn ? 'Mute' : 'Unmute'}
                  </button>
                )}
                {canControl && (
                  <button
                    type="button"
                    className="pact"
                    title={row.camOn ? 'Turn camera off' : 'Ask for camera'}
                    onClick={() => onModerate(row.id, row.camOn ? 'mute-cam' : 'ask-cam')}
                  >
                    {row.camOn ? 'Cam off' : 'Cam on'}
                  </button>
                )}
                {isHost && !row.you && row.id !== hostId && (
                  <button
                    type="button"
                    className={coHostIds.includes(row.id) ? 'pact on' : 'pact'}
                    title={coHostIds.includes(row.id) ? 'Remove co-host' : 'Make co-host'}
                    onClick={() => onCohost(row.id, !coHostIds.includes(row.id))}
                  >
                    {coHostIds.includes(row.id) ? 'Co-host ?' : 'Co-host'}
                  </button>
                )}
                {canControl && confirmRemove !== row.id && (
                  <button type="button" className="pact danger" onClick={() => onConfirm(row.id)} title="Remove">
                    Remove
                  </button>
                )}
                {canControl && confirmRemove === row.id && (
                  <button type="button" className="pact danger" onClick={() => onKick(row.id)}>
                    Confirm?
                  </button>
                )}
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function CatchUpPanel({ events, onOpenChat }: { events: CatchUpEvent[]; onOpenChat: () => void }) {
  return (
    <div className="catchup">
      <header className="catchup-head">
        <h2>Catch-Up</h2>
        <p>What you missed before joining.</p>
      </header>
      {events.length === 0 ? (
        <p className="empty">Nothing yet ? you are caught up.</p>
      ) : (
        <ul className="catchup-list">
          {events.map((event) => (
            <li key={event.id} data-kind={event.kind}>
              <time>
                {new Date(event.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </time>
              <span>{event.text}</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="secondary" onClick={onOpenChat}>
        View full notes
      </button>
    </div>
  );
}

function AdmitBanner({
  waiting,
  onReview,
  onAdmit,
  onDeny,
  onAdmitAll,
}: {
  waiting: { id: string; name: string }[];
  onReview: () => void;
  onAdmit: (id: string) => void;
  onDeny: (id: string) => void;
  onAdmitAll: () => void;
}) {
  const first = waiting[0];
  return (
    <div className="admit-banner" role="status">
      <div className="admit-banner-avatars" aria-hidden="true">
        {waiting.slice(0, 3).map((person) => (
          <span key={person.id} className="avatar xs" style={{ background: colorFor(person.name) }}>
            {initials(person.name)}
          </span>
        ))}
      </div>
      <div className="admit-banner-copy">
        <strong>
          {waiting.length === 1 ? `${first.name} wants to join` : `${waiting.length} people waiting`}
        </strong>
        <span>Admit them to let them into the meeting</span>
      </div>
      <div className="admit-banner-actions">
        {waiting.length === 1 ? (
          <>
            <button type="button" className="admit-yes" onClick={() => onAdmit(first.id)}>
              Admit
            </button>
            <button type="button" className="admit-no" onClick={() => onDeny(first.id)}>
              Deny
            </button>
          </>
        ) : (
          <button type="button" className="admit-yes" onClick={onAdmitAll}>
            Admit all
          </button>
        )}
        <button type="button" className="secondary slim" onClick={onReview}>
          Review
        </button>
      </div>
    </div>
  );
}

function PollCard({
  poll,
  myId,
  canEnd,
  onVote,
  onEnd,
  onHide,
}: {
  poll: { id: string; question: string; options: string[]; votes: Record<string, number>; closed: boolean };
  myId: string;
  canEnd: boolean;
  onVote: (option: number) => void;
  onEnd: () => void;
  onHide: () => void;
}) {
  const mine = poll.votes[myId];
  return (
    <section className="poll" aria-label="Poll">
      <header>
        <strong>Poll</strong>
        <button type="button" className="textbtn" onClick={onHide}>
          Hide
        </button>
      </header>
      <h3>{poll.question}</h3>
      {poll.options.map((option, index) => {
        const count = Object.values(poll.votes).filter((vote) => vote === index).length;
        return (
          <button
            key={`${poll.id}-${index}`}
            type="button"
            className={mine === index ? 'poll-opt mine' : 'poll-opt'}
            disabled={poll.closed}
            onClick={() => onVote(index)}
          >
            <span>{option}</span>
            <span>{count}</span>
          </button>
        );
      })}
      <p>
        {Object.keys(poll.votes).length} votes{poll.closed ? ' · Closed' : ''}
        {mine !== undefined ? ' · You voted' : ''}
      </p>
      {canEnd && !poll.closed && (
        <button type="button" className="secondary slim" onClick={onEnd}>
          End poll
        </button>
      )}
    </section>
  );
}

function FaceCastDialog({
  recording,
  people,
  selected,
  includeScreens,
  hasScreens,
  onClose,
  onConfirm,
  director,
}: {
  recording: boolean;
  people: { id: string; name: string; role: string; you: boolean }[];
  selected: string[];
  includeScreens: boolean;
  hasScreens: boolean;
  onClose: () => void;
  onConfirm: (cast: RecordCast) => void;
  director?: boolean;
}) {
  const [ids, setIds] = useState(selected);
  const [screens, setScreens] = useState(includeScreens);

  function toggle(id: string) {
    setIds((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
  }

  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div
        className="modal facecast-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="facecast-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="modal-head">
          <h2 id="facecast-title">{recording ? 'Live FaceCast cut' : 'FaceCast director'}</h2>
          <button type="button" className="textbtn" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="hint">
          {director
            ? 'When you stop, LetsConnect saves a ZIP with 4 videos: host only, host+guests, screen share, and chat.'
            : 'Pick who belongs in the room cut. You still get host, screen, and chat videos in the ZIP.'}
        </p>
        <div className="cast-actions">
          <button type="button" className="secondary slim" onClick={() => setIds(people.map((person) => person.id))}>
            Everyone
          </button>
          <button
            type="button"
            className="secondary slim"
            onClick={() => setIds(people.filter((person) => person.role === 'Host' || person.you).map((person) => person.id))}
          >
            Hosts only
          </button>
          <button
            type="button"
            className="secondary slim"
            onClick={() => setIds(people.filter((person) => person.role === 'Guest').map((person) => person.id))}
          >
            Guests only
          </button>
          <button type="button" className="textbtn" onClick={() => setIds([])}>
            Clear
          </button>
        </div>
        <ul className="cast-list">
          {people.map((person) => {
            const on = ids.includes(person.id);
            return (
              <li key={person.id}>
                <button type="button" className={on ? 'cast-person on' : 'cast-person'} onClick={() => toggle(person.id)}>
                  <span className="avatar sm" style={{ background: colorFor(person.name) }}>
                    {initials(person.name)}
                  </span>
                  <span>
                    <strong>
                      {person.name}
                      {person.you ? ' (You)' : ''}
                    </strong>
                    <small>{person.role}</small>
                  </span>
                  <em>{on ? 'Included' : 'Skip'}</em>
                </button>
              </li>
            );
          })}
        </ul>
        {hasScreens && (
          <label className="check">
            <input type="checkbox" checked={screens} onChange={(event) => setScreens(event.target.checked)} />
            <span>Also include screen shares in this FaceCast</span>
          </label>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="primary"
            disabled={!ids.length && !screens}
            onClick={() =>
              onConfirm({
                peerIds: ids,
                includeScreens: screens,
                includeAudioFromOthers: true,
              })
            }
          >
            {recording ? 'Apply cut' : 'Start FaceCast'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CastDirector({
  people,
  selected,
  includeScreens,
  hasScreens,
  onToggle,
  onScreens,
  onOpen,
}: {
  people: { id: string; name: string }[];
  selected: string[];
  includeScreens: boolean;
  hasScreens: boolean;
  onToggle: (id: string) => void;
  onScreens: () => void;
  onOpen: () => void;
}) {
  return (
    <div className="cast-director" aria-label="FaceCast director">
      <div className="cast-director-head">
        <strong>FaceCast cut</strong>
        <span>Tap to show or hide faces in the recording</span>
        <button type="button" className="textbtn" onClick={onOpen}>
          Full list
        </button>
      </div>
      <div className="cast-chips">
        {people.map((person) => {
          const on = selected.includes(person.id);
          return (
            <button
              key={person.id}
              type="button"
              className={on ? 'cast-chip on' : 'cast-chip'}
              onClick={() => onToggle(person.id)}
              title={on ? `Hide ${person.name} from FaceCast` : `Show ${person.name} in FaceCast`}
            >
              <span className="avatar xs" style={{ background: colorFor(person.name) }}>
                {initials(person.name)}
              </span>
              {person.name}
            </button>
          );
        })}
        {hasScreens && (
          <button type="button" className={includeScreens ? 'cast-chip on' : 'cast-chip'} onClick={onScreens}>
            Screen share
          </button>
        )}
      </div>
    </div>
  );
}

function WaitingRoom({
  code,
  name,
  gate,
  asHost = false,
  stream,
  camOn,
  micOn,
  theme,
  onTheme,
  onCam,
  onMic,
  onLeave,
  onCopy,
}: {
  code: string;
  name: string;
  gate: 'connecting' | 'waiting';
  asHost?: boolean;
  stream: MediaStream | null;
  camOn: boolean;
  micOn: boolean;
  theme: Settings['theme'];
  onTheme: (theme: Settings['theme']) => void;
  onCam: () => void;
  onMic: () => void;
  onLeave: () => void;
  onCopy: () => void;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const parent = previewRef.current;
    if (!parent) return;
    return mountPreview(parent, stream, {
      mirror: true,
      recordOff: !camOn,
    });
  }, [camOn, stream]);

  const hostStarting = asHost;
  const kicker = hostStarting
    ? 'Starting\u2026'
    : gate === 'connecting'
      ? 'Connecting\u2026'
      : 'Knock sent';
  const title = hostStarting
    ? 'Opening your meeting'
    : gate === 'connecting'
      ? 'Reaching the room\u2026'
      : 'Waiting for the host';
  const detail = hostStarting
    ? 'You are the host. Entering the room now \u2014 guests who use your link will knock first.'
    : gate === 'connecting'
      ? 'One moment while we find the meeting.'
      : `You'll appear as ${name}. The host or a co-host will let you in.`;

  return (
    <main className={hostStarting ? 'waiting-room host-start' : 'waiting-room'}>
      <div className="waiting-glow" aria-hidden="true" />
      <section className="waiting-shell">
        <header className="waiting-brand">
          <Logo size={28} />
          <div>
            <strong>LetsConnect</strong>
            <span>{code}</span>
          </div>
          <ThemeButton theme={theme} onChange={onTheme} />
        </header>
        <div className="waiting-stage">
          <div className="waiting-preview">
            <div className="preview-slot" ref={previewRef} />
            {!camOn && (
              <div className="avatar xl" style={{ background: colorFor(name) }}>
                {initials(name)}
              </div>
            )}
            <div className="waiting-pulse" aria-hidden="true">
              <i />
              <i />
            </div>
          </div>
          <div className="waiting-copy">
            <p className="waiting-kicker">{kicker}</p>
            <h1>{title}</h1>
            <p>{detail}</p>
            {(gate === 'waiting' || hostStarting) && (
              <div className="waiting-dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            )}
          </div>
        </div>
        <div className="waiting-toolbar">
          <button type="button" className={micOn ? 'waiting-toggle' : 'waiting-toggle off'} onClick={onMic}>
            {micOn ? 'Mic on' : 'Mic off'}
          </button>
          <button type="button" className={camOn ? 'waiting-toggle' : 'waiting-toggle off'} onClick={onCam}>
            {camOn ? 'Camera on' : 'Camera off'}
          </button>
          <button type="button" className="waiting-toggle" onClick={onCopy}>
            Copy link
          </button>
          <button type="button" className="primary" onClick={onLeave}>
            Cancel
          </button>
        </div>
      </section>
    </main>
  );
}

function PollDialog({ onClose, onCreate }: { onClose: () => void; onCreate: (question: string, options: string[]) => void }) {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['Yes', 'No']);
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <form
        className="modal"
        role="dialog"
        aria-labelledby="poll-title"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          const clean = options.map((option) => option.trim()).filter(Boolean);
          if (!question.trim() || clean.length < 2) return;
          onCreate(question, clean);
          onClose();
        }}
      >
        <header className="modal-head">
          <h2 id="poll-title">Start a poll</h2>
          <button type="button" className="textbtn" onClick={onClose}>
            Close
          </button>
        </header>
        <label className="field">
          <span>Question</span>
          <input value={question} maxLength={140} onChange={(event) => setQuestion(event.target.value)} required />
        </label>
        {options.map((option, index) => (
          <label className="field" key={index}>
            <span>Option {index + 1}</span>
            <input
              value={option}
              maxLength={48}
              onChange={(event) => setOptions(options.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))}
              required
            />
          </label>
        ))}
        {options.length < 4 && (
          <button type="button" className="textbtn" onClick={() => setOptions([...options, ''])}>
            Add option
          </button>
        )}
        <div className="modal-actions">
          <button type="button" className="secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="primary">
            Start poll
          </button>
        </div>
      </form>
    </div>
  );
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-labelledby="keys-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2 id="keys-title">Keyboard shortcuts</h2>
          <button type="button" className="textbtn" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="hint">These keys work when you are not typing in a message.</p>
        <ul className="keys">
          {shortcuts.map(([key, label]) => (
            <li key={key}>
              <kbd>{key}</kbd>
              <span>{label}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function DetailsDialog({
  code,
  isHost,
  hostName,
  status,
  peers,
  onCopy,
  onRetry,
  onClose,
}: {
  code: string;
  isHost: boolean;
  hostName: string;
  status: string;
  peers: RemotePeer[];
  onCopy: () => void;
  onRetry: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-back" onMouseDown={onClose}>
      <div className="modal" role="dialog" aria-labelledby="details-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-head">
          <h2 id="details-title">Meeting details</h2>
          <button type="button" className="textbtn" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="code-lg">{code}</p>
        <p>
          {isHost
            ? 'You are the host. Anyone with the link asks to join · admit or deny them from People.'
            : `Host: ${hostName}.`}
        </p>
        <p>Meeting server: {status === 'connected' ? 'Connected' : 'Not connected yet'}.</p>
        <button type="button" className="secondary" onClick={onCopy}>
          Copy invite link
        </button>
        <ul className="list plain">
          {peers.map((peer) => (
            <li key={peer.id}>
              <div>
                <strong>{peer.name}</strong>
                <span>
                  {peer.connection === 'connected'
                    ? 'Video connected'
                    : peer.connection === 'failed'
                      ? 'Cannot reach them. Their network may be blocking direct video.'
                      : 'Connecting…'}
                </span>
              </div>
              {peer.connection !== 'connected' && (
                <button type="button" onClick={() => onRetry(peer.id)}>
                  Try again
                </button>
              )}
            </li>
          ))}
          {peers.length === 0 && <li>No one else is here yet.</li>}
        </ul>
        <p className="hint">
          Anyone with the link can join on this Wi-Fi. Video quality is best under about 12 people on a mesh call; the
          grid supports denser rooms when your network can handle it.
        </p>
      </div>
    </div>
  );
}
