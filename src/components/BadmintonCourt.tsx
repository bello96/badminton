import { useCallback, useEffect, useRef } from "react";
import type { InputState, PlayerFrameData, RallyState, ShuttleFrameData } from "../types/protocol";

/* ── 物理常量（与服务端一致） ── */
const COURT_W = 800;
const COURT_H = 450;
const GROUND_Y = 400;
const NET_X = 400;
const NET_TOP = 300;
const PLAYER_H = 60;
const SWING_DURATION = 28;


interface Props {
  players: [PlayerFrameData, PlayerFrameData] | null;
  shuttle: ShuttleFrameData | null;
  score: [number, number];
  serving: number;
  rallyState: RallyState;
  mirrored: boolean;
  player1IsBlue: boolean;
  player1Name: string;
  player2Name: string;
  playerCount: number;
  lastScorer: number | null;
  lastReason: string;
  onInput: (input: InputState) => void;
  disabled: boolean;
}

/* ── 视角镜像工具 ── */
function mirrorP(p: PlayerFrameData): PlayerFrameData {
  return { ...p, x: COURT_W - p.x, facingRight: !p.facingRight };
}
function mirrorSh(s: ShuttleFrameData): ShuttleFrameData {
  return { ...s, x: COURT_W - s.x, vx: -s.vx };
}

export default function BadmintonCourt({
  players, shuttle, score, rallyState,
  serving, mirrored, player1IsBlue, playerCount,
  lastScorer, lastReason, onInput, disabled,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef({ players, shuttle, score, serving, rallyState, playerCount, mirrored, player1IsBlue, lastScorer, lastReason });
  const keysRef = useRef(new Set<string>());
  const lastInputRef = useRef<string>("");
  const mirroredRef = useRef(mirrored);
  mirroredRef.current = mirrored;

  frameRef.current = { players, shuttle, score, serving, rallyState, playerCount, mirrored, player1IsBlue, lastScorer, lastReason };

  /* ── 键盘输入：← → 移动，↑ 跳跃，空格击球 ── */
  const sendInput = useCallback(() => {
    if (disabled) { return; }
    const keys = keysRef.current;
    const input: InputState = {
      left: keys.has(mirroredRef.current ? "ArrowRight" : "ArrowLeft"),
      right: keys.has(mirroredRef.current ? "ArrowLeft" : "ArrowRight"),
      up: keys.has("ArrowUp"),
      swing: keys.has("Space"),
    };
    const key = JSON.stringify(input);
    if (key !== lastInputRef.current) {
      lastInputRef.current = key;
      onInput(input);
    }
  }, [onInput, disabled]);

  useEffect(() => {
    const allowedKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "Space"];
    function onKeyDown(e: KeyboardEvent) {
      if (allowedKeys.includes(e.code)) {
        e.preventDefault();
        keysRef.current.add(e.code);
        sendInput();
      }
    }
    function onKeyUp(e: KeyboardEvent) {
      if (keysRef.current.has(e.code)) {
        keysRef.current.delete(e.code);
        sendInput();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [sendInput]);

  /* ── Canvas 渲染 ── */
  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) { return; }

    const ctx = canvas.getContext("2d")!;
    let animId = 0;
    const prevXRef = [200, 600];

    const observer = new ResizeObserver(() => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const aspect = COURT_W / COURT_H;
      let w = rect.width;
      let h = w / aspect;
      if (h > rect.height) {
        h = rect.height;
        w = h * aspect;
      }
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr * w / COURT_W, 0, 0, dpr * h / COURT_H, 0, 0);
    });
    observer.observe(container);

    function draw() {
      const f = frameRef.current;
      const mirror = f.mirrored;
      ctx.clearRect(0, 0, COURT_W, COURT_H);

      drawWall(ctx);
      drawFloor(ctx);
      drawNet(ctx);

      // 默认站位
      const defaultP: [PlayerFrameData, PlayerFrameData] = [
        { x: 200, y: GROUND_Y, vy: 0, swingTick: 0, facingRight: true },
        { x: 600, y: GROUND_Y, vy: 0, swingTick: 0, facingRight: false },
      ];
      const raw = f.players || defaultP;
      const showCount = f.players ? 2 : f.playerCount;

      // ★ 视角镜像：player2 看到的画面是水平翻转的，自己始终在左边
      let rp: [PlayerFrameData, PlayerFrameData];
      let rSh: ShuttleFrameData | null;
      let rSc: [number, number];
      let rSv: number;
      if (mirror) {
        rp = [mirrorP(raw[1]), mirrorP(raw[0])];
        rSh = f.shuttle ? mirrorSh(f.shuttle) : null;
        rSc = [f.score[1], f.score[0]];
        rSv = f.serving === 0 ? 1 : 0;
      } else {
        rp = [raw[0], raw[1]];
        rSh = f.shuttle;
        rSc = f.score;
        rSv = f.serving;
      }

      // 走路动画检测
      const isMoving0 = Math.abs(rp[0].x - (prevXRef[0] ?? 200)) > 0.3;
      const isMoving1 = Math.abs(rp[1].x - (prevXRef[1] ?? 600)) > 0.3;
      prevXRef[0] = rp[0].x;
      prevXRef[1] = rp[1].x;

      // 颜色跟随加入顺序，不随镜像变化
      const p1Color = f.player1IsBlue ? "#3B82F6" : "#E84040";
      const p2Color = f.player1IsBlue ? "#E84040" : "#3B82F6";
      const leftColor = mirror ? p2Color : p1Color;
      const rightColor = mirror ? p1Color : p2Color;
      drawShadow(ctx, rp[0]);
      drawStickman(ctx, rp[0], leftColor, isMoving0);
      if (showCount >= 2) {
        drawShadow(ctx, rp[1]);
        drawStickman(ctx, rp[1], rightColor, isMoving1);
      }

      if (showCount === 1 && !f.players) {
        drawWaitingHint(ctx, rp[0]);
      }

      if (rSh?.visible) {
        drawShuttle(ctx, rSh);
      }

      drawScoreboard(ctx, rSc, leftColor, rightColor);

      if (f.rallyState === "serving" && f.players) {
        drawServeHint(ctx, rSv, rp);
      }

      if (f.rallyState === "scored") {
        // 得分者颜色：scorer 0=player1, 1=player2
        let scorerColor = "#3B82F6";
        let scorerLabel = "蓝方得分";
        if (f.lastScorer !== null) {
          const scorerIsP1 = f.lastScorer === 0;
          const isBlue = scorerIsP1 ? f.player1IsBlue : !f.player1IsBlue;
          scorerColor = isBlue ? "#3B82F6" : "#E84040";
          scorerLabel = isBlue ? "蓝方得分" : "红方得分";
        }
        drawScoredFlash(ctx, scorerLabel, scorerColor, f.lastReason);
      }

      animId = requestAnimationFrame(draw);
    }

    animId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
    };
  }, []);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center">
      <canvas ref={canvasRef} className="rounded-lg" style={{ imageRendering: "auto" }} />
    </div>
  );
}

/* ══════════════════════════════════════════
   绘制函数 — 火柴人羽毛球风格
   ══════════════════════════════════════════ */

function drawWall(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, "#F2F2F2");
  g.addColorStop(0.5, "#ECECEC");
  g.addColorStop(1, "#E6E6E6");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, COURT_W, GROUND_Y);
  ctx.strokeStyle = "rgba(0,0,0,0.03)";
  ctx.lineWidth = 1;
  for (let y = 10; y < GROUND_Y; y += 18) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(COURT_W, y);
    ctx.stroke();
  }
}

function drawFloor(ctx: CanvasRenderingContext2D) {
  const g = ctx.createLinearGradient(0, GROUND_Y, 0, COURT_H);
  g.addColorStop(0, "#A8D8B0");
  g.addColorStop(1, "#8CC896");
  ctx.fillStyle = g;
  ctx.fillRect(0, GROUND_Y, COURT_W, COURT_H - GROUND_Y);
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 2;
  ctx.strokeRect(30, GROUND_Y + 2, COURT_W - 60, COURT_H - GROUND_Y - 4);
  ctx.beginPath();
  ctx.moveTo(NET_X, GROUND_Y + 2);
  ctx.lineTo(NET_X, COURT_H - 2);
  ctx.stroke();
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  ctx.moveTo(160, GROUND_Y + 2);
  ctx.lineTo(160, COURT_H - 2);
  ctx.moveTo(COURT_W - 160, GROUND_Y + 2);
  ctx.lineTo(COURT_W - 160, COURT_H - 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawNet(ctx: CanvasRenderingContext2D) {
  const postW = 6;
  const netW = 16;
  ctx.fillStyle = "#888";
  ctx.fillRect(NET_X - postW / 2, NET_TOP - 8, postW, GROUND_Y - NET_TOP + 8);
  ctx.fillStyle = "#666";
  ctx.fillRect(NET_X - postW / 2 - 2, NET_TOP - 10, postW + 4, 6);
  ctx.fillStyle = "rgba(100,100,100,0.15)";
  ctx.fillRect(NET_X - netW / 2, NET_TOP - 4, netW, GROUND_Y - NET_TOP + 4);
  ctx.strokeStyle = "rgba(80,80,80,0.3)";
  ctx.lineWidth = 0.5;
  for (let y = NET_TOP; y <= GROUND_Y; y += 10) {
    ctx.beginPath();
    ctx.moveTo(NET_X - netW / 2, y);
    ctx.lineTo(NET_X + netW / 2, y);
    ctx.stroke();
  }
  for (let x = NET_X - netW / 2; x <= NET_X + netW / 2; x += 4) {
    ctx.beginPath();
    ctx.moveTo(x, NET_TOP - 4);
    ctx.lineTo(x, GROUND_Y);
    ctx.stroke();
  }
  ctx.strokeStyle = "#555";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(NET_X - netW / 2 - 2, NET_TOP - 4);
  ctx.lineTo(NET_X + netW / 2 + 2, NET_TOP - 4);
  ctx.stroke();
}

function drawShadow(ctx: CanvasRenderingContext2D, p: PlayerFrameData) {
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.beginPath();
  ctx.ellipse(p.x, GROUND_Y + 3, 22, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawStickman(
  ctx: CanvasRenderingContext2D,
  p: PlayerFrameData,
  headColor: string,
  isMoving: boolean,
) {
  const x = p.x;
  const feetY = p.y;
  const dir = p.facingRight ? 1 : -1;
  const inAir = p.y < GROUND_Y - 2;

  const headR = 12;
  const neckY = feetY - PLAYER_H + headR + 2;
  const hipY = feetY - 22;
  const shoulderY = neckY + 8;

  ctx.strokeStyle = "#111";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 腿部动画
  let leftFootDx = -14;
  let rightFootDx = 14;
  let leftFootDy = 0;
  let rightFootDy = 0;

  if (inAir) {
    leftFootDx = -10;
    rightFootDx = 10;
    leftFootDy = -6;
    rightFootDy = -6;
  } else if (isMoving) {
    const phase = Math.sin(Date.now() * 0.015);
    leftFootDx = -8 + phase * 12;
    rightFootDx = 8 - phase * 12;
    leftFootDy = -Math.abs(phase) * 4;
    rightFootDy = -Math.abs(Math.sin(Date.now() * 0.015 + Math.PI)) * 4;
  }

  ctx.beginPath();
  ctx.moveTo(x, hipY);
  ctx.lineTo(x + leftFootDx, feetY + leftFootDy);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, hipY);
  ctx.lineTo(x + rightFootDx, feetY + rightFootDy);
  ctx.stroke();

  // 身体
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(x, hipY);
  ctx.lineTo(x, neckY);
  ctx.stroke();

  // 非持拍手臂
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(x, shoulderY);
  ctx.lineTo(x - dir * 16, shoulderY + 18);
  ctx.stroke();

  // 持拍手臂 + 球拍
  const swinging = p.swingTick > 0 && p.swingTick <= SWING_DURATION;
  let armAngle: number;
  if (swinging) {
    const progress = p.swingTick / SWING_DURATION;
    armAngle = dir > 0
      ? -2.6 + progress * 3.2
      : Math.PI + 2.6 - progress * 3.2;
  } else {
    armAngle = dir > 0 ? -1.2 : Math.PI + 1.2;
  }

  const armLen = 22;
  const handX = x + dir * 4 + Math.cos(armAngle) * armLen;
  const handY = shoulderY + Math.sin(armAngle) * armLen;

  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.moveTo(x, shoulderY);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  // 球拍
  const racketAngle = armAngle + (dir > 0 ? -0.3 : 0.3);
  const racketBaseX = handX + Math.cos(racketAngle) * 18;
  const racketBaseY = handY + Math.sin(racketAngle) * 18;

  ctx.strokeStyle = "#555";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(racketBaseX, racketBaseY);
  ctx.stroke();

  ctx.save();
  ctx.translate(racketBaseX, racketBaseY);
  ctx.rotate(racketAngle);
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(8, 0, 14, 10, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(180,180,180,0.5)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-2, 0);
  ctx.lineTo(18, 0);
  ctx.moveTo(8, -8);
  ctx.lineTo(8, 8);
  ctx.stroke();
  ctx.restore();

  // 头
  ctx.fillStyle = headColor;
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.arc(x, feetY - PLAYER_H + headR, headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 眼睛
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.arc(x + dir * 4, feetY - PLAYER_H + headR - 2, 2, 0, Math.PI * 2);
  ctx.fill();

  // 嘴巴
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x + dir * 3, feetY - PLAYER_H + headR + 4, 3, 0, Math.PI);
  ctx.stroke();
}

function drawShuttle(ctx: CanvasRenderingContext2D, sh: ShuttleFrameData) {
  let angle = Math.PI / 2;
  if (Math.abs(sh.vx) > 0.5 || Math.abs(sh.vy) > 0.5) {
    angle = Math.atan2(sh.vy, sh.vx);
  }
  ctx.save();
  ctx.translate(sh.x, sh.y);
  ctx.rotate(angle);

  ctx.fillStyle = "#FFF";
  ctx.beginPath();
  ctx.moveTo(-4, 0);
  ctx.lineTo(-20, -10);
  ctx.lineTo(-22, -8);
  ctx.lineTo(-22, 8);
  ctx.lineTo(-20, 10);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "#CCC";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.strokeStyle = "rgba(180,180,180,0.6)";
  ctx.lineWidth = 0.6;
  for (let i = -7; i <= 7; i += 3.5) {
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(-21, i);
    ctx.stroke();
  }

  ctx.fillStyle = "#E8C87A";
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#B8963A";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.restore();
}

function drawScoreboard(
  ctx: CanvasRenderingContext2D,
  score: [number, number],
  leftColor: string,
  rightColor: string,
) {
  const w = 160;
  const h = 50;
  const bx = COURT_W / 2 - w / 2;
  const by = 15;
  const cy = by + h / 2 + 1;

  ctx.fillStyle = "rgba(240,240,240,0.7)";
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 6);
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(bx, by, w, h, 6);
  ctx.stroke();

  ctx.font = "bold 32px 'Courier New', monospace";
  ctx.textBaseline = "middle";

  ctx.textAlign = "right";
  ctx.fillStyle = leftColor;
  ctx.fillText(`${score[0]}`, COURT_W / 2 - 10, cy);

  ctx.textAlign = "center";
  ctx.fillStyle = "#666";
  ctx.fillText("-", COURT_W / 2, cy);

  ctx.textAlign = "left";
  ctx.fillStyle = rightColor;
  ctx.fillText(`${score[1]}`, COURT_W / 2 + 10, cy);
}

function drawServeHint(
  ctx: CanvasRenderingContext2D,
  serving: number,
  players: [PlayerFrameData, PlayerFrameData],
) {
  const p = players[serving]!;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.beginPath();
  ctx.roundRect(p.x - 35, p.y - PLAYER_H - 58, 70, 20, 5);
  ctx.fill();
  ctx.fillStyle = "#FFF";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("按空格发球", p.x, p.y - PLAYER_H - 48);
}

function drawWaitingHint(ctx: CanvasRenderingContext2D, p: PlayerFrameData) {
  const dotCount = Math.floor(Date.now() / 500) % 4;
  const display = "等待对手加入" + ".".repeat(dotCount);
  ctx.font = "bold 13px sans-serif";
  const fixedW = ctx.measureText("等待对手加入...").width + 20;
  const px = p.x;
  const py = p.y - PLAYER_H - 56;
  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.beginPath();
  ctx.roundRect(px - fixedW / 2, py - 12, fixedW, 24, 6);
  ctx.fill();
  ctx.fillStyle = "#FFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(display, px - fixedW / 2 + 10, py);
}

function drawScoredFlash(
  ctx: CanvasRenderingContext2D,
  scorerLabel: string,
  scorerColor: string,
  reason: string,
) {
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.fillRect(0, 0, COURT_W, COURT_H);

  const boxW = 180;
  const boxH = reason ? 52 : 36;
  const bx = COURT_W / 2 - boxW / 2;
  const by = COURT_H / 2 - boxH / 2;

  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.beginPath();
  ctx.roundRect(bx, by, boxW, boxH, 8);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = scorerColor;
  ctx.font = "bold 18px sans-serif";
  ctx.fillText(scorerLabel, COURT_W / 2, reason ? by + 18 : by + boxH / 2);

  if (reason) {
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "13px sans-serif";
    ctx.fillText(reason, COURT_W / 2, by + 38);
  }
}
