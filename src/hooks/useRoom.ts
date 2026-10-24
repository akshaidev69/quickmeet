import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { safeName, uid } from '../lib/code';
import type { ChatMessage, PeerInfo, Poll, RecordCastSignal, Signal, WaitingPerson } from '../types';

export type RemotePeer = PeerInfo & {
  connection: RTCPeerConnectionState | 'new';
  camera: MediaStream | null;
  screen: MediaStream | null;
  audio: MediaStream | null;
};

export type GateState = 'connecting' | 'waiting' | 'admitted' | 'denied';

type Ask = { kind: 'mic' | 'cam'; fromName: string } | null;

type Options = {
  code: string;
  name: string;
  stream: MediaStream | null;
  micOn: boolean;
  camOn: boolean;
  hand: boolean;
  sharing: boolean;
  recording: boolean;
  onForceMute?: (kind: 'mic' | 'cam') => void;
  onHostCast?: (cast: RecordCastSignal, active: boolean) => void;
};

type Bucket = { camera: MediaStream; screen: MediaStream; audio: MediaStream };
type VideoItem = { mid: string | null; track: MediaStreamTrack };
type Conn = {
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingIce: RTCIceCandidateInit[];
  audioSender: RTCRtpSender | null;
  videoSender: RTCRtpSender | null;
  screenSender: RTCRtpSender | null;
  screenAudioSender: RTCRtpSender | null;
  remoteCameraMid: string | null;
  remoteScreenMid: string | null;
  videos: VideoItem[];
};

type RoomApi = {
  publish: () => void;
  setStream: (stream: MediaStream | null) => void;
  setScreenTrack: (stream: MediaStream | null) => void;
  sendChat: (text: string) => void;
  sendReaction: (emoji: string) => void;
  sendCaption: (text: string) => void;
  kick: (id: string) => void;
  moderate: (id: string, action: 'mute-mic' | 'mute-cam' | 'ask-mic' | 'ask-cam') => void;
  retry: (id: string) => void;
  sendPoll: (poll: Poll) => void;
  sendVote: (pollId: string, option: number) => void;
  admit: (id: string) => void;
  deny: (id: string) => void;
  setCohost: (id: string, on: boolean) => void;
  publishCast: (cast: RecordCastSignal, active: boolean) => void;
  rename: (name: string) => void;
};

const iceServers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }];

function tuneCameraTrack(track: MediaStreamTrack | null) {
  if (!track) return;
  try {
    track.contentHint = 'motion';
  } catch {
    /* older browsers */
  }
}

function tuneCameraSender(sender: RTCRtpSender | null) {
  if (!sender?.track || sender.track.kind !== 'video') return;
  tuneCameraTrack(sender.track);
  try {
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings = params.encodings.map((encoding) => ({
      ...encoding,
      maxBitrate: 900_000,
      maxFramerate: 30,
    }));
    (params as RTCRtpSendParameters & { degradationPreference?: string }).degradationPreference =
      'maintain-framerate';
    void sender.setParameters(params).catch(() => undefined);
  } catch {
    /* setParameters unsupported */
  }
}

function tuneReceiverLatency(receiver: RTCRtpReceiver) {
  try {
    const hintable = receiver as RTCRtpReceiver & { playoutDelayHint?: number };
    if ('playoutDelayHint' in hintable) hintable.playoutDelayHint = 0;
  } catch {
    /* ignore */
  }
}

function samePeer(a: PeerInfo, b: PeerInfo) {
  return (
    a.name === b.name &&
    a.micOn === b.micOn &&
    a.camOn === b.camOn &&
    a.hand === b.hand &&
    a.sharing === b.sharing &&
    a.recording === b.recording
  );
}

function systemNote(text: string): ChatMessage {
  return { id: uid(), from: 'system', name: 'Meeting', text, ts: Date.now(), system: true };
}

export function useRoom(options: Options) {
  const peerId = useRef(uid()).current;
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting'>('connecting');
  const [gate, setGate] = useState<GateState>('connecting');
  const [waiting, setWaiting] = useState<WaitingPerson[]>([]);
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({});
  const [connState, setConnState] = useState<Record<string, RTCPeerConnectionState | 'new'>>({});
  const [mediaTick, setMediaTick] = useState(0);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [reactions, setReactions] = useState<{ id: string; peerId: string; emoji: string }[]>([]);
  const [caption, setCaption] = useState<{ name: string; text: string } | null>(null);
  const [kickedBy, setKickedBy] = useState<string | null>(null);
  const [hostId, setHostId] = useState<string | null>(null);
  const [coHostIds, setCoHostIds] = useState<string[]>([]);
  const [ask, setAsk] = useState<Ask>(null);
  const [poll, setPoll] = useState<Poll | null>(null);
  const [hostCastActive, setHostCastActive] = useState(false);

  const nameRef = useRef(options.name);
  const micRef = useRef(options.micOn);
  const camRef = useRef(options.camOn);
  const handRef = useRef(options.hand);
  const shareRef = useRef(options.sharing);
  const recRef = useRef(options.recording);
  const streamRef = useRef<MediaStream | null>(options.stream);
  const peersRef = useRef(peers);
  const historyRef = useRef<ChatMessage[]>([]);
  const pollRef = useRef(poll);
  const onForceMuteRef = useRef(options.onForceMute);
  const onHostCastRef = useRef(options.onHostCast);
  const admittedRef = useRef(false);
  const apiRef = useRef<RoomApi | null>(null);
  const mediaRef = useRef(new Map<string, Bucket>());

  nameRef.current = options.name;
  micRef.current = options.micOn;
  camRef.current = options.camOn;
  handRef.current = options.hand;
  shareRef.current = options.sharing;
  recRef.current = options.recording;
  streamRef.current = options.stream;
  peersRef.current = peers;
  pollRef.current = poll;
  onForceMuteRef.current = options.onForceMute;
  onHostCastRef.current = options.onHostCast;

  const addChat = useCallback((messages: ChatMessage[]) => {
    const ids = new Set(historyRef.current.map((item) => item.id));
    const fresh = messages.filter((item) => item.text && !ids.has(item.id));
    if (!fresh.length) return;
    historyRef.current = [...historyRef.current, ...fresh].sort((a, b) => a.ts - b.ts).slice(-300);
    setChat(historyRef.current);
  }, []);

  useEffect(() => {
    const code = options.code;
    if (!code) return;
    let closed = false;
    let dead = false;
    let attempt = 0;
    let socket: WebSocket | null = null;
    let reconnectTimer = 0;
    let captionTimer = 0;
    const queue: string[] = [];
    const conns = new Map<string, Conn>();
    const timeouts = new Set<number>();
    let screenStream: MediaStream | null = null;

    const selfInfo = (): PeerInfo => ({
      id: peerId,
      name: safeName(nameRef.current),
      micOn: micRef.current,
      camOn: camRef.current,
      hand: handRef.current,
      sharing: shareRef.current,
      recording: recRef.current,
    });

    const send = (payload: Signal) => {
      const packet = JSON.stringify({ kind: 'signal', from: peerId, payload });
      if (socket && socket.readyState === WebSocket.OPEN) socket.send(packet);
      else if (!closed) queue.push(packet);
    };

    const bump = () => {
      if (!closed) setMediaTick((value) => value + 1);
    };

    const bucket = (id: string): Bucket => {
      let item = mediaRef.current.get(id);
      if (!item) {
        item = { camera: new MediaStream(), screen: new MediaStream(), audio: new MediaStream() };
        mediaRef.current.set(id, item);
      }
      return item;
    };

    const replaceStreamTracks = (target: MediaStream, tracks: MediaStreamTrack[]) => {
      for (const track of target.getTracks()) {
        if (!tracks.some((item) => item.id === track.id)) target.removeTrack(track);
      }
      for (const track of tracks) {
        if (!target.getTracks().some((item) => item.id === track.id)) target.addTrack(track);
      }
    };

    const reclassify = (id: string, conn: Conn) => {
      const item = bucket(id);
      const camera: MediaStreamTrack[] = [];
      const screen: MediaStreamTrack[] = [];
      for (const video of conn.videos) {
        if (video.track.readyState === 'ended') continue;
        if (video.mid && conn.remoteScreenMid && video.mid === conn.remoteScreenMid) screen.push(video.track);
        else camera.push(video.track);
      }
      if (!conn.remoteScreenMid && camera.length > 1) {
        const extra = camera.pop();
        if (extra) screen.push(extra);
      }
      replaceStreamTracks(item.camera, camera.slice(0, 1));
      replaceStreamTracks(item.screen, screen.slice(0, 1));
      bump();
    };

    const rememberMids = (conn: Conn, cameraMid: string | null, screenMid: string | null, remoteId: string) => {
      if (cameraMid) conn.remoteCameraMid = cameraMid;
      const previous = conn.remoteScreenMid;
      if (screenMid === null) {
        if (previous) conn.videos = conn.videos.filter((item) => item.mid !== previous);
        conn.remoteScreenMid = null;
      } else if (screenMid && screenMid !== 'pending') {
        conn.remoteScreenMid = screenMid;
      }
      reclassify(remoteId, conn);
    };

    const readMids = (conn: Conn) => {
      const midFor = (sender: RTCRtpSender | null) =>
        sender ? conn.pc.getTransceivers().find((item) => item.sender === sender)?.mid ?? null : null;
      return { cameraMid: midFor(conn.videoSender), screenMid: midFor(conn.screenSender) };
    };

    const sendDescription = async (conn: Conn, remoteId: string) => {
      await conn.pc.setLocalDescription();
      if (!conn.pc.localDescription) return;
      const mids = readMids(conn);
      send({
        type: 'description',
        from: peerId,
        to: remoteId,
        description: conn.pc.localDescription,
        cameraMid: mids.cameraMid,
        screenMid: conn.screenSender ? mids.screenMid ?? 'pending' : null,
      });
    };

    const dropScreenSenders = (conn: Conn) => {
      if (conn.screenSender) {
        conn.pc.removeTrack(conn.screenSender);
        conn.screenSender = null;
      }
      if (conn.screenAudioSender) {
        conn.pc.removeTrack(conn.screenAudioSender);
        conn.screenAudioSender = null;
      }
    };

    const wireLocal = (conn: Conn) => {
      const stream = streamRef.current;
      const audio = stream?.getAudioTracks()[0] ?? null;
      const video = stream?.getVideoTracks()[0] ?? null;
      tuneCameraTrack(video);
      if (audio && stream) conn.audioSender = conn.pc.addTrack(audio, stream);
      else conn.audioSender = conn.pc.addTransceiver('audio', { direction: 'sendrecv' }).sender;
      if (video && stream) conn.videoSender = conn.pc.addTrack(video, stream);
      else conn.videoSender = conn.pc.addTransceiver('video', { direction: 'sendrecv' }).sender;
      tuneCameraSender(conn.videoSender);
      const screenVideo = screenStream?.getVideoTracks()[0];
      const screenAudio = screenStream?.getAudioTracks()[0];
      if (screenVideo && screenStream && screenVideo.readyState === 'live') {
        screenVideo.contentHint = 'text';
        conn.screenSender = conn.pc.addTrack(screenVideo, screenStream);
      }
      if (screenAudio && screenStream && screenAudio.readyState === 'live') {
        conn.screenAudioSender = conn.pc.addTrack(screenAudio, screenStream);
      }
    };

    const ensureConn = (remoteId: string, force = false) => {
      const existing = conns.get(remoteId);
      if (
        existing &&
        !force &&
        existing.pc.connectionState !== 'failed' &&
        existing.pc.connectionState !== 'closed'
      ) {
        return existing;
      }
      if (existing) {
        existing.pc.onnegotiationneeded = null;
        existing.pc.onicecandidate = null;
        existing.pc.ontrack = null;
        existing.pc.close();
      }
      const pc = new RTCPeerConnection({ iceServers });
      const conn: Conn = {
        pc,
        polite: peerId > remoteId,
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        pendingIce: [],
        audioSender: null,
        videoSender: null,
        screenSender: null,
        screenAudioSender: null,
        remoteCameraMid: null,
        remoteScreenMid: null,
        videos: [],
      };
      conns.set(remoteId, conn);
      if (!closed) setConnState((prev) => ({ ...prev, [remoteId]: 'new' }));

      pc.onicecandidate = ({ candidate }) => {
        send({
          type: 'ice',
          from: peerId,
          to: remoteId,
          candidate: candidate ? candidate.toJSON() : null,
        });
      };
      pc.onconnectionstatechange = () => {
        if (!closed) setConnState((prev) => ({ ...prev, [remoteId]: pc.connectionState }));
      };
      pc.oniceconnectionstatechange = () => {
        if (closed) return;
        if (pc.iceConnectionState === 'failed') setConnState((prev) => ({ ...prev, [remoteId]: 'failed' }));
      };
      pc.ontrack = (event) => {
        tuneReceiverLatency(event.receiver);
        const track = event.track;
        if (track.kind === 'audio') {
          const item = bucket(remoteId);
          if (!item.audio.getTracks().some((current) => current.id === track.id)) item.audio.addTrack(track);
          track.onended = () => {
            item.audio.removeTrack(track);
            bump();
          };
          bump();
          return;
        }
        tuneCameraTrack(track);
        conn.videos = conn.videos.filter((item) => item.track.id !== track.id);
        conn.videos.push({ mid: event.transceiver.mid, track });
        track.onended = () => {
          conn.videos = conn.videos.filter((item) => item.track.id !== track.id);
          reclassify(remoteId, conn);
        };
        reclassify(remoteId, conn);
      };
      pc.onnegotiationneeded = () => {
        if (conn.polite && !pc.currentRemoteDescription && pc.signalingState === 'stable') return;
        if (conn.makingOffer) return;
        conn.makingOffer = true;
        void sendDescription(conn, remoteId)
          .catch((error) => console.warn('Negotiation failed', error))
          .finally(() => {
            conn.makingOffer = false;
          });
      };
      wireLocal(conn);
      return conn;
    };

    const learn = (peer: PeerInfo) => {
      if (closed || peer.id === peerId) return;
      setPeers((prev) => {
        const current = prev[peer.id];
        if (current && samePeer(current, peer)) return prev;
        return { ...prev, [peer.id]: peer };
      });
      ensureConn(peer.id);
    };

    const showCaption = (name: string, text: string) => {
      if (closed || !text.trim()) return;
      setCaption({ name, text: text.trim() });
      window.clearTimeout(captionTimer);
      captionTimer = window.setTimeout(() => {
        if (!closed) setCaption(null);
      }, 5000);
    };

    const pushReaction = (id: string, from: string, emoji: string) => {
      if (closed) return;
      setReactions((items) => [...items, { id, peerId: from, emoji }].slice(-12));
      const timer = window.setTimeout(() => {
        timeouts.delete(timer);
        if (!closed) setReactions((items) => items.filter((item) => item.id !== id));
      }, 2400);
      timeouts.add(timer);
    };

    const flushIce = async (conn: Conn) => {
      const queued = conn.pendingIce.splice(0);
      for (const candidate of queued) {
        try {
          await conn.pc.addIceCandidate(candidate);
        } catch (error) {
          if (!conn.ignoreOffer) console.warn('ICE failed', error);
        }
      }
    };

    const onDescription = async (payload: Extract<Signal, { type: 'description' }>) => {
      const conn = ensureConn(payload.from);
      const pc = conn.pc;
      const readyForOffer =
        !conn.makingOffer && (pc.signalingState === 'stable' || conn.isSettingRemoteAnswerPending);
      const offerCollision = payload.description.type === 'offer' && !readyForOffer;
      conn.ignoreOffer = !conn.polite && offerCollision;
      if (conn.ignoreOffer) return;
      if (offerCollision && conn.polite) {
        await pc.setLocalDescription({ type: 'rollback' }).catch(() => undefined);
      }
      rememberMids(conn, payload.cameraMid, payload.screenMid, payload.from);
      conn.isSettingRemoteAnswerPending = payload.description.type === 'answer';
      try {
        await pc.setRemoteDescription(payload.description);
      } catch (error) {
        console.warn('Could not apply description', error);
        return;
      } finally {
        conn.isSettingRemoteAnswerPending = false;
      }
      await flushIce(conn);
      if (payload.description.type === 'offer') {
        try {
          await sendDescription(conn, payload.from);
        } catch (error) {
          console.warn('Could not answer', error);
        }
      }
    };

    const handle = (payload: Signal) => {
      if (!payload?.type || payload.from === peerId) return;
      if ('to' in payload && payload.to && payload.to !== peerId) return;
      if (payload.type === 'hello' || payload.type === 'state') {
        learn(payload.peer);
        if (payload.type === 'hello') {
          send({
            type: 'welcome',
            from: peerId,
            to: payload.from,
            peer: selfInfo(),
            chat: historyRef.current.filter((item) => !item.system).slice(-50),
            poll: pollRef.current,
          });
        }
        return;
      }
      if (payload.type === 'welcome') {
        learn(payload.peer);
        addChat(payload.chat);
        if (payload.poll) {
          setPoll((current) => {
            if (!current || current.id !== payload.poll?.id) return payload.poll;
            return { ...payload.poll, votes: { ...payload.poll.votes, ...current.votes } };
          });
        }
        return;
      }
      if (payload.type === 'chat') {
        addChat([payload.message]);
        return;
      }
      if (payload.type === 'reaction') {
        pushReaction(payload.id, payload.from, payload.emoji);
        return;
      }
      if (payload.type === 'caption') {
        showCaption(payload.name, payload.text);
        return;
      }
      if (payload.type === 'leave') {
        conns.get(payload.from)?.pc.close();
        conns.delete(payload.from);
        mediaRef.current.delete(payload.from);
        bump();
        if (!closed) {
          setPeers((prev) => {
            if (!prev[payload.from]) return prev;
            const next = { ...prev };
            delete next[payload.from];
            return next;
          });
          setConnState((prev) => {
            if (!prev[payload.from]) return prev;
            const next = { ...prev };
            delete next[payload.from];
            return next;
          });
        }
        return;
      }
      if (payload.type === 'reset') {
        ensureConn(payload.from, true);
        return;
      }
      if (payload.type === 'kick') {
        dead = true;
        if (!closed) setKickedBy(peersRef.current[payload.from]?.name || 'The host');
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ kind: 'signal', from: peerId, payload: { type: 'leave', from: peerId } }));
        }
        for (const conn of conns.values()) conn.pc.close();
        socket?.close();
        return;
      }
      if (payload.type === 'moderate') {
        const fromName = peersRef.current[payload.from]?.name || 'The host';
        if (payload.action === 'mute-mic') onForceMuteRef.current?.('mic');
        if (payload.action === 'mute-cam') onForceMuteRef.current?.('cam');
        if (!closed && payload.action === 'ask-mic') setAsk({ kind: 'mic', fromName });
        if (!closed && payload.action === 'ask-cam') setAsk({ kind: 'cam', fromName });
        return;
      }
      if (payload.type === 'description') {
        void onDescription(payload);
        return;
      }
      if (payload.type === 'ice') {
        if (!payload.candidate) return;
        const conn = ensureConn(payload.from);
        if (!conn.pc.remoteDescription) conn.pendingIce.push(payload.candidate);
        else void conn.pc.addIceCandidate(payload.candidate).catch(() => undefined);
        return;
      }
      if (payload.type === 'poll') {
        if (!closed) setPoll(payload.poll);
        return;
      }
      if (payload.type === 'vote') {
        if (closed) return;
        setPoll((current) => {
          if (!current || current.id !== payload.pollId) return current;
          return { ...current, votes: { ...current.votes, [payload.from]: payload.option } };
        });
        return;
      }
      if (payload.type === 'cast') {
        if (closed) return;
        setHostCastActive(payload.active);
        onHostCastRef.current?.(payload.cast, payload.active);
      }
    };

    const enterMeeting = () => {
      if (closed || !admittedRef.current) return;
      for (const packet of queue) socket?.send(packet);
      queue.length = 0;
      for (const [id, conn] of conns) {
        const state = conn.pc.connectionState;
        if (state === 'failed' || state === 'disconnected' || state === 'closed') ensureConn(id, true);
      }
      send({ type: 'hello', from: peerId, peer: selfInfo() });
    };

    const connect = () => {
      if (closed || dead) return;
      if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return;
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      socket = new WebSocket(`${proto}://${location.host}/signal`);
      socket.onopen = () => {
        if (closed || !socket) return;
        attempt = 0;
        setStatus('connected');
        if (!admittedRef.current) setGate('connecting');
        socket.send(
          JSON.stringify({
            kind: 'join',
            room: code,
            from: peerId,
            name: safeName(nameRef.current),
          }),
        );
      };
      socket.onmessage = (event) => {
        let message: {
          kind?: string;
          hostId?: string | null;
          coHostIds?: string[];
          state?: string;
          people?: WaitingPerson[];
          payload?: Signal;
        };
        try {
          message = JSON.parse(String(event.data)) as typeof message;
        } catch {
          return;
        }
        if (message.kind === 'gate') {
          if (closed) return;
          if (message.hostId) setHostId(message.hostId);
          if (Array.isArray(message.coHostIds)) setCoHostIds(message.coHostIds);
          if (message.state === 'waiting') {
            admittedRef.current = false;
            setGate('waiting');
            return;
          }
          if (message.state === 'denied') {
            dead = true;
            admittedRef.current = false;
            setGate('denied');
            socket?.close();
            return;
          }
          if (message.state === 'admitted') {
            admittedRef.current = true;
            setGate('admitted');
            enterMeeting();
            return;
          }
          return;
        }
        if (message.kind === 'waiting' && Array.isArray(message.people)) {
          if (!closed) setWaiting(message.people);
          return;
        }
        if (message.kind === 'meta' && message.hostId) {
          if (!closed) {
            setHostId(message.hostId);
            setCoHostIds(Array.isArray(message.coHostIds) ? message.coHostIds : []);
          }
          return;
        }
        if (message.kind === 'signal' && message.payload && admittedRef.current) handle(message.payload);
      };
      socket.onclose = () => {
        if (closed || dead) return;
        setStatus('reconnecting');
        if (admittedRef.current) setGate('admitted');
        else setGate('connecting');
        const delay = Math.min(5000, 400 * 2 ** attempt);
        attempt += 1;
        reconnectTimer = window.setTimeout(connect, delay);
      };
    };

    const control = (kind: 'admit' | 'deny' | 'eject', id: string) => {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ kind, peerId: id }));
      }
    };

    apiRef.current = {
      publish: () => {
        if (admittedRef.current) send({ type: 'state', from: peerId, peer: selfInfo() });
      },
      setStream: (next) => {
        streamRef.current = next;
        const audio = next?.getAudioTracks()[0] ?? null;
        const video = next?.getVideoTracks()[0] ?? null;
        tuneCameraTrack(video);
        for (const conn of conns.values()) {
          if (conn.audioSender) void conn.audioSender.replaceTrack(audio);
          if (conn.videoSender) {
            void conn.videoSender.replaceTrack(video);
            tuneCameraSender(conn.videoSender);
          }
        }
      },
      setScreenTrack: (next) => {
        screenStream = next;
        const video = next?.getVideoTracks()[0] ?? null;
        const audio = next?.getAudioTracks()[0] ?? null;
        if (video) video.contentHint = 'text';
        for (const conn of conns.values()) {
          dropScreenSenders(conn);
          if (video && next && video.readyState === 'live') conn.screenSender = conn.pc.addTrack(video, next);
          if (audio && next && audio.readyState === 'live') conn.screenAudioSender = conn.pc.addTrack(audio, next);
        }
      },
      sendChat: (text) => {
        const message: ChatMessage = {
          id: uid(),
          from: peerId,
          name: safeName(nameRef.current),
          text: text.trim().slice(0, 2000),
          ts: Date.now(),
        };
        if (!message.text) return;
        addChat([message]);
        send({ type: 'chat', from: peerId, message });
      },
      sendReaction: (emoji) => {
        const id = uid();
        pushReaction(id, peerId, emoji);
        send({ type: 'reaction', from: peerId, id, emoji });
      },
      sendCaption: (text) => {
        const label = safeName(nameRef.current);
        const clean = text.trim().slice(0, 280);
        if (!clean) return;
        showCaption(label, clean);
        send({ type: 'caption', from: peerId, name: label, text: clean });
      },
      kick: (id) => control('eject', id),
      moderate: (id, action) => send({ type: 'moderate', from: peerId, to: id, action }),
      retry: (id) => {
        ensureConn(id, true);
        send({ type: 'reset', from: peerId, to: id });
      },
      sendPoll: (next) => send({ type: 'poll', from: peerId, poll: next }),
      sendVote: (pollId, option) => send({ type: 'vote', from: peerId, pollId, option }),
      admit: (id) => control('admit', id),
      deny: (id) => control('deny', id),
      setCohost: (id, on) => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ kind: 'cohost', peerId: id, on }));
        }
      },
      publishCast: (cast, active) => {
        setHostCastActive(active);
        send({ type: 'cast', from: peerId, cast, active });
      },
      rename: (nextName) => {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ kind: 'rename', name: safeName(nextName) }));
        }
      },
    };

    connect();
    return () => {
      try {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ kind: 'signal', from: peerId, payload: { type: 'leave', from: peerId } }));
        }
      } catch {
        /* socket already closed */
      }
      closed = true;
      dead = true;
      window.clearTimeout(reconnectTimer);
      window.clearTimeout(captionTimer);
      timeouts.forEach((timer) => window.clearTimeout(timer));
      for (const conn of conns.values()) conn.pc.close();
      socket?.close();
      apiRef.current = null;
      mediaRef.current.clear();
    };
  }, [addChat, options.code, peerId]);

  useEffect(() => {
    const timer = window.setTimeout(() => apiRef.current?.publish(), 40);
    return () => window.clearTimeout(timer);
  }, [options.micOn, options.camOn, options.hand, options.sharing, options.recording]);

  // Debounce name publishes so typing does not flood chat with "X is now Y".
  useEffect(() => {
    const timer = window.setTimeout(() => {
      apiRef.current?.publish();
      if (gate === 'waiting') apiRef.current?.rename(options.name);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [gate, options.name]);

  useEffect(() => {
    apiRef.current?.setStream(options.stream);
  }, [options.stream]);

  const seenPeers = useRef<Record<string, PeerInfo>>({});
  const pendingNames = useRef<Record<string, { from: string; to: string; timer: number }>>({});
  useEffect(() => {
    const prev = seenPeers.current;
    const notes: ChatMessage[] = [];
    for (const id of Object.keys(peers)) {
      const now = peers[id];
      const was = prev[id];
      if (!was) notes.push(systemNote(`${now.name} joined`));
      else {
        if (was.name !== now.name) {
          const pending = pendingNames.current[id];
          if (pending) window.clearTimeout(pending.timer);
          const from = pending?.from ?? was.name;
          pendingNames.current[id] = {
            from,
            to: now.name,
            timer: window.setTimeout(() => {
              delete pendingNames.current[id];
              addChat([systemNote(`${from} is now ${now.name}`)]);
            }, 900),
          };
        }
        if (was.sharing !== now.sharing) {
          notes.push(systemNote(now.sharing ? `${now.name} started sharing` : `${now.name} stopped sharing`));
        }
        if (was.recording !== now.recording) {
          notes.push(systemNote(now.recording ? `${now.name} started recording` : `${now.name} stopped recording`));
        }
      }
    }
    for (const id of Object.keys(prev)) {
      if (!peers[id]) {
        const pending = pendingNames.current[id];
        if (pending) {
          window.clearTimeout(pending.timer);
          delete pendingNames.current[id];
        }
        notes.push(systemNote(`${prev[id].name} left`));
      }
    }
    seenPeers.current = peers;
    if (notes.length) addChat(notes);
  }, [addChat, peers]);

  const remotes = useMemo<RemotePeer[]>(() => {
    return Object.values(peers)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((peer) => {
        const media = mediaRef.current.get(peer.id);
        return {
          ...peer,
          connection: connState[peer.id] ?? 'new',
          camera: mediaTick >= 0 ? media?.camera ?? null : null,
          screen: media?.screen ?? null,
          audio: media?.audio ?? null,
        };
      });
  }, [connState, mediaTick, peers]);

  const sendChat = useCallback((text: string) => apiRef.current?.sendChat(text), []);
  const sendReaction = useCallback((emoji: string) => apiRef.current?.sendReaction(emoji), []);
  const sendCaption = useCallback((text: string) => apiRef.current?.sendCaption(text), []);
  const kick = useCallback((id: string) => apiRef.current?.kick(id), []);
  const moderate = useCallback(
    (id: string, action: 'mute-mic' | 'mute-cam' | 'ask-mic' | 'ask-cam') => apiRef.current?.moderate(id, action),
    [],
  );
  const retry = useCallback((id: string) => apiRef.current?.retry(id), []);
  const setScreenTrack = useCallback((stream: MediaStream | null) => apiRef.current?.setScreenTrack(stream), []);
  const admit = useCallback((id: string) => apiRef.current?.admit(id), []);
  const deny = useCallback((id: string) => apiRef.current?.deny(id), []);
  const setCohost = useCallback((id: string, on: boolean) => apiRef.current?.setCohost(id, on), []);
  const publishCast = useCallback(
    (cast: RecordCastSignal, active: boolean) => apiRef.current?.publishCast(cast, active),
    [],
  );
  const dismissAsk = useCallback(() => setAsk(null), []);

  const createPoll = useCallback(
    (question: string, optionsList: string[]) => {
      const next: Poll = {
        id: uid(),
        question: question.trim().slice(0, 140),
        options: optionsList.map((item) => item.trim().slice(0, 48)).filter(Boolean).slice(0, 4),
        votes: {},
        closed: false,
        owner: peerId,
      };
      if (!next.question || next.options.length < 2) return;
      setPoll(next);
      apiRef.current?.sendPoll(next);
    },
    [peerId],
  );

  const vote = useCallback(
    (option: number) => {
      const current = pollRef.current;
      if (!current || current.closed) return;
      const next = { ...current, votes: { ...current.votes, [peerId]: option } };
      setPoll(next);
      apiRef.current?.sendVote(current.id, option);
    },
    [peerId],
  );

  const endPoll = useCallback(() => {
    const current = pollRef.current;
    if (!current) return;
    const next = { ...current, closed: true };
    setPoll(next);
    apiRef.current?.sendPoll(next);
  }, []);

  return {
    myId: peerId,
    status,
    gate,
    waiting,
    peers: remotes,
    chat,
    reactions,
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
  };
}
