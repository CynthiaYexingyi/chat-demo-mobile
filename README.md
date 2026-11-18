# chat-demo-mobile

[简体中文](README.zh-CN.md) | English

A **mobile-first, performance-tuned fork** of [DeepSeek's official chat-demo](https://github.com/deepseek-ai/chat-demo) (v0.1.1). The upstream project is an excellent static chat UI; this fork keeps its MIT license and its no-backend design, and focuses on something the demos don't cover: **what happens after you actually use it every day with hundreds of long conversations and large attachments**.

[Live demo](https://cynthiaexingyi.github.io/chat-demo-mobile/) · [What changed and why](DEVELOP.md) · [MIT](LICENSE)

> This is an unofficial community fork. It is not affiliated with or endorsed by DeepSeek. You supply your own API key; requests go from your browser straight to the API service you configure (default `https://api.deepseek.com`).

## Why this fork exists

The official demo is a starting point. In real use, a few things start to hurt: a 20-million-character conversation makes the page stutter; full-text search blocks the UI; every round re-sends old attachments until the API returns 400; cache prefixes break every turn so you pay full price; there is no offline support on a phone.

This fork fixes those specifically, and writes up the reasoning and measurements in [DEVELOP.md](DEVELOP.md) rather than just shipping the code.

## Highlights

**Performance on long conversations**
- Search runs in a Web Worker with a **per-session bigram Bloom bitmap**. 1.12 MB of bitmaps for 45 conversations; index built in 2.1 s on desktop; zero false negatives across 11 test keywords (`searchIndex/`).
- Search hits jump to the exact message — even one buried 165 "load earlier" clicks deep.
- The message list renders only the **last 80 messages** with a "load earlier" control; scroll height is compensated so there is no jump.
- Mermaid diagrams no longer redraw on every streaming chunk.

**Cost and context**
- Fixed two cache-prefix bugs: a changing number in the system prompt, and re-cutting context at the exact budget every round. In a 40-round simulation, prefix changes dropped from **23 to 1** — cached input is billed at roughly 1/50 of a miss.
- Attachments are de-duplicated **by file identity**, not by round. Asking five follow-ups about the same deck keeps the file in context instead of dropping it after two rounds; document blocks are still capped at the API's limit of 20.
- Per-reply display of token usage, cache-hit rate and estimated cost (peak/off-peak pricing in CNY).
- CSV/TSV files are profiled locally (first 2 MB / 20k rows, GBK fallback) and summarized instead of being sent whole and overflowing the context.

**Mobile and offline**
- PWA with a Service Worker: app shell cached, network-first for navigation, cache-first for hashed assets, cross-origin requests untouched. Installable on a home screen.
- Thumbnails (320 px WebP) generated locally; full images are only decoded when opened.
- API origin is user-configurable in Settings, so you can point it at a gateway or an OpenAI/Anthropic-compatible service.

**Organization**
- Manual collections (folders) with pinning/archiving, collapsible groups, and per-group style templates — pick example Q&A rounds from a conversation and have new chats in that group inherit the tone.
- Single-conversation export to Markdown or a self-contained HTML file.
- Attachment receipts: see which files were actually sent and where they were cited.

## Run locally

Requires Node.js 22.12+ and pnpm.

```sh
git clone https://github.com/CynthiaYexingyi/chat-demo-mobile.git
cd chat-demo-mobile
pnpm install
pnpm dev
```

Open http://localhost:8090 and enter your API key in Settings.

```sh
pnpm build    # static output in dist/
pnpm type     # TypeScript check
pnpm lint     # oxlint
```

`dist/` is a plain static site — GitHub Pages, Netlify, any CDN, or open `dist/index.html` directly (local files need browser storage and CORS support). Relative paths and a scope-aware Service Worker mean subpath deployments work without configuration.

## Privacy and data

There is no backend. Your API key lives in browser local storage; conversations and original attachments live in IndexedDB; the Service Worker cache only holds app files. Data is isolated per site origin, so a different domain means a fresh start — use Settings → History import/export to move conversations. Exports include conversation text and local image originals, but never the API key. See the [upstream README](README.zh-CN.md) for the full data model.

## License

MIT, inherited from DeepSeek's chat-demo. The original copyright notice is preserved in [LICENSE](LICENSE).
