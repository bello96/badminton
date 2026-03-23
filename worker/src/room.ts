import { DurableObject } from "cloudflare:workers";

/* ── 类型定义 ── */
type GamePhase = "waiting" | "readying" | "playing" | "ended";
type RallyState = "serving" | "rally" | "scored";

interface PlayerInfo {
  id: string;
  name: string;
  online: boolean;
  ready: boolean;
}

interface ChatMessage {
  id: string;
  kind: "chat" | "system";
  playerId: string;
  playerName: string;
  text: string;
  timestamp: number;
}

interface DisconnectedPlayer {
  name: string;
  disconnectedAt: number;
  quickLeave: boolean;
  ready: boolean;
}

interface WsAttachment {
  playerId: string;
  playerName: string;
}

interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  swing: boolean;
}

interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  swingTick: number;
  facingRight: boolean;
}

interface ShuttleState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  visible: boolean;
  lastHitBy: number;
}

/* ── 物理常量 ── */
const COURT_W = 800;
const GROUND_Y = 400;
const NET_X = 400;
const NET_TOP = 280;

const PLAYER_H = 60;
const PLAYER_SPEED = 5;
const JUMP_VY = -12;
const GRAVITY = 0.5;
const P1_MIN_X = 50;
const P1_MAX_X = 365;
const P2_MIN_X = 435;
const P2_MAX_X = 750;

const SHUTTLE_GRAVITY = 0.12;
const SHUTTLE_DRAG = 0.997;
const SHUTTLE_RADIUS = 5;

const SWING_DURATION = 14;
const HIT_START = 2;
const HIT_END = 8;
const HIT_RANGE = 60;

const TICK_RATE = 30;
const TICK_MS = Math.ceil(1000 / TICK_RATE);
const SCORE_PAUSE_TICKS = 45;

const DEFAULT_WIN_POINTS = 21;
const MAX_SCORE = 30;
const DEUCE_LEAD = 2;

const MAX_PLAYERS = 2;
const GRACE_PERIOD = 15_000;
const QUICK_GRACE = 3_000;
const INACTIVITY_TIMEOUT = 5 * 60_000;
const MAX_CHAT = 200;

/* ── 辅助函数 ── */
function generateId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function defaultPlayerStates(): [PlayerState, PlayerState] {
  return [
    { x: 200, y: GROUND_Y, vx: 0, vy: 0, swingTick: 0, facingRight: true },
    { x: 600, y: GROUND_Y, vx: 0, vy: 0, swingTick: 0, facingRight: false },
  ];
}

function defaultShuttle(serving: number): ShuttleState {
  const dir = serving === 0 ? 1 : -1;
  const sx = serving === 0 ? 200 : 600;
  return {
    x: sx + dir * 25,
    y: GROUND_Y - 35,
    vx: 0,
    vy: 0,
    visible: true,
    lastHitBy: -1,
  };
}

/* ── BadmintonRoom Durable Object ── */
export class BadmintonRoom extends DurableObject {
  private loaded = false;
  private roomCode = "";
  private created = 0;
  private closed = false;
  private phase: GamePhase = "waiting";
  private ownerId: string | null = null;
  private winPoints = DEFAULT_WIN_POINTS;
  private chatHistory: ChatMessage[] = [];
  private lastActivityAt = 0;
  private disconnectedPlayers = new Map<string, DisconnectedPlayer>();
  private playerReady = new Map<string, boolean>();

  /* ── 游戏状态（内存中，不持久化帧数据） ── */
  private player1Id: string | null = null;
  private player2Id: string | null = null;
  private playerStates: [PlayerState, PlayerState] = defaultPlayerStates();
  private shuttle: ShuttleState = defaultShuttle(0);
  private score: [number, number] = [0, 0];
  private serving: 0 | 1 = 0;
  private rallyState: RallyState = "serving";
  private playerInputs = new Map<string, InputState>();
  private gameLoopTimer: ReturnType<typeof setInterval> | null = null;
  private scorePauseTicks = 0;
  private winner: { id: string; name: string } | null = null;

  /* ── 持久化 ── */
  private async ensureLoaded() {
    if (this.loaded) {
      return;
    }
    this.loaded = true;
    const s = this.ctx.storage;
    const data = await s.get([
      "roomCode", "created", "closed", "phase", "ownerId", "winPoints",
      "chatHistory", "lastActivityAt", "playerReady",
      "player1Id", "player2Id", "score", "winner",
    ]);

    this.roomCode = (data.get("roomCode") as string) || "";
    this.created = (data.get("created") as number) || 0;
    this.closed = (data.get("closed") as boolean) || false;
    this.phase = (data.get("phase") as GamePhase) || "waiting";
    this.ownerId = (data.get("ownerId") as string) || null;
    this.winPoints = (data.get("winPoints") as number) || DEFAULT_WIN_POINTS;
    this.chatHistory = (data.get("chatHistory") as ChatMessage[]) || [];
    this.lastActivityAt = (data.get("lastActivityAt") as number) || Date.now();
    this.player1Id = (data.get("player1Id") as string) || null;
    this.player2Id = (data.get("player2Id") as string) || null;
    this.score = (data.get("score") as [number, number]) || [0, 0];
    this.winner = (data.get("winner") as { id: string; name: string }) || null;

    const readyData = data.get("playerReady") as Record<string, boolean> | undefined;
    if (readyData) {
      this.playerReady = new Map(Object.entries(readyData));
    }
  }

  private async save(fields: Record<string, unknown>) {
    await this.ctx.storage.put(fields);
  }

  /* ── HTTP 入口 ── */
  async fetch(request: Request): Promise<Response> {
    await this.ensureLoaded();
    const url = new URL(request.url);

    if (url.pathname === "/init" && request.method === "POST") {
      const { roomCode } = (await request.json()) as { roomCode: string };
      this.roomCode = roomCode;
      this.created = Date.now();
      this.lastActivityAt = Date.now();
      await this.save({
        roomCode, created: this.created, lastActivityAt: this.lastActivityAt,
        phase: "waiting", closed: false, winPoints: DEFAULT_WIN_POINTS,
      });
      return new Response("ok");
    }

    if (url.pathname === "/quickleave" && request.method === "POST") {
      const playerId = await request.text();
      const dp = this.disconnectedPlayers.get(playerId);
      if (dp) {
        dp.quickLeave = true;
      }
      return new Response("ok");
    }

    if (url.pathname === "/info" && request.method === "GET") {
      const players = this.getActivePlayers();
      const owner = players.find((p) => p.id === this.ownerId);
      return Response.json({
        roomCode: this.roomCode,
        phase: this.phase,
        playerCount: players.length,
        closed: this.closed,
        ownerName: owner?.name || null,
      });
    }

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    return new Response("Not Found", { status: 404 });
  }

  /* ── WebSocket 生命周期 ── */
  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    await this.ensureLoaded();
    if (typeof raw !== "string") {
      return;
    }

    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.type === "join") {
      await this.onJoin(ws, msg);
      return;
    }

    const att = this.getAttachment(ws);
    if (!att) {
      this.sendTo(ws, { type: "error", message: "未加入房间" });
      return;
    }

    this.lastActivityAt = Date.now();
    await this.save({ lastActivityAt: this.lastActivityAt });

    switch (msg.type as string) {
      case "ping": break;
      case "ready": await this.onReady(att); break;
      case "setSettings": await this.onSetSettings(att, msg); break;
      case "startGame": await this.onStartGame(att); break;
      case "input": this.onInput(att, msg); break;
      case "chat": await this.onChat(att, msg); break;
      case "surrender": await this.onSurrender(att); break;
      case "playAgain": await this.onPlayAgain(att); break;
      case "transferOwner": await this.onTransferOwner(att); break;
      case "leave": await this.onLeave(ws, att); break;
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.ensureLoaded();
    const att = this.getAttachment(ws);
    if (att) {
      this.handleDisconnect(att.playerId, att.playerName);
    }
  }

  async webSocketError(ws: WebSocket) {
    await this.ensureLoaded();
    const att = this.getAttachment(ws);
    if (att) {
      this.handleDisconnect(att.playerId, att.playerName);
    }
  }

  /* ── 消息处理 ── */
  private async onJoin(ws: WebSocket, msg: Record<string, unknown>) {
    if (this.closed) {
      this.sendTo(ws, { type: "roomClosed", reason: "房间已关闭" });
      ws.close(1000, "Room closed");
      return;
    }

    const playerName = (msg.playerName as string) || "匿名";
    const requestedId = msg.playerId as string | undefined;

    // 断线重连
    if (requestedId) {
      if (this.disconnectedPlayers.has(requestedId)) {
        const dp = this.disconnectedPlayers.get(requestedId)!;
        this.disconnectedPlayers.delete(requestedId);
        this.playerReady.set(requestedId, dp.ready);
        this.setAttachment(ws, { playerId: requestedId, playerName });
        this.broadcastExcept(ws, {
          type: "playerJoined",
          player: { id: requestedId, name: playerName, online: true, ready: dp.ready },
        });
        this.sendRoomState(ws, requestedId);
        this.scheduleAlarm();
        return;
      }

      const existing = this.findWsByPlayerId(requestedId);
      if (existing) {
        this.setAttachment(existing, null as unknown as WsAttachment);
        try { existing.close(1000, "Replaced"); } catch { /* ignore */ }
        this.disconnectedPlayers.delete(requestedId);
        this.setAttachment(ws, { playerId: requestedId, playerName });
        this.sendRoomState(ws, requestedId);
        return;
      }
    }

    const activePlayers = this.getActivePlayers();
    if (activePlayers.length >= MAX_PLAYERS) {
      this.sendTo(ws, { type: "error", message: "房间已满" });
      ws.close(1000, "Room full");
      return;
    }

    const playerId = requestedId || generateId();
    this.setAttachment(ws, { playerId, playerName });
    this.playerReady.set(playerId, false);

    if (!this.ownerId) {
      this.ownerId = playerId;
      await this.save({ ownerId: playerId });
    }

    this.broadcastExcept(ws, {
      type: "playerJoined",
      player: { id: playerId, name: playerName, online: true, ready: false },
    });

    const allPlayers = this.getActivePlayers();
    if (allPlayers.length === 2 && this.phase === "waiting") {
      this.phase = "readying";
      await this.save({ phase: "readying", playerReady: Object.fromEntries(this.playerReady) });
      this.broadcast({ type: "phaseChange", phase: "readying", ownerId: this.ownerId });
    }

    this.sendRoomState(ws, playerId);
    this.scheduleAlarm();
  }

  private async onReady(att: WsAttachment) {
    if (this.phase !== "readying") { return; }
    if (att.playerId === this.ownerId) { return; }
    const current = this.playerReady.get(att.playerId) || false;
    this.playerReady.set(att.playerId, !current);
    await this.save({ playerReady: Object.fromEntries(this.playerReady) });
    this.broadcast({ type: "readyChanged", playerId: att.playerId, ready: !current });
  }

  private async onSetSettings(att: WsAttachment, msg: Record<string, unknown>) {
    if (att.playerId !== this.ownerId || this.phase !== "readying") { return; }
    const wp = msg.winPoints as number;
    if (typeof wp !== "number" || (wp !== 11 && wp !== 21)) { return; }
    this.winPoints = wp;
    await this.save({ winPoints: this.winPoints });
    this.broadcast({ type: "settingsChanged", winPoints: this.winPoints });
  }

  private async onStartGame(att: WsAttachment) {
    if (att.playerId !== this.ownerId || this.phase !== "readying") { return; }
    const players = this.getActivePlayers();
    if (players.length < 2) { return; }
    const nonOwner = players.find((p) => p.id !== this.ownerId);
    if (!nonOwner || !this.playerReady.get(nonOwner.id)) { return; }

    // 随机分配左右
    const shuffled = [...players].sort(() => Math.random() - 0.5);
    this.player1Id = shuffled[0]!.id;
    this.player2Id = shuffled[1]!.id;
    this.score = [0, 0];
    this.serving = 0;
    this.rallyState = "serving";
    this.playerStates = defaultPlayerStates();
    this.shuttle = defaultShuttle(0);
    this.playerInputs.clear();
    this.winner = null;
    this.phase = "playing";

    await this.save({
      phase: "playing",
      player1Id: this.player1Id, player2Id: this.player2Id,
      score: this.score, winner: null,
    });

    const p1Name = shuffled[0]!.name;
    const p2Name = shuffled[1]!.name;
    const sysMsg = this.addSystemMessage(
      `比赛开始！${p1Name}（左）vs ${p2Name}（右），${this.winPoints}分制`,
    );
    this.broadcast({ type: "chat", message: sysMsg });
    this.broadcast({
      type: "gameStart",
      player1Id: this.player1Id,
      player2Id: this.player2Id,
      winPoints: this.winPoints,
    });

    this.startGameLoop();
  }

  private onInput(att: WsAttachment, msg: Record<string, unknown>) {
    if (this.phase !== "playing") { return; }
    // 只允许参赛玩家发送输入
    if (att.playerId !== this.player1Id && att.playerId !== this.player2Id) { return; }
    const input = msg.input as InputState | undefined;
    if (!input || typeof input !== "object") { return; }
    this.playerInputs.set(att.playerId, {
      left: !!input.left,
      right: !!input.right,
      up: !!input.up,
      swing: !!input.swing,
    });
  }

  private async onChat(att: WsAttachment, msg: Record<string, unknown>) {
    const raw = msg.text as string | undefined;
    if (typeof raw !== "string") { return; }
    const text = raw.trim();
    if (!text || text.length > 200) { return; }
    const chatMsg: ChatMessage = {
      id: generateId(),
      kind: "chat",
      playerId: att.playerId,
      playerName: att.playerName,
      text,
      timestamp: Date.now(),
    };
    this.chatHistory.push(chatMsg);
    if (this.chatHistory.length > MAX_CHAT) {
      this.chatHistory = this.chatHistory.slice(-MAX_CHAT);
    }
    await this.save({ chatHistory: this.chatHistory });
    this.broadcast({ type: "chat", message: chatMsg });
  }

  private async onSurrender(att: WsAttachment) {
    if (this.phase !== "playing") { return; }
    const winnerId = att.playerId === this.player1Id ? this.player2Id : this.player1Id;
    const winnerPlayer = this.getActivePlayers().find((p) => p.id === winnerId);
    await this.endGame(winnerId, winnerPlayer?.name || "对手", "投降");
  }

  private async onPlayAgain(att: WsAttachment) {
    if (att.playerId !== this.ownerId || this.phase !== "ended") { return; }
    const players = this.getActivePlayers();
    if (players.length < 2) { return; }

    this.phase = "readying";
    for (const p of players) {
      this.playerReady.set(p.id, p.id === this.ownerId);
    }
    await this.save({ phase: "readying", playerReady: Object.fromEntries(this.playerReady) });
    this.broadcast({ type: "phaseChange", phase: "readying", ownerId: this.ownerId! });
    const sysMsg = this.addSystemMessage("房主发起了新一局");
    this.broadcast({ type: "chat", message: sysMsg });
  }

  private async onTransferOwner(att: WsAttachment) {
    if (att.playerId !== this.ownerId) { return; }
    const players = this.getActivePlayers();
    const other = players.find((p) => p.id !== att.playerId);
    if (!other) { return; }
    this.ownerId = other.id;
    await this.save({ ownerId: this.ownerId });
    const sysMsg = this.addSystemMessage(`${att.playerName} 将房主转让给了 ${other.name}`);
    this.broadcast({ type: "chat", message: sysMsg });
    this.broadcast({ type: "phaseChange", phase: this.phase, ownerId: this.ownerId });
  }

  private async onLeave(ws: WebSocket, att: WsAttachment) {
    this.setAttachment(ws, null as unknown as WsAttachment);
    try { ws.close(1000, "Left"); } catch { /* ignore */ }
    await this.removePlayer(att.playerId, att.playerName);
  }

  /* ── 断线处理 ── */
  private handleDisconnect(playerId: string, playerName: string) {
    this.disconnectedPlayers.set(playerId, {
      name: playerName,
      disconnectedAt: Date.now(),
      quickLeave: false,
      ready: this.playerReady.get(playerId) || false,
    });
    this.broadcast({
      type: "playerJoined",
      player: { id: playerId, name: playerName, online: false, ready: false },
    });

    // 游戏中断线 → 对手胜
    if (this.phase === "playing") {
      const winnerId = playerId === this.player1Id ? this.player2Id : this.player1Id;
      const winnerPlayer = this.getActivePlayers().find((p) => p.id === winnerId);
      this.endGame(winnerId, winnerPlayer?.name || "对手", "对方断线");
    }

    this.scheduleAlarm();
  }

  private async removePlayer(playerId: string, playerName: string) {
    this.disconnectedPlayers.delete(playerId);
    this.playerReady.delete(playerId);
    this.playerInputs.delete(playerId);

    this.broadcast({ type: "playerLeft", playerId });
    const sysMsg = this.addSystemMessage(`${playerName} 离开了房间`);
    this.broadcast({ type: "chat", message: sysMsg });

    const remaining = this.getActivePlayers();

    if (remaining.length === 0) {
      this.closed = true;
      await this.save({ closed: true });
      this.stopGameLoop();
      return;
    }

    if (this.ownerId === playerId) {
      this.ownerId = remaining[0]!.id;
      await this.save({ ownerId: this.ownerId });
    }

    if (this.phase === "playing") {
      const winnerId = playerId === this.player1Id ? this.player2Id : this.player1Id;
      const winnerPlayer = remaining.find((p) => p.id === winnerId);
      await this.endGame(winnerId, winnerPlayer?.name || "对手", "对方离开");
    } else if (this.phase === "readying" && remaining.length < 2) {
      this.phase = "waiting";
      await this.save({ phase: "waiting" });
      this.broadcast({ type: "phaseChange", phase: "waiting", ownerId: this.ownerId! });
    }
  }

  /* ── 游戏循环 ── */
  private startGameLoop() {
    this.stopGameLoop();
    this.scorePauseTicks = 0;
    this.gameLoopTimer = setInterval(() => {
      try {
        this.gameTick();
      } catch (e) {
        console.error("Game tick error:", e);
        this.stopGameLoop();
      }
    }, TICK_MS);
  }

  private stopGameLoop() {
    if (this.gameLoopTimer !== null) {
      clearInterval(this.gameLoopTimer);
      this.gameLoopTimer = null;
    }
  }

  private gameTick() {
    if (this.phase !== "playing") {
      this.stopGameLoop();
      return;
    }

    // 得分暂停
    if (this.scorePauseTicks > 0) {
      this.scorePauseTicks--;
      if (this.scorePauseTicks === 0) {
        this.resetForServe();
      }
      this.broadcastFrame();
      return;
    }

    // 处理输入
    this.processInputs();

    // 更新物理
    this.updatePlayers();

    // 发球状态下羽毛球跟随发球方
    if (this.rallyState === "serving") {
      this.updateServePosition();
    } else if (this.rallyState === "rally") {
      this.updateShuttle();
      this.checkNetCollision();
      this.checkGroundAndBounds();
    }

    // 检测击球
    this.checkHits();

    // 广播帧
    this.broadcastFrame();
  }

  private processInputs() {
    const ids = [this.player1Id, this.player2Id];
    for (let i = 0; i < 2; i++) {
      const id = ids[i];
      if (!id) { continue; }
      const input = this.playerInputs.get(id);
      const ps = this.playerStates[i]!;
      const minX = i === 0 ? P1_MIN_X : P2_MIN_X;
      const maxX = i === 0 ? P1_MAX_X : P2_MAX_X;

      if (input) {
        // 水平移动
        if (input.left && !input.right) {
          ps.vx = -PLAYER_SPEED;
        } else if (input.right && !input.left) {
          ps.vx = PLAYER_SPEED;
        } else {
          ps.vx = 0;
        }

        // 跳跃
        if (input.up && ps.y >= GROUND_Y) {
          ps.vy = JUMP_VY;
        }

        // 挥拍
        if (input.swing && ps.swingTick === 0) {
          ps.swingTick = 1;
        }
      } else {
        ps.vx = 0;
      }

      // 朝向
      if (ps.vx > 0) {
        ps.facingRight = true;
      } else if (ps.vx < 0) {
        ps.facingRight = false;
      }

      // 限制范围
      const nextX = ps.x + ps.vx;
      ps.x = Math.max(minX, Math.min(maxX, nextX));
    }
  }

  private updatePlayers() {
    for (let i = 0; i < 2; i++) {
      const ps = this.playerStates[i]!;

      // 重力
      ps.vy += GRAVITY;
      ps.y += ps.vy;

      // 地面碰撞
      if (ps.y >= GROUND_Y) {
        ps.y = GROUND_Y;
        ps.vy = 0;
      }

      // 挥拍动画
      if (ps.swingTick > 0) {
        ps.swingTick++;
        if (ps.swingTick > SWING_DURATION) {
          ps.swingTick = 0;
        }
      }
    }
  }

  private updateServePosition() {
    const si = this.serving;
    const ps = this.playerStates[si]!;
    const dir = si === 0 ? 1 : -1;
    this.shuttle.x = ps.x + dir * 25;
    this.shuttle.y = ps.y - 35;
    this.shuttle.vx = 0;
    this.shuttle.vy = 0;
    this.shuttle.visible = true;
  }

  private updateShuttle() {
    const sh = this.shuttle;
    sh.vy += SHUTTLE_GRAVITY;
    sh.vx *= SHUTTLE_DRAG;
    sh.vy *= SHUTTLE_DRAG;
    sh.x += sh.vx;
    sh.y += sh.vy;
  }

  private checkNetCollision() {
    const sh = this.shuttle;
    // 羽毛球穿越球网位置
    const prevX = sh.x - sh.vx;
    const crossesNet =
      (prevX < NET_X && sh.x >= NET_X) || (prevX > NET_X && sh.x <= NET_X);

    if (crossesNet && sh.y > NET_TOP) {
      // 击中球网 — 停止水平运动，缓慢落下
      sh.x = prevX < NET_X ? NET_X - SHUTTLE_RADIUS : NET_X + SHUTTLE_RADIUS;
      sh.vx = 0;
      sh.vy = 2;
    }
  }

  private checkGroundAndBounds() {
    const sh = this.shuttle;

    // 落地
    if (sh.y >= GROUND_Y) {
      sh.y = GROUND_Y;
      sh.vy = 0;
      sh.vx = 0;

      if (sh.x < NET_X) {
        this.scorePoint(1, "落地得分");
      } else {
        this.scorePoint(0, "落地得分");
      }
      return;
    }

    // 出界
    if (sh.x < 0 || sh.x > COURT_W || sh.y < -50) {
      if (sh.lastHitBy === 0) {
        this.scorePoint(1, "出界");
      } else if (sh.lastHitBy === 1) {
        this.scorePoint(0, "出界");
      } else {
        // 未被击中就出界（不应发生）
        this.scorePoint(this.serving === 0 ? 1 : 0, "出界");
      }
    }
  }

  private checkHits() {
    if (this.rallyState === "scored") { return; }

    for (let i = 0; i < 2; i++) {
      const ps = this.playerStates[i]!;
      if (ps.swingTick < HIT_START || ps.swingTick > HIT_END) { continue; }

      // 不能连续两次击球（需要对方先打回来）
      if (this.rallyState === "rally" && this.shuttle.lastHitBy === i) { continue; }

      const sh = this.shuttle;
      const playerCenterX = ps.x;
      const playerCenterY = ps.y - PLAYER_H * 0.4;
      const dx = sh.x - playerCenterX;
      const dy = sh.y - playerCenterY;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (dist > HIT_RANGE) { continue; }

      // 击中！
      const dir = i === 0 ? 1 : -1;

      if (this.rallyState === "serving") {
        // 发球
        sh.vx = dir * 8;
        sh.vy = -7;
      } else {
        // 根据相对位置决定击球类型
        const relY = playerCenterY - sh.y; // 正值=玩家在球下方

        if (ps.vy < -2 && relY < -5) {
          // 扣杀（跳起且在球上方）
          sh.vx = dir * 14;
          sh.vy = 3 + Math.random() * 2;
        } else if (relY > 15) {
          // 球在玩家上方 → 挑高球
          sh.vx = dir * 6;
          sh.vy = -9;
        } else {
          // 平抽
          sh.vx = dir * 11;
          sh.vy = -3 + (Math.random() - 0.5) * 2;
        }
      }

      sh.lastHitBy = i;
      if (this.rallyState === "serving") {
        this.rallyState = "rally";
      }
      break;
    }
  }

  private scorePoint(scorerIndex: number, reason: string) {
    this.score[scorerIndex]!++;
    this.rallyState = "scored";
    this.scorePauseTicks = SCORE_PAUSE_TICKS;

    // 下一个发球方 = 得分方
    this.serving = scorerIndex as 0 | 1;

    const scorerName = scorerIndex === 0
      ? this.getPlayerName(this.player1Id)
      : this.getPlayerName(this.player2Id);

    this.broadcast({
      type: "pointScored",
      scorer: scorerIndex,
      score: [...this.score] as [number, number],
      reason,
    });

    const sysMsg = this.addSystemMessage(
      `${scorerName} 得分！(${reason}) ${this.score[0]} - ${this.score[1]}`,
    );
    this.broadcast({ type: "chat", message: sysMsg });

    // 检查胜负
    const winnerIdx = this.checkWin();
    if (winnerIdx >= 0) {
      const winnerId = winnerIdx === 0 ? this.player1Id : this.player2Id;
      const winnerName = this.getPlayerName(winnerId);
      this.endGame(winnerId, winnerName, "比赛结束");
    }
  }

  private checkWin(): number {
    const [s0, s1] = this.score;
    if (s0! >= this.winPoints && s0! - s1! >= DEUCE_LEAD) { return 0; }
    if (s1! >= this.winPoints && s1! - s0! >= DEUCE_LEAD) { return 1; }
    if (s0! >= MAX_SCORE) { return 0; }
    if (s1! >= MAX_SCORE) { return 1; }
    return -1;
  }

  private resetForServe() {
    this.rallyState = "serving";
    this.playerStates = defaultPlayerStates();
    this.shuttle = defaultShuttle(this.serving);
    this.playerInputs.clear();
  }

  private async endGame(
    winnerId: string | null,
    winnerName: string,
    reason: string,
  ) {
    this.stopGameLoop();
    this.phase = "ended";
    this.winner = winnerId ? { id: winnerId, name: winnerName } : null;

    await this.save({
      phase: "ended",
      score: this.score,
      winner: this.winner,
    });

    const sysMsg = this.addSystemMessage(
      winnerId
        ? `${winnerName} 获胜！${this.score[0]} - ${this.score[1]}（${reason}）`
        : `比赛结束（${reason}）`,
    );
    this.broadcast({ type: "chat", message: sysMsg });

    this.broadcast({
      type: "gameEnd",
      winnerId,
      winnerName,
      score: [...this.score] as [number, number],
      reason,
    });
  }

  private broadcastFrame() {
    const frame = {
      type: "gameFrame" as const,
      players: this.playerStates.map((ps) => ({
        x: Math.round(ps.x * 10) / 10,
        y: Math.round(ps.y * 10) / 10,
        vy: Math.round(ps.vy * 10) / 10,
        swingTick: ps.swingTick,
        facingRight: ps.facingRight,
      })) as [
        { x: number; y: number; vy: number; swingTick: number; facingRight: boolean },
        { x: number; y: number; vy: number; swingTick: number; facingRight: boolean },
      ],
      shuttle: {
        x: Math.round(this.shuttle.x * 10) / 10,
        y: Math.round(this.shuttle.y * 10) / 10,
        vx: Math.round(this.shuttle.vx * 10) / 10,
        vy: Math.round(this.shuttle.vy * 10) / 10,
        visible: this.shuttle.visible,
      },
      score: [...this.score] as [number, number],
      serving: this.serving,
      rallyState: this.rallyState,
    };
    this.broadcast(frame);
  }

  /* ── 通用工具方法 ── */
  private getAttachment(ws: WebSocket): WsAttachment | null {
    try {
      const att = this.ctx.getWebSockets().includes(ws)
        ? (ws.deserializeAttachment() as WsAttachment | null)
        : null;
      return att?.playerId ? att : null;
    } catch {
      return null;
    }
  }

  private setAttachment(ws: WebSocket, att: WsAttachment) {
    try {
      ws.serializeAttachment(att);
    } catch { /* ignore */ }
  }

  private getActivePlayers(): PlayerInfo[] {
    const players: PlayerInfo[] = [];
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.getAttachment(ws);
      if (att) {
        players.push({
          id: att.playerId,
          name: att.playerName,
          online: true,
          ready: this.playerReady.get(att.playerId) || false,
        });
      }
    }
    return players;
  }

  private findWsByPlayerId(playerId: string): WebSocket | null {
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.getAttachment(ws);
      if (att?.playerId === playerId) {
        return ws;
      }
    }
    return null;
  }

  private getPlayerName(playerId: string | null): string {
    if (!playerId) { return "未知"; }
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.getAttachment(ws);
      if (att?.playerId === playerId) {
        return att.playerName;
      }
    }
    const dp = this.disconnectedPlayers.get(playerId);
    return dp?.name || "未知";
  }

  private sendTo(ws: WebSocket, msg: unknown) {
    try {
      ws.send(JSON.stringify(msg));
    } catch { /* ignore */ }
  }

  private broadcast(msg: unknown) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.getAttachment(ws);
      if (att) {
        try { ws.send(data); } catch { /* ignore */ }
      }
    }
  }

  private broadcastExcept(exceptWs: WebSocket, msg: unknown) {
    const data = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exceptWs) { continue; }
      const att = this.getAttachment(ws);
      if (att) {
        try { ws.send(data); } catch { /* ignore */ }
      }
    }
  }

  private sendRoomState(ws: WebSocket, yourId: string) {
    this.sendTo(ws, {
      type: "roomState",
      yourId,
      players: this.getActivePlayers(),
      ownerId: this.ownerId,
      phase: this.phase,
      winPoints: this.winPoints,
      player1Id: this.player1Id,
      player2Id: this.player2Id,
      score: [...this.score],
      winner: this.winner,
      chatHistory: this.chatHistory,
    });
  }

  private addSystemMessage(text: string): ChatMessage {
    const msg: ChatMessage = {
      id: generateId(),
      kind: "system",
      playerId: "",
      playerName: "",
      text,
      timestamp: Date.now(),
    };
    this.chatHistory.push(msg);
    if (this.chatHistory.length > MAX_CHAT) {
      this.chatHistory = this.chatHistory.slice(-MAX_CHAT);
    }
    this.ctx.storage.put({ chatHistory: this.chatHistory });
    return msg;
  }

  /* ── Alarm 清理 ── */
  private scheduleAlarm() {
    const nextCheck = Math.min(
      this.disconnectedPlayers.size > 0 ? QUICK_GRACE : INACTIVITY_TIMEOUT,
      INACTIVITY_TIMEOUT,
    );
    this.ctx.storage.setAlarm(Date.now() + nextCheck);
  }

  async alarm() {
    await this.ensureLoaded();
    const now = Date.now();

    // 处理断线玩家
    for (const [id, dp] of this.disconnectedPlayers) {
      const grace = dp.quickLeave ? QUICK_GRACE : GRACE_PERIOD;
      if (now - dp.disconnectedAt >= grace) {
        this.disconnectedPlayers.delete(id);
        await this.removePlayer(id, dp.name);
      }
    }

    // 不活跃超时
    if (now - this.lastActivityAt >= INACTIVITY_TIMEOUT) {
      const players = this.getActivePlayers();
      if (players.length === 0) {
        this.closed = true;
        await this.save({ closed: true });
        this.stopGameLoop();
        return;
      }
    }

    // 还有断线玩家需要处理
    if (this.disconnectedPlayers.size > 0) {
      this.scheduleAlarm();
    }
  }
}
