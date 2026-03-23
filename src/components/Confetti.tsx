import { useEffect, useState } from "react";

const COLORS = [
  "#059669", "#f59e0b", "#10b981", "#ef4444",
  "#8b5cf6", "#ec4899", "#f97316", "#14b8a6",
];
const PARTICLE_COUNT = 80;

interface Particle {
  id: number;
  side: "left" | "right";
  angle: number;
  speed: number;
  color: string;
  delay: number;
  duration: number;
  size: number;
  shape: "circle" | "rect" | "strip";
  spin: number;
}

export default function Confetti({ show }: { show: boolean }) {
  const [particles, setParticles] = useState<Particle[]>([]);

  useEffect(() => {
    if (!show) {
      setParticles([]);
      return;
    }
    setParticles(
      Array.from({ length: PARTICLE_COUNT }, (_, i) => {
        const side = i < PARTICLE_COUNT / 2 ? "left" : "right";
        const shapes = ["circle", "rect", "strip"] as const;
        return {
          id: i,
          side,
          angle: 45 + (Math.random() - 0.5) * 50,
          speed: 0.5 + Math.random() * 0.7,
          color: COLORS[Math.floor(Math.random() * COLORS.length)]!,
          delay: Math.random() * 0.6,
          duration: 1.8 + Math.random() * 1.5,
          size: 6 + Math.random() * 7,
          shape: shapes[Math.floor(Math.random() * shapes.length)]!,
          spin: 360 + Math.random() * 720,
        };
      }),
    );
  }, [show]);

  if (!show) {
    return null;
  }

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      {particles.map((p) => {
        const rad = (p.angle * Math.PI) / 180;
        const distX = Math.cos(rad) * p.speed * 120;
        const distY = Math.sin(rad) * p.speed * 120;
        const startX = p.side === "left" ? -2 : 102;
        const startY = 102;
        const dirX = p.side === "left" ? 1 : -1;
        const endX = startX + dirX * distX;
        const endY = startY - distY;
        const borderRadius = p.shape === "circle" ? "50%" : "2px";
        const w = p.shape === "strip" ? p.size * 0.4 : p.size;
        const h = p.shape === "strip" ? p.size * 1.8 : p.size;

        return (
          <div
            key={p.id}
            style={{
              position: "absolute",
              left: `${startX}%`,
              top: `${startY}%`,
              width: w,
              height: h,
              backgroundColor: p.color,
              borderRadius,
              opacity: 0,
              animation: `confetti-burst-${p.id} ${p.duration}s ${p.delay}s ease-out forwards`,
            }}
          >
            <style>{`
              @keyframes confetti-burst-${p.id} {
                0% { transform: translate(0, 0) rotate(0deg) scale(0.3); opacity: 1; }
                20% { opacity: 1; transform: translate(${endX * 0.6}vw, ${(endY - startY) * 0.6}vh) rotate(${p.spin * 0.4}deg) scale(1); }
                60% { opacity: 0.9; transform: translate(${endX * 0.95}vw, ${(endY - startY) * 0.85}vh) rotate(${p.spin * 0.8}deg) scale(0.9); }
                100% { opacity: 0; transform: translate(${endX}vw, ${(endY - startY) * 1.1 + 20}vh) rotate(${p.spin}deg) scale(0.5); }
              }
            `}</style>
          </div>
        );
      })}
    </div>
  );
}
