import { useCallback, useEffect, useRef } from "react";
import type { InputState, PlayerFrameData, RallyState, ShuttleFrameData } from "../types/protocol";

/* ── 物理常量（与服务端一致） ── */
const COURT_W = 800;
const COURT_H = 450;
const GROUND_Y = 400;
const NET_X = 400;
const NET_TOP = 280;
const PLAYER_H = 60;
const SWING_DURATION = 12;

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
  players, shuttle, score, serving, rallyState,
  myPlayerIndex, player1Name, player2Name, onInput, disabled,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef({ players, shuttle, score, serving, rallyState });
  const keysRef = useRef(new Set<string>());
  const lastInputRef = useRef<string>("");

  // 更新帧数据引用
  frameRef.current = { players, shuttle, score, serving, rallyState };

  /* ── 键盘输入 ── */
  const sendInput = useCallback(() => {
    if (disabled) { return; }
    const keys = keysRef.current;
    const input: InputState = {
      left: keys.has("KeyA") || keys.has("ArrowLeft"),
      right: keys.has("KeyD") || keys.has("ArrowRight"),
      up: keys.has("KeyW") || keys.has("ArrowUp") || keys.has("Space"),
      swing: keys.has("KeyJ") || keys.has("KeyK"),
    };
    const key = JSON.stringify(input);
    if (key !== lastInputRef.current) {
      lastInputRef.current = key;
      onInput(input);
    }
  }, [onInput, disabled]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (["KeyA", "KeyD", "KeyW", "KeyJ", "KeyK", "Space",
           "ArrowLeft", "ArrowRight", "ArrowUp"].includes(e.code)) {
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

      // 保持宽高比
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

      drawBackground(ctx);
      drawCourt(ctx);
      drawNet(ctx);

      if (f.players) {
        drawPlayerShadow(ctx, f.players[0]!);
        drawPlayerShadow(ctx, f.players[1]!);
        drawPlayer(ctx, f.players[0]!, "#2563EB", "#1D4ED8");
        drawPlayer(ctx, f.players[1]!, "#DC2626", "#B91C1C");
      }

      if (f.shuttle?.visible) {
        drawShuttle(ctx, f.shuttle);
      }

      drawScoreOverlay(ctx, f.score, player1Name, player2Name);

      if (f.rallyState === "serving" && f.players) {
        drawServeHint(ctx, f.serving, f.players);
      }

      if (f.rallyState === "scored") {
        drawScoredOverlay(ctx);
      }

      animId = requestAnimationFrame(draw);
    }

    animId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
    };
  }, [player1Name, player2Name, myPlayerIndex]);

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center">
      <canvas
        ref={canvasRef}
        className="rounded-lg shadow-md"
        style={{ imageRendering: "auto" }}
      />
    </div>
  );
}

/* ── 绘制函数 ── */

function drawBackground(ctx: CanvasRenderingContext2D) {
  // 天空渐变
  const skyGrad = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  skyGrad.addColorStop(0, "#87CEEB");
  skyGrad.addColorStop(0.7, "#B8E4F0");
  skyGrad.addColorStop(1, "#D4EDDA");
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, COURT_W, GROUND_Y);

  // 地面
  const groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, COURT_H);
  groundGrad.addColorStop(0, "#4A8B3E");
  groundGrad.addColorStop(1, "#3D7C2F");
  ctx.fillStyle = groundGrad;
  ctx.fillRect(0, GROUND_Y, COURT_W, COURT_H - GROUND_Y);
}

function drawCourt(ctx: CanvasRenderingContext2D) {
  // 球场地面标记
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.lineWidth = 2;

  // 边界线
  ctx.strokeRect(30, GROUND_Y, COURT_W - 60, 45);

  // 中线
  ctx.beginPath();
  ctx.moveTo(NET_X, GROUND_Y);
  ctx.lineTo(NET_X, GROUND_Y + 45);
  ctx.stroke();

  // 发球线
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(160, GROUND_Y);
  ctx.lineTo(160, GROUND_Y + 45);
  ctx.moveTo(COURT_W - 160, GROUND_Y);
  ctx.lineTo(COURT_W - 160, GROUND_Y + 45);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawNet(ctx: CanvasRenderingContext2D) {
  // 网柱
  ctx.fillStyle = "#666";
  ctx.fillRect(NET_X - 3, NET_TOP - 5, 6, GROUND_Y - NET_TOP + 5);

  // 网
  ctx.strokeStyle = "rgba(255,255,255,0.8)";
  ctx.lineWidth = 1;
  // 水平线
  for (let y = NET_TOP; y <= GROUND_Y; y += 12) {
    ctx.beginPath();
    ctx.moveTo(NET_X - 2, y);
    ctx.lineTo(NET_X + 2, y);
    ctx.stroke();
  }

  // 网顶白线
  ctx.strokeStyle = "#FFF";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(NET_X - 4, NET_TOP);
  ctx.lineTo(NET_X + 4, NET_TOP);
  ctx.stroke();
}

function drawPlayerShadow(ctx: CanvasRenderingContext2D, p: PlayerFrameData) {
  ctx.fillStyle = "rgba(0,0,0,0.15)";
  ctx.beginPath();
  ctx.ellipse(p.x, GROUND_Y + 2, 18, 5, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  p: PlayerFrameData,
  bodyColor: string,
  darkColor: string,
) {
  const x = p.x;
  const feetY = p.y;
  const dir = p.facingRight ? 1 : -1;

  // 腿
  ctx.strokeStyle = darkColor;
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x - 6, feetY - 18);
  ctx.lineTo(x - 9, feetY);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + 6, feetY - 18);
  ctx.lineTo(x + 9, feetY);
  ctx.stroke();

  // 身体
  ctx.fillStyle = bodyColor;
  ctx.beginPath();
  ctx.roundRect(x - 12, feetY - PLAYER_H + 12, 24, 35, 4);
  ctx.fill();

  // 头
  ctx.fillStyle = "#FFDCB0";
  ctx.beginPath();
  ctx.arc(x, feetY - PLAYER_H + 5, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#D4A574";
  ctx.lineWidth = 1;
  ctx.stroke();

  // 眼睛
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.arc(x + dir * 3, feetY - PLAYER_H + 3, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // 手臂和球拍
  const shoulderX = x + dir * 10;
  const shoulderY = feetY - PLAYER_H + 18;

  // 计算球拍角度
  let racketAngle: number;
  if (p.swingTick > 0 && p.swingTick <= SWING_DURATION) {
    // 挥拍动画：从后到前的弧线
    const progress = p.swingTick / SWING_DURATION;
    racketAngle = dir * (-2.0 + progress * 3.5);
  } else {
    // 待机姿势
    racketAngle = dir * 0.3;
  }

  const armLen = 18;
  const handX = shoulderX + Math.cos(racketAngle) * armLen;
  const handY = shoulderY + Math.sin(racketAngle) * armLen;

  // 手臂
  ctx.strokeStyle = "#FFDCB0";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(shoulderX, shoulderY);
  ctx.lineTo(handX, handY);
  ctx.stroke();

  // 球拍柄
  const racketLen = 16;
  const racketAngle2 = racketAngle - dir * 0.4;
  const racketTipX = handX + Math.cos(racketAngle2) * racketLen;
  const racketTipY = handY + Math.sin(racketAngle2) * racketLen;

  ctx.strokeStyle = "#8B5513";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(handX, handY);
  ctx.lineTo(racketTipX, racketTipY);
  ctx.stroke();

  // 球拍面
  ctx.save();
  ctx.translate(racketTipX, racketTipY);
  ctx.rotate(racketAngle2);
  ctx.strokeStyle = "#CCC";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 12, 8, 0, 0, Math.PI * 2);
  ctx.stroke();

  // 球拍网格
  ctx.strokeStyle = "rgba(200,200,200,0.5)";
  ctx.lineWidth = 0.5;
  ctx.beginPath();
  ctx.moveTo(-8, 0);
  ctx.lineTo(8, 0);
  ctx.moveTo(0, -6);
  ctx.lineTo(0, 6);
  ctx.stroke();
  ctx.restore();
}

function drawShuttle(ctx: CanvasRenderingContext2D, sh: ShuttleFrameData) {
  const x = sh.x;
  const y = sh.y;

  // 计算朝向角度（基于速度方向）
  let angle = 0;
  if (Math.abs(sh.vx) > 0.5 || Math.abs(sh.vy) > 0.5) {
    angle = Math.atan2(sh.vy, sh.vx);
  } else {
    angle = Math.PI / 2; // 静止时朝下
  }

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // 羽毛（锥形尾部）
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath();
  ctx.moveTo(-5, 0);
  ctx.lineTo(-18, -8);
  ctx.lineTo(-18, 8);
  ctx.closePath();
  ctx.fill();

  ctx.strokeStyle = "rgba(200,200,200,0.7)";
  ctx.lineWidth = 0.5;
  for (let i = -6; i <= 6; i += 3) {
    ctx.beginPath();
    ctx.moveTo(-5, 0);
    ctx.lineTo(-18, i);
    ctx.stroke();
  }

  // 软木球头
  ctx.fillStyle = "#F5DEB3";
  ctx.beginPath();
  ctx.arc(0, 0, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#D4A574";
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
}

function drawScoreOverlay(
  ctx: CanvasRenderingContext2D,
  score: [number, number],
  p1Name: string,
  p2Name: string,
) {
  // 半透明背景
  ctx.fillStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.roundRect(COURT_W / 2 - 140, 10, 280, 40, 8);
  ctx.fill();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // 玩家1名字
  ctx.fillStyle = "#60A5FA";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText(p1Name, COURT_W / 2 - 80, 30);

  // 比分
  ctx.fillStyle = "#FFF";
  ctx.font = "bold 20px sans-serif";
  ctx.fillText(`${score[0]}  -  ${score[1]}`, COURT_W / 2, 30);

  // 玩家2名字
  ctx.fillStyle = "#F87171";
  ctx.font = "bold 13px sans-serif";
  ctx.fillText(p2Name, COURT_W / 2 + 80, 30);
}

function drawServeHint(
  ctx: CanvasRenderingContext2D,
  serving: number,
  players: [PlayerFrameData, PlayerFrameData],
) {
  const p = players[serving]!;
  const text = "按 J 发球";

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.roundRect(p.x - 40, p.y - PLAYER_H - 30, 80, 22, 6);
  ctx.fill();

  ctx.fillStyle = "#FFF";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, p.x, p.y - PLAYER_H - 19);
}

function drawScoredOverlay(ctx: CanvasRenderingContext2D) {
  ctx.fillStyle = "rgba(0,0,0,0.2)";
  ctx.fillRect(0, 0, COURT_W, COURT_H);

  ctx.fillStyle = "rgba(0,0,0,0.6)";
  ctx.beginPath();
  ctx.roundRect(COURT_W / 2 - 60, COURT_H / 2 - 18, 120, 36, 10);
  ctx.fill();

  ctx.fillStyle = "#FFF";
  ctx.font = "bold 16px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("得分!", COURT_W / 2, COURT_H / 2);
}
