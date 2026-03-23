import { useState } from "react";
import { getHttpBase } from "../api";

interface Props {
  onEnterRoom: (code: string, nickname: string) => void;
  urlError?: string;
}

export default function Home({ onEnterRoom, urlError }: Props) {
  const [nickname, setNickname] = useState(() => {
    try {
      const raw = sessionStorage.getItem("badminton_session");
      if (raw) {
        return (JSON.parse(raw) as { nickname?: string }).nickname || "";
      }
    } catch {
      /* ignore */
    }
    return "";
  });
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [tip, setTip] = useState("");

  function clearTip() {
    setTip("");
  }

  async function createRoom() {
    setTip("");
    setError("");
    if (!nickname.trim()) {
      setTip("请输入昵称");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${getHttpBase()}/api/rooms`, {
        method: "POST",
      });
      if (!res.ok) {
        throw new Error("创建房间失败");
      }
      const data = (await res.json()) as { roomCode: string };
      onEnterRoom(data.roomCode, nickname.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function joinRoom() {
    setTip("");
    setError("");
    if (!nickname.trim()) {
      setTip("请输入昵称");
      return;
    }
    if (!joinCode) {
      setTip("请输入房间号");
      return;
    }
    if (joinCode.length !== 6) {
      setTip("房间号为6位数字");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${getHttpBase()}/api/rooms/${joinCode}`);
      if (!res.ok) {
        throw new Error("房间不存在");
      }
      const info = (await res.json()) as {
        roomCode: string;
        playerCount: number;
        closed: boolean;
      };
      if (info.closed || !info.roomCode) {
        throw new Error("房间不存在或已关闭");
      }
      if (info.playerCount >= 2) {
        throw new Error("房间已满，无法加入");
      }
      onEnterRoom(joinCode, nickname.trim());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-4 bg-[#ecfdf5]">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md">
        <h1 className="text-4xl font-bold text-center mb-2 text-emerald-600">
          羽毛球对战
        </h1>
        <p className="text-gray-500 text-center mb-8">
          双人在线实时对战，操控角色击打羽毛球
        </p>

        {error && (
          <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">
            {error}
          </div>
        )}
        {urlError && !error && (
          <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg mb-4 text-sm">
            {urlError}
          </div>
        )}
        {tip && <div className="text-red-500 text-sm mb-4">{tip}</div>}

        <label className="block text-sm font-medium text-gray-700 mb-1">
          昵称
        </label>
        <input
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition mb-6"
          placeholder="输入你的昵称"
          maxLength={12}
          value={nickname}
          onChange={(e) => {
            setNickname(e.target.value);
            clearTip();
          }}
        />

        <button
          className="w-full py-3 px-4 bg-emerald-600 text-white font-semibold rounded-lg hover:bg-emerald-700 transition mb-6"
          onClick={createRoom}
          disabled={loading}
        >
          {loading ? "请稍候..." : "创建房间"}
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="flex-1 h-px bg-gray-200" />
          <span className="text-sm text-gray-400">或加入房间</span>
          <div className="flex-1 h-px bg-gray-200" />
        </div>

        <input
          className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none transition text-center text-2xl tracking-[0.5em] mb-3"
          placeholder="房间号"
          maxLength={6}
          value={joinCode}
          onChange={(e) => {
            setJoinCode(e.target.value.replace(/\D/g, ""));
            clearTip();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              joinRoom();
            }
          }}
        />
        <button
          className="w-full py-3 px-4 bg-white text-emerald-600 font-semibold rounded-lg border-2 border-emerald-600 hover:bg-emerald-50 transition"
          onClick={joinRoom}
          disabled={loading}
        >
          加入房间
        </button>

        <div className="mt-6 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 text-center">
            操作：A/D 移动 · W 跳跃 · J 挥拍击球
          </p>
        </div>
      </div>
    </div>
  );
}
