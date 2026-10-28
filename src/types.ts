export type PeerInfo = {
  id: string;
  name: string;
  micOn: boolean;
  camOn: boolean;
  hand: boolean;
  sharing: boolean;
  recording: boolean;
};

export type ChatAttachment = {
  name: string;
  mime: string;
  data: string;
  size: number;
};

export type ChatMessage = {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  system?: boolean;
  attachment?: ChatAttachment;
};

export type Poll = {
  id: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  closed: boolean;
  owner: string;
};

import type { BoardMeta, BoardObject, BoardPoint, BoardSnapshot } from './lib/board';

export type RecordCastSignal = {
  peerIds: string[];
  includeScreens: boolean;
  includeAudioFromOthers: boolean;
};

export type WaitingPerson = { id: string; name: string };

export type Signal =
  | { type: 'hello'; from: string; peer: PeerInfo }
  | { type: 'welcome'; from: string; to: string; peer: PeerInfo; chat: ChatMessage[]; poll: Poll | null; board?: BoardSnapshot }
  | { type: 'state'; from: string; peer: PeerInfo }
  | { type: 'chat'; from: string; message: ChatMessage }
  | { type: 'reaction'; from: string; id: string; emoji: string }
  | { type: 'caption'; from: string; name: string; text: string }
  | { type: 'kick'; from: string; to: string }
  | { type: 'moderate'; from: string; to: string; action: 'mute-mic' | 'mute-cam' | 'ask-mic' | 'ask-cam' }
  | { type: 'leave'; from: string }
  | { type: 'end-meeting'; from: string }
  | { type: 'meeting-lock'; from: string; locked: boolean }
  | { type: 'reset'; from: string; to: string }
  | {
      type: 'description';
      from: string;
      to: string;
      description: RTCSessionDescriptionInit;
      cameraMid: string | null;
      screenMid: string | null;
    }
  | { type: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit | null }
  | { type: 'poll'; from: string; poll: Poll }
  | { type: 'vote'; from: string; pollId: string; option: number }
  | { type: 'cast'; from: string; cast: RecordCastSignal; active: boolean }
  | { type: 'board-op'; from: string; object: BoardObject }
  | { type: 'board-live'; from: string; id: string; points: BoardPoint[]; color: string; size: number; opacity?: number; done?: boolean }
  | { type: 'board-cursor'; from: string; name: string; color: string; x: number; y: number }
  | { type: 'board-meta'; from: string; meta: BoardMeta }
  | { type: 'board-sync'; from: string; to?: string; snapshot: BoardSnapshot };

export type ThemeMode = 'light' | 'dark';

export type BackgroundId = 'none' | 'blur' | 'blurStrong' | 'office' | 'studio' | 'home' | 'custom';

export type Settings = {
  name: string;
  micId: string;
  camId: string;
  speakerId: string;
  mirror: boolean;
  noiseSuppression: boolean;
  instantJoin: boolean;
  sounds: boolean;
  theme: ThemeMode;
  background: BackgroundId;
};

export type RecentMeeting = {
  code: string;
  title: string;
  ts: number;
};

export type ScheduledMeeting = {
  id: string;
  title: string;
  when: string;
  code: string;
};
