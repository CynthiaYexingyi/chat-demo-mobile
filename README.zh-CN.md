# chat-demo-mobile

[English](README.md) | 简体中文

基于 [DeepSeek 官方 chat-demo](https://github.com/deepseek-ai/chat-demo) v0.1.1 的**手机优先、性能向**改造版。上游是一个很优秀的静态聊天界面；本 fork 沿用它的 MIT 协议与无后端设计，专攻官方 demo 没覆盖的场景：**当你真的天天在用、攒下几百个长会话和大附件之后会发生什么**。

[在线体验](https://cynthiaexingyi.github.io/chat-demo-mobile/) · [改造过程与实测数据](DEVELOP.md) · [MIT](LICENSE)

> 非官方社区 fork，与 DeepSeek 官方无关联。需自行填写 API Key；请求从你的浏览器直连你配置的 API 服务（默认 `https://api.deepseek.com`）。

## 为什么有这个 fork

官方 demo 是起点。真正长期使用会遇到这些问题：两千万字的会话让页面卡顿；全文搜索阻塞界面；历史附件每轮重复发送直到接口报 400；缓存前缀每轮失效导致按原价付费；手机上没有离线能力。

本 fork 逐条解决，并把思路和实测写进 [DEVELOP.md](DEVELOP.md)，而不只是丢一份改完的代码。

## 亮点

**长会话性能**
- 搜索搬进 Web Worker，配**会话级双字布隆位图**。45 个会话合计 1.12 MB 位图，桌面建索引 2.1 秒，11 个关键词零漏检（`searchIndex/`）。
- 搜索命中可跳到具体那条消息——哪怕它藏在 165 次「加载更早」之后。
- 消息列表只渲染**末尾 80 条**并提供「加载更早」，补偿滚动高度，无跳动。
- Mermaid 图表流式阶段不再逐块重绘。

**费用与上下文**
- 修掉两处缓存前缀失效：系统提示里的变化数字、每轮精确裁到预算上限。40 轮模拟中前缀变化从 **23 次降到 1 次**——命中缓存的输入按未命中的约 1/50 计价。
- 附件**按文件身份去重**，不按轮数。连续追问同一份课件五轮，文件始终在上下文里；文档块仍遵守接口上限 20 个。
- 每条回复显示 token 用量、缓存命中率与估算费用（人民币，区分峰谷）。
- CSV/TSV 本地画像（前 2 MB / 2 万行，GBK 回退），发摘要而非整文件，避免撑爆上下文。

**手机与离线**
- PWA + Service Worker：应用外壳缓存，导航请求网络优先、带哈希的静态资源缓存优先，跨域请求一律不接管。可添加到主屏幕。
- 本地生成 320px WebP 缩略图，点开才解码原图。
- API 地址可在设置里改，可指向自建网关或其他兼容服务。

**组织**
- 手动分组（文件夹）、置顶/归档、分组折叠；分组可保存风格范例，新对话自动沿用该组的解释风格。
- 单条会话导出 Markdown 或单文件 HTML（内联样式、无外部依赖）。
- 附件回执：看到底发了哪些文件、被引用在哪里。

## 本地运行

需要 Node.js 22.12+ 与 pnpm。

```sh
git clone https://github.com/CynthiaYexingyi/chat-demo-mobile.git
cd chat-demo-mobile
pnpm install
pnpm dev
```

打开 http://localhost:8090 ，在设置里填 API Key。

```sh
pnpm build    # 静态产物在 dist/
pnpm type     # TypeScript 检查
pnpm lint     # oxlint
```

`dist/` 是纯静态站点——GitHub Pages、Netlify、任意 CDN 均可，也可直接打开 `dist/index.html`（本地文件需浏览器允许存储与跨域）。相对路径 + 按 scope 定位的 Service Worker 让子路径部署无需额外配置。

## 隐私与数据

没有后端。API Key 存在浏览器本地存储，会话与附件原件在 IndexedDB，Service Worker 缓存只放应用文件。数据按站点源隔离——换域名等于全新开始，用「设置 → 历史导入导出」搬运会话。导出包含会话正文与本地图片原件，**不含 API Key**。完整数据模型见[上游说明](README.zh-CN.md)。

## 许可证

MIT，继承自 DeepSeek 的 chat-demo，原始版权声明保留在 [LICENSE](LICENSE)。
