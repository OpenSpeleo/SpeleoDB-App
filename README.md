# SpeleoDB

A mobile-first speleology database app built with **Ionic**, **React**, **Capacitor**, and **Tailwind CSS**.

## Tech Stack

| Layer       | Technology                          |
| ----------- | ----------------------------------- |
| Framework   | Ionic 8 + React 19                  |
| Styling     | Tailwind CSS 3.4                    |
| Bundler     | Vite 7                              |
| Native      | Capacitor 8 (iOS)                   |
| Tests       | Vitest (unit) / Cypress (e2e)       |
| Linting     | ESLint 9                            |

## Prerequisites

- **Node.js** >= 18 (managed via [nvm](https://github.com/nvm-sh/nvm) recommended)
- **npm**
- **Xcode** (for iOS builds) with Command Line Tools installed
- **Ionic CLI** -- `npm install -g @ionic/cli`
- *(optional)* [xcbeautify](https://github.com/cpisciotta/xcbeautify) for prettier xcodebuild output

## Getting Started

```bash
# Clone the repo
git clone <repo-url> && cd SpeleoDB-App

# Install dependencies
make install

# Start the dev server
make dev
```

Open [http://localhost:8100](http://localhost:8100) in your browser.

## Sentry Configuration

This app uses `@sentry/capacitor` with strict per-platform DSN bundling.

1. Copy `.env.dist` to `.env`.
2. Set:
   - `SENTRY_DSN_IOS`
   - `SENTRY_DSN_ANDROID`
3. Build from Xcode or Android Studio as usual.

Native pre-build hooks regenerate web assets before compile and inject the
platform-specific DSN into `VITE_SENTRY_DSN`, so iOS and Android builds do not
share the same DSN in their bundled web assets.

If Node is not available in your IDE build environment, set `NODE_BINARY` to
your Node executable path (or launch the IDE from a shell where Node is on
`PATH`).

## Make Targets

Run `make help` to see all targets. Here is the full reference:

### Web Development

| Command        | Description                        |
| -------------- | ---------------------------------- |
| `make install` | Install npm dependencies           |
| `make dev`     | Start Vite dev server (live reload)|
| `make build`   | Build the web app for production   |
| `make clean`   | Remove `dist/`, `build/`, Vite cache |
| `make lint`    | Run ESLint                         |

### Testing

| Command          | Description                    |
| ---------------- | ------------------------------ |
| `make test`      | Run unit tests (Vitest)        |
| `make test.e2e`  | Run end-to-end tests (Cypress) |

### Capacitor

| Command          | Description                              |
| ---------------- | ---------------------------------------- |
| `make sync`      | Build web app + sync to iOS native project |
| `make cap-doctor` | Run Capacitor doctor diagnostics        |

### iOS -- Build & Run from the Terminal

These targets let you build, install, and run the iOS app **entirely from Cursor/VSCode** without opening Xcode.

| Command              | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `make ios-sim`       | **Full pipeline**: build web + sync + compile + boot simulator + install + launch |
| `make ios-sim-run`   | Re-install + launch on simulator (skip rebuild, uses last build) |
| `make ios-build`     | Build the iOS app (Debug) via `xcodebuild`                   |
| `make ios-release`   | Build the iOS app (Release) via `xcodebuild`                 |
| `make ios-sim-boot`  | Boot the iOS simulator                                       |
| `make ios-sim-shutdown` | Shutdown all running simulators                           |
| `make ios-device`    | Build + target a connected physical device                   |
| `make ios-live`      | Live-reload on iOS simulator (Ionic + Capacitor)             |
| `make ios-log`       | Stream app logs from the booted simulator                    |
| `make ios-open`      | Open the project in Xcode                                    |

### Choosing a Simulator

The default simulator is **iPhone 16 Pro**. Override it with the `SIMULATOR` variable:

```bash
make ios-sim SIMULATOR="iPhone 17 Pro Max"
```

### Typical Workflows

**First run (or after pulling changes):**

```bash
make install
make ios-sim
```

**Quick iteration (web changes only):**

```bash
make ios-sim-run        # re-deploy last native build with new web assets
```

**Live reload during development:**

```bash
make ios-live           # auto-refreshes on file save
```

**Debug logs:**

```bash
make ios-log            # in a separate terminal
```

## Project Structure

```
SpeleoDB-App/
├── src/                  # React source code
│   ├── pages/            # Page components
│   ├── components/       # Shared components
│   ├── index.css         # Tailwind directives + global styles
│   └── App.tsx           # Root component & routing
├── ios/                  # Native iOS project (Capacitor)
│   └── App/
│       ├── App.xcodeproj
│       └── App/
├── capacitor.config.ts   # Capacitor configuration
├── tailwind.config.js    # Tailwind CSS configuration
├── postcss.config.js     # PostCSS configuration
├── vite.config.ts        # Vite bundler configuration
├── Makefile              # Build & run targets
└── package.json
```

## License

TBD
