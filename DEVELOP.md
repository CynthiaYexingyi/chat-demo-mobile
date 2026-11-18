# 二次开发说明

> 这是 DeepSeek 官方开源客户端 `deepseek-ai/chat-demo` v0.1.1（MIT 协议）的本地副本。
> 你完全可以改代码、加功能、自己部署。MIT 协议只要求保留 LICENSE。

---

## 一、环境与构建

本机依赖已装好（`node_modules` 就在目录里），可直接构建。

```bash
cd official-chat/src/chat-demo-0.1.1

# 开发（热更新，端口 8090）
npx rspack serve -c rspack.config.ts

# 生产构建（输出到 dist/）
NODE_ENV=production npx rspack build -c rspack.config.ts
```

> ⚠️ `package.json` 里的 `build` 脚本用了 `rm -rf dist`，Windows 下会失败。
> 直接用上面那条 `npx rspack build`，`output.clean: true` 已经会自动清空 dist。

构建耗时约 60 秒（首次）/ 2 秒（增量）。

---

## 二、我对官方源码做的三处改动

这些都是为了让它在手机上真正能用。**都已在源码里，重新构建不会丢。**

| 改动 | 文件 | 为什么 |
|---|---|---|
| 1. 放宽导入文件类型 | `src/components/settings/SettingsDialog.tsx:499` | Android 文件选择器识别不了 `.zip` MIME，导致 zip 变灰选不到。加了 `,*/*` |
| 2. 加 PWA 配置 | `src/index.html` + `src/pwa/` + `rspack.config.ts` | 官方包没有 manifest 和图标，装不到手机主屏幕 |
| 3. 标题改为 DeepSeek | `src/index.html` | 原标题是「API 使用 demo」，装到桌面后图标下面是这个名字 |

第 2 项的实现方式：`src/pwa/` 里放 `manifest.json` 和 4 个图标，
`rspack.config.ts` 的 `CopyRspackPlugin` 会把它们复制到 `dist/` 根目录。

---

## 三、我加的自定义功能（已实现并验证）

除了上面三处兼容性改动，还加了四个功能。全部在源码里，构建即可复现。

### 1. 上下文裁剪 —— 让超长会话能继续聊

**改的文件**：`services/chat/reply.ts`、`services/chat/store.ts`

原版把整条对话全量发给模型，所以超长会话一开口就超窗口。现在：
- `reply.ts` 加了 `estimateTokens()`（中文按 1.5 字符/token 保守估算）
- `toRequestMessages()` 从最新一轮往前累加，超过 `DEFAULT_CONTEXT_TOKENS`（默认 40000）就停
- 返回 `{ messages, droppedRounds }`，`store.ts` 据此在系统提示里追加一句
  「此前另有 N 轮对话因长度限制未包含在本次请求中」，避免模型误判对话起点

**实测**：在 28.9 万字的「统计学」会话里发消息，丢弃 90 轮，只发最近的轮次，
system 带说明，请求正常。

**想调预算**：改 `reply.ts` 里的 `DEFAULT_CONTEXT_TOKENS`。

### 2. 本地全文搜索

**新增文件**：`services/chat/search.ts`
**改的文件**：`components/sider/Sider.tsx`、`Sider.module.css`、`Sider.module.css.d.ts`、`i18n/*.ts`

侧栏原本只有会话列表，没有搜索。现在加了一个搜索框：
- 输入后 280ms 防抖，逐个会话从 IndexedDB 读取并扫描正文
- 结果按会话聚合，显示标题、命中次数、正文片段
- 支持中途取消（换关键词时旧任务自动 abort）
- 最多返回 60 个会话

**实测**：搜「荣格」命中 18 个会话，搜「潜意识」命中 21 个。

### 3. 可选模型 + 自定义 API 端点

**新增文件**：`services/api/origin.ts`
**改的文件**：`services/settings.ts`、`services/api/client.ts`、`services/api/speech.ts`、
`components/settings/SettingsDialog.tsx`、`i18n/*.ts`

- 设置 → 通用设置 → 多了「模型」下拉：`deepseek-flash` / `deepseek-v4-pro`
- 设置 → 数据管理 → 多了「API 地址」输入框：留空用默认 `https://api.deepseek.com`，
  填了就改走自定义地址（自建网关、代理、其它兼容服务）
- 地址格式非法会提示且不保存；每次请求时读取，改完立即生效，无需重启

**实测**：填 `https://example.com` 保存成功；填 `not-a-url` 被拒并提示；清空恢复默认。

### 4. 备份提醒

**改的文件**：`services/chat/backup.ts`、`components/sider/Sider.tsx`、`i18n/*.ts`

- 每次导出成功后把时间写进 `localStorage`（`chat-demo:last-export-at`）
- 侧栏顶部显示提醒：从未导出 → 「还没有备份过对话，点击导出」；
  超过 7 天 → 「已 N 天没有备份」，点击直接跳到数据管理
- 阈值在 `Sider.tsx` 的 `BACKUP_REMINDER_DAYS`

---

## 四、构建时的两个环境变量

沙箱环境会拦截「删除整个输出目录」，导致 `output.clean` 失败。为此加了两个开关：

```bash
# 输出到别的目录（默认 dist）
OUT_DIR=dist-mods

# 跳过构建前清空
NO_CLEAN=1

NODE_ENV=production OUT_DIR=dist-mods NO_CLEAN=1 npx rspack build -c rspack.config.ts
```

在你自己电脑上不需要它们，直接 `npx rspack build` 即可。

---

## 五、代码结构（想改哪块看这里）

```
src/
├── app/              应用外壳、主题、全局样式
├── components/       UI 组件
│   ├── messages/     消息气泡、重新生成按钮、版本切换 → AssistantMessage.tsx
│   └── settings/     设置面板、导入导出 → SettingsDialog.tsx
├── i18n/             中英文文案 (zh.ts / en.ts)
├── services/
│   ├── api/          请求构造、SSE 解析、协议类型
│   │   ├── client.ts     ← 请求体和端点在这里
│   │   └── types.ts      ← CreateMessageRequest / ChatModel
│   ├── chat/         会话、消息树、存储
│   │   ├── reply.ts      ← 上下文组装 toRequestMessages
│   │   └── store.ts      ← 状态、重新生成、模型常量
│   ├── markdown/     渲染、代码高亮、公式、图表
│   └── speech/       录音与朗读
└── utils/
```

## 六、常见改动的落点

**想换模型 / 加模型**
`services/api/types.ts` 的 `ChatModel` 类型 + `services/chat/store.ts:36` 的 `MODEL` 常量。
注意后端走的是 Anthropic 兼容接口 `api.deepseek.com/anthropic/v1/messages`，不是 `/chat/completions`。

**想调整上下文预算**

已经在第三节第 1 项实现。改 `services/chat/reply.ts` 的 `DEFAULT_CONTEXT_TOKENS` 即可（默认 40000 tokens）。
想做"早期摘要"的话，在 `toRequestMessages` 里把被丢弃的轮次交给模型生成一句摘要，
放进 `buildSystemPrompt` 那条说明里。

**想改输出长度上限**
`services/api/types.ts` 的 `CreateMessageRequest` 加 `max_tokens: number`
（当前没设，由服务端默认值决定，长回答可能被截断）。

**想改界面文案**
`src/i18n/zh.ts`。按钮、提示都在这里。

**想加设置项**
`components/settings/SettingsDialog.tsx`，照着已有项复制即可。

---

## 七、部署

构建产物在 `dist/`，是纯静态文件（约 4.6MB），可直接托管到任何静态服务器。

当前线上版本部署在 WorkBuddy 域名，来源目录是 `src/chat-demo-0.1.1/dist-mods`（含四项自定义功能）。

**注意**：`official-chat/site` 是早期手工打补丁的旧版目录，已不再使用。
现在一切从源码构建，线上直接从构建产物部署。

更新线上流程：改源码 → `npx rspack build` → 部署构建产物目录。

---

## 八、许可证

MIT。可以改、可以商用、可以再分发，保留 `LICENSE` 文件即可。
构建产物里已自动包含 `dist/LICENSE`。

---

## 九、数据在哪

- API Key、设置：浏览器 `localStorage`
- 会话、附件：浏览器 `IndexedDB`，库名 `chat-demo`
- 搜索索引：同一个库的 `searchIndex` 表（可随时重建，不进导出包）
- 服务端没有任何数据

换浏览器 / 清缓存 / 无痕模式 → 数据全部丢失。靠导出 ZIP 备份。

---

## 十、第二轮改造：手机端性能

针对手机上「打开白屏、搜索闪退、长会话卡死」做的三件事。全部不改变数据格式，
**升级数据库只新增 `searchIndex` 一张表，原有会话不做迁移**，所以更新版本不需要再导出导入。

### 1. 离线缓存（`src/pwa/sw.js`）

之前只有 PWA 图标和 manifest，没有 Service Worker，所以每次打开都要重新下载约 560KB 的
`main.js` + CSS，弱网下就是白屏。

- 页面走「先联网、失败用缓存」，4 秒超时兜底
- 其余同源资源走「先缓存、没有再联网」；文件名带内容哈希，内容变了文件名就变，不会读到旧版本
- 缓存上限 400 条，超出按写入顺序淘汰；跨域请求（DeepSeek 接口、外链图）完全不接管
- `skipWaiting`：新版本装好即待命，下次打开就是新版，不需要点刷新

注册在 `src/pwa/register.ts`，只在正式构建里注册（开发服务器会挡住热更新）。
`sw.js` 由 `CopyRspackPlugin` 复制到产物根目录；`register.ts` 不复制，它被打进主包。

### 2. 搜索搬进 Worker + 会话级布隆位图

`src/services/chat/searchIndex/`：

| 文件 | 职责 |
|---|---|
| `bloom.ts` | 按正文建位图；`mightContain` 判断「一定不包含」 |
| `text.ts` | 正文提取、命中摘要、`matchSession` 精确核对 |
| `worker.ts` | 后台线程：读会话、查位图、扫描、返回结果 |
| `client.ts` | 主线程侧：发消息收结果，失败即抛错让上层兜底 |
| `protocol.ts` | 两边共用的消息格式 |

关键点：

- **读会话这件事本身移出了主线程**。原来搜一次要把几十 MB 的会话 JSON 结构化成对象再扫，
  主线程被占满就会卡顿甚至闪退；现在只在后台线程做。
- 位图索引的是「双字」，只用来**排除**不含关键词的会话，不会漏结果。实测 45 个会话、
  2318 万字正文，位图合计 1.12 MB，桌面建索引 2.1 秒（手机约十几秒，后台空闲时做）。
- 索引随会话 `updatedAt` 失效自动重建；`App.tsx` 在会话列表就绪后于空闲时预热。
- 后台线程不可用或崩溃时，`search.ts` 自动退回主线程扫描，搜索始终可用。

### 3. 长会话只渲染末尾一段 + 图表延后绘制

- `MessageList.tsx`：消息超过 80 条时只渲染最后 80 条，顶部给「加载更早的消息」按钮，
  点一次往前放 80 条，并补偿滚动高度保持阅读位置。切换会话自动回到 80 条。
  那个 13323 条消息的会话以前要把全部消息铺进 DOM，手机必然卡死。
- `MermaidDiagram.tsx`：流式阶段不再每 100ms 重画一次图表，改为回答结束后画一次。

### 性能预算（实测）

| 项 | 改造前 | 改造后 |
|---|---|---|
| 首屏资源 | 每次联网下载 560KB | 首次之后走本地缓存 |
| 搜索 CPU | 主线程，2318 万字全扫 | 后台线程，先过滤掉约一半会话 |
| 长会话 DOM | 13323 条消息全渲染 | 80 条，按需展开 |
| 主包体积 | 471 KB | 474 KB（+3KB，worker 独立成块 8KB） |

### 验证方式

`npx tsc --noEmit`、`oxlint src rspack.config.ts`、`NODE_ENV=production npx rspack build` 均通过。
搜索逻辑另外用真实导出数据跑了对照测试：11 个关键词，布隆过滤漏检 0 条，
`matchSession` 与改造前实现逐字一致。

---

## 十一、第三轮：补上搜索落点与上下文提示

第二轮把长会话改成「只渲染末尾 80 条」之后留下一个断层：搜索只返回会话，不定位到命中的那句话。
在 13323 条消息的会话里搜「潜意识」，命中在第 1 条，而窗口在末尾 —— 要点 165 次「加载更早」才翻得到。

### 1. 搜索能跳到命中的消息

- `searchIndex/text.ts`：`SearchHit` 增加 `messageId`（第一条正文命中的消息 id，仅标题命中时为 `null`）。
  Worker 与主线程兜底两条路径共用 `matchSession`，所以两边都带这个字段。
- `services/chat/store.ts`：新增 `searchAnchor` 状态 + `jumpToMessage()` / `clearSearchAnchor()`。
  侧栏点击命中项改为 `jumpToMessage()`，而不是只 `selectSession()`。
- `MessageList.tsx`：窗口模型从「末尾 N 条」改成 `{ start: number | null }` —— `null` 表示跟随末尾，
  数字表示从该下标开始渲染。跳转时窗口起点设为 `命中下标 - 6`，上方留一点上下文。
  命中消息上方插入一个「搜索命中」标记，并用它定位滚动（不给消息再包一层容器，避免影响现有样式）。
  窗口没覆盖到最后一条时，底部出现「回到最新」按钮。
- 窗口不覆盖末尾时，`streaming` 标记不再落到窗口最后一条上（否则回复中会误标）。

### 2. 上下文省略可见

`store.ts` 的 `toRequestMessages` 早就算出了 `droppedRounds`，但只写进系统提示，界面看不到。
现在发送时记进 `droppedRounds[sessionId]`，`SessionView` 在输入框上方显示一行灰字
「对话过长，本次已省略早期 N 轮」。为 0 时不占位。

### 验证

真实导出数据（45 个会话）上跑 7 个关键词、104 组命中：落点错误 0，仅标题命中 0，空片段 0。
最大会话搜「潜意识」：命中下标 1，窗口起点 0，旧逻辑需点 165 次「加载更早」。

---

## 十二、第四轮：图片缩略图与会话组织

### 1. 图片只解码缩略图（`src/services/thumbs.ts`）

原来 `MessageFile` 一挂载就把原件读出来 `createObjectURL`，用 120px 的格子显示 4000×3000 的原图 ——
一张解码后占约 48MB 内存，几张就能让手机杀掉页面。

- 新上传的图片在发送时顺手生成 320px webp 存进 `thumbs` 表（`prepareThumbnails`）
- 列表读缩略图；老附件第一次显示时用原件补生成一次并落库，之后不再碰原图
- 点图片打开查看层（`.viewer`）时才读原件，关闭即 `revokeObjectURL`
- 数据库版本 12 → 13，**只新增 `thumbs` 一张表**，会话与附件原件不动；
  删除会话时随原件一起清理（仅当没有其他会话引用）

### 2. 置顶与归档

- `types.ts`：`Session` / `SessionSummary` 增加 `pinned` 与 `archivedAt`（都是可选字段，
  老数据没有字段即视为未置顶、未归档，不需要迁移）
- `db.ts`：`setSessionFlags()` 原子更新详情与列表摘要；`store.ts`：`pinSession()` / `archiveSession()`，
  排序改为「置顶优先，其余按 updatedAt」
- `SessionItem` 菜单增加置顶/取消置顶、归档/取消归档；置顶项标题前带一个小图钉
- 侧栏底部出现「已归档（N）」入口，点进去只看归档会话，再点返回主列表

### 3. 单条会话导出（`services/chat/exportSession.ts`）

整库 ZIP 是给程序看的备份，这里导出的是「能发出去的东西」：

- **Markdown**：`## 我` / `## DeepSeek` 交替，正文原样保留
- **HTML**：单文件、不引任何外部资源，排版与代码块样式内联，浅色/深色跟随系统；
  公式按 LaTeX 原文显示（不引 KaTeX，保证离线也能看）；图片附件只留一行说明
- 思考过程不导出；`[citation:N]` 角标去掉（导出文件里没有来源卡片）
- 生成过程用分段生成器，每 400 段让出一次主线程，1.3 万条消息的会话导出时界面不假死

### 验证

真实数据 45 个会话全部导出成功（HTML 合计 25.7MB，无 `<script>` 泄漏）；
最大会话 13323 条 → 11.4MB，桌面约 4 秒。`npx tsc --noEmit`、`oxlint`、生产构建均通过。

---

## 十三、第五轮：附件与上下文容量

### 背景：接口真实限制（api-docs.deepseek.com）

上下文窗口 1M token，最大输出 384K；单次请求最多引用 **20 个文档**、文档正文合计 ≤ 8 MiB；
PDF/Word/PPT 单文件 ≤ 100 MiB、≤ 1000 页；纯文本与表格原件 ≤ 32 MiB、转出文本 ≤ 8 MiB；
图片单请求 ≤ 600 张、单张折算 ≤ 1024 token。**接口不支持代码执行**。

### 1. 附件不再跨轮无限重发（`services/chat/reply.ts`）

原来历史里每一轮的附件都会重新拼成 document 块。每轮带 3 个文件，到第 7 轮就是 21 个，
触发 400 且此后每一轮都失败，会话等于废掉。现在：

- `FILE_ROUND_LIMIT = 2`：只有最近 2 轮继续携带附件
- `MAX_DOC_BLOCKS = 20`：从本轮提问往前分配文档额度，放不下的轮次不带附件
- 被移出上下文的轮次改为一行文字说明（「此前附带的 N 个附件已不在本次上下文中…」），
  模型不会误以为那轮本来就没有文件

### 2. 单条消息文档数上限（`services/attachments.ts`）

`MAX_COUNT = 50` 是 Files API 的账号文件数语义，不是单次请求的文档上限。
新增 `MAX_DOCUMENTS = 20`，`validateFiles` 按「已有文档数 + 本次新增」校验，图片不计入。

### 3. 容量类 400 中文化（`services/api/errors.ts`、`services/chat/describe.ts`）

`getRequestLimitInfo(status, message)` 识别「文档过多 / 文档正文超 8 MiB / 超出上下文窗口」，
分别给中文说明和处理建议；其余 400 仍按服务端原文展示。

### 4. 上下文预算 4 万 → 20 万（`DEFAULT_CONTEXT_TOKENS`）

原值是按 64K 窗口留的。窗口实际 1M，20 万约两成，长会话不再频繁丢历史；
历史前缀命中缓存的部分按 1/50 计价。预算里额外计入图片 token（单张按上限 1024 估）。

### 5. 每轮 token 用量可见（`AssistantMessage`）

`usage` 本来就随回复保存，这里在操作按钮后加一行小字「输入 12.3k · 输出 1.2k」，
数据来自 `message_start` / `message_delta`，不发额外请求。

### 6. CSV / TSV 本地数据摘要（`src/services/csvProfile.ts`）

模型不能跑统计，把整张表塞进上下文既贵又会超限。上传时在本地先算一遍：

- 只读文件开头 2 MB（`slice`），最多 2 万行、40 列，内存有界；实测 4MB 文件约 70ms
- 自动判断分隔符（comma / tab / semicolon）、UTF-8 与 **GBK**（Excel 导出的中文 CSV）
- 数值列给出缺失数、最小/下四分位/中位/上四分位/最大、均值、标准差；文本列给出取值数与前三高频
- 摘要作为文本块紧跟文件块发送；**文件超过 2 MB 时只发摘要 + 前 60 行样本**，
  因为完整文件必然超出 1M token，模型拿不到也读不完
- 摘要只存在内存（`Map`，上限 20 份），不写库、不进归档，导入的历史没有摘要

### 验证

合成会话与真实格式 CSV 全量断言通过：5 轮各带 2 个附件时文档块总数 6（≤20）、
更早 3 轮留下说明；单轮 20 个文档时恰好 20；500 行中文 CSV 的行数、分位数正确；
2.3MB CSV 判定为抽样且带 60 行样本；抽样附件不再发送文件块。
`npx tsc --noEmit`、`oxlint`、生产构建均通过；主包 486 → 493 KB。

---

## 十四、第六轮：让缓存命中（省 token 与首字延迟）

### 问题：长会话几乎每轮都按「未命中」付费

DeepSeek 的上下文硬盘缓存按**前缀**匹配，命中价约为未命中的 1/50
（V4.1-Flash 峰时：命中 $0.006/M，未命中 $0.30/M，输出 $1.20/M；谷时全部减半）。
原来的实现有两处让前缀每轮都变：

1. `buildSystemPrompt(droppedRounds)` 把**轮数**写进系统提示。系统提示在请求最前面，
   数字一变，整段前缀全部失配。长会话 `droppedRounds` 每轮 +1，等于每轮全灭。
2. 上下文裁剪从末尾往前精确装到预算上限，起点随新增内容每轮前移一位——
   保留轮数看着恒定，实际每次丢掉的是"最老的一轮"，前缀头部一直在动。

### 1. 系统提示不再带变量（`services/chat/store.ts`）

改成固定文案 `TRIMMED_NOTE`，只在首次发生裁剪时切换一次（之后恒定）：

```ts
const buildSystemPrompt = (droppedRounds: number) =>
  droppedRounds > 0 ? `${SYSTEM_PROMPT}${TRIMMED_NOTE}` : SYSTEM_PROMPT
```

模型只需要知道"更早的对话被省略了"，具体轮数没有信息价值。

### 2. 裁剪加锚点，一次多丢一些（`services/chat/reply.ts`）

`toRequestMessages` 多两个参数：`anchor`（上次保留的第一条消息 id）与返回值里的 `anchor`。
策略：

- 锚点仍在、且连同本轮一起仍在 `budget` 内 → **完全不动起点**，前缀逐轮只追加；
- 沿用锚点会超预算 → 从末尾往前装到 `budget × TRIM_TO_RATIO`（0.6），
  一次多丢 40%，换来之后十几轮起点不动；
- 锚点对不上（消息被删改、换分支、导入了历史）→ 按当前历史重算，不影响正确性。

锚点存在 `Session.contextAnchor`（可选字段，不需要升 IndexedDB 版本），
由 `streamReply` 写回；值没变时不写，避免无谓落盘。

**合成验证**（20 轮历史、预算 2 万、每轮约 2.7k token）：

| 策略 | 40 轮里前缀变化次数 |
| --- | --- |
| 旧：每轮精确裁到预算 | 23（第 18 轮起每轮都变） |
| 新：锚点 + 裁到 60% | 1（第 29 轮重裁一次，之后稳定） |

### 3. 每轮显示缓存命中率与估算费用（`services/pricing.ts`）

`usage` 里本来就有 `cache_read_input_tokens` 与 `cache_creation_input_tokens`，
这里换算成「输入 12.3k · 缓存 92% · 输出 1.2k · 约 ¥0.04」。
费用按刊例价估算（峰谷按 UTC 周一至周五 01–04、06–10 判断，即北京时间 09–12、14–18），
汇率按 7.1，只作量级参考。**这个百分比就是判断优化是否生效的仪表盘**：
长会话第二轮起应稳定在 85% 以上，若长期接近 0，说明前缀又被什么变量打散了。

### 4. 图片上传前缩小（`services/thumbs.ts`）

手机原图 4000px、几百 KB 到几 MB，直接上传既慢又占服务端存储。
`shrinkForUpload` 把长边缩到 2048 的 webp（质量 0.9），小于 700KB 的图不动；
本机原件不改，点开看大图仍是原样。失败就按原图上传。

### 验证

`npx tsc --noEmit`、`oxlint`、生产构建均通过；产物 `main.d0c95ff1.js`（495 KB）。
锚点逻辑用编译后的真实模块跑了 40 轮合成会话，上表数据即来自该脚本。

---

## 十五、附件回执：确认文件真的送进去了

用户不开深度思考时，会怀疑模型有没有读文件。这里给出可点开的证据，不发额外请求：

- `AssistantMessage.attachedFileNames`：在 `streamReply` 里从本轮实际构建的提问快照写入，
  回答下方显示「已发送 N 个附件」，点开可看文件名；
- `citations`：服务端本来就随 `content_block_delta` 下发 `citations_delta`，之前只用于网页来源编号。
  现在同时收集到回执里，点开可看模型引用的原文片段（最多 8 条）；
- `SYSTEM_PROMPT` 追加一句「回答若依据用户上传的文件，请简要说明依据的是哪份文件」，
  文案固定，不破坏缓存前缀；
- 深度思考开关的提示明确写出「关闭它不影响附件读取」。

**判断文件有没有被读的三种证据**（都不需要开深度模式）：
① 回执里的文件名 = 本轮请求确实带了它；
② 引用片段 = 服务端确认引用了该文件；
③ 用量行的输入 token 明显变大 = 文件正文进入了上下文。
回答没有引用标记不代表没读——模型只在需要逐字引用时才会标注。

### 本轮取舍

- 用户平时不发 CSV（数据处理走 agent），**「表格只发摘要」不做**，保留原件 + 本地摘要的现状。
- **上下文预算分档不做**：缓存命中后 20 万 token 输入约 ¥0.008，分档省不下多少；
  切换档位反而会让锚点重算、缓存失效一次。真正的费用大头是输出，而用户已默认关闭深度思考。
- ~~附件跟随轮数维持 2 轮~~ → 见下节，已改成按文件身份去重、长期留在上下文。

### 验证

`npx tsc --noEmit`、`oxlint`、生产构建通过；产物 `main.5bacaa19.js` / `main.1b0543da.css`。

---

## 十六、附件按文件去重：连续追问同一课件不会丢文件

### 问题

按轮数限制（原来只跟最近 2 轮）在「上传一次课件、后面十轮都在追问它」的场景下是错的：
第 3 轮起文件就从请求里消失，模型只能看到一句"此前附带过一个文件"。

### 做法（`services/chat/reply.ts`）

文件身份用 `name + size + isImage` 识别（每次选文件都会生成新的本地 id，不能拿 id 判重）。

1. 扫一遍**全部历史 + 本轮提问**，按身份记下每份文件最早出现的那条；
2. 只有"自己就是最早那一份"的轮次才挂文件块；重复上传同名同大小的文件不再挂第二个块；
3. 最早那次上传被上下文裁剪移出窗口时，把文件块补到窗口第一轮——课件不能凭空消失；
4. 文档块仍受 20 个上限约束，图片不计；真放不下的才改成文字说明；
5. `toUserParam` 第二参从 `withFiles: boolean` 改为 `sendFiles: FileAttachment[]`，
   只有确实被数量上限排除的文件才写"已不在本次上下文"，重复上传的文件不再误报丢失。

**好处不只是"看得到"**：文件块固定在首次出现的轮次、位置不变，
服务端按前缀匹配的缓存能一直命中，追问同一课件时那部分输入按 1/50 计价。

### 验证

编译后真实模块跑 4 个场景：上传一次连续追问 10 轮 → 每轮恰好 1 个文档块且 file_id 不变；
重复上传同一课件 → 仍 1 个块且沿用首次的 file_id；首次轮次被裁掉 → 补位后仍有 1 个块；
一次传 25 个文档 → 恰好 20 个块并有超限说明。`tsc`、`oxlint`、构建通过。

产物更新为 `main.045eb0c2.js`（CSS 未变）。**仍未发布**。

---

## 十六、手动分组：把相关对话放一起并取名

用户场景：一节课有好几个同主题 PPT。此前"一个课件一个会话"的建议容易被误解成
"一个主题只能开一个会话"，其实省钱的真正要求是**同一份文件的追问留在同一个会话里**
（换会话 = 缓存冷启动）。多个课件本来就适合多个会话，只是需要一层手动归类。

### 实现

- `services/chat/collections.ts`：分组定义 `{id, name, createdAt}` 存 localStorage
  （和设置一致，版本更新不丢）；会话只多一个可选字段 `collectionId`。
  分组改名不碰任何会话，因此**不影响服务端缓存前缀**。
- `types.ts` / `db.ts` / `store.ts`：`SessionSummary` 带上 `collectionId`；
  `setSessionFlags` 复用置顶/归档那套原子写回，新增 `moveSessionToCollection`、
  `createCollection`、`renameCollection`、`deleteCollection`。删组时只清对话上的组 id，
  对话正文、附件、历史全部保留；`updatedAt` 不变，排序不跳。
- `sider/Sider.tsx`：搜索框下新增横向分组条（全部 / 未分组 / 自定义组 / ＋ / 管理）。
  点组名筛选；＋ 新建组（可选把当前对话放进去）；管理里改名、删除（二次确认）。
- `sider/SessionItem.tsx`：菜单新增「移到分组…」，弹窗直接选组或现场建组；
  列表标题后显示组名小标签；「全部」视图也能一眼看出对话属于哪组。

### 为什么不写进 IndexedDB

分组只有几十字节，localStorage 同步读写更简单；与已有设置的存储方式一致。
即使分组丢失，对话本身完全不受影响（只是退回未分组）。

---

## 十七、分组文件夹化、滚动条预览、按组继承解释风格

### 1. 分组从「标签筛选」改为「文件夹」

用户的反馈：点组名只是筛选，列表还是按时间排，感觉分组只是标签，没有"点进去"的感觉。
现在侧边栏按 **置顶 → 各分组 → 未分组** 排列，每组标题整行可点，带箭头与数量，展开/收起状态存 localStorage。
空组也显示，便于往里放对话。时间分组（今天/昨天/按月）去掉，因为一级已经是分组。
搜索结果视图不受影响。

### 2. 桌面端滚动条预览

`MessageList` 在桌面端监听鼠标到消息区右边缘的距离（≤18px），浮出「最近提问」目录：
列出当前渲染窗口里最近 24 条用户提问（截断 44 字），点击滚到对应消息，当前视口中的那条高亮。
只在桌面端渲染，不读整库、不发请求；`UserMessage` 根节点加 `data-outline-id` 作为锚点。

### 3. 解释风格按分组继承（代码层，不靠提示词）

用户痛点：习惯某个课件对话的解释风格，换会话要重新调；不同学科风格还不一样。
做法不是让用户写提示词，而是**直接从对话里摘样例**：

- 会话菜单新增「把本对话风格存为本组模板」：取该会话最早两轮问答
  （问题截 800 字、回答截 3000 字）存进所属分组的 `styleSeed`（localStorage，最多两轮）。
- `toRequestMessages` 新增 `styleSeed` 参数：样例以 user/assistant 消息对放在所有历史之前，
  每轮固定不变，既是少样本示范，也是稳定缓存前缀；样例 token 计入上下文预算。
- 请求时按会话的 `collectionId` 查所属组的模板，所以**统计学组和英语组各自用自己的风格**。
- 「开启新对话」自动沿用最近所在分组，换课件时风格模板自动带上；不在组里则不会乱套用。
- 对话没有被移入分组时会提示先分组，而不是静默失败。

验证（编译后的真实模块）：A/B 两个不同样例产生不同前缀；样例位于历史之前；
历史消息数量与无样例时一致，只多两条样例消息。`tsc`、`oxlint` 全过。
