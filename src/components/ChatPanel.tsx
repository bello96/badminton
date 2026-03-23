import { useState, useRef, useEffect } from "react";
import type { ChatMessage } from "../types/protocol";

interface Props {
  messages: ChatMessage[];
  myId: string | null;
  onSendChat: (text: string) => void;
}

export default function ChatPanel({ messages, myId, onSendChat }: Props) {
  const [input, setInput] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSubmit = () => {
    if (!input.trim()) {
      return;
    }
    onSendChat(input.trim());
    setInput("");
  };

  return (
    <div className="flex flex-col h-full bg-white rounded-xl shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-700">聊天</h3>
      </div>

      <div
        ref={listRef}
        className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0"
      >
        {messages.map((msg) => (
          <div key={msg.id}>
            {msg.kind === "system" ? (
              <div className="text-center text-xs text-gray-400 py-1">
                {msg.text}
              </div>
            ) : (
              <div className="text-sm">
                <span className="font-medium text-emerald-600">
                  {msg.playerName}
                  {msg.playerId === myId && "（你）"}
                </span>
                <span className="text-gray-400 mx-1">:</span>
                <span className="text-gray-700">{msg.text}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="px-3 py-2 border-t border-gray-100">
        <div className="flex gap-2 items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="发送消息..."
            className="flex-1 px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:ring-2 focus:ring-gray-400 focus:border-transparent outline-none transition-colors"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                handleSubmit();
              }
            }}
          />
          <button
            onClick={handleSubmit}
            className="px-4 py-2 text-sm text-white rounded-lg transition shrink-0 bg-gray-600 hover:bg-gray-700"
          >
            发送
          </button>
        </div>
      </div>
    </div>
  );
}
