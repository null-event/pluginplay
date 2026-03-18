# pluginplay

CTF challenge for security research into VS Code plugins. This project implements a C2 infrastructure disguised as a VS Code extension, used as a benchmark to test security controls.

## Architecture

```
[VS Code Extension] --WSS:443--> [Nginx TLS Proxy] --HTTP:3000--> [WebSocket Server] <--WSS:443-- [Operator CLI]
```

| Component | Path | Description |
|---|---|---|
| **devcontainer-support** | `devcontainer-support/` | Malicious VS Code extension (the implant) |
| **wsserver** | `wsserver/` | Node.js Socket.IO C2 server |
| **operator** | `operator/` | Python CLI for controlling bots |
| **https-server** | `https-server/` | Nginx reverse proxy with TLS termination |

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [Node.js](https://nodejs.org/) (for building the extension)
- Python 3 (for the operator CLI)
- VS Code (for installing/testing the extension)

## Setup

### 1. Start the C2 infrastructure

```bash
docker-compose up --build
```

This starts two containers:
- **nginserver** — Nginx TLS proxy on port 443
- **wsserver** — Socket.IO server on port 3000 (bound to localhost only)

Self-signed TLS certs are included in `https-server/config/certs/`.

### 2. Build and install the VS Code extension

```bash
cd devcontainer-support
npm install
npx @vscode/vsce package
```

This produces `devcontainer-support-0.0.1.vsix`. Install it in VS Code:

```bash
code --install-extension devcontainer-support-0.0.1.vsix
```

The extension activates automatically on VS Code startup and connects to `wss://localhost:443`.

### 3. Run the operator CLI

Install Python dependencies:

```bash
pip install python-socketio[client] requests termcolor
```

Start the operator:

```bash
cd operator
python main.py
```

Connect to the C2 server from the operator prompt:

```
(shell) connect https://localhost:443
```

## Operator Commands

| Command | Description | Example |
|---|---|---|
| `connect <url>` | Connect to the C2 server | `connect https://localhost:443` |
| `bots` | List all registered bots | `bots` |
| `info <bot_id>` | Show details for a bot | `info a1b2c3d4` |
| `use <bot_id>` | Select a bot for commands | `use a1b2c3d4` |
| `shell <cmd>` | Run a shell command on the selected bot | `shell whoami` |
| `mass <cmd>` | Run a shell command on all bots | `mass id` |
| `upload <local> <remote>` | Upload a local file to the bot | `upload ./payload.sh /tmp/p.sh` |
| `download <remote>` | Download a file from the bot to the server | `download /etc/hostname` |
| `files` | List files downloaded to the server | `files` |
| `get <file_id> <local>` | Save a server-stored file locally | `get 0 /tmp/out.txt` |
| `kill <bot_id>` | Remove bot persistence and disconnect it | `kill a1b2c3d4` |
| `spread` | Copy extension to other installed IDEs on the bot | `spread` |
| `persist` | Install macOS LaunchAgent for startup persistence | `persist` |
| `poison [path]` | Drop extension recommendations into git repos | `poison /Users/victim/Code` |
| `exit` | Quit the operator | `exit` |

### Persistence Commands

**`spread`** — Discovers other VS Code-compatible IDEs on the bot (Cursor, VSCodium, Windsurf, Positron) and copies the extension into each. Skips the IDE it's already running in.

**`persist`** — macOS only. Backs up the extension to `~/.cache/.vscode-ext/`, then installs a LaunchAgent (`com.microsoft.vscode.helper`) that restores the extension from backup if removed and opens VS Code at login.

**`poison`** — Scans common development directories for git repos and drops `.vscode/extensions.json` recommending the malicious extension. When a developer opens a poisoned repo, VS Code prompts them to install the extension. Optionally accepts a target directory; otherwise scans `~/Code`, `~/Projects`, `~/src`, `~/dev`, `~/repos`, `~/workspace`, `~/git`, and `~/Documents`.

## Project Structure

```
pluginplay/
  docker-compose.yml          # Orchestrates nginx + wsserver
  https-server/
    Dockerfile                # Nginx image with TLS certs
    config/
      default.conf            # Nginx WSS proxy config
      certs/                  # Self-signed TLS certificate and key
  wsserver/
    Dockerfile                # Node.js C2 server image
    index.js                  # C2 routing logic
  devcontainer-support/
    extension-dev.js          # Readable (unobfuscated) extension source
    extension.js              # Obfuscated production payload
    package.json              # VS Code extension manifest
  operator/
    main.py                   # Operator CLI
```

## Teardown

```bash
docker-compose down
code --uninstall-extension f5247a15-38ab-4aaf-9a59-ca641efeef1e.devcontainer-support
```
