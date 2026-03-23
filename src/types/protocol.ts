/* ── 游戏阶段 ── */
export type GamePhase = "waiting" | "readying" | "playing" | "ended";
export type RallyState = "serving" | "rally" | "scored";

/* ── 玩家信息 ── */
export interface PlayerInfo {
  id: string;
  name: string;
  online: boolean;
  ready: boolean;
}

/* ── 聊天消息 ── */
export interface ChatMessage {
  id: string;
  kind: "chat" | "system";
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}

/* ── 玩家输入 ── */
export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  swing: boolean;
}

/* ── 游戏帧数据（实时广播） ── */
export interface PlayerFrameData {
  x: number;
  y: number;
  vy: number;
  swingTick: number;
  facingRight: boolean;
}

export interface ShuttleFrameData {
  x: number;
  y: number;
  vx: number;
  vy: number;
  visible: boolean;
}

/* ── 服务端 → 客户端 消息 ── */

export interface S_RoomState {
  type: "roomState";
  yourId: string;
  players: PlayerInfo[];
  ownerId: string;
  phase: GamePhase;
  winPoints: number;
  player1Id: string | null;
  player2Id: string | null;
  score: [number, number];
  winner: { id: string; name: string } | null;
  chatHistory: ChatMessage[];
}

export interface S_PlayerJoined {
  type: "playerJoined";
  player: PlayerInfo;
}

export interface S_PlayerLeft {
  type: "playerLeft";
  playerId: string;
}

export interface S_PhaseChange {
  type: "phaseChange";
  phase: GamePhase;
  ownerId: string;
}

export interface S_GameStart {
  type: "gameStart";
  player1Id: string;
  player2Id: string;
  winPoints: number;
}

export interface S_GameFrame {
  type: "gameFrame";
  players: [PlayerFrameData, PlayerFrameData];
  shuttle: ShuttleFrameData;
  score: [number, number];
  serving: number;
  rallyState: RallyState;
}

export interface S_PointScored {
  type: "pointScored";
  scorer: number;
  score: [number, number];
  reason: string;
}

export interface S_GameEnd {
  type: "gameEnd";
  winnerId: string | null;
  winnerName: string;
  score: [number, number];
  reason: string;
}

export interface S_ReadyChanged {
  type: "readyChanged";
  playerId: string;
  ready: boolean;
}

export interface S_SettingsChanged {
  type: "settingsChanged";
  winPoints: number;
}

export interface S_Chat {
  type: "chat";
  message: ChatMessage;
}

export interface S_Error {
  type: "error";
  message: string;
}

export interface S_RoomClosed {
  type: "roomClosed";
  reason: string;
}

export type ServerMessage =
  | S_RoomState
  | S_PlayerJoined
  | S_PlayerLeft
  | S_PhaseChange
  | S_GameStart
  | S_GameFrame
  | S_PointScored
  | S_GameEnd
  | S_ReadyChanged
  | S_SettingsChanged
  | S_Chat
  | S_Error
  | S_RoomClosed;

/* ── 客户端 → 服务端 消息 ── */

export interface C_Join {
  type: "join";
  playerName: string;
  playerId?: string;
}

export interface C_Ready {
  type: "ready";
}

export interface C_SetSettings {
  type: "setSettings";
  winPoints: number;
}

export interface C_StartGame {
  type: "startGame";
}

export interface C_Input {
  type: "input";
  input: InputState;
}

export interface C_Chat {
  type: "chat";
  text: string;
}

export interface C_Surrender {
  type: "surrender";
}

export interface C_PlayAgain {
  type: "playAgain";
}

export interface C_TransferOwner {
  type: "transferOwner";
}

export interface C_Leave {
  type: "leave";
}

export interface C_Ping {
  type: "ping";
}

export type ClientMessage =
  | C_Join
  | C_Ready
  | C_SetSettings
  | C_StartGame
  | C_Input
  | C_Chat
  | C_Surrender
  | C_PlayAgain
  | C_TransferOwner
  | C_Leave
  | C_Ping;
