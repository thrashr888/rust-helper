# Rust Helper

A macOS app for managing multiple Rust projects. Scan your workspace, clean build artifacts, check dependencies, run audits, and monitor project health—all from one place.

## Features

- **Project Discovery** - Auto-scan `~/Workspace` for Rust projects, add others manually
- **Build Cleanup** - View `target/` sizes, clean all or debug-only builds, see space reclaimed
- **Dependency Management** - Check outdated deps across projects, optionally update Cargo.toml
- **Security Audits** - Run `cargo audit` across all projects, view vulnerabilities by severity
- **Health Checks** - Run `cargo fmt --check`, `cargo clippy`, `cargo test` per-project or globally
- **Dependency Analysis** - Find most-used crates, version mismatches, alignment opportunities
- **Toolchain Consistency** - Compare `rust-toolchain.toml` across projects, check MSRV
- **License Compliance** - Aggregate license usage, flag problematic licenses
- **Auto-Refresh** - Background monitoring with notifications for new issues

## Tech Stack

**Frontend:**
- React 19
- Vite 7
- TypeScript
- Phosphor Icons

**Backend (Tauri):**
- Tauri v2
- tokio (async runtime)
- walkdir (directory scanning)
- serde/serde_json (serialization)
- anyhow (error handling)

## Prerequisites

- Rust (1.70+)
- Node.js (20+)
- Cargo tools:
  ```bash
  cargo install cargo-outdated cargo-audit cargo-license
  ```

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run tauri dev

# Build for production
npm run tauri build
```

## Architecture

```
rust-helper/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # React hooks for Tauri commands
│   └── App.tsx             # Main app layout
├── src-tauri/
│   ├── src/
│   │   ├── main.rs         # Tauri entry point
│   │   ├── commands/       # Tauri commands (IPC handlers)
│   │   │   ├── discover.rs # Project scanning
│   │   │   ├── clean.rs    # Build artifact cleanup
│   │   │   ├── deps.rs     # Dependency checking
│   │   │   ├── audit.rs    # Security audits
│   │   │   └── health.rs   # Health checks
│   │   └── lib.rs          # Library exports
│   └── Cargo.toml
└── package.json
```

## How It Works

1. **Scan** - Recursively searches directories for `Cargo.toml` files
2. **Index** - Parses each project's manifest, extracts metadata (name, version, deps)
3. **Analyze** - Runs cargo subcommands in parallel across projects
4. **Report** - Aggregates results and displays in the UI
5. **Act** - User can clean, update, or run checks from the UI

## Project Tracking

This project uses [beads](https://github.com/thrashr888/beads) for issue tracking:

```bash
bd list              # View all tasks
bd ready             # See what's ready to work on
bd show <id>         # View task details
```

## License

MIT
