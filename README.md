# 羽毛球对战

双人在线实时对战羽毛球游戏，火柴人风格，支持房间匹配、实时聊天、断线重连。

**在线体验**: https://badminton.dengjiabei.cn/

## 游戏截图

- 灰色墙壁 + 木地板球场，火柴人角色（蓝方 vs 红方）
- 黑色 LED 风格计分板
- 每个玩家始终看到自己在左边（视角镜像）

## 操作方式

| 按键 | 动作 |
|------|------|
| ← → | 左右移动 |
| ↑ | 跳跃 |
| ↓ | 挥拍击球 / 发球 |

跳起 + 击球 = 扣杀

## 游戏规则

- 默认 11 分制（可选 21 分制）
- 平分需领先 2 分，30 分封顶
- 落地得分 / 出界失分 / 触网落回失分
- 得分方获得发球权

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 18 + TypeScript + Vite + Twind |
| 渲染 | HTML5 Canvas（60fps 客户端渲染） |
| 后端 | Cloudflare Workers + Durable Objects |
| 通信 | WebSocket（30Hz 服务端物理引擎） |
| 部署 | Cloudflare Pages + Workers |
| CI/CD | GitHub Actions |

## 项目结构

```
badminton/
├── src/
│   ├── components/
│   │   ├── BadmintonCourt.tsx   # Canvas 球场渲染 + 视角镜像
│   │   ├── ChatPanel.tsx        # 实时聊天
│   │   ├── PlayerBar.tsx        # 房间信息栏
│   │   └── Confetti.tsx         # 胜利特效
│   ├── pages/
│   │   ├── Home.tsx             # 创建/加入房间
│   │   └── Room.tsx             # 游戏房间
│   ├── hooks/useWebSocket.ts    # WebSocket 自动重连
│   ├── types/protocol.ts       # 前后端共享消息协议
│   ├── api.ts                   # API 地址配置
│   ├── App.tsx                  # 路由 + 会话管理
│   └── main.tsx                 # 入口
├── worker/
│   └── src/
│       ├── index.ts             # HTTP 路由 + WebSocket 升级
│       └── room.ts              # BadmintonRoom Durable Object（物理引擎 + 计分）
├── .github/workflows/
│   ├── deploy-pages.yml         # 前端自动部署
│   └── deploy-worker.yml        # Worker 自动部署
└── .env.development             # 开发环境 API 地址
```

## 核心特性

- **视角镜像**: 每个玩家始终看到自己在左边，操作方向自动适配
- **服务端权威物理**: 30Hz 物理引擎运行在 Durable Object 中，防止作弊
- **断线重连**: 15 秒内重连恢复游戏状态
- **房间分享**: 6 位房间号 + 链接邀请
- **走路动画**: 移动时腿部交替迈步，跳跃时腿部收起

## 本地开发

```bash
# 安装依赖
npm install --legacy-peer-deps
cd worker && npm install && cd ..

# 启动前端（代理线上 API）
npm run dev

# 启动本地 Worker（可选）
npm run dev:worker
```

## 部署

推送到 `master` 分支后 GitHub Actions 自动部署：

- 前端变更 → Cloudflare Pages
- `worker/` 变更 → Cloudflare Workers

手动部署：

```bash
npm run build
npx wrangler pages deploy dist --project-name=badminton
cd worker && npx wrangler deploy
```

## License

MIT
