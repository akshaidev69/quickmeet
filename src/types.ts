export type PeerInfo = {
  id: string;
  name: string;
  micOn: boolean;
  camOn: boolean;
  hand: boolean;
  sharing: boolean;
  recording: boolean;
};

export type ChatMessage = {
  id: string;
  from: string;
  name: string;
  text: string;
  ts: number;
  system?: boolean;
};

export type Poll = {
  id: string;
  question: string;
  options: string[];
  votes: Record<string, number>;
  closed: boolean;
  owner: string;
};

export type RecordCastSignal = {
  peerIds: string[];
  includeScreens: boolean;
  includeAudioFromOthers: boolean;
};

export type WaitingPerson = { id: string; name: string };

export type Signal =
  | { type: 'hello'; from: string; peer: PeerInfo }
  | { type: 'welcome'; from: string; to: string; peer: PeerInfo; chat: ChatMessage[]; poll: Poll | null }
  | { type: 'state'; from: string; peer: PeerInfo }
  | { type: 'chat'; from: string; message: ChatMessage }
  | { type: 'reaction'; from: string; id: string; emoji: string }
  | { type: 'caption'; from: string; name: string; text: string }
  | { type: 'kick'; from: string; to: string }
  | { type: 'moderate'; from: string; to: string; action: 'mute-mic' | 'mute-cam' | 'ask-mic' | 'ask-cam' }
  | { type: 'leave'; from: string }
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
  | { type: 'cast'; from: string; cast: RecordCastSignal; active: boolean };

export type ThemeMode = 'light' | 'dark';

export type BackgroundId = 'none' | 'blur' | 'office' | 'studio' | 'home' | 'custom';

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
