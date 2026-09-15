# Alma Status Publisher

<div align="center">

**Schedule WhatsApp status updates across every number you own.**

Link 5, 10, 50 WhatsApp numbers — compose once — Alma pushes your text, image, or video status to all of them on schedule.

`Windows` · `macOS` · `Next.js` · `Electron` · `shadcn/ui` · `open-wa` · `العربية / English`

</div>

---

## Why

Posting the same status on many WhatsApp numbers by hand is slow and easy to forget. Alma turns it into a set-and-forget routine: link your numbers once, build a schedule, and the desktop app publishes on time to every connected number — with a full delivery history and retries.

## Features

- **Multi-number linking** — run as many WhatsApp accounts as you need, each a lightweight protocol session (Baileys WebSocket — no browser). Link via **QR** or **pairing code**.
- **Scheduled statuses** — text (with background/color/font styling), images, and videos with captions.
- **Recurrence** — one-shot, daily, or weekly on selected days; timezone-aware using your machine's local time.
- **Push to all or selected numbers** — target every linked number or hand-pick per post.
- **Run now** — fire any schedule immediately.
- **Delivery history** — per-number results (sent / failed / skipped) with automatic retries (30 s → 2 min backoff) and one-click manual retry.
- **Resilience** — missed runs fire on startup within a 15-minute grace window; stale one-shots are flagged instead of silently dropped.
- **Live session monitoring** — connection state per number with auto-recovery, and logged-out detection that tells you exactly which number needs relinking.
- **Light & dark themes**, full **RTL Arabic** + English UI, **IBM Plex Sans Arabic** typography.
- **Clean Architecture** — domain, application, infrastructure, and presentation layers with the dependency rule enforced by structure.

## Screenshots

> Add screenshots here after first run.

## How linking works

Alma uses [Baileys](https://github.com/WhiskeySockets/Baileys) — the WhatsApp multi-device WebSocket protocol — directly. Each linked number is a lightweight protocol session (~50 MB RAM, no browser); session credentials are stored locally in your user-data folder and never leave your machine.

1. Open **Numbers → Link a number**, give it a name.
2. Scan the QR with the phone (WhatsApp → Settings → Linked devices), or enter the pairing code.
3. The number turns **Connected**. Repeat for as many numbers as you like — **Show QR** reopens a live QR for any number.
4. Create a schedule in **Scheduler**, pick content + timing + targets.
5. Alma publishes on time. Watch results live in **History**.

> **Note:** your machine must be online for statuses to publish — the phone linked to each number must also be reachable.

## Development

```bash
# 1. install
npm install

# 2. run the desktop app in dev mode (Next dev + esbuild watch + Electron)
npm run dev

# 3. verify everything
npm run typecheck   # renderer + electron-main strict typecheck
npm run lint
npm run build       # static renderer export + electron bundle
```

### Packaging

```bash
npm run dist:mac    # DMG + ZIP (arm64 + x64) into release/
npm run dist:win    # NSIS installer (x64) — run on Windows or CI
```

## Architecture

```
src/
├── core/                     # ── Enterprise & application logic (zero deps) ──
│   ├── domain/
│   │   ├── entities/         # WhatsAppSession, ScheduledPost, PostLog, MediaAsset
│   │   ├── services/         # ScheduleCalculator (pure time math)
│   │   └── errors.ts         # AppError taxonomy (stable codes → i18n)
│   └── application/
│       ├── ports/            # Repository / Gateway / Clock / EventBus interfaces
│       └── use-cases/        # StartLinking, PublishSchedule, SchedulerTick, …
├── infrastructure/           # ── Adapters ──
│   ├── persistence/          # Atomic JSON stores + repositories
│   ├── whatsapp/             # Baileys protocol gateway (multi-session)
│   └── system/               # Clock, EventBus, IDs, MediaFileStore
├── presentation/             # ── UI (React 19 + Tailwind 4 + shadcn/ui) ──
│   ├── components/           # App shell, QR dialog, schedule dialog…
│   ├── providers/            # Live data store over the IPC bridge
│   └── i18n/                 # en/ar dictionaries, RTL
├── app/                      # Next.js routes (dashboard, numbers, scheduler, …)
└── shared/                   # Renderer↔main contract (view models + bridge)

electron/                     # ── Process shell ──
├── main.ts                   # Lifecycle, window, crash guards
├── bootstrap.ts              # Composition root (the only place that wires it all)
├── ipc.ts                    # Typed command handlers + error envelopes
├── preload.ts                # contextBridge API
└── static-server.ts          # localhost-only server for the renderer + media
```

**Dependency rule:** `core` depends on nothing. `infrastructure` implements `core` ports. `electron` composes. The renderer only knows `shared/` and talks over the typed bridge.

## Error handling & resilience

- Every IPC failure crosses the bridge as `{ code, message, messageKey }` and is translated in the UI — raw stack traces never reach users.
- Publish pipeline: per-number logs, bounded retries with backoff, unrecoverable failures (logged out, media missing) short-circuit.
- Scheduler survives sleep/quit: due runs tick every 30 s, missed one-shots fire within a grace window, stale ones are surfaced, interrupted rows are cleaned up.
- Session lifecycle is a state machine (`initializing → awaiting_qr → connecting → connected`, plus `qr_expired / logged_out / disconnected`) driven by open-wa events and client hooks.
- JSON persistence uses atomic tmp-file + rename writes with a `.bak` recovery path.
- The main process traps `uncaughtException` / `unhandledRejection` and keeps running.

## Privacy

- WhatsApp session credentials, media, schedules, and logs stay **on your machine** (`userData` folder, viewable from Settings).
- No telemetry, no cloud, no accounts.

## License

MIT — see [LICENSE](LICENSE).

---

Built with ❤️ using the [Baileys](https://github.com/WhiskeySockets/Baileys) protocol library. Use responsibly and in accordance with WhatsApp's terms of service.
