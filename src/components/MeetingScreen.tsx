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
import { createRecorder, downloadBlob, type RecordCast } from '../lib/record';
import { beep } from '../lib/sound';
import { useCaptions } from '../hooks/useCaptions';
import { useRoom, type RemotePeer } from '../hooks/useRoom';
import { useToasts } from '../hooks/useToasts';
import { SettingsDialog } from './SettingsDialog';
import type { Settings } from '../types';

type Props = {
  code: string;
  settings: Settings;
  initialStream: MediaStream | null;
  onSettings: (settings: Settings) => void;
  onLeave: () => void;
};

type Layout = 'grid' | 'speaker' | 'sidebar';
type Panel = 'chat' | 'people' | null;
type Popover = 'react' | 'more' | 'leave' | 'look' | null;
type Dialog = 'settings' | 'shortcuts' | 'details' | 'poll' | 'facecast' | null;

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
  ['👍', 'Thumbs up'],
  ['👏', 'Clap'],
  ['❤️', 'Heart'],
  ['😂', 'Laugh'],
  ['😮', 'Wow'],
  ['🎉', 'Celebrate'],
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

function useLoudest(items: { id: string; track: MediaStreamTrack | null }[]) {
  const [active, setActive] = useState<string | null>(null);
  const key = items.map((item) => `${item.id}:${item.track?.id ?? ''}:${item.track?.enabled ? 1 : 0}`).join('|');
  useEffect(() => {
    const live = items.filter((item) => item.track && item.track.readyState === 'live' && item.track.enabled);
    if (!live.length) {
      setActive(null);
      return;
    }
    const ctx = new AudioContext();
    const analysers = live.map((item) => {
      const source = ctx.createMediaStreamSource(new MediaStream([item.track!]));
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      return { id: item.id, analyser, data: new Uint8Array(analyser.fftSize) };
    });
    let current: string | null = null;
    let holdUntil = 0;
    const timer = window.setInterval(() => {
      void ctx.resume();
      let best = '';
      let bestValue = 0;
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
      }
      const time = Date.now();
      if (bestValue > 12) {
        current = best;
        holdUntil = time + 1600;
        setActive(best);
      } else if (current && time > holdUntil) {
        current = null;
        setActive(null);
      }
    }, 200);
    return () => {
      window.clearInterval(timer);
      void ctx.close();
    };
    // The key captures the track list for this run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return active;
}

export function MeetingScreen({ code, settings, initialStream, onSettings, onLeave }: Props) {
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
  const [hideTip, setHideTip] = useState(() => sessionStorage.getItem('qm-tip') === '1');
  const [chatText, setChatText] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [deviceNonce, setDeviceNonce] = useState(0);

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

  const {
    myId,
    status,
    peers,
    chat,
    reactions: reactionItems,
    caption,
    kickedBy,
    hostId,
    ask,
    poll,
    dismissAsk,
    sendChat,
    sendReaction,
    sendCaption,
    kick,
    moderate,
    retry,
    setScreenTrack,
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
    onForceMute: (kind) => {
      if (kind === 'mic') setMicOn(false);
      else setCamOn(false);
      toast(kind === 'mic' ? 'The host turned your microphone off.' : 'The host turned your camera off.');
    },
  });

  const captionSupported = useCaptions(captionsOn, (text) => {
    const time = Date.now();
    if (time - lastCaption.current < 280) return;
    lastCaption.current = time;
    sendCaption(text);
  });

  const name = safeName(settings.name);
  const isHost = hostId === myId;
  const hostPeer = peers.find((peer) => peer.id === hostId);
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
        void recorder.stop().then((blob) => {
          if (blob.size) downloadBlob(blob, `quickmeet-${code}.webm`);
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
    if (!kickedBy) return;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    screenRef.current?.getTracks().forEach((track) => track.stop());
  }, [kickedBy]);

  useEffect(() => {
    if (captionsOn && !captionSupported) toast('Live captions need Chrome or Edge.');
  }, [captionSupported, captionsOn, toast]);

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

  const loudest = useLoudest([
    { id: myId, track: micOn ? stream?.getAudioTracks()[0] ?? null : null },
    ...peers.map((peer) => ({
      id: peer.id,
      track: peer.micOn ? peer.audio?.getAudioTracks()[0] ?? null : null,
    })),
  ]);

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
    } catch {
      toast('Could not share the screen.');
    }
  }

  function openFaceCast() {
    const everyone = [myId, ...peers.map((peer) => peer.id)];
    setCastIds((current) => (current.length ? current.filter((id) => everyone.includes(id)) : everyone));
    setCastScreens(sharing || peers.some((peer) => peer.sharing));
    setDialog('facecast');
  }

  async function toggleRecord() {
    if (recorderRef.current) {
      const blob = await recorderRef.current.stop();
      recorderRef.current = null;
      setRecording(false);
      if (blob.size) {
        downloadBlob(blob, `facecast-${code}.webm`);
        toast('FaceCast saved to your downloads.');
      } else toast('Recording was empty.');
      return;
    }
    openFaceCast();
  }

  function startFaceCast(next: RecordCast) {
    if (!stageRef.current) return;
    castRef.current = next;
    setCastIds(next.peerIds);
    setCastScreens(next.includeScreens);
    const recorder = createRecorder(stageRef.current, () => audioTracksRef.current(), next);
    if (!recorder) {
      toast('This browser cannot record the meeting.');
      return;
    }
    recorderRef.current = recorder;
    setRecording(true);
    setDialog(null);
    toast(`FaceCast started with ${next.peerIds.length} people. Change who is included anytime.`);
  }

  function applyCast(next: RecordCast) {
    castRef.current = next;
    setCastIds(next.peerIds);
    setCastScreens(next.includeScreens);
    recorderRef.current?.setCast(next);
  }

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
      tile.kind === 'screen' ? 'Screen' : tile.you ? (isHost ? 'Host' : 'You') : tile.peerId === hostId ? 'Host' : 'Guest';
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
        ? `FaceCast · ${castIds.length} face${castIds.length === 1 ? '' : 's'}`
        : `${recorders.join(', ')} recording`;
  const serverMessage =
    status === 'connected'
      ? ''
      : status === 'reconnecting'
        ? 'Reconnecting to the meeting server…'
        : now - downSince.current > 8000
          ? 'Cannot reach the meeting server. Keep the terminal that started the app open, then refresh.'
          : 'Connecting to the meeting server…';
  const sharers = [
    sharing ? 'You are sharing your screen' : null,
    ...peers.filter((peer) => peer.sharing).map((peer) => `${peer.name} is sharing their screen`),
  ].filter((item): item is string => Boolean(item));

  if (kickedBy) {
    return (
      <main className="home kicked">
        <section className="card narrow">
          <h1>{kickedBy} removed you from the meeting</h1>
          <p>You can join again with the same link.</p>
          <button type="button" className="primary" onClick={onLeave}>
            Back to home
          </button>
        </section>
      </main>
    );
  }

  const mainTile =
    cameras.find((tile) => tile.key === pin) ||
    cameras.find((tile) => tile.speaking) ||
    cameras.find((tile) => !tile.you) ||
    cameras[0];
  const otherTiles = cameras.filter((tile) => tile.key !== mainTile.key);

  return (
    <main className="room" ref={roomRef}>
      <header className="topbar">
        <div className="top-id">
          <Logo size={22} />
          <strong>QuickMeet</strong>
          <code>{code}</code>
          <button type="button" className="secondary slim" onClick={() => void copyLink()}>
            Copy link
          </button>
        </div>
        <div className="top-mid">
          <span className="time">Time {formatElapsed(now - started.current)}</span>
          {isHost ? <span className="pill">You are the host</span> : hostPeer ? <span className="pill">Host: {hostPeer.name}</span> : null}
          {recordingText && (
            <span className="recpill">
              <i />
              {recordingText}
            </span>
          )}
          <ThemeButton theme={settings.theme} onChange={(theme) => onSettings({ ...settings, theme })} />
        </div>
        <div className="seg" aria-label="Layout">
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
      </header>

      <div className="banners">
        {serverMessage && <div className="banner warn">{serverMessage}</div>}
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
            <span>You are the only person here. Copy the link and send it to the people you want.</span>
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
                sessionStorage.setItem('qm-tip', '1');
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
              canEnd={poll.owner === myId || isHost}
              onVote={vote}
              onEnd={endPoll}
              onHide={() => setPollHidden(true)}
            />
          )}
        </div>

        {panel && (
          <aside className="side" aria-label={panel === 'chat' ? 'Chat' : 'People'}>
            <div className="side-tabs">
              <button type="button" aria-pressed={panel === 'chat'} onClick={() => setPanel('chat')}>
                Chat
              </button>
              <button type="button" aria-pressed={panel === 'people'} onClick={() => setPanel('people')}>
                People ({peers.length + 1})
              </button>
              <button type="button" className="textbtn" onClick={() => setPanel(null)}>
                Close
              </button>
            </div>
            {panel === 'chat' ? (
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
                myId={myId}
                peers={peers}
                confirmRemove={confirmRemove}
                onConfirm={setConfirmRemove}
                onPin={(id) => setPin((current) => (current === `cam:${id}` ? null : `cam:${id}`))}
                pin={pin}
                onRetry={retry}
                onModerate={moderate}
                onKick={kick}
              />
            )}
          </aside>
        )}
      </div>

      {peers.map((peer) => (
        <RemoteAudio key={peer.id} stream={peer.audio} sinkId={settings.speakerId} onBlocked={() => setHear(true)} />
      ))}

      {popover && <button type="button" className="backdrop" aria-label="Close menu" onClick={() => setPopover(null)} />}

      <footer className="controls">
        <div className="cgroup">
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
          <Cmd label={sharing ? 'Stop' : 'Share'} shortcut="S" live={sharing} pressed={sharing} onClick={() => void toggleShare()}>
            <IconShare />
          </Cmd>
        </div>
        <div className="cgroup">
          <Cmd label={hand ? 'Lower' : 'Hand'} shortcut="H" live={hand} pressed={hand} onClick={() => setHand((value) => !value)}>
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
            label={captionsOn ? 'On' : 'Captions'}
            shortcut="K"
            live={captionsOn}
            pressed={captionsOn}
            onClick={() => setCaptionsOn((value) => !value)}
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
        <div className="cgroup">
          <Cmd label={unread ? `Chat ${unread}` : 'Chat'} shortcut="C" live={panel === 'chat'} badge={unread} onClick={() => togglePanel('chat')}>
            <IconChat />
          </Cmd>
          <Cmd
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
                <MenuButton
                  title={recording ? 'Stop FaceCast' : 'FaceCast recording'}
                  detail="Pick host, guests, or anyone — only their faces go in the file"
                  onClick={() => {
                    setPopover(null);
                    void toggleRecord();
                  }}
                />
                {recording && (
                  <MenuButton
                    title="Change FaceCast people"
                    detail="Add or remove faces while the recording keeps going"
                    onClick={() => {
                      setPopover(null);
                      openFaceCast();
                    }}
                  />
                )}
                <MenuButton title="Full screen" detail="Fill this display" onClick={() => void toggleFullscreen()} />
                <MenuButton title="Pop out my video" detail="A small window that stays on top" onClick={() => void popOut()} />
                <MenuButton
                  title={poll ? 'Start a new poll' : 'Start a poll'}
                  detail="Everyone can vote, and the counts stay visible"
                  onClick={() => {
                    setPopover(null);
                    setDialog('poll');
                  }}
                />
                {poll && (
                  <MenuButton
                    title={pollHidden ? 'Show poll' : 'Hide poll'}
                    detail={poll.question}
                    onClick={() => {
                      setPollHidden((value) => !value);
                      setPopover(null);
                    }}
                  />
                )}
                <MenuButton
                  title="Audio and video settings"
                  detail="Microphone, camera, speaker, and your name"
                  onClick={() => {
                    setPopover(null);
                    setDialog('settings');
                  }}
                />
                <MenuButton
                  title="Keyboard shortcuts"
                  detail="The letter keys that run each control"
                  onClick={() => {
                    setPopover(null);
                    setDialog('shortcuts');
                  }}
                />
                <MenuButton
                  title="Meeting details"
                  detail="Code, invite link, and connection"
                  onClick={() => {
                    setPopover(null);
                    setDialog('details');
                  }}
                />
                <MenuButton
                  title={settings.sounds ? 'Sound alerts on' : 'Sound alerts off'}
                  detail="A soft sound when someone joins or chats"
                  onClick={() => onSettings({ ...settings, sounds: !settings.sounds })}
                />
              </div>
            )}
          </div>
        </div>
        <div className="cmdwrap">
          <button
            type="button"
            className="leave"
            aria-keyshortcuts="L"
            onClick={() => setPopover((value) => (value === 'leave' ? null : 'leave'))}
          >
            <IconLeave />
            Leave
          </button>
          {popover === 'leave' && (
            <div className="popover confirm" role="dialog" aria-label="Leave meeting">
              <p>Leave this meeting?</p>
              <button type="button" className="primary danger-btn" onClick={onLeave}>
                Leave now
              </button>
              <button type="button" className="secondary" onClick={() => setPopover(null)}>
                Stay
              </button>
            </div>
          )}
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
      {dialog === 'details' && (
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
      {dialog === 'poll' && (
        <PollDialog
          onClose={() => setDialog(null)}
          onCreate={(question, options) => {
            createPoll(question, options);
            setPollHidden(false);
          }}
        />
      )}
      {dialog === 'facecast' && (
        <FaceCastDialog
          recording={recording}
          people={[
            { id: myId, name, role: isHost ? 'Host' : 'You', you: true },
            ...peers.map((peer) => ({
              id: peer.id,
              name: peer.name,
              role: peer.id === hostId ? 'Host' : 'Guest',
              you: false,
            })),
          ]}
          selected={castIds}
          includeScreens={castScreens}
          hasScreens={sharing || peers.some((peer) => peer.sharing)}
          onClose={() => setDialog(null)}
          onConfirm={(next) => {
            if (recording) {
              applyCast(next);
              setDialog(null);
              toast('FaceCast people updated.');
              return;
            }
            startFaceCast(next);
          }}
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
  badge,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  pressed?: boolean;
  danger?: boolean;
  live?: boolean;
  badge?: number;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx('cmd', danger && 'danger', live && 'live')}
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

function MenuButton({ title, detail, onClick }: { title: string; detail: string; onClick: () => void }) {
  return (
    <button type="button" className="menu-row" onClick={onClick}>
      <strong>{title}</strong>
      <small>{detail}</small>
    </button>
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
      {tile.hand && (
        <div className="hand-badge" title="Hand raised" aria-label="Hand raised">
          <IconHand />
        </div>
      )}
      <div className="nameplate">
        <span>
          {tile.name}
          {tile.you && tile.kind === 'camera' ? ' (You)' : ''}
          {tile.kind === 'camera' ? ` · ${role}` : ''}
          {tile.kind === 'camera' && !tile.micOn ? ' · Muted' : ''}
          {tile.speaking ? ' · Speaking' : ''}
          {pinned ? ' · Pinned' : ''}
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
  const key = stream?.getAudioTracks().map((track) => track.id).join(',') ?? '';
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    element.srcObject = stream;
    const withSink = element as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (sinkId && withSink.setSinkId) void withSink.setSinkId(sinkId).catch(() => undefined);
    void element.play().catch(() => blockedRef.current());
  }, [key, sinkId, stream]);
  return <audio ref={ref} autoPlay playsInline />;
}

function PeopleList({
  youName,
  youMic,
  youCam,
  youHand,
  youSharing,
  isHost,
  myId,
  peers,
  confirmRemove,
  onConfirm,
  onPin,
  pin,
  onRetry,
  onModerate,
  onKick,
}: {
  youName: string;
  youMic: boolean;
  youCam: boolean;
  youHand: boolean;
  youSharing: boolean;
  isHost: boolean;
  myId: string;
  peers: RemotePeer[];
  confirmRemove: string | null;
  onConfirm: (id: string | null) => void;
  onPin: (id: string) => void;
  pin: string | null;
  onRetry: (id: string) => void;
  onModerate: (id: string, action: 'mute-mic' | 'mute-cam' | 'ask-mic' | 'ask-cam') => void;
  onKick: (id: string) => void;
}) {
  const rows = [
    { id: myId, name: `${youName} (You)`, micOn: youMic, camOn: youCam, hand: youHand, sharing: youSharing, you: true, connection: 'connected' as const },
    ...peers.map((peer) => ({ ...peer, you: false })),
  ];
  const hands = rows.filter((row) => row.hand);
  return (
    <div className="people">
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
      {rows.map((row) => (
        <article key={row.id} className="person">
          <div className="avatar sm" style={{ background: colorFor(row.you ? youName : row.name) }}>
            {initials(row.you ? youName : row.name)}
          </div>
          <div className="person-main">
            <strong>{row.name}</strong>
            <span>
              {[
                row.connection !== 'connected' ? (row.connection === 'failed' ? 'Cannot reach' : 'Connecting') : '',
                row.micOn ? 'Mic on' : 'Mic off',
                row.camOn ? 'Camera on' : 'Camera off',
                row.hand ? 'Hand raised' : '',
                row.sharing ? 'Sharing' : '',
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <div className="row-actions">
              <button type="button" onClick={() => onPin(row.id)}>
                {pin === `cam:${row.id}` ? 'Unpin' : 'Pin'}
              </button>
              {!row.you && row.connection !== 'connected' && (
                <button type="button" onClick={() => onRetry(row.id)}>
                  Try again
                </button>
              )}
              {isHost && !row.you && row.micOn && (
                <button type="button" onClick={() => onModerate(row.id, 'mute-mic')}>
                  Turn mic off
                </button>
              )}
              {isHost && !row.you && !row.micOn && (
                <button type="button" onClick={() => onModerate(row.id, 'ask-mic')}>
                  Ask to unmute
                </button>
              )}
              {isHost && !row.you && row.camOn && (
                <button type="button" onClick={() => onModerate(row.id, 'mute-cam')}>
                  Turn camera off
                </button>
              )}
              {isHost && !row.you && !row.camOn && (
                <button type="button" onClick={() => onModerate(row.id, 'ask-cam')}>
                  Ask for camera
                </button>
              )}
              {isHost && !row.you && confirmRemove !== row.id && (
                <button type="button" onClick={() => onConfirm(row.id)}>
                  Remove
                </button>
              )}
              {isHost && confirmRemove === row.id && (
                <button type="button" className="danger-text" onClick={() => onKick(row.id)}>
                  Remove {row.name}?
                </button>
              )}
            </div>
          </div>
        </article>
      ))}
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
}: {
  recording: boolean;
  people: { id: string; name: string; role: string; you: boolean }[];
  selected: string[];
  includeScreens: boolean;
  hasScreens: boolean;
  onClose: () => void;
  onConfirm: (cast: RecordCast) => void;
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
          <h2 id="facecast-title">{recording ? 'Change FaceCast people' : 'FaceCast recording'}</h2>
          <button type="button" className="textbtn" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="hint">
          Pick host, guests, or anyone. Only the faces you choose appear together in the saved video — a cast of people,
          not the whole screen dump.
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
            {recording ? 'Update FaceCast' : 'Start FaceCast'}
          </button>
        </div>
      </div>
    </div>
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
        <p>{isHost ? 'You are the host.' : `Host: ${hostName}.`}</p>
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
          Anyone with the link can join on this Wi‑Fi. Video quality is best under about 12 people on a mesh call; the
          grid supports denser rooms when your network can handle it.
        </p>
      </div>
    </div>
  );
}
