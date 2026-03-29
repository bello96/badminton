import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getHttpBase, getWsBase } from "../api";
import BadmintonCourt from "../components/BadmintonCourt";
import ChatPanel from "../components/ChatPanel";
import Confetti from "../components/Confetti";
import PlayerBar from "../components/PlayerBar";
import { useWebSocket } from "../hooks/useWebSocket";
import type {
  ChatMessage,
  GamePhase,
  PlayerFrameData,
  PlayerInfo,
  RallyState,
  ServerMessage,
  ShuttleFrameData,
} from "../types/protocol";

interface Props {
  roomCode: string;
  nickname: string;
  playerId: string;
  onLeave: () => void;
}

const WIN_POINTS_OPTIONS = [11, 16, 21];

export default function Room({ roomCode, nickname, playerId, onLeave }: Props) {
  /* ── 房间状态 ── */
  const [myId, setMyId] = useState<string | null>(null);
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [phase, setPhase] = useState<GamePhase>("waiting");
  const [winPoints, setWinPoints] = useState(21);

  /* ── 游戏状态 ── */
  const [player1Id, setPlayer1Id] = useState<string | null>(null);
  const [player2Id, setPlayer2Id] = useState<string | null>(null);
  const [gamePlayers, setGamePlayers] = useState<[PlayerFrameData, PlayerFrameData] | null>(null);
  const [shuttle, setShuttle] = useState<ShuttleFrameData | null>(null);
  const [score, setScore] = useState<[number, number]>([0, 0]);
  const [serving, setServing] = useState(0);
  const [rallyState, setRallyState] = useState<RallyState>("serving");
  const [lastScorer, setLastScorer] = useState<number | null>(null);
  const [lastReason, setLastReason] = useState("");

  /* ── 结束状态 ── */
  const [winner, setWinner] = useState<{ id: string; name: string } | null>(null);
  const [endReason, setEndReason] = useState("");
  const [showConfetti, setShowConfetti] = useState(false);
  const [showEndDialog, setShowEndDialog] = useState(false);

  /* ── UI 状态 ── */
  const [readySending, setReadySending] = useState(false);
  const [startSending, setStartSending] = useState(false);

  /* ── 聊天 ── */
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);

  /* ── WebSocket ── */
  const wsUrl = useMemo(
    () => `${getWsBase()}/api/rooms/${roomCode}/ws`,
    [roomCode],
  );
  const { connected, send, addListener, leave } = useWebSocket(wsUrl);

  const joinedRef = useRef(false);

  // 加入房间
  useEffect(() => {
    if (connected && !joinedRef.current) {
      joinedRef.current = true;
      send({ type: "join", playerName: nickname, playerId });
    }
  }, [connected, nickname, playerId, send]);

  // 页面离开时发送 beacon
  useEffect(() => {
    const handlePageHide = () => {
      navigator.sendBeacon(
        `${getHttpBase()}/api/rooms/${roomCode}/quickleave`,
        playerId,
      );
    };
    window.addEventListener("pagehide", handlePageHide);
    return () => window.removeEventListener("pagehide", handlePageHide);
  }, [roomCode, playerId]);

  // 消息监听
  useEffect(() => {
    const unsub = addListener((msg: ServerMessage) => {
      switch (msg.type) {
        case "roomState": {
          setMyId(msg.yourId);
          setPlayers(msg.players);
          setOwnerId(msg.ownerId);
          setPhase(msg.phase);
          setWinPoints(msg.winPoints);
          setPlayer1Id(msg.player1Id);
          setPlayer2Id(msg.player2Id);
          setScore(msg.score as [number, number]);
          setChatMessages(msg.chatHistory);
          if (msg.winner) {
            setWinner(msg.winner);
          }
          if (msg.phase === "ended") {
            setShowEndDialog(true);
            if (msg.winner?.id === msg.yourId) {
              setShowConfetti(true);
            }
          }
          break;
        }
        case "playerJoined":
          setPlayers((prev) => {
            const existing = prev.find((p) => p.id === msg.player.id);
            if (existing) {
              return prev.map((p) => (p.id === msg.player.id ? msg.player : p));
            }
            return [...prev, msg.player];
          });
          break;
        case "playerLeft":
          setPlayers((prev) => prev.filter((p) => p.id !== msg.playerId));
          break;
        case "phaseChange":
          setPhase(msg.phase);
          setOwnerId(msg.ownerId);
          if (msg.phase === "readying") {
            setShowEndDialog(false);
            setShowConfetti(false);
            setWinner(null);
          }
          break;
        case "gameStart":
          setPhase("playing");
          setPlayer1Id(msg.player1Id);
          setPlayer2Id(msg.player2Id);
          setWinPoints(msg.winPoints);
          setScore([0, 0]);
          setStartSending(false);
          setShowEndDialog(false);
          setShowConfetti(false);
          break;
        case "gameFrame":
          setGamePlayers(msg.players);
          setShuttle(msg.shuttle);
          setScore(msg.score);
          setServing(msg.serving);
          setRallyState(msg.rallyState);
          break;
        case "pointScored":
          setScore(msg.score);
          setLastScorer(msg.scorer);
          setLastReason(msg.reason);
          break;
        case "gameEnd":
          setPhase("ended");
          setScore(msg.score);
          setEndReason(msg.reason);
          if (msg.winnerId) {
            setWinner({ id: msg.winnerId, name: msg.winnerName });
            setShowConfetti(msg.winnerId === myId);
          } else {
            setWinner(null);
          }
          setShowEndDialog(true);
          break;
        case "readyChanged":
          setPlayers((prev) =>
            prev.map((p) =>
              p.id === msg.playerId ? { ...p, ready: msg.ready } : p,
            ),
          );
          setReadySending(false);
          break;
        case "settingsChanged":
          setWinPoints(msg.winPoints);
          break;
        case "chat":
          setChatMessages((prev) => [...prev, msg.message]);
          break;
        case "error":
          break;
        case "roomClosed":
          onLeave();
          break;
      }
    });
    return unsub;
  }, [addListener, myId, onLeave]);

  /* ── 操作 ── */
  const isOwner = myId === ownerId;
  const myPlayerIndex = myId === player1Id ? 0 : myId === player2Id ? 1 : -1;
  const mePlayer = players.find((p) => p.id === myId);
  const opponentPlayer = players.find((p) => p.id !== myId);

  const handleReady = useCallback(() => send({ type: "ready" }), [send]);
  const handleStartGame = useCallback(() => send({ type: "startGame" }), [send]);
  const handleSurrender = useCallback(() => send({ type: "surrender" }), [send]);
  const handlePlayAgain = useCallback(() => send({ type: "playAgain" }), [send]);
  const handleTransferOwner = useCallback(() => send({ type: "transferOwner" }), [send]);
  const handleSetWinPoints = useCallback(
    (wp: number) => send({ type: "setSettings", winPoints: wp }),
    [send],
  );
  const handleSendChat = useCallback(
    (text: string) => send({ type: "chat", text }),
    [send],
  );
  const handleInput = useCallback(
    (input: { left: boolean; right: boolean; up: boolean; swing: boolean }) =>
      send({ type: "input", input }),
    [send],
  );
  const handleLeave = useCallback(() => {
    leave();
    onLeave();
  }, [leave, onLeave]);

  const opponentReady = opponentPlayer?.ready ?? false;
  const meReady = mePlayer?.ready ?? false;

  const p1Player = players.find((p) => p.id === player1Id);
  const p2Player = players.find((p) => p.id === player2Id);

  // 颜色绑定房主身份：房主=蓝方，对手=红方，双方视角一致
  const playerColorMap: Record<string, "blue" | "red"> = {};
  for (const p of players) {
    playerColorMap[p.id] = p.id === ownerId ? "blue" : "red";
  }
  // player1 是否对应蓝方（房主）
  const player1IsBlue = !player1Id || player1Id === ownerId;
  // 房主始终在左侧：当 player1 不是房主时镜像，双方客户端算出同一个值
  const mirrored = player1Id !== null && player1Id !== ownerId;

  return (
    <div className="h-screen bg-[#ecfdf5] flex flex-col p-2 gap-2 overflow-hidden">
      <PlayerBar
        roomCode={roomCode}
        players={players}
        ownerId={ownerId}
        myId={myId}
        phase={phase}
        playerColorMap={playerColorMap}
        onPlayAgain={handlePlayAgain}
        onTransferOwner={handleTransferOwner}
        onLeave={handleLeave}
      />

      <div className="flex-1 flex gap-2 min-h-0">
        {/* 左侧：游戏区 */}
        <div className="flex-1 flex flex-col gap-1.5 min-w-0 min-h-0">
          {/* 游戏中：比分和投降（视角统一：自己始终是蓝方/左边） */}
          {phase === "playing" && (() => {
            const leftPlayer = mirrored ? p2Player : p1Player;
            const rightPlayer = mirrored ? p1Player : p2Player;
            const leftScore = mirrored ? score[1] : score[0];
            const rightScore = mirrored ? score[0] : score[1];
            // 颜色跟随加入顺序：mirrored 只换位置不换颜色
            const leftIsBlue = mirrored ? !player1IsBlue : player1IsBlue;
            const leftIsMe = (mirrored ? player2Id : player1Id) === myId;
            const rightIsMe = !leftIsMe && myPlayerIndex >= 0;
            return (
            <div className="flex items-center justify-between bg-white rounded-lg px-4 py-3 shadow-sm shrink-0">
              <div className="flex items-center gap-3">
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs ${leftIsBlue ? "bg-blue-50 text-blue-700" : "bg-red-50 text-red-700"}`}>
                  <span className={`w-2 h-2 rounded-full inline-block ${leftIsBlue ? "bg-blue-500" : "bg-red-500"}`} />
                  <span className="font-medium">{leftPlayer?.name || (leftIsBlue ? "蓝方" : "红方")}{leftIsMe ? "（我）" : ""}</span>
                  <span className="font-bold">{leftScore}</span>
                </div>
                <span className="text-gray-300 text-xs font-bold">VS</span>
                <div className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-xs ${leftIsBlue ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
                  <span className={`w-2 h-2 rounded-full inline-block ${leftIsBlue ? "bg-red-500" : "bg-blue-500"}`} />
                  <span className="font-medium">{rightPlayer?.name || (leftIsBlue ? "红方" : "蓝方")}{rightIsMe ? "（我）" : ""}</span>
                  <span className="font-bold">{rightScore}</span>
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <span className="text-xs text-gray-400">
                  {winPoints}分制
                </span>
                <button
                  className="px-2.5 py-1 text-xs rounded-md transition font-medium bg-red-50 text-red-500 hover:bg-red-100"
                  onClick={handleSurrender}
                >
                  投降
                </button>
              </div>
            </div>
            );
          })()}

          {/* 等待/准备区 */}
          {(phase === "waiting" || phase === "readying") && (
            <div className="bg-white rounded-lg px-4 py-3 shadow-sm shrink-0">
              {phase === "waiting" && (
                <div className="text-center text-gray-500 text-sm py-[2px]">
                  等待对手加入...
                </div>
              )}
              {phase === "readying" && (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {isOwner && (
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-500">分制</span>
                        <div className="flex gap-1">
                          {WIN_POINTS_OPTIONS.map((wp) => (
                            <button
                              key={wp}
                              className={`px-2 py-0.5 text-xs rounded-md transition ${
                                winPoints === wp
                                  ? "bg-emerald-600 text-white"
                                  : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                              }`}
                              onClick={() => handleSetWinPoints(wp)}
                            >
                              {wp}分
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                    {!isOwner && (
                      <span className="text-xs text-gray-500">
                        {winPoints}分制
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2.5">
                    {!isOwner && (() => {
                      const readyPending = !meReady && readySending;
                      return (
                        <button
                          className={`px-3 py-1 text-xs rounded-md transition font-medium ${
                            meReady
                              ? "bg-green-100 text-green-700"
                              : readyPending
                                ? "bg-emerald-400 text-white"
                                : "bg-emerald-600 text-white hover:bg-emerald-700"
                          }`}
                          onClick={() => {
                            if (!meReady) { setReadySending(true); }
                            handleReady();
                          }}
                          disabled={readyPending}
                        >
                          {meReady ? "已准备" : readyPending ? "准备中..." : "准备"}
                        </button>
                      );
                    })()}
                    {isOwner && (
                      <>
                        <span className="text-xs text-gray-400">
                          {opponentReady ? "对手已准备" : "等待对手准备..."}
                        </span>
                        <button
                          className="px-3 py-1 text-xs rounded-md transition font-medium bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
                          disabled={!opponentReady || startSending}
                          onClick={() => {
                            setStartSending(true);
                            handleStartGame();
                          }}
                        >
                          {startSending ? "开始中..." : "开始比赛"}
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* 游戏画面 */}
          <div className="flex-1 min-h-0">
            <BadmintonCourt
              players={gamePlayers}
              shuttle={shuttle}
              score={score}
              serving={serving}
              rallyState={rallyState}
              mirrored={mirrored}
              player1IsBlue={player1IsBlue}
              player1Name={p1Player?.name || "蓝方"}
              player2Name={p2Player?.name || "红方"}
              playerCount={players.length}
              lastScorer={lastScorer}
              lastReason={lastReason}
              onInput={handleInput}
              disabled={phase !== "playing" || myPlayerIndex < 0}
            />
          </div>

        </div>

        {/* 右侧：聊天 */}
        <div className="w-72 flex-shrink-0">
          <ChatPanel
            messages={chatMessages}
            myId={myId}
            onSendChat={handleSendChat}
          />
        </div>
      </div>

      {/* 结束弹窗 */}
      {showEndDialog && phase === "ended" && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-40">
          <div className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-xl text-center">
            <h2 className="text-2xl font-bold mb-2">
              {winner?.id === myId
                ? "你赢了！"
                : winner
                  ? `${winner.name} 获胜`
                  : "比赛结束"}
            </h2>
            <p className="text-gray-500 text-sm mb-4">{endReason}</p>

            <div className="flex items-center justify-center gap-6 mb-6">
              <div className="text-center">
                <div className="flex items-center gap-1.5 mb-1 justify-center">
                  <span className="w-3 h-3 rounded-full bg-blue-500 inline-block" />
                  <span className="text-sm font-medium">
                    {p1Player?.name || "蓝方"}
                  </span>
                </div>
                <span className="text-2xl font-bold">{score[0]}</span>
              </div>
              <span className="text-gray-300 text-2xl">:</span>
              <div className="text-center">
                <div className="flex items-center gap-1.5 mb-1 justify-center">
                  <span className="w-3 h-3 rounded-full bg-red-500 inline-block" />
                  <span className="text-sm font-medium">
                    {p2Player?.name || "红方"}
                  </span>
                </div>
                <span className="text-2xl font-bold">{score[1]}</span>
              </div>
            </div>

            <div className="flex gap-3 justify-center">
              {isOwner && (
                <button
                  className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition font-medium"
                  onClick={handlePlayAgain}
                >
                  再来一局
                </button>
              )}
              <button
                className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition"
                onClick={() => setShowEndDialog(false)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      <Confetti show={showConfetti} />
    </div>
  );
}
