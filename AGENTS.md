# Repository Guidelines

## Project Structure & Module Organization

Server Nest is a Windows desktop application built with React, Vite, and Tauri.

- `src/main.tsx` contains the React UI and Tauri command calls.
- `src/styles.css` holds the application styles.
- `src-tauri/src/lib.rs` owns server profiles, process lifecycle, logs, health checks, and tray behavior.
- `src-tauri/src/main.rs` is the native entry point.
- `src-tauri/capabilities/` defines Tauri permissions; `src-tauri/icons/` contains icons.
- Build output belongs in `dist/` and `src-tauri/target/`; do not commit it.

Keep UI code in `src/` and platform/process code in `src-tauri/`. Do not expose filesystem or process behavior directly from React.

## Build, Test, and Development Commands

```powershell
npm install                 # Install JavaScript dependencies
npm run dev                 # Run the Vite frontend only
npm run build               # Type-check TypeScript and build dist/
npm run tauri dev           # Run the full desktop app with hot reload
cd src-tauri; cargo check   # Compile-check Rust backend quickly
npx tauri build --no-bundle # Create the release executable without an installer
```

Run `npm run build` and `cargo check` before opening a pull request.

## Coding Style & Naming Conventions

Use TypeScript with strict typing; indent TypeScript, JSON, and CSS with two spaces. Use `camelCase` for TypeScript variables/functions, `PascalCase` for React components and types, and descriptive command names such as `start_server`.

Use Rust's standard formatting (`cargo fmt`), four-space indentation, `snake_case` for functions/fields, and `PascalCase` for structs. Keep Tauri commands thin: validate and orchestrate in Rust, and return serializable data structures to the UI.

## Testing Guidelines

No automated test framework is configured yet. At minimum, validate every change with `npm run build` and `cargo check`. For process-management changes, manually verify start, stop, restart, natural exit, tray close, and log capture using a harmless local server. Add focused unit tests for new complex non-UI Rust logic.

## Commit & Pull Request Guidelines

The existing history uses Conventional Commit-style messages, for example `feat: add local server manager desktop app`. Follow `type: imperative summary`, using `feat`, `fix`, `docs`, `refactor`, or `chore`.

Keep commits scoped. Pull requests should explain the user-visible change, list verification commands, link related issues when available, and include screenshots for UI or tray-flow changes.

## Security & Configuration

Treat server commands and environment variables as sensitive local inputs. Never commit credentials, machine-specific paths, logs, or the persisted `servers.json` file. Preserve hidden-window process creation on Windows and stop only processes owned by this app.
