import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  IconCam,
  IconCamOff,
  IconCatchUp,
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
  IconCrop,
  IconShare,
  IconShield,
  IconSmile,
  Logo,
} from './icons';
import { LookMenu, ThemeButton } from './LookControls';
import { useOutsideDismiss } from './ui';
import { useSelfLook } from '../hooks/useSelfLook';
import { loadRoomDisplayName, safeName } from '../lib/code';
import { shareInviteUrl } from '../lib/invite';
import { EndedMeetingDialog } from './EndedMeetingDialog';
import type { MeetingSummaryData } from './MeetingSummary';
import { markMeetingEnded } from '../lib/endedMeeting';
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
import { Whiteboard } from './Whiteboard';
import { ComingSoonModal } from './ComingSoonModal';
import { MeetingPip } from './MeetingPip';
import { isNativeApp } from '../lib/native';
import { pauseAutoFloat } from '../lib/pipGate';
import { onNativePipAction, onNativePipMode, setPipControls } from '../lib/nativeMeeting';
import { detectFaceCenter, faceObjectPosition, tickFaceEase } from '../lib/faceFrame';
import { loadMeetingFramePrefs, saveFramePrefs, stageGrid, trackIsPortrait, type FramePrefs, type LayoutAspect, type TileFit } from '../lib/framePrefs';
import { buildCatchUp, harvestPromises, type CatchUpEvent } from '../lib/meetingIntel';
import { beep } from '../lib/sound';
import { useCaptions } from '../hooks/useCaptions';
import { useRoom, type RemotePeer } from '../hooks/useRoom';
import { useToasts } from '../hooks/useToasts';
import { SettingsDialog } from './SettingsDialog';
import { RecordingsDialog } from './RecordingsDialog';
import type { ChatMessage, Settings } from '../types';

type Props = {
  code: string;
  asHost?: boolean;
  settings: Settings;
  initialStream: MediaStream | null;
  onSettings: (settings: Settings) => void;
  onLeave: (summary?: MeetingSummaryData) => void;
  onMinimize?: () => void;
  onRestore?: () => void;
  docked?: boolean;
};

type Layout = 'grid' | 'speaker' | 'sidebar';
type Panel = 'chat' | 'people' | 'catchup' | null;
type Popover = 'react' | 'more' | 'look' | 'top' | null;
type Dialog = 'settings' | 'shortcuts' | 'details' | 'poll' | 'facecast' | 'recordings' | 'catchup' | 'receipt' | 'leave' | 'soon-rooms' | null;

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
  ['P', 'Open or close people'],
  ['W', 'Open or close the whiteboard'],
  ['Shift+P', 'Open or close the floating window'],
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

function isShareCancel(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  const message = error instanceof Error ? error.message : String(error || '');
  return name === 'NotAllowedError' || name === 'AbortError' || /denied|permission|cancel|abort/i.test(message);
}

function shareFailMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : '';
  const message = error instanceof Error ? error.message : '';
  if (name === 'NotFoundError') return 'No screen or window was available to share.';
  if (name === 'NotReadableError' || name === 'InvalidStateError') {
    return 'Could not capture that screen. Close other capture windows and try again.';
  }
  if (name === 'NotSupportedError' || /support/i.test(message)) {
    return "Screen sharing isn't available in this browser. Try Chrome or Edge.";
  }
  if (/gesture|user|activation/i.test(message)) return 'Click Screen again to share.';
  return 'Could not share the screen. Allow screen capture when the browser asks.';
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

function ordinal(rank: number) {
  const mod = rank % 100;
  const suffix =
    mod >= 11 && mod <= 13 ? 'th' : rank % 10 === 1 ? 'st' : rank % 10 === 2 ? 'nd' : rank % 10 === 3 ? 'rd' : 'th';
  return `${rank}${suffix}`;
}

function readNetworkQuality(): 'Good' | 'Fair' {
  const conn = (navigator as Navigator & { connection?: { effectiveType?: string; downlink?: number } }).connection;
  if (!conn) return 'Good';
  const type = conn.effectiveType;
  const downlink = typeof conn.downlink === 'number' ? conn.downlink : Infinity;
  // Chrome desktop often reports 3g even on Wi-Fi. Trust throughput before the label.
  if (type === 'slow-2g' || type === '2g') return downlink < 1.2 ? 'Fair' : 'Good';
  if (type === '3g' && downlink < 1.2) return 'Fair';
  if (downlink < 1.2) return 'Fair';
  return 'Good';
}

function tileFitFor(frame: FramePrefs, key: string, kind?: TileModel['kind']): TileFit {
  if (frame.fit[key]) return frame.fit[key];
  if (kind === 'screen') return 'contain';
  return frame.defaultFit || 'cover';
}

function inviteLink(code: string) {
  return shareInviteUrl(code);
}

const CHAT_EMOJIS = ['\u{1F600}', '\u{1F602}', '\u{1F44D}', '\u{2764}\u{FE0F}', '\u{1F389}', '\u{1F64F}', '\u{1F44F}', '\u{1F525}'] as const;
const MAX_CHAT_FILE_BYTES = 2 * 1024 * 1024;

function urlsInText(text: string) {
  const matches = text.match(/https?:\/\/[^\s<>"']+/gi);
  if (!matches) return [];
  return [...new Set(matches.map((url) => url.replace(/[.,;:!?)]+$/, '')))];
}

function linkHost(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function buildLeaveSummary(input: {
  code: string;
  name: string;
  startedAt: number;
  peers: { name: string }[];
  catchUp: CatchUpEvent[];
  chat: { name: string; text: string; ts: number; system?: boolean }[];
  faceCastReady: boolean;
  hadPoll: boolean;
  endedForEveryone?: boolean;
  guest?: boolean;
}): MeetingSummaryData {
  const highlights = input.catchUp
    .filter((event) => event.text?.trim())
    .slice(0, 12)
    .map((event) => ({ id: event.id, ts: event.ts, text: event.text }));
  const promises = harvestPromises(input.chat).map((item) => ({
    text: item.text,
    owner: item.name,
  }));
  const participants = [input.name, ...input.peers.map((peer) => peer.name)];
  return {
    code: input.code,
    title: 'LetsConnect meeting',
    startedAt: input.startedAt,
    endedAt: Date.now(),
    participants,
    catchUp: highlights,
    promises,
    followUpCount: promises.length,
    pollCount: input.hadPoll ? 1 : 0,
    endedForEveryone: Boolean(input.endedForEveryone),
    guest: Boolean(input.guest),
    recordingAvailable: input.faceCastReady,
    faceCastReady: input.faceCastReady,
    presence: participants.map((participant) => ({ name: participant })),
  };
}

function leaveMeetingCleanup(
  streamRef: RefObject<MediaStream | null>,
  screenRef: RefObject<MediaStream | null>,
) {
  streamRef.current?.getTracks().forEach((track) => track.stop());
  screenRef.current?.getTracks().forEach((track) => track.stop());
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

export function MeetingScreen({ code, asHost = false, settings, initialStream, onSettings, onLeave, onMinimize, onRestore, docked = false }: Props) {
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
  const [sharingPick, setSharingPick] = useState(false);

  const openDialog = useCallback((next: Dialog) => {
    setPopover(null);
    setDialog(next);
  }, []);
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
  const [chatEmojiOpen, setChatEmojiOpen] = useState(false);
  const [pendingFile, setPendingFile] = useState<ChatMessage['attachment'] | null>(null);
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
  const [viewportMobile, setViewportMobile] = useState(() => window.matchMedia('(max-width: 820px)').matches);
  const [boardOpen, setBoardOpen] = useState(false);
  const [frame, setFrame] = useState<FramePrefs>(loadMeetingFramePrefs);
  const [pipNonce, setPipNonce] = useState(0);
  const [faceEase, setFaceEase] = useState({ x: 0.5, y: 0.34, zoom: 1 });
  const [boardEvents, setBoardEvents] = useState<CatchUpEvent[]>([]);
  const [noticeIndex, setNoticeIndex] = useState(0);
  const [networkQuality, setNetworkQuality] = useState<'Good' | 'Fair'>(() => readNetworkQuality());
  const handOrderRef = useRef(new Map<string, number>());
  const handSeqRef = useRef(0);
  const [handOrderTick, setHandOrderTick] = useState(0);
  const chatCount = useRef(0);
  const lastCaption = useRef(0);
  const streamRef = useRef<MediaStream | null>(initialStream);
  const skipAcquire = useRef(Boolean(initialStream));
  const micOnRef = useRef(true);
  const camOnRef = useRef(true);
  const screenRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const gridObs = useRef<ResizeObserver | null>(null);
  const [stageBox, setStageBox] = useState({ w: 1280, h: 720 });
  const setGridNode = useCallback((node: HTMLDivElement | null) => {
    gridObs.current?.disconnect();
    gridObs.current = null;
    if (!node) return;
    const apply = (width: number, height: number) => {
      const w = Math.round(width);
      const h = Math.round(height);
      if (w < 40 || h < 40) return;
      setStageBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) apply(box.width, box.height);
    });
    ro.observe(node);
    gridObs.current = ro;
    const rect = node.getBoundingClientRect();
    apply(rect.width, rect.height);
  }, []);
  const roomRef = useRef<HTMLElement>(null);
  const chatInput = useRef<HTMLInputElement>(null);
  const chatFileInput = useRef<HTMLInputElement>(null);
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
  const finishLeaveRef = useRef<((endedForEveryone?: boolean) => void) | null>(null);

  const {
    myId,
    status,
    gate,
    denyReason,
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
    meetingLocked,
    dismissAsk,
    sendChat,
    endMeeting,
    setMeetingLock,
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
    boardObjects,
    boardMeta,
    boardLive,
    boardCursors,
    sendBoardOp,
    sendBoardLive,
    sendBoardCursor,
    sendBoardMeta,
    sendBoardView,
    sendBoardSync,
    boardView,
    boardTick,
  } = useRoom({
    code,
    name: loadRoomDisplayName(code, settings.name),
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
    onMeetingEnded: () => {
      finishLeaveRef.current?.(true);
    },
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

  const name = safeName(loadRoomDisplayName(code, settings.name));
  const isHost = hostId === myId;
  const seenHostRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hostId) return;
    if (seenHostRef.current && seenHostRef.current !== hostId) {
      const nextName = hostId === myId ? name : peers.find((peer) => peer.id === hostId)?.name || 'Someone';
      toast(`${nextName} is now the host`);
    }
    seenHostRef.current = hostId;
  }, [hostId, myId, name, peers, toast]);

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const channel = new BroadcastChannel(`letsconnect-room:${code}`);
    const tabId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    let warned = false;
    const onMessage = (event: MessageEvent) => {
      const data = event.data as { type?: string; tabId?: string };
      if (data?.type === 'here' && data.tabId && data.tabId !== tabId && !warned) {
        warned = true;
        toast('This meeting is also open in another tab on this computer.');
      }
    };
    channel.addEventListener('message', onMessage);
    channel.postMessage({ type: 'here', tabId });
    return () => {
      channel.removeEventListener('message', onMessage);
      channel.close();
    };
  }, [code, toast]);
  const isCoHost = coHostIds.includes(myId);
  const canModerate = isHost || isCoHost;
  const canRecord = canModerate;
  const hostPeer = peers.find((peer) => peer.id === hostId);
  hostIdRef.current = hostId;
  chatRef.current = chat;
  const hasMic = Boolean(stream?.getAudioTracks().some((track) => track.readyState === 'live'));
  const hasCam = Boolean(stream?.getVideoTracks().some((track) => track.readyState === 'live'));
  micOnRef.current = micOn;
  camOnRef.current = camOn;

  function toggleMic() {
    setMicOn((on) => {
      if (on) {
        streamRef.current?.getAudioTracks().forEach((track) => {
          track.enabled = false;
        });
        return false;
      }
      const live = streamRef.current?.getAudioTracks().some((track) => track.readyState === 'live');
      if (live) {
        streamRef.current?.getAudioTracks().forEach((track) => {
          track.enabled = true;
        });
      } else {
        skipAcquire.current = false;
        setDeviceNonce((value) => value + 1);
      }
      return true;
    });
  }

  function toggleCam() {
    setCamOn((on) => {
      if (on) {
        streamRef.current?.getVideoTracks().forEach((track) => {
          track.enabled = false;
        });
        return false;
      }
      const live = streamRef.current?.getVideoTracks().some((track) => track.readyState === 'live');
      if (live) {
        streamRef.current?.getVideoTracks().forEach((track) => {
          track.enabled = true;
        });
      } else {
        skipAcquire.current = false;
        setDeviceNonce((value) => value + 1);
      }
      return true;
    });
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia('(max-width: 820px)');
    const sync = () => setViewportMobile(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => () => {
    gridObs.current?.disconnect();
    gridObs.current = null;
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const sync = () => {
      const covered = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      document.documentElement.style.setProperty('--kb', `${Math.round(covered)}px`);
    };
    sync();
    viewport?.addEventListener('resize', sync);
    viewport?.addEventListener('scroll', sync);
    window.addEventListener('focusin', sync);
    window.addEventListener('focusout', sync);
    return () => {
      viewport?.removeEventListener('resize', sync);
      viewport?.removeEventListener('scroll', sync);
      window.removeEventListener('focusin', sync);
      window.removeEventListener('focusout', sync);
      document.documentElement.style.removeProperty('--kb');
    };
  }, []);

  useEffect(() => {
    const conn = (navigator as Navigator & { connection?: EventTarget & { effectiveType?: string; downlink?: number } })
      .connection;
    if (!conn || !('addEventListener' in conn)) return;
    const sync = () => setNetworkQuality(readNetworkQuality());
    conn.addEventListener('change', sync);
    return () => conn.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (skipAcquire.current) {
      skipAcquire.current = false;
      return;
    }
    let cancel = false;
    // Always open mic+cam devices; mute/camera-off only flips track.enabled.
    // Otherwise unmute/cam-on after PiP/background has no live track to re-enable.
    void acquireMedia({
      micId: settings.micId,
      camId: settings.camId,
      wantMic: true,
      wantCam: true,
      noise: settings.noiseSuppression,
    }).then((result) => {
      if (cancel) {
        result.stream.getTracks().forEach((track) => track.stop());
        return;
      }
      result.stream.getAudioTracks().forEach((track) => {
        track.enabled = micOnRef.current;
      });
      result.stream.getVideoTracks().forEach((track) => {
        track.enabled = camOnRef.current;
      });
      const previous = streamRef.current;
      if (previous && previous !== result.stream) previous.getTracks().forEach((track) => track.stop());
      streamRef.current = result.stream;
      setStream(result.stream);
      if (result.warning) toast(result.warning, { key: 'no-device', oncePerSession: true });
      if (!result.audio) {
        micOnRef.current = false;
        setMicOn(false);
      }
      if (!result.video) {
        camOnRef.current = false;
        setCamOn(false);
      }
    });
    return () => {
      cancel = true;
    };
    // Mic and camera toggles must not request devices again ? only deviceNonce / device ids.
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

  // Native: mark meeting active so Home / app-switch can enter PiP instead of killing the room.
  useEffect(() => {
    let cancelled = false;
    void import('../lib/native').then(({ isNativeApp }) => {
      if (cancelled || !isNativeApp()) return;
      void import('../lib/nativeMeeting').then((mod) => mod.setMeetingActive(true));
    });
    return () => {
      cancelled = true;
      void import('../lib/nativeMeeting').then((mod) => mod.setMeetingActive(false)).catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    void setPipControls(micOn, camOn);
  }, [camOn, micOn]);

  const pipActRef = useRef({ toggleMic, toggleCam });
  pipActRef.current = { toggleMic, toggleCam };

  useEffect(() => {
    const stopMode = onNativePipMode((inPip) => {
      document.documentElement.classList.toggle('is-pip', inPip);
    });
    const stopAct = onNativePipAction((act) => {
      if (act === 'mic') pipActRef.current.toggleMic();
      if (act === 'cam') pipActRef.current.toggleCam();
      if (act === 'leave') finishLeaveRef.current?.();
    });
    return () => {
      stopMode();
      stopAct();
      document.documentElement.classList.remove('is-pip');
    };
  }, []);

  // Keep active-room stamp fresh so process death still restores this meeting.
  useEffect(() => {
    let alive = true;
    const touch = () => {
      void import('../lib/storage').then(({ touchActiveRoom }) => {
        if (alive) touchActiveRoom();
      });
    };
    touch();
    const timer = window.setInterval(touch, 60_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [code]);

  // Camera/mic freeze after backgrounding: reacquire dead tracks and restart local preview.
  useEffect(() => {
    let lastBump = 0;
    let appHandle: { remove: () => Promise<void> } | null = null;

    const reviveMedia = () => {
      const now = Date.now();
      if (now - lastBump < 900) return;
      const current = streamRef.current;
      // Wait for the first acquire ? do not cancel it with a nonce bump.
      if (!current) return;
      const videoLive = Boolean(current.getVideoTracks().some((track) => track.readyState === 'live'));
      const audioLive = Boolean(current.getAudioTracks().some((track) => track.readyState === 'live'));
      // Reacquire whenever hardware tracks died (even if muted ? unmute needs a live track).
      if (!videoLive || !audioLive) {
        lastBump = now;
        skipAcquire.current = false;
        setDeviceNonce((value) => value + 1);
        return;
      }
      current.getAudioTracks().forEach((track) => {
        track.enabled = micOnRef.current;
      });
      current.getVideoTracks().forEach((track) => {
        track.enabled = camOnRef.current;
      });
      const preview = localVideoRef.current;
      if (preview) {
        if (preview.srcObject !== current) preview.srcObject = current;
        void preview.play().catch(() => undefined);
      }
    };

    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      window.setTimeout(reviveMedia, 280);
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);

    void import('../lib/native').then(({ isNativeApp }) => {
      if (!isNativeApp()) return;
      void import('@capacitor/app').then(({ App }) => {
        void App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) window.setTimeout(reviveMedia, 320);
        }).then((handle) => {
          appHandle = handle;
        });
      });
    });

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
      void appHandle?.remove();
    };
  }, []);

  useEffect(() => {
    if (!frame.centerMe) {
      setFaceEase(tickFaceEase(null, false, frame.selfZoom));
      return undefined;
    }
    const timer = window.setInterval(() => {
      void detectFaceCenter(getPreviewVideo()).then((box) => {
        setFaceEase(tickFaceEase(box, true, frame.selfZoom));
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [frame.centerMe, frame.selfZoom]);

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

  const remoteBoardWasOpen = useRef(false);
  useEffect(() => {
    if (boardMeta.open) {
      setBoardOpen((open) => {
        if (!open) {
          toast(canModerate ? 'Whiteboard is open for everyone' : 'The host opened the whiteboard', {
            key: 'wb-open',
            oncePerSession: true,
          });
        }
        return true;
      });
      remoteBoardWasOpen.current = true;
      return;
    }
    if (remoteBoardWasOpen.current) {
      remoteBoardWasOpen.current = false;
      setBoardOpen(false);
    }
  }, [boardMeta.open, boardTick, canModerate, toast]);

  useEffect(() => {
    if (canModerate && waiting.length > 0) {
      setPanel('people');
      setPopover(null);
    }
  }, [canModerate, waiting.length]);

  useEffect(() => {
    if (!captionsOn) return;
    if (captionError === 'unsupported' || !captionSupported) {
      toast('Captions need Chrome or Edge on HTTPS.', { key: 'caption-unsupported' });
      return;
    }
    if (captionError === 'denied') {
      toast('Allow microphone access to use captions.', { key: 'caption-mic' });
      return;
    }
    if (captionError === 'failed') toast('Captions could not start. Try again.', { key: 'caption-fail' });
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
    for (const id of raised) {
      if (!handOrderRef.current.has(id)) handOrderRef.current.set(id, (handSeqRef.current += 1));
    }
    for (const id of [...handOrderRef.current.keys()]) {
      if (!raised.has(id)) handOrderRef.current.delete(id);
    }
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
    setHandOrderTick((value) => value + 1);
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

  function clearScreenShare(stream: MediaStream | null) {
    stream?.getTracks().forEach((track) => track.stop());
    setScreenStream(null);
    setSharingPick(false);
    void import('../lib/nativeScreenShare').then((mod) => mod.stopNativeScreenShare()).catch(() => undefined);
  }

  async function toggleShare() {
    if (screenStream) {
      clearScreenShare(screenStream);
      return;
    }

    if (isNativeApp()) {
      const resume = pauseAutoFloat();
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        resume();
      };
      setSharingPick(true);
      let started = false;
      try {
        const { nativeScreenShareAvailable, startNativeScreenShare } = await import('../lib/nativeScreenShare');
        if (await nativeScreenShareAvailable()) {
          const display = await startNativeScreenShare();
          display.getVideoTracks()[0]?.addEventListener('ended', () => {
            release();
            clearScreenShare(display);
          });
          setScreenStream(display);
          toast('Sharing your screen.', { key: 'share-on' });
          started = true;
          return;
        }
        toast('Screen sharing needs the latest LetsConnect app.', { key: 'share-unsupported' });
      } catch (error) {
        toast(isShareCancel(error) ? 'Screen share canceled' : shareFailMessage(error), {
          key: isShareCancel(error) ? 'share-cancel' : 'share-fail',
        });
      } finally {
        if (!started) release();
        setSharingPick(false);
      }
      return;
    }

    if (typeof navigator.mediaDevices?.getDisplayMedia !== 'function') {
      toast("Screen sharing isn't available here. Try Chrome or Edge.", { key: 'share-unsupported' });
      return;
    }

    const resume = pauseAutoFloat();
    // Start capture on this click so the browser still treats it as a user gesture.
    const pending = navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    setSharingPick(true);
    try {
      let display: MediaStream;
      try {
        display = await pending;
      } catch (error) {
        if (isShareCancel(error)) {
          toast('Screen share canceled', { key: 'share-cancel' });
          return;
        }
        try {
          display = await navigator.mediaDevices.getDisplayMedia({ video: true });
        } catch (retryError) {
          toast(isShareCancel(retryError) ? 'Screen share canceled' : shareFailMessage(retryError), {
            key: isShareCancel(retryError) ? 'share-cancel' : 'share-fail',
          });
          return;
        }
      }
      display.getVideoTracks().forEach((track) => {
        track.addEventListener('ended', () => clearScreenShare(display));
      });
      setScreenStream(display);
      toast('Sharing your screen.', { key: 'share-on' });
    } finally {
      resume();
      setSharingPick(false);
    }
  }

  function openFaceCast() {
    const everyone = [myId, ...peers.map((peer) => peer.id)];
    setCastIds((current) => (current.length ? current.filter((id) => everyone.includes(id)) : everyone));
    setCastScreens(sharing || peers.some((peer) => peer.sharing));
    openDialog('facecast');
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
      openDialog('recordings');
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

  function patchFrame(partial: Partial<FramePrefs>) {
    const next = { ...frame, ...partial };
    setFrame(next);
    saveFramePrefs(next);
  }

  function openSharedBoard() {
    if (!canModerate) return;
    setBoardOpen(true);
    const meta = { hostOnly: true, open: true as const, clock: Date.now() };
    sendBoardMeta(meta);
    sendBoardSync();
    window.setTimeout(() => sendBoardMeta({ ...meta, clock: Date.now() }), 400);
    window.setTimeout(() => sendBoardMeta({ ...meta, clock: Date.now() }), 1400);
  }

  function closeSharedBoard() {
    if (!canModerate) return;
    setBoardOpen(false);
    sendBoardMeta({ hostOnly: boardMeta.hostOnly, open: false, clock: Date.now() });
  }

  function toggleSharedBoard() {
    if (!canModerate) return;
    if (boardOpen || boardMeta.open) closeSharedBoard();
    else openSharedBoard();
  }

  const showBoard = canModerate ? Boolean(boardOpen || boardMeta.open) : Boolean(boardMeta.open);

  function popOut() {
    setPipNonce((value) => value + 1);
  }

  function togglePanel(next: Panel) {
    setPopover(null);
    setPanel((current) => (current === next ? null : next));
  }

  function sendMessage(event: FormEvent) {
    event.preventDefault();
    const text = chatText.trim();
    if (!text && !pendingFile) return;
    sendChat(text, pendingFile ?? undefined);
    setChatText('');
    setPendingFile(null);
    setChatEmojiOpen(false);
  }

  function onChatFilePick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_CHAT_FILE_BYTES) {
      toast('Files must be smaller than 2 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setPendingFile({
        name: file.name,
        mime: file.type || 'application/octet-stream',
        data: String(reader.result ?? ''),
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  }

  useEffect(() => {
    if (!popover && !dialog) return;
    roomRef.current?.querySelectorAll('[data-tip-active]').forEach((element) => {
      element.removeAttribute('data-tip-active');
    });
    roomRef.current?.querySelectorAll('.cmd:focus, .leave:focus').forEach((element) => {
      (element as HTMLElement).blur();
    });
  }, [dialog, popover]);

  const catchUpEvents = useMemo(() => {
    const hands = [
      ...(hand ? [name] : []),
      ...peers.filter((peer) => peer.hand).map((peer) => peer.name),
    ];
    return [
      ...boardEvents,
      ...buildCatchUp({
        joinedAt,
        chat,
        airtime: {},
        names: Object.fromEntries([[myId, name], ...peers.map((peer) => [peer.id, peer.name] as const)]),
        hands,
        sharing: [
          ...(sharing ? [name] : []),
          ...peers.filter((peer) => peer.sharing).map((peer) => peer.name),
        ],
      }),
    ].sort((a, b) => b.ts - a.ts);
  }, [boardEvents, chat, hand, joinedAt, myId, name, peers, sharing]);

  const finishLeave = useCallback((endedForEveryone = false) => {
    if (endedForEveryone) markMeetingEnded(code);
    leaveMeetingCleanup(streamRef, screenRef);
    onLeave(
      buildLeaveSummary({
        code,
        name,
        startedAt: started.current,
        peers,
        catchUp: catchUpEvents,
        chat,
        faceCastReady: Boolean(recordReady?.length),
        hadPoll: Boolean(poll),
        endedForEveryone,
        guest: false,
      }),
    );
  }, [catchUpEvents, chat, code, name, onLeave, peers, poll, recordReady]);
  finishLeaveRef.current = finishLeave;

  const uiRef = useRef({
    dialog,
    popover,
    panel,
    captionsOn,
    boardOpen,
    canModerate,
    leave: finishLeave,
    toggleShare,
    toggleFullscreen,
    togglePanel,
    popOut,
    toggleBoard: toggleSharedBoard,
  });
  uiRef.current = {
    dialog,
    popover,
    panel,
    captionsOn,
    canModerate,
    boardOpen,
    leave: finishLeave,
    toggleShare,
    toggleFullscreen,
    togglePanel,
    popOut,
    toggleBoard: toggleSharedBoard,
  };

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      const typing =
        target instanceof HTMLElement &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
      const ui = uiRef.current;
      if (event.key === 'Escape') {
        if (typing) return;
        if (ui.dialog) setDialog(null);
        else if (ui.popover) setPopover(null);
        else if (ui.boardOpen && ui.canModerate) closeSharedBoard();
        else if (ui.panel) setPanel(null);
        return;
      }
      if (typing || ui.dialog || ui.boardOpen || event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const run = (action: () => void) => {
        event.preventDefault();
        setPopover(null);
        action();
      };
      if (key === 'm') run(() => toggleMic());
      else if (key === 'v') run(() => toggleCam());
      else if (key === 's') run(() => void ui.toggleShare());
      else if (key === 'h') run(() => setHand((value) => !value));
      else if (key === 'c') run(() => ui.togglePanel('chat'));
      else if (key === 'w' && ui.canModerate) run(() => ui.toggleBoard());
      else if (key === 'p') {
        if (event.shiftKey) run(() => ui.popOut());
        else run(() => ui.togglePanel('people'));
      }
      else if (key === 'r') run(() => setPopover('react'));
      else if (key === 'b') run(() => setPopover('look'));
      else if (key === 'k') run(() => setCaptionsOn((value) => !value));
      else if (key === 'f') run(() => void ui.toggleFullscreen());
      else if (key === 'l') {
        event.preventDefault();
        setPopover(null);
        if (ui.dialog === 'leave') {
          ui.leave();
        } else openDialog('leave');
      } else if (event.key === '?') run(() => openDialog('shortcuts'));
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

  function renderTile(tile: TileModel, layoutRole?: 'main' | 'pip') {
    const waitMs = now - (seenAt.current[tile.peerId] || now);
    const connecting = tile.connection && tile.connection !== 'connected';
    const slow = connecting && waitMs > 10000;
    const timedOut = connecting && waitMs > 15000;
    const connection = timedOut ? 'failed' : tile.connection;
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
    const compact =
      viewportMobile || document.documentElement.classList.contains('is-mobile') || document.documentElement.classList.contains('is-native');
    const trackPortrait = trackIsPortrait(tile.stream?.getVideoTracks()[0]);
    const fit = tileFitFor(frame, tile.key, tile.kind);
    const blurFill = trackPortrait && fit === 'contain' && !compact;
    return (
      <Tile
        key={tile.key}
        tile={{ ...tile, connection }}
        role={role}
        layoutRole={layoutRole}
        handRank={tile.hand ? handRankByPeer.get(tile.peerId) ?? null : null}
        pinned={pin === tile.key}
        localRef={tile.you && tile.kind === 'camera' ? localVideoRef : undefined}
        lookCanvas={tile.you && tile.kind === 'camera' ? look.canvas : null}
        casted={recording && castIds.includes(tile.peerId) && tile.kind === 'camera'}
        slow={Boolean(slow)}
        trouble={Boolean(slow && connecting && tile.connection !== 'failed')}
        fit={fit}
        portrait={blurFill}
        selfZoom={tile.you ? (frame.centerMe ? faceEase.zoom : frame.selfZoom) : 1}
        selfPanX={tile.you ? (frame.centerMe ? faceEase.x : frame.selfPanX) : 0.5}
        selfPanY={tile.you ? (frame.centerMe ? faceEase.y : frame.selfPanY) : 0.34}
        onFit={(next) => patchFrame({ fit: { ...frame.fit, [tile.key]: next } })}
        onSelfCrop={
          tile.you
            ? (zoom, x, y) => patchFrame({ selfZoom: zoom, selfPanX: x, selfPanY: y })
            : undefined
        }
        onPin={() => setPin((current) => (current === tile.key ? null : tile.key))}
        onRetry={() => retry(tile.peerId)}
        onCopyInvite={() => void copyLink()}
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

  type NoticeKind =
    | 'ask'
    | 'admit'
    | 'share-pick'
    | 'share'
    | 'hear'
    | 'host-tip'
    | 'headphone'
    | 'facecast'
    | 'server';
  const noticeQueue = useMemo((): NoticeKind[] => {
    const list: NoticeKind[] = [];
    if (ask) list.push('ask');
    if (canModerate && waiting.length > 0) list.push('admit');
    if (sharers.length > 0) list.push('share');
    if (hear) list.push('hear');
    if (peers.length === 0 && !hideAlone) list.push('host-tip');
    if (peers.length > 0 && !hideTip) list.push('headphone');
    if (!canRecord && hostCastActive && !recording) list.push('facecast');
    if (serverMessage) list.push('server');
    return list;
  }, [
    ask,
    canModerate,
    waiting.length,
    sharers.length,
    hear,
    peers.length,
    hideAlone,
    hideTip,
    canRecord,
    hostCastActive,
    recording,
    serverMessage,
  ]);

  useEffect(() => {
    setNoticeIndex(0);
  }, [noticeQueue.join('|')]);

  useEffect(() => {
    if (noticeQueue.length <= 1) return;
    const timer = window.setInterval(() => {
      setNoticeIndex((value) => (value + 1) % noticeQueue.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [noticeQueue.length]);

  const noticeKind = noticeQueue.length ? noticeQueue[noticeIndex % noticeQueue.length] : null;
  const noticeCounter =
    noticeQueue.length > 1 ? `${(noticeIndex % noticeQueue.length) + 1}/${noticeQueue.length}` : null;

  const handRankByPeer = useMemo(() => {
    void handOrderTick;
    const ranked = [...handOrderRef.current.entries()].sort((a, b) => a[1] - b[1]);
    const map = new Map<string, number>();
    ranked.forEach(([id], index) => map.set(id, index + 1));
    return map;
  }, [hand, peers, handOrderTick]);

  if (kickedBy) {
    return (
      <main className="home kicked">
        <section className="card narrow">
          <h1>{kickedBy} removed you from the meeting</h1>
          <p>You can join again with the same link · the host will need to admit you again.</p>
          <button type="button" className="primary" onClick={() => onLeave()}>
            Back to home
          </button>
        </section>
      </main>
    );
  }

  if (gate === 'denied') {
    if (denyReason === 'ended') {
      return (
        <main className="home kicked">
          <EndedMeetingDialog onClose={() => onLeave()} />
        </main>
      );
    }
    return (
      <main className="home kicked">
        <section className="card narrow">
          <h1>The host did not let you in</h1>
          <p>Ask them for a new invite, or try again later.</p>
          <button type="button" className="primary" onClick={() => onLeave()}>
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
        onCam={() => toggleCam()}
        onMic={() => toggleMic()}
        onLeave={() => onLeave()}
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
  const mobileFocus = viewportMobile && screens.length === 0 && cameras.length === 2 && layout === 'speaker';
  const peopleGrid = stageGrid(cameras.length, stageBox.w, stageBox.h);
  const mobileMainTile =
    cameras.find((tile) => tile.speaking && !tile.you) ||
    cameras.find((tile) => !tile.you) ||
    mainTile;
  const mobilePipTile = cameras.find((tile) => tile.you && tile.key !== mobileMainTile.key) || null;
  const inCallCount = peers.length + 1;
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
    <main className={cx('room', 'room-meet', docked && 'is-docked')} ref={roomRef}>
      <header className="topbar">
        <div className="top-id">
          <button type="button" className="meet-logo-btn" aria-label="Minimize to home" onClick={() => onMinimize?.()}>
            <Logo size={22} />
          </button>
          <div className="meet-title-block desk-only">
            <strong>LetsConnect</strong>
            <span className="meet-subtitle">Meeting room</span>
          </div>
          <code className="meet-code" title="Meeting code">
            {code}
          </code>
        </div>
        <div className="top-mid">
          <span className="time" aria-label="Elapsed time">
            {formatElapsed(now - started.current)}
          </span>
          {isHost ? (
            <>
              <span className="pill meet-host-pill meet-host-full">You&apos;re the host</span>
              <span className="pill meet-host-pill meet-host-short">Host</span>
            </>
          ) : isCoHost ? (
            <span className="pill">Co-host</span>
          ) : hostPeer ? (
            <span className="pill desk-only">Host: {hostPeer.name}</span>
          ) : null}
          <span className="pill meet-in-call">{inCallCount} in call</span>
          {meetingLocked && (
            <span className="pill meet-locked-pill">Meeting locked · new people wait</span>
          )}
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
          <span className="meet-trust-pill desk-only" title="Peer-to-peer · encrypted in transit">
            <IconShield />
            Peer-to-peer
          </span>
          <span
            className={cx('meet-network-pill', 'desk-only', networkQuality === 'Good' ? 'good' : 'fair')}
            title="Network quality"
          >
            {networkQuality}
          </span>
          <button
            type="button"
            className={panel === 'catchup' ? 'top-icon on' : 'top-icon'}
            title="Catch-Up"
            aria-label="Catch-Up"
            onClick={() => setPanel((value) => (value === 'catchup' ? null : 'catchup'))}
          >
            <span className="desk-only">Catch-Up</span>
            <span className="phone-only top-icon-label" aria-hidden="true">
              <IconCatchUp />
            </span>
          </button>
          <button
            type="button"
            className={panel === 'people' ? 'top-icon on desk-only' : 'top-icon desk-only'}
            title="People"
            aria-label="People"
            onClick={() => setPanel((value) => (value === 'people' ? null : 'people'))}
          >
            <IconPeople />
            <em>{inCallCount}</em>
          </button>
          <button
            type="button"
            className={panel === 'chat' ? 'top-icon on' : 'top-icon desk-only'}
            title="Chat"
            aria-label="Chat"
            onClick={() => setPanel((value) => (value === 'chat' ? null : 'chat'))}
          >
            <IconChat />
            {unread > 0 && <em className="badge">{unread}</em>}
          </button>
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
                {(['auto', '16:9', '4:3', '1:1', '9:16'] as LayoutAspect[]).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    aria-pressed={frame.aspect === ratio}
                    onClick={() => patchFrame({ aspect: ratio })}
                  >
                    {ratio === 'auto' ? 'Auto' : ratio}
                  </button>
                ))}
                <button type="button" aria-pressed={frame.centerMe} onClick={() => patchFrame({ centerMe: !frame.centerMe })}>
                  Center me
                </button>
              </>
            )}
          </div>
          <div className="meet-top-overflow phone-only">
            <button
              type="button"
              className={popover === 'top' ? 'top-icon on' : 'top-icon'}
              aria-label="More room actions"
              aria-expanded={popover === 'top'}
              onClick={(event) => {
                event.stopPropagation();
                setPopover((value) => (value === 'top' ? null : 'top'));
              }}
            >
              <IconMore />
            </button>
            {popover === 'top' && (
              <div className="meet-top-overflow-pop" role="menu">
                <button
                  type="button"
                  onClick={() => {
                    setPopover(null);
                    void copyLink();
                  }}
                >
                  Copy link
                </button>
                <button type="button" aria-pressed={layout === 'grid'} onClick={() => setLayout('grid')}>
                  Grid
                </button>
                <button type="button" aria-pressed={layout === 'speaker'} onClick={() => setLayout('speaker')}>
                  Speaker
                </button>
                <button type="button" aria-pressed={layout === 'sidebar'} onClick={() => setLayout('sidebar')}>
                  Sidebar
                </button>
                <p className="meet-overflow-label">Display size</p>
                {(['auto', '16:9', '4:3', '1:1', '9:16'] as LayoutAspect[]).map((ratio) => (
                  <button
                    key={ratio}
                    type="button"
                    aria-pressed={frame.aspect === ratio}
                    onClick={() => patchFrame({ aspect: ratio })}
                  >
                    {ratio === 'auto' ? 'Fill screen' : ratio}
                  </button>
                ))}
                <button type="button" aria-pressed={frame.centerMe} onClick={() => patchFrame({ centerMe: !frame.centerMe })}>
                  {frame.centerMe ? 'Center me on' : 'Center me'}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {meetingLocked && (
        <p className="meet-locked-bar phone-only" role="status">
          Meeting locked · new people wait
        </p>
      )}

      {sharingPick && (
        <div className="share-pending-banner" role="status">
          <span>Choose what to share in the browser window?</span>
          <button
            type="button"
            className="secondary slim"
            onClick={() => {
              setSharingPick(false);
              toast('Screen share canceled', { key: 'share-cancel' });
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <div className="room-body">
        <div className="stage" ref={stageRef}>
          {noticeKind && !showBoard && (
            <div className="notice-row" role="status">
              {noticeCounter && (
                <span className="notice-counter" aria-label={`Notice ${noticeCounter}`}>
                  {noticeCounter}
                </span>
              )}
              {noticeKind === 'ask' && ask && (
                <div className="banner ask">
                  <span>
                    {ask.fromName} is asking you to turn your {ask.kind === 'mic' ? 'microphone' : 'camera'} on.
                  </span>
                  <button
                    type="button"
                    className="primary slim"
                    onClick={() => {
                      if (ask.kind === 'mic') {
                        if (!micOn) toggleMic();
                      } else if (!camOn) {
                        toggleCam();
                      }
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
              {noticeKind === 'admit' && (
                <AdmitBanner
                  waiting={waiting}
                  onReview={() => setPanel('people')}
                  onAdmit={admit}
                  onDeny={deny}
                  onAdmitAll={() => waiting.forEach((person) => admit(person.id))}
                  onDenyAll={() => waiting.forEach((person) => deny(person.id))}
                />
              )}
              {noticeKind === 'share' && (
                <div className="banner share">
                  <span>{sharers.join('. ')}.</span>
                  {sharing && (
                    <button type="button" onClick={() => void toggleShare()}>
                      Stop sharing
                    </button>
                  )}
                </div>
              )}
              {noticeKind === 'hear' && (
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
              {noticeKind === 'host-tip' && (
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
              {noticeKind === 'headphone' && (
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
              {noticeKind === 'facecast' && (
                <div className="banner info">
                  <span>
                    A host or co-host is directing FaceCast · only their chosen faces go into the marketing cut.
                  </span>
                </div>
              )}
              {noticeKind === 'server' && serverMessage && <div className="banner warn">{serverMessage}</div>}
            </div>
          )}
          {showBoard ? (
            <Whiteboard
              myId={myId}
              name={name}
              objects={boardObjects}
              meta={boardMeta}
              cursors={boardCursors}
              live={boardLive}
              canDraw={canModerate}
              followView={canModerate ? null : boardView || boardMeta.view || null}
              filmstrip={<div className="strip wb-people">{cameras.map((tile) => renderTile(tile))}</div>}
              onOp={canModerate ? sendBoardOp : () => undefined}
              onLive={canModerate ? sendBoardLive : () => undefined}
              onCursor={canModerate ? sendBoardCursor : () => undefined}
              onView={canModerate ? sendBoardView : undefined}
              onMeta={canModerate ? sendBoardMeta : () => undefined}
              onSave={(blob) => {
                const url = URL.createObjectURL(blob);
                setBoardEvents((events) => [
                  {
                    id: `board-${Date.now()}`,
                    ts: Date.now(),
                    kind: 'board',
                    text: `${name} saved the whiteboard`,
                  },
                  ...events,
                ]);
                toast('Whiteboard saved to Catch-Up');
                URL.revokeObjectURL(url);
              }}
              onClose={closeSharedBoard}
            />
          ) : screens.length > 0 ? (
            <div className="present">
              <div className={screens.length > 1 ? 'present-main split' : 'present-main'}>
                {screens.map((tile) => renderTile(tile))}
              </div>
              <div className="strip">{cameras.map((tile) => renderTile(tile))}</div>
            </div>
          ) : mobileFocus ? (
            <div className="meet-mobile-stage" data-aspect="auto">
              <div className="meet-mobile-main">{renderTile(mobileMainTile, 'main')}</div>
              {mobilePipTile ? <div className="meet-mobile-pip">{renderTile(mobilePipTile, 'pip')}</div> : null}
            </div>
          ) : layout === 'grid' || cameras.length < 2 ? (
            <div
              ref={setGridNode}
              className={peopleGrid.spanLast ? 'grid fill span-last' : 'grid fill'}
              data-aspect="auto"
              style={{
                gridTemplateColumns: `repeat(${peopleGrid.cols}, minmax(0, 1fr))`,
                gridTemplateRows: `repeat(${peopleGrid.rows}, minmax(0, 1fr))`,
              }}
            >
              {cameras.map((tile) => renderTile(tile))}
            </div>
          ) : (
            <div className={layout === 'sidebar' ? 'sidebar' : 'speaker'}>
              <div className="present-main">{renderTile(mainTile)}</div>
              <div className="strip">{otherTiles.map((tile) => renderTile(tile))}</div>
            </div>
          )}
          {(captionsOn || caption) && (
            <div className={caption ? 'captions' : 'captions is-waiting'} aria-live="polite">
              {caption ? (
                <>
                  <strong>{caption.name}</strong>
                  <span>{caption.text}</span>
                </>
              ) : (
                <span>
                  {!captionSupported
                    ? 'Captions need Chrome or Edge on HTTPS.'
                    : !micOn
                      ? 'Turn on your mic so captions can hear you.'
                      : captionError === 'denied'
                        ? 'Allow microphone access to use captions.'
                        : 'Listening…'}
                </span>
              )}
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
              <button
                type="button"
                className="people-tab"
                aria-pressed={panel === 'people'}
                onClick={() => setPanel('people')}
              >
                People
                <em className="tab-badge">{peers.length + 1}</em>
                {canModerate && waiting.length > 0 && (
                  <em className="people-waiting">{waiting.length} waiting</em>
                )}
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
                        <ChatBubbleBody message={message} />
                        <time>
                          {new Date(message.ts).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                        </time>
                      </article>
                    ),
                  )}
                  <div ref={chatEnd} />
                </div>
                {pendingFile && (
                  <p className="chat-pending-file">
                    <span className="attach-chip">
                      {pendingFile.name}
                      <button type="button" className="textbtn" aria-label="Remove attachment" onClick={() => setPendingFile(null)}>
                        ×
                      </button>
                    </span>
                  </p>
                )}
                {chatEmojiOpen && (
                  <div className="chat-emoji" role="listbox" aria-label="Emoji">
                    {CHAT_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        onClick={() => {
                          setChatText((value) => `${value}${emoji}`);
                          chatInput.current?.focus();
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                <form className="composer" onSubmit={sendMessage}>
                  <div className="composer-bar">
                    <button
                      type="button"
                      className="composer-ico"
                      aria-label="Insert emoji"
                      aria-expanded={chatEmojiOpen}
                      onClick={() => setChatEmojiOpen((value) => !value)}
                    >
                      <IconSmile />
                    </button>
                    <button
                      type="button"
                      className="composer-ico"
                      aria-label="Attach a file"
                      onClick={() => chatFileInput.current?.click()}
                    >
                      +
                    </button>
                    <input ref={chatFileInput} type="file" className="sr-only" onChange={onChatFilePick} />
                    <input
                      ref={chatInput}
                      className="chat-compose-input"
                      type="text"
                      inputMode="text"
                      autoComplete="off"
                      autoCorrect="on"
                      spellCheck
                      enterKeyHint="send"
                      value={chatText}
                      maxLength={2000}
                      placeholder="Message everyone"
                      aria-label="Message everyone"
                      onChange={(event) => setChatText(event.target.value)}
                    />
                  </div>
                  <button type="submit" className="primary slim" disabled={!chatText.trim() && !pendingFile}>
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
                onDenyAll={() => waiting.forEach((person) => deny(person.id))}
                onMuteAll={() => {
                  peers.filter((peer) => peer.micOn).forEach((peer) => moderate(peer.id, 'mute-mic'));
                }}
                onCopyInvite={() => void copyLink()}
                handOrderIds={[...handRankByPeer.entries()]
                  .sort((a, b) => a[1] - b[1])
                  .map(([id]) => id)}
                onLowerAll={() => {
                  if (hand) setHand(false);
                  const others = peers.filter((peer) => peer.hand);
                  if (others.length) {
                    toast('Only each person can lower their own hand.');
                  }
                }}
                meetingLocked={meetingLocked}
                onLock={() => setMeetingLock(!meetingLocked)}
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

      <MeetingPip
        people={[
          {
            id: myId,
            name,
            stream,
            showVideo: camOn && Boolean(stream?.getVideoTracks().length),
            speaking: loudest === myId,
            you: true,
          },
          ...peers.map((peer) => ({
            id: peer.id,
            name: peer.name,
            stream: peer.camera,
            showVideo: peer.camOn && Boolean(peer.camera?.getVideoTracks().length),
            speaking: loudest === peer.id,
            you: false,
          })),
        ]}
        micOn={micOn}
        camOn={camOn}
        hand={hand}
        autoFloat
        docked={docked}
        panelOpen={Boolean(panel)}
        boardOpen={showBoard}
        mobile={viewportMobile}
        onMic={() => toggleMic()}
        onCam={() => toggleCam()}
        onHand={() => setHand((value) => !value)}
        onLeave={() => openDialog('leave')}
        onBack={() => {
          if (docked) onRestore?.();
          else setPanel(null);
        }}
        onStatus={(text) => toast(text)}
        openSignal={pipNonce}
      />

      {popover &&
        !dialog &&
        !(viewportMobile && (popover === 'more' || popover === 'look')) && (
        <button type="button" className="backdrop" aria-label="Close menu" onClick={() => setPopover(null)} />
      )}

      <footer className="controls">
        <div className="cgroup meet-core">
          <Cmd
            label={!hasMic ? 'No mic' : micOn ? 'Mic' : 'Muted'}
            shortcut="M"
            danger={!micOn || !hasMic}
            pressed={micOn && hasMic}
            className={!hasMic ? 'nodevice' : undefined}
            onClick={() => toggleMic()}
          >
            {micOn && hasMic ? <IconMic /> : <IconMicOff />}
          </Cmd>
          <Cmd
            label={!hasCam ? 'No cam' : camOn ? 'Camera' : 'Cam off'}
            shortcut="V"
            danger={!camOn || !hasCam}
            pressed={camOn && hasCam}
            className={!hasCam ? 'nodevice' : undefined}
            onClick={() => toggleCam()}
          >
            {camOn && hasCam ? <IconCam /> : <IconCamOff />}
          </Cmd>
          <Cmd
            className="desk-only"
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
            label={unread ? `Chat ${unread}` : 'Chat'}
            shortcut="C"
            live={panel === 'chat'}
            badge={unread}
            onClick={() => togglePanel('chat')}
          >
            <IconChat />
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
            {popover === 'look' && !viewportMobile && (
              <LookMenu
                value={settings.background}
                status={look.status}
                onChange={(background) => onSettings({ ...settings, background })}
              />
            )}
          </div>
        </div>
        <div className="cgroup meet-panels">
          {canModerate && (
            <Cmd
              className="desk-only"
              label="Whiteboard"
              shortcut="W"
              live={showBoard}
              onClick={toggleSharedBoard}
            >
              <IconBoard />
            </Cmd>
          )}
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
            live={panel === 'people'}
            badge={canModerate && waiting.length > 0 ? waiting.length : undefined}
            onClick={() => togglePanel('people')}
          >
            <IconPeople />
          </Cmd>
          <div className="cmdwrap">
            <Cmd label="More" live={popover === 'more'} onClick={() => setPopover((value) => (value === 'more' ? null : 'more'))}>
              <IconMore />
            </Cmd>
            {popover === 'more' && (
              <div className="popover more-pop meet-more-pop desk-only" role="menu">
                <p className="more-label">Collaborate</p>
                {canModerate && (
                  <MenuButton
                    icon={<IconPoll />}
                    title={poll ? 'New poll' : 'Polls'}
                    hint="Quick vote"
                    onClick={() => {
                      setPopover(null);
                      openDialog('poll');
                    }}
                  />
                )}
                {canModerate && (
                  <MenuButton
                    icon={<IconBoard />}
                    title="Whiteboard"
                    hint="W"
                    onClick={() => {
                      setPopover(null);
                      openSharedBoard();
                    }}
                  />
                )}
                <MenuButton
                  icon={<IconBreakout />}
                  title="Breakouts"
                  soon
                  className="soon"
                  onClick={() => {
                    setPopover(null);
                    openDialog('soon-rooms');
                  }}
                />
                <p className="more-label">Meeting</p>
                {canRecord && (
                  <MenuButton
                    icon={<IconRecord />}
                    title="Recording / FaceCast"
                    hint={recording ? 'Recording now' : 'Start a FaceCast cut'}
                    onClick={() => {
                      setPopover(null);
                      void toggleRecord();
                    }}
                  />
                )}
                <MenuButton
                  icon={<IconInfo />}
                  title="Meeting info"
                  hint="Code & invite link"
                  onClick={() => {
                    setPopover(null);
                    openDialog('details');
                  }}
                />
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
                  title="Floating window"
                  hint="P"
                  onClick={() => {
                    setPopover(null);
                    popOut();
                  }}
                />
                <p className="more-label">Settings</p>
                <MenuButton
                  icon={<IconGear />}
                  title="Devices"
                  hint="Mic, camera, speaker"
                  onClick={() => {
                    setPopover(null);
                    openDialog('settings');
                  }}
                />
                <MenuButton
                  icon={<IconKeys />}
                  title="Shortcuts"
                  hint="Keyboard keys"
                  onClick={() => {
                    setPopover(null);
                    openDialog('shortcuts');
                  }}
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
              onClick={() => {
                setPopover(null);
                openDialog('leave');
              }}
            >
              <IconLeave />
              <span>Leave</span>
            </button>
          </div>
        </div>
      </footer>

      {popover === 'look' && viewportMobile && (
        <>
          <button type="button" className="meet-sheet-backdrop" aria-label="Close look menu" onClick={() => setPopover(null)} />
          <div className="meet-more-sheet" role="dialog" aria-label="Background">
            <header className="meet-more-sheet-head">
              <strong>Background</strong>
              <button type="button" className="textbtn" onClick={() => setPopover(null)}>
                Close
              </button>
            </header>
            <LookMenu
              value={settings.background}
              status={look.status}
              onChange={(background) => onSettings({ ...settings, background })}
            />
          </div>
        </>
      )}

      {popover === 'more' && (
        <>
          <button type="button" className="meet-sheet-backdrop phone-only" aria-label="Close menu" onClick={() => setPopover(null)} />
          <div className="meet-more-sheet phone-only" role="menu" aria-label="More options">
            <header className="meet-more-sheet-head">
              <strong>More</strong>
              <button type="button" className="textbtn" onClick={() => setPopover(null)}>
                Close
              </button>
            </header>
            <div className="meet-more-reactions" aria-label="Reactions">
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
                  {emoji}
                </button>
              ))}
            </div>
            <div className="meet-tool-grid">
              <button
                type="button"
                onClick={() => {
                  setHand((value) => !value);
                  setPopover(null);
                }}
              >
                <IconHand />
                <span>{hand ? 'Lower' : 'Hand'}</span>
              </button>
              <button type="button" onClick={() => void toggleShare()}>
                <IconShare />
                <span>{sharing ? 'Stop' : 'Share'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setCaptionsOn((value) => !value);
                  setPopover(null);
                }}
              >
                <IconCaptions />
                <span>{captionsOn ? 'Captions on' : 'Captions'}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPopover('look');
                }}
              >
                <IconLook />
                <span>Look</span>
              </button>
              <button type="button" onClick={() => togglePanel('people')}>
                <IconPeople />
                <span>People</span>
              </button>
              {canModerate && (
                <button type="button" onClick={() => openDialog('poll')}>
                  <IconPoll />
                  <span>Polls</span>
                </button>
              )}
              {canRecord && (
                <button type="button" onClick={() => void toggleRecord()}>
                  <IconRecord />
                  <span>FaceCast</span>
                </button>
              )}
              <button type="button" onClick={() => openDialog('settings')}>
                <IconGear />
                <span>Devices</span>
              </button>
              <button type="button" onClick={() => openDialog('shortcuts')}>
                <IconKeys />
                <span>Keys</span>
              </button>
              <button type="button" onClick={() => void toggleFullscreen()}>
                <IconExpand />
                <span>Full</span>
              </button>
              {canModerate && (
                <button
                  type="button"
                  onClick={() => {
                    setPopover(null);
                    openSharedBoard();
                  }}
                >
                  <IconBoard />
                  <span>Board</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setPopover(null);
                  popOut();
                }}
              >
                <IconPip />
                <span>Float</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setPopover(null);
                  openDialog('soon-rooms');
                }}
              >
                <IconBreakout />
                <span>Rooms</span>
              </button>
              <button type="button" onClick={() => openDialog('details')}>
                <IconInfo />
                <span>Info</span>
              </button>
            </div>
          </div>
        </>
      )}

      <div className="toasts" aria-live="polite">
        {toasts.map((item) => (
          <div key={item.id} className="toast">
            {item.text}
          </div>
        ))}
      </div>

      {dialog === 'soon-rooms' && <ComingSoonModal kind="rooms" onClose={() => setDialog(null)} />}
      {dialog === 'leave' && (
        <div className="modal-back leave-modal-back" role="presentation" onClick={() => setDialog(null)}>
          <div
            className="leave-dialog"
            role="dialog"
            aria-labelledby="leave-dialog-title"
            aria-describedby="leave-dialog-copy"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="leave-dialog-icon" aria-hidden="true">
              <IconLeave />
            </div>
            <div className="leave-dialog-copy">
              <strong id="leave-dialog-title">Leave meeting?</strong>
              <p id="leave-dialog-copy">You can rejoin anytime with the same link.</p>
            </div>
            <div className="leave-dialog-actions">
              <button type="button" className="leave-stay" onClick={() => setDialog(null)}>
                Stay
              </button>
              <button
                type="button"
                className="leave-go"
                onClick={() => {
                  setDialog(null);
                  finishLeave();
                }}
              >
                Leave
              </button>
            </div>
            {isHost ? (
              <button
                type="button"
                className="leave-end-all"
                onClick={() => {
                  setDialog(null);
                  endMeeting();
                  finishLeave(true);
                }}
              >
                End meeting for everyone
              </button>
            ) : null}
          </div>
        </div>
      )}
      {dialog === 'settings' && (
        <SettingsDialog
          settings={settings}
          onChange={onSettings}
          onClose={() => setDialog(null)}
          onRetry={() => setDeviceNonce((value) => value + 1)}
        />
      )}
      {dialog === 'shortcuts' && <ShortcutsDialog canModerate={canModerate} onClose={() => setDialog(null)} />}
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
  title,
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
  title?: string;
  onClick: () => void;
  children: ReactNode;
}) {
  const tip = title || (shortcut ? `${label} (${shortcut})` : label);
  return (
    <button
      type="button"
      className={cx('cmd', danger && 'danger', live && 'live', tone === 'hand' && 'hand-live', className)}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      data-tip={tip}
      onClick={(event) => {
        event.currentTarget.blur();
        onClick();
      }}
      onPointerEnter={(event) => event.currentTarget.setAttribute('data-tip-active', '')}
      onFocus={(event) => event.currentTarget.setAttribute('data-tip-active', '')}
      onPointerLeave={(event) => {
        event.currentTarget.removeAttribute('data-tip-active');
        event.currentTarget.blur();
      }}
      onBlur={(event) => event.currentTarget.removeAttribute('data-tip-active')}
    >
      {children}
      <span className="cmd-label">{label}</span>
      {badge ? <em className="badge">{badge}</em> : null}
    </button>
  );
}

function MenuButton({
  icon,
  title,
  hint,
  danger,
  soon,
  className,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  hint?: string;
  danger?: boolean;
  soon?: boolean;
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
        {soon ? (
          <small className="soon-badge">Coming soon</small>
        ) : hint ? (
          <small>{hint}</small>
        ) : null}
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

function IconBoard() {
  return (
    <MenuSvg>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 9h8M8 13h5" />
    </MenuSvg>
  );
}

function IconBreakout() {
  return (
    <MenuSvg>
      <rect x="3" y="4" width="8" height="8" rx="1.5" />
      <rect x="13" y="4" width="8" height="8" rx="1.5" />
      <rect x="8" y="14" width="8" height="6" rx="1.5" />
    </MenuSvg>
  );
}

function ChatBubbleBody({ message }: { message: ChatMessage }) {
  const links = urlsInText(message.text);
  return (
    <>
      {message.text ? <p>{message.text}</p> : null}
      {links.map((url) => (
        <a key={url} className="link-preview" href={url} target="_blank" rel="noreferrer noopener">
          <span className="link-preview-host">{linkHost(url)}</span>
          <span className="link-preview-url">{url}</span>
        </a>
      ))}
      {message.attachment ? (
        message.attachment.mime.startsWith('image/') ? (
          <img className="chat-attach-img" src={message.attachment.data} alt={message.attachment.name} />
        ) : (
          <a className="chat-file-card" download={message.attachment.name} href={message.attachment.data}>
            <span className="chat-file-icon" aria-hidden="true">
              📎
            </span>
            <span className="chat-file-meta">
              <strong>{message.attachment.name}</strong>
              <small>Tap to download</small>
            </span>
          </a>
        )
      ) : null}
    </>
  );
}

function Tile({
  tile,
  role,
  layoutRole,
  handRank,
  pinned,
  localRef,
  lookCanvas,
  casted,
  slow,
  trouble,
  fit = 'cover',
  portrait = false,
  selfZoom = 1,
  selfPanX = 0.5,
  selfPanY = 0.34,
  onFit,
  onSelfCrop,
  onPin,
  onRetry,
  onCopyInvite,
}: {
  tile: TileModel;
  role: string;
  layoutRole?: 'main' | 'pip';
  handRank?: number | null;
  pinned: boolean;
  localRef?: RefObject<HTMLVideoElement | null>;
  lookCanvas?: HTMLCanvasElement | null;
  casted?: boolean;
  slow: boolean;
  trouble?: boolean;
  fit?: TileFit;
  portrait?: boolean;
  selfZoom?: number;
  selfPanX?: number;
  selfPanY?: number;
  onFit?: (fit: TileFit) => void;
  onSelfCrop?: (zoom: number, x: number, y: number) => void;
  onPin: () => void;
  onRetry: () => void;
  onCopyInvite: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const slotRef = useRef<HTMLDivElement>(null);
  const blurRef = useRef<HTMLVideoElement>(null);
  const [menu, setMenu] = useState(false);
  const closeFrameMenu = useCallback(() => setMenu(false), []);
  const frameMenuRef = useOutsideDismiss(() => {
    if (menu) closeFrameMenu();
  });
  const localCamera = tile.you && tile.kind === 'camera';
  const cropStyle = {
    objectFit: fit as TileFit,
    objectPosition: faceObjectPosition(selfPanX, selfPanY),
    transform: `scale(${selfZoom})`,
  };
  const letters = initials(tile.name.replace(/'s screen$/, ''));
  const color = colorFor(tile.you ? tile.name : tile.name);
  const trackKey = tile.stream?.getTracks().map((track) => track.id).join(',') ?? '';
  useEffect(() => {
    if (localCamera) {
      const parent = slotRef.current;
      if (!parent) return;
      if (localRef) localRef.current = getPreviewVideo();
      const blur = blurRef.current;
      if (blur) {
        blur.srcObject = tile.stream;
        void blur.play().catch(() => undefined);
      }
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
    const blur = blurRef.current;
    if (blur) {
      blur.srcObject = tile.stream;
      void blur.play().catch(() => undefined);
    }
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

  const connectStep =
    tile.connection === 'failed'
      ? 3
      : tile.connection === 'disconnected'
        ? 3
        : slow
          ? 2
          : 1;

  return (
    <article
      className={cx(
        'tile',
        tile.speaking && 'speaking',
        pinned && 'pinned',
        casted && 'casted',
        portrait && 'has-blur-fill',
        layoutRole === 'pip' && 'meet-pip-tile',
        layoutRole === 'main' && 'meet-main-tile',
      )}
      data-kind={tile.kind}
      data-fit={fit}
      onContextMenu={(event) => event.preventDefault()}
    >
      {portrait && tile.showVideo && (
        <video ref={blurRef} className="tile-blur" autoPlay muted playsInline aria-hidden="true" />
      )}
      {localCamera ? (
        <div
          className="local-slot"
          ref={slotRef}
          style={{
            ['--tile-fit' as string]: fit,
            ['--tile-pos' as string]: faceObjectPosition(selfPanX, selfPanY),
            ['--self-zoom' as string]: String(selfZoom),
          }}
          onPointerMove={(event) => {
            if (!onSelfCrop || event.buttons !== 1) return;
            const box = event.currentTarget.getBoundingClientRect();
            onSelfCrop(selfZoom, Math.min(1, Math.max(0, (event.clientX - box.left) / box.width)), Math.min(1, Math.max(0, (event.clientY - box.top) / box.height)));
          }}
        />
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
          className={cx(fit === 'cover' ? 'fit-cover' : 'fit-contain', !tile.showVideo && 'is-off')}
          style={cropStyle}
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
      {(tile.hand || (tile.kind === 'camera' && (!tile.micOn || !tile.showVideo))) && (
        <div className="tile-badges">
          {tile.kind === 'camera' && !tile.micOn && (
            <div className="tile-chip muted-chip" title="Muted" aria-label="Muted">
              <IconMicOff />
              <span>Muted</span>
            </div>
          )}
          {tile.kind === 'camera' && !tile.showVideo && (
            <div className="tile-chip camoff-chip" title="Camera off" aria-label="Camera off">
              <IconCamOff />
              <span>Camera off</span>
            </div>
          )}
          {tile.hand && (
            <div className="hand-badge" title="Hand raised" aria-label="Hand raised">
              <IconHand />
              <span>{handRank ? `Hand raised ${ordinal(handRank)}` : 'Hand raised'}</span>
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
          {tile.kind === 'camera' && role && role !== 'You' ? ` · ${role}` : ''}
          {tile.speaking ? ' · Speaking' : ''}
          {pinned ? ' · Pinned' : ''}
        </span>
      </div>
      {connecting && (
        <div className={cx('connline', trouble && 'connline-trouble', 'connline-panel')}>
          <strong>{connecting}</strong>
          <ol className="conn-steps" aria-label="Connection steps">
            <li className={connectStep >= 1 ? 'done' : ''}>Finding peer route</li>
            <li className={connectStep >= 2 ? 'done' : ''}>Checking network path</li>
            <li className={connectStep >= 3 ? 'done' : ''}>Waiting for media</li>
          </ol>
          {!tile.you && (
            <div className="connline-actions">
              <button type="button" className="primary slim" onClick={onRetry}>
                Retry now
              </button>
              <button type="button" className="secondary slim" onClick={onCopyInvite}>
                Send rejoin link
              </button>
            </div>
          )}
          {trouble && (
            <details className="net-tips">
              <summary>Network tips</summary>
              <ul>
                <li>Switch to a stronger Wi?Fi or wired connection.</li>
                <li>Close VPNs or firewalls that block peer video.</li>
                <li>Ask them to refresh and rejoin the meeting.</li>
              </ul>
            </details>
          )}
        </div>
      )}
      <button type="button" className={cx('pinbtn', pinned && 'on')} onClick={onPin}>
        <IconPin />
        {pinned ? 'Unpin' : 'Pin'}
      </button>
      <div className="tile-frame-wrap" ref={frameMenuRef}>
        <button
          type="button"
          className="tile-frame-btn"
          aria-label="Frame this video"
          aria-expanded={menu}
          onClick={(event) => {
            event.stopPropagation();
            setMenu((value) => !value);
          }}
        >
          <IconCrop />
        </button>
        {menu && (
          <>
            <button
              type="button"
              className="tile-frame-scrim"
              aria-label="Close frame options"
              onClick={() => setMenu(false)}
            />
            <div className="tile-frame-menu" role="menu">
              <button
                type="button"
                aria-pressed={fit === 'contain'}
                onClick={() => {
                  onFit?.('contain');
                  setMenu(false);
                }}
              >
                Fit
              </button>
              <button
                type="button"
                aria-pressed={fit === 'cover'}
                onClick={() => {
                  onFit?.('cover');
                  setMenu(false);
                }}
              >
                Fill
              </button>
              {onSelfCrop && (
                <label>
                  Zoom
                  <input
                    type="range"
                    min={1}
                    max={2}
                    step={0.05}
                    value={selfZoom}
                    onChange={(event) => onSelfCrop(Number(event.target.value), selfPanX, selfPanY)}
                  />
                </label>
              )}
              <button type="button" onClick={() => setMenu(false)}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
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
  onDenyAll,
  onMuteAll,
  onCopyInvite,
  handOrderIds,
  onLowerAll,
  meetingLocked,
  onLock,
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
  onDenyAll: () => void;
  onMuteAll: () => void;
  onCopyInvite: () => void;
  handOrderIds: string[];
  onLowerAll: () => void;
  meetingLocked: boolean;
  onLock: () => void;
  onCohost: (id: string, on: boolean) => void;
}) {
  const [query, setQuery] = useState('');
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
  const needle = query.trim().toLowerCase();
  const visible = needle
    ? rows.filter((row) => row.name.toLowerCase().includes(needle))
    : rows;
  return (
    <div className="people">
      <div className="people-toolbar">
        <input
          type="search"
          className="people-search"
          placeholder="Search people"
          aria-label="Search people"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className="people-count">{rows.length} in call</span>
      </div>
      <div className="people-host-actions">
        <button type="button" className="secondary slim" onClick={onCopyInvite}>
          Invite / copy link
        </button>
        {canModerate && (
          <>
            <button type="button" className="secondary slim" onClick={onMuteAll}>
              Mute all
            </button>
            <button type="button" className="secondary slim" aria-pressed={meetingLocked} onClick={onLock}>
              {meetingLocked ? 'Unlock meeting' : 'Lock meeting'}
            </button>
          </>
        )}
      </div>
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
            <div className="admit-bulk">
              <button type="button" className="admit-all" onClick={() => waiting.forEach((person) => onAdmit(person.id))}>
                Admit all
              </button>
              <button type="button" className="admit-no admit-all" onClick={onDenyAll}>
                Deny all
              </button>
            </div>
          )}
        </div>
      )}
      {hands.length > 0 && (
        <div className="hands">
          <div className="hands-head">
            <strong>Raised hands ({hands.length})</strong>
            <button type="button" className="textbtn" onClick={onLowerAll}>
              Lower all
            </button>
          </div>
          <ul>
            {(handOrderIds.length
              ? [...hands].sort((a, b) => handOrderIds.indexOf(a.id) - handOrderIds.indexOf(b.id))
              : hands
            ).map((row, index) => (
              <li key={row.id}>
                {row.name}
                {handOrderIds.length > 1 ? ` · ${ordinal(index + 1)}` : ''}
              </li>
            ))}
          </ul>
        </div>
      )}
      {visible.map((row) => {
        const role =
          row.id === hostId ? 'Host' : coHostIds.includes(row.id) ? 'Co-host' : row.you ? 'You' : 'Guest';
        const label = row.you ? `${row.name} (You)` : row.name;
        const canControl =
          canModerate && !row.you && row.id !== hostId && (isHost || !coHostIds.includes(row.id));
        const overflowOpen = confirmRemove === `more:${row.id}`;
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
                  row.connection !== 'connected'
                    ? row.connection === 'failed'
                      ? 'Cannot reach'
                      : 'Connecting…'
                    : '',
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
                {(canControl || (isHost && !row.you && row.id !== hostId)) && (
                  <div className="person-more">
                    <button
                      type="button"
                      className="pact"
                      aria-label="More participant actions"
                      aria-expanded={overflowOpen}
                      onClick={() => onConfirm(overflowOpen ? null : `more:${row.id}`)}
                    >
                      {'⋯'}
                    </button>
                    {overflowOpen && (
                      <div className="person-more-menu" role="menu">
                        {canControl && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              onConfirm(null);
                              onModerate(row.id, row.camOn ? 'mute-cam' : 'ask-cam');
                            }}
                          >
                            {row.camOn ? 'Turn cam off' : 'Ask for camera'}
                          </button>
                        )}
                        {isHost && !row.you && row.id !== hostId && (
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              onConfirm(null);
                              onCohost(row.id, !coHostIds.includes(row.id));
                            }}
                          >
                            {coHostIds.includes(row.id) ? 'Remove co-host' : 'Make co-host'}
                          </button>
                        )}
                        {canControl && (
                          <button
                            type="button"
                            role="menuitem"
                            className="danger"
                            onClick={() => onConfirm(row.id)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    )}
                  </div>
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
        <p className="empty">Nothing yet {'—'} you are caught up.</p>
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
  onDenyAll,
}: {
  waiting: { id: string; name: string }[];
  onReview: () => void;
  onAdmit: (id: string) => void;
  onDeny: (id: string) => void;
  onAdmitAll: () => void;
  onDenyAll: () => void;
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
          <>
            <button type="button" className="admit-yes" onClick={onAdmitAll}>
              Admit all
            </button>
            <button type="button" className="admit-no" onClick={onDenyAll}>
              Deny all
            </button>
          </>
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
  const voteCount = Object.keys(poll.votes).length;
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
        {voteCount} vote{voteCount === 1 ? '' : 's'}
        {poll.closed ? ' · Closed' : ''}
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
    ? 'Starting…'
    : gate === 'connecting'
      ? 'Connecting…'
      : 'Knock sent';
  const title = hostStarting
    ? 'Opening your meeting'
    : gate === 'connecting'
      ? 'Reaching the room…'
      : 'Waiting for the host';
  const detail = hostStarting
    ? 'You are the host. Entering the room now — guests who use your link will knock first.'
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

function ShortcutsDialog({ canModerate, onClose }: { canModerate: boolean; onClose: () => void }) {
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
          {shortcuts
            .filter(([key]) => canModerate || key !== 'W')
            .map(([key, label]) => (
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
