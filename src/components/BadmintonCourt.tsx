import { useCallback, useEffect, useRef } from "react";
import type { InputState, PlayerFrameData, RallyState, ShuttleFrameData } from "../types/protocol";

/* ── 物理常量（与服务端一致） ── */
const COURT_W = 800;
const COURT_H = 450;
const GROUND_Y = 400;
const NET_X = 400;
const NET_TOP = 280;
const PLAYER_H = 60;
const SWING_DURATION = 14;

interface Props {
  players: [PlayerFrameData, PlayerFrameData] | null;
  shuttle: ShuttleFrameData | null;
  score: [number, number];
  serving: number;
  rallyState: RallyState;
  myPlayerIndex: number;
  player1Name: string;
  player2Name: string;
  onInput: (input: InputState) => void;
  disabled: boolean;
}

export default function BadmintonCourt({
  players, shuttle, score, rallyState,
  serving, onInput, disabled,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef({ players, shuttle, score, serving, rallyState });
  const keysRef = useRef(new Set<string>());
  const lastInputRef = useRef<string>("");

  frameRef.current = { players, shuttle, score, serving, rallyState };

  /* ── 键盘输入：仅方向键 ── */
  const sendInput = useCallback(() => {
    if (disabled) { return; }
    const keys = keysRef.current;
    const input: InputState = {
      left: keys.has("ArrowLeft"),
      right: keys.has("ArrowRight"),
      up: keys.has("ArrowUp"),
      swing: keys.has("ArrowDown"),
    };
    const key = JSON.stringify(input);
    if (key !== lastInputRef.current) {
      lastInputRef.current = key;
      onInput(input);
    }
  }, [onInput, disabled]);

  useEffect(() => {
    const allowedKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
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
      ctx.clearRect(0, 0, COURT_W, COURT_H);

      drawWall(ctx);
      drawFloor(ctx);
      drawNet(ctx);

      // 默认站位（等待/准备阶段也显示火柴人）
      const defaultP: [PlayerFrameData, PlayerFrameData] = [
        { x: 200, y: GROUND_Y, vy: 0, swingTick: 0, facingRight: true },
        { x: 600, y: GROUND_Y, vy: 0, swingTick: 0, facingRight: false },
      ];
      const pp = f.players || defaultP;
      drawShadow(ctx, pp[0]);
      drawShadow(ctx, pp[1]);
      drawStickman(ctx, pp[0], "#FFFFFF", 0);
      drawStickman(ctx, pp[1], "#E84040", 1);

      if (f.shuttle?.visible) {
        drawShuttle(ctx, f.shuttle);
      }

      drawScoreboard(ctx, f.score);

      if (f.rallyState === "serving" && f.players) {
        drawServeHint(ctx, f.serving, f.players);
      }

      if (f.rallyState === "scored") {
        drawScoredFlash(ctx);
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
   绘制函数 — 参考火柴人羽毛球风格
   ══════════════════════════════════════════ */

function drawWall(ctx: CanvasRenderingContext2D) {
  // 灰色墙壁
  const g = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  g.addColorStop(0, "#9E9E9E");
  g.addColorStop(0.5, "#B0B0B0");
  g.addColorStop(1, "#A8A8A8");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, COURT_W, GROUND_Y);

  // 墙壁纹理（细微噪点线条）
  ctx.strokeStyle = "rgba(0,0,0,0.04)";
  ctx.lineWidth = 1;
  for (let y = 10; y < GROUND_Y; y += 18) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(COURT_W, y);
    ctx.stroke();
  }
}

function drawFloor(ctx: CanvasRenderingContext2D) {
  // 木地板
  const g = ctx.createLinearGradient(0, GROUND_Y, 0, COURT_H);
  g.addColorStop(0, "#C8A46E");
  g.addColorStop(0.3, "#BF9B60");
  g.addColorStop(1, "#A07840");
  ctx.fillStyle = g;
  ctx.fillRect(0, GROUND_Y, COURT_W, COURT_H - GROUND_Y);

  // 地板线条纹理
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1;
  for (let x = 0; x < COURT_W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.lineTo(x, COURT_H);
    ctx.stroke();
  }

  // 球场边界线
  ctx.strokeStyle = "rgba(180,140,80,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(30, GROUND_Y + 2, COURT_W - 60, COURT_H - GROUND_Y - 4);

  // 中线
  ctx.beginPath();
  ctx.moveTo(NET_X, GROUND_Y + 2);
  ctx.lineTo(NET_X, COURT_H - 2);
  ctx.stroke();

  // 发球线（虚线）
  ctx.setLineDash([6, 6]);
  ctx.strokeStyle = "rgba(180,140,80,0.5)";
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

  // 网柱
  ctx.fillStyle = "#DDDDDD";
  ctx.fillRect(NET_X - postW / 2, NET_TOP - 8, postW, GROUND_Y - NET_TOP + 8);

  // 网柱顶
  ctx.fillStyle = "#FFFFFF";
  ctx.fillRect(NET_X - postW / 2 - 2, NET_TOP - 10, postW + 4, 6);

  // 网面（半透明白色 + 网格）
  ctx.fillStyle = "rgba(220,230,240,0.4)";
  ctx.fillRect(NET_X - netW / 2, NET_TOP - 4, netW, GROUND_Y - NET_TOP + 4);

  // 网格线
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 0.5;
  // 水平线
  for (let y = NET_TOP; y <= GROUND_Y; y += 10) {
    ctx.beginPath();
    ctx.moveTo(NET_X - netW / 2, y);
    ctx.lineTo(NET_X + netW / 2, y);
    ctx.stroke();
  }
  // 垂直线
  for (let x = NET_X - netW / 2; x <= NET_X + netW / 2; x += 4) {
    ctx.beginPath();
    ctx.moveTo(x, NET_TOP - 4);
    ctx.lineTo(x, GROUND_Y);
    ctx.stroke();
  }

  // 顶部白线
  ctx.strokeStyle = "#FFFFFF";
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
  _index: number,
) {
  const x = p.x;
  const feetY = p.y;
  const dir = p.facingRight ? 1 : -1;

  const headR = 12;
  const neckY = feetY - PLAYER_H + headR + 2;
  const hipY = feetY - 22;
  const shoulderY = neckY + 8;

  ctx.strokeStyle = "#111";
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // 左腿
  ctx.beginPath();
  ctx.moveTo(x, hipY);
  ctx.lineTo(x - 14, feetY);
  ctx.stroke();

  // 右腿
  ctx.beginPath();
  ctx.moveTo(x, hipY);
  ctx.lineTo(x + 14, feetY);
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
    // 从后上方（-150度）挥到前方（30度）
    armAngle = dir > 0
      ? -2.6 + progress * 3.2
      : Math.PI + 2.6 - progress * 3.2;
  } else {
    // 待机：手臂朝后上方
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

  // 球拍柄
  const racketHandleLen = 18;
  const racketAngle = armAngle + (dir > 0 ? -0.3 : 0.3);
  const racketBaseX = handX + Math.cos(racketAngle) * racketHandleLen;
  const racketBaseY = handY + Math.sin(racketAngle) * racketHandleLen;

  ctx.strokeStyle = "#555";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(racketBaseX, racketBaseY);
  ctx.stroke();

  // 球拍面（椭圆）
  ctx.save();
  ctx.translate(racketBaseX, racketBaseY);
  ctx.rotate(racketAngle);
  ctx.strokeStyle = "#999";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(8, 0, 14, 10, 0, 0, Math.PI * 2);
  ctx.stroke();
  // 网线
  ctx.strokeStyle = "rgba(180,180,180,0.5)";
  ctx.lineWidth = 0.7;
  ctx.beginPath();
  ctx.moveTo(-2, 0);
  ctx.lineTo(18, 0);
  ctx.moveTo(8, -8);
  ctx.lineTo(8, 8);
  ctx.stroke();
  ctx.restore();

  // 头（最后画，覆盖在身体上方）
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

  // 羽毛裙（白色锥形）
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

  // 羽毛线条
  ctx.strokeStyle = "rgba(180,180,180,0.6)";
  ctx.lineWidth = 0.6;
  for (let i = -7; i <= 7; i += 3.5) {
    ctx.beginPath();
    ctx.moveTo(-4, 0);
    ctx.lineTo(-21, i);
    ctx.stroke();
  }

  // 软木头
  ctx.fillStyle = "#E8C87A";
  ctx.beginPath();
  ctx.arc(0, 0, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#B8963A";
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.restore();
}

function drawScoreboard(ctx: CanvasRenderingContext2D, score: [number, number]) {
  const w = 160;
  const h = 50;
  const x = COURT_W / 2 - w / 2;
  const y = 15;

  // 黑色记分板
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();

  // 边框
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.stroke();

  // LED 风格比分
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#FF2222";
  ctx.font = "bold 32px 'Courier New', monospace";
  ctx.fillText(`${score[0]} - ${score[1]}`, COURT_W / 2, y + h / 2 + 1);
}

function drawServeHint(
  ctx: CanvasRenderingContext2D,
  serving: number,
  players: [PlayerFrameData, PlayerFrameData],
) {
  const p = players[serving]!;

  ctx.fillStyle = "rgba(0,0,0,0.65)";
  ctx.beginPath();
  ctx.roundRect(p.x - 35, p.y - PLAYER_H - 28, 70, 20, 5);
  ctx.fill();

  ctx.fillStyle = "#FFF";
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("按 ↓ 发球", p.x, p.y - PLAYER_H - 18);
}

function drawScoredFlash(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.fillRect(0, 0, COURT_W, COURT_H);

  ctx.fillStyle = "rgba(0,0,0,0.7)";
  ctx.beginPath();
  ctx.roundRect(COURT_W / 2 - 50, COURT_H / 2 - 16, 100, 32, 8);
  ctx.fill();

  ctx.fillStyle = "#FF4444";
  ctx.font = "bold 18px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("得分!", COURT_W / 2, COURT_H / 2);
}
