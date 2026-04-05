# Terminal AI Error Agent — Complete Build Specification

> **Purpose of this document:** This is a fully self-contained agent prompt / engineering spec. Pass this entire file to a coding agent (e.g. Claude, GPT-4, Cursor, Aider) and it will have everything needed to build the terminal AI error agent end-to-end — architecture, schemas, code templates, file structure, roadmap, and deployment instructions.

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [How It Works — User Flow](#2-how-it-works--user-flow)
3. [Repository Structure](#3-repository-structure)
4. [Technology Stack](#4-technology-stack)
5. [Phase-by-Phase Roadmap](#5-phase-by-phase-roadmap)
6. [Component Specifications](#6-component-specifications)
   - 6.1 [Shell Hook](#61-shell-hook)
   - 6.2 [Daemon (Agent Core)](#62-daemon-agent-core)
   - 6.3 [Context Collector](#63-context-collector)
   - 6.4 [Prompt Builder](#64-prompt-builder)
   - 6.5 [LLM Client](#65-llm-client)
   - 6.6 [Response Parser](#66-response-parser)
   - 6.7 [Approval Gate](#67-approval-gate)
   - 6.8 [File Patcher](#68-file-patcher)
7. [Memory Architecture](#7-memory-architecture)
   - 7.1 [Vector DB Schema (ChromaDB)](#71-vector-db-schema-chromadb)
   - 7.2 [Session Log Schema (SQLite)](#72-session-log-schema-sqlite)
   - 7.3 [LMCache Integration](#73-lmcache-integration)
   - 7.4 [Write-back Logic](#74-write-back-logic)
8. [Hugging Face Agentic Layer (smolagents)](#8-hugging-face-agentic-layer-smolagents)
   - 8.1 [Custom Tools](#81-custom-tools)
   - 8.2 [Agent Initialization](#82-agent-initialization)
   - 8.3 [ReAct Loop Explained](#83-react-loop-explained)
9. [Model Recommendations](#9-model-recommendations)
10. [Fine-Tuning Loop](#10-fine-tuning-loop)
11. [vLLM + LMCache Server Config](#11-vllm--lmcache-server-config)
12. [Team Deployment](#12-team-deployment)
13. [Safety Rules](#13-safety-rules)
14. [Environment Variables & Config](#14-environment-variables--config)
15. [Testing Strategy](#15-testing-strategy)
16. [Agent Instructions](#16-agent-instructions)

---

## 1. Product Overview

Build a **terminal AI error agent** that intercepts every failed shell command in real time, reads the file the user was working on, understands the error context, and proposes (or automatically applies) a fix — all without the user leaving their terminal.

### Core capabilities

- Intercepts any non-zero exit code from any shell (bash, zsh, fish)
- Reads the file mentioned in the error path automatically
- Sends error + file context to a local or remote LLM
- Retrieves similar past fixes from a vector database (few-shot)
- Proposes a unified diff and shell commands as fixes
- Applies fixes with user approval (or auto-applies with confidence threshold)
- Learns over time: every successful fix is stored and reused
- Multi-step reasoning via Hugging Face `smolagents` (ReAct loop)
- Fine-tunes itself on collected error/fix pairs using QLoRA

### What it is NOT

- Not a chatbot. It runs silently in the background.
- Not cloud-dependent. Fully local inference via vLLM + ollama.
- Not destructive. Every file edit creates a `.bak` backup first.

---

## 2. How It Works — User Flow

```
User runs: python app.py
→ Exit code: 1
→ stderr: ModuleNotFoundError: No module named 'fastapi'

Shell hook fires (trap ERR / precmd)
→ Captures: command, stderr, cwd, file_path

Daemon receives payload over Unix socket
→ Context collector reads app.py (±20 lines around error)
→ Error classifier: "ModuleNotFoundError" → likely pip install fix
→ Vector DB query: find top-3 similar past fixes

Prompt builder assembles:
  [system prompt] + [file content] + [error] + [3 past fixes as few-shot]

LMCache checks: has this prompt prefix been computed before?
  → HIT: skip prefill, return cached KV → ~0.3s response
  → MISS: full vLLM inference → ~2-4s response, KV saved for next time

smolagents CodeAgent reasons in ReAct loop:
  Think: "ModuleNotFoundError — I should check imports and suggest pip install"
  Act:   search_past_fixes("ModuleNotFoundError fastapi")
  Observe: [past fix: "pip install fastapi==0.104.1"]
  Think: "Confirmed. Apply shell fix."
  Act:   propose_fix(command="pip install fastapi==0.104.1")

Approval gate prints colored diff in terminal:
  → User presses y → fix applied
  → User presses n → skipped, logged
  → Auto-approved if confidence > 0.95 and fix_type = shell_command

File patcher applies diff (creates .bak first)
Shell runner executes shell command fix
Retry: re-runs original command

Session logger writes outcome to SQLite
If fix_success = True → embed error and write to ChromaDB vector DB
```

---

## 3. Repository Structure

```
terminal-agent/
├── shell/
│   ├── hook.bash              # bash trap ERR + PROMPT_COMMAND hook
│   ├── hook.zsh               # zsh add-zsh-hook precmd hook
│   ├── hook.fish              # fish function on_exit hook
│   └── install.sh             # appends hook to ~/.bashrc / ~/.zshrc / config.fish
│
├── agent/
│   ├── __init__.py
│   ├── daemon.py              # asyncio Unix socket server — main entry point
│   ├── context.py             # stderr parser, file reader, path extractor, error classifier
│   ├── prompt.py              # prompt builder with few-shot injection
│   ├── llm.py                 # LLM client (OpenAI-compat, works with vLLM/ollama/HF Endpoints)
│   ├── parser.py              # response parser: extract diff, shell cmd, explanation
│   ├── approval.py            # terminal UI: colored diff display, y/n prompt
│   ├── patcher.py             # unified diff applier with .bak backup
│   ├── runner.py              # shell command executor with timeout
│   └── logger.py              # SQLite session logger
│
├── memory/
│   ├── __init__.py
│   ├── vectordb.py            # ChromaDB client, embed, add, query
│   ├── embedder.py            # sentence-transformers embedding wrapper
│   └── writeback.py           # promotion logic: SQLite → ChromaDB on success
│
├── agentic/
│   ├── __init__.py
│   ├── agent.py               # smolagents CodeAgent initialization
│   └── tools/
│       ├── __init__.py
│       ├── file_reader.py     # @tool: read file at path
│       ├── patcher_tool.py    # @tool: apply unified diff
│       ├── shell_tool.py      # @tool: run shell command, return exit code
│       ├── vector_search.py   # @tool: query ChromaDB for similar fixes
│       └── web_search.py      # @tool: DuckDuckGo fallback for unknown errors
│
├── models/
│   ├── serve.sh               # starts vLLM server with LMCache and LoRA adapter
│   ├── lmcache_config.yaml    # LMCache storage tier configuration
│   └── pull_model.sh          # downloads model from HF Hub via huggingface-cli
│
├── finetune/
│   ├── export_sft.py          # exports SQLite session log → JSONL for SFTTrainer
│   ├── train.py               # QLoRA fine-tuning with trl SFTTrainer
│   └── push_adapter.py        # pushes trained LoRA adapter to HF Hub
│
├── tests/
│   ├── fixtures/              # sample .py, .ts, .rs files with known errors
│   ├── test_context.py
│   ├── test_prompt.py
│   ├── test_patcher.py
│   └── test_agent.py
│
├── config.yaml                # main config: model endpoint, auto-approve threshold, ignored paths
├── requirements.txt
└── README.md
```

---

## 4. Technology Stack

| Layer | Technology | Purpose |
|---|---|---|
| Shell integration | bash/zsh/fish hooks | Intercept non-zero exits |
| Daemon | Python `asyncio`, Unix socket | Low-latency background process |
| Embedding | `sentence-transformers` (`all-MiniLM-L6-v2`) | Embed errors for vector search |
| Vector DB | `chromadb` (local) or `pgvector` (team) | Semantic fix memory |
| Session log | `sqlite3` (local) or `postgresql` (team) | Audit log + fine-tuning data |
| Inference server | `vllm` | Fast model serving, LoRA support |
| KV cache | `lmcache` | 3-10x TTFT reduction on repeated prompts |
| Agentic reasoning | `smolagents` (Hugging Face) | ReAct loop, tool use, multi-step |
| Models | `Qwen2.5-Coder-7B-Instruct` (default) | Code error understanding |
| Fine-tuning | `trl` + `peft` (QLoRA) | Adapt model to your codebase |
| Model registry | Hugging Face Hub | Version and serve LoRA adapters |
| Terminal UI | `rich` | Colored diff display, spinners |

---

## 5. Phase-by-Phase Roadmap

### Phase 0 — Foundation (Week 1)

**Goal:** Dev environment working, hook fires, row appears in SQLite.

Tasks:
- Install Python 3.11+, create virtualenv, install requirements
- Install `ollama`, pull `qwen2.5-coder:7b` for local testing without GPU
- Set up repo structure as defined in Section 3
- Write simplest possible hook: `echo "$?" >> /tmp/agent_test.log`
- Verify hook fires on a bad command
- Create SQLite DB with session log schema (Section 7.2)
- Write a script that reads `/tmp/agent_test.log` and inserts a row

**Done when:** `python app.py` (broken) → row appears in SQLite within 1 second.

---

### Phase 1 — Core MVP (Weeks 2–3)

**Goal:** Agent proposes a real fix in the terminal.

Tasks:
- Build daemon as `asyncio` Unix socket server (`agent/daemon.py`)
- Update shell hook to send JSON payload to daemon socket (not log file)
- Build context collector: parse stderr for file paths, read ±20 lines
- Build error classifier: regex rules for `ModuleNotFoundError`, `SyntaxError`, `FileNotFoundError`, `PermissionError`, `command not found`
- Build prompt builder (no few-shot yet): system + error + file snippet
- Integrate `ollama` via OpenAI-compat API (`http://localhost:11434/v1`)
- Build response parser: extract `<fix_command>`, `<fix_diff>`, `<explanation>`
- Build approval gate: print colored diff with `rich`, prompt y/n
- Build file patcher: write `.bak`, apply unified diff with `python-patch`
- Build shell runner: `subprocess.run` with 30s timeout
- Wire everything together in `daemon.py`

**Done when:** Break a Python file intentionally → agent proposes correct fix → press y → retry succeeds.

---

### Phase 2 — Memory Layer (Weeks 4–5)

**Goal:** Agent retrieves similar past fixes and uses them as few-shot examples.

Tasks:
- Install `chromadb`, `sentence-transformers`
- Implement ChromaDB schema (Section 7.1): collection, embedding fn, metadata fields
- Implement `memory/vectordb.py`: `add_fix()`, `query_similar()`, `upsert_fix()`
- Implement `memory/embedder.py`: wrap `all-MiniLM-L6-v2`
- Wire vector DB query into prompt builder: top-3 similar fixes as few-shot
- Implement write-back: after `fix_success = True`, call `add_fix()`
- Switch inference from `ollama` to `vLLM`:
  - Install `vllm`, download `Qwen2.5-Coder-7B-Instruct` from HF Hub
  - Start vLLM server (see Section 11)
- Install `lmcache`, add LMCache config to vLLM server command
- Verify KV cache hit on repeated similar errors

**Done when:** Same error type fired twice → second response is noticeably faster (LMCache hit) + fix includes a relevant past example.

---

### Phase 3 — HF Agentic Layer (Weeks 6–7)

**Goal:** Multi-step reasoning agent that can handle cascading and complex errors.

Tasks:
- Install `smolagents`
- Implement all four custom tools (Section 8.1)
- Initialize `CodeAgent` with tools and local vLLM endpoint (Section 8.2)
- Replace single-shot LLM call in daemon with `agent.run(error_prompt)`
- Add `web_search` tool as fallback for unknown errors
- Add `ManagedAgent` structure for language-specialist routing (Python, Rust, JS, Docker)
- Test multi-step scenario: cascading import errors, environment issues

**Done when:** Agent autonomously: reads file → queries vector DB → proposes fix → runs retry → confirms success, without a single-shot prompt.

---

### Phase 4 — Fine-Tuning Loop (Weeks 8–10)

**Goal:** Model specialized to your codebase. Measurably better fix accuracy.

Tasks:
- Verify ≥500 `fix_success = True` rows in SQLite
- Implement `finetune/export_sft.py`: exports to JSONL instruction format
- Implement `finetune/train.py`: QLoRA with `trl` SFTTrainer (Section 10)
- Run first fine-tuning job (needs 1x 16GB GPU or use HF AutoTrain)
- Push adapter to HF Hub with `finetune/push_adapter.py`
- Update vLLM server to load LoRA adapter (Section 11)
- Run eval harness on `tests/fixtures/` to measure improvement
- Set up weekly cron job to auto-retrain when 100 new successful sessions accumulate

**Done when:** Fine-tuned adapter measurably outperforms base model on your fixture test suite.

---

### Phase 5 — Team Rollout (Weeks 11–12)

**Goal:** Every developer on the team has it installed and sharing fixes.

Tasks:
- Move vLLM + LMCache server to shared GPU machine
- Move ChromaDB to `pgvector` on shared Postgres (Section 7.1 note)
- Add API key auth to daemon config (simple shared secret in `config.yaml`)
- Write `shell/install.sh` that:
  - Adds hook to `~/.bashrc` and `~/.zshrc`
  - Writes `~/.terminal-agent/config.yaml` pointing at shared server
  - Installs daemon as `systemd --user` service
  - Runs `systemctl --user start terminal-agent`
- Add `ignored_paths` list: `/etc`, `~/.ssh`, `**/secrets/**`, `.env`
- Set up Prometheus + Grafana for monitoring (latency, cache hit rate, fix success rate)
- Write internal docs / onboarding guide

**Done when:** `curl -sSL https://your-internal/install.sh | bash` installs and works on a fresh machine.

---

### Phase 6 — Advanced Features (Ongoing)

- Multi-agent orchestration: coordinator routes to Python/Rust/JS/Docker specialist sub-agents
- VS Code extension: listens on same daemon socket, shows fixes inline
- RLHF feedback: use accept/reject signals as reward for preference training
- Eval CI: auto-run fixture tests on every new adapter before deploying
- Model versioning: tag adapters with semantic versions, rollback on regression
- Streaming responses: stream fix tokens to terminal as they generate

---

## 6. Component Specifications

### 6.1 Shell Hook

**File:** `shell/hook.bash`

```bash
#!/usr/bin/env bash

_terminal_agent_hook() {
    local exit_code=$?
    local last_cmd
    last_cmd=$(history 1 | sed 's/^[ ]*[0-9]*[ ]*//')

    if [ "$exit_code" -ne 0 ] && [ -n "$last_cmd" ]; then
        local payload
        payload=$(python3 -c "
import json, sys, os
print(json.dumps({
    'command': '''$last_cmd''',
    'exit_code': $exit_code,
    'cwd': os.getcwd(),
    'stderr': open('/tmp/terminal_agent_stderr.tmp').read() if os.path.exists('/tmp/terminal_agent_stderr.tmp') else ''
}))
")
        # Send to daemon socket asynchronously
        echo "$payload" | socat - UNIX-CONNECT:/tmp/terminal-agent.sock &
    fi
}

# Capture stderr to temp file for every command
exec 2> >(tee /tmp/terminal_agent_stderr.tmp >&2)

PROMPT_COMMAND="_terminal_agent_hook; $PROMPT_COMMAND"
```

**File:** `shell/hook.zsh`

```zsh
#!/usr/bin/env zsh

_terminal_agent_precmd() {
    local exit_code=$?
    local last_cmd="${history[$HISTCMD]}"

    if [[ $exit_code -ne 0 ]] && [[ -n "$last_cmd" ]]; then
        local stderr_content=""
        [[ -f /tmp/terminal_agent_stderr.tmp ]] && stderr_content=$(cat /tmp/terminal_agent_stderr.tmp)

        python3 -c "
import json, socket, os
payload = json.dumps({
    'command': '''${last_cmd//\'/\'\\\'\'}\''',
    'exit_code': $exit_code,
    'cwd': '${PWD}',
    'stderr': '''${stderr_content//\'/\'\\\'\'}'''
})
try:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.connect('/tmp/terminal-agent.sock')
    s.sendall(payload.encode())
    s.close()
except: pass
" &
    fi
}

exec 2> >(tee /tmp/terminal_agent_stderr.tmp >&2)
autoload -Uz add-zsh-hook
add-zsh-hook precmd _terminal_agent_precmd
```

**File:** `shell/install.sh`

```bash
#!/usr/bin/env bash
set -e

echo "Installing terminal-agent shell hooks..."

HOOK_BASH='source ~/.terminal-agent/hook.bash'
HOOK_ZSH='source ~/.terminal-agent/hook.zsh'

mkdir -p ~/.terminal-agent
cp shell/hook.bash ~/.terminal-agent/hook.bash
cp shell/hook.zsh ~/.terminal-agent/hook.zsh

# Bash
if [ -f ~/.bashrc ] && ! grep -q "terminal-agent" ~/.bashrc; then
    echo "$HOOK_BASH" >> ~/.bashrc
    echo "Added bash hook to ~/.bashrc"
fi

# Zsh
if [ -f ~/.zshrc ] && ! grep -q "terminal-agent" ~/.zshrc; then
    echo "$HOOK_ZSH" >> ~/.zshrc
    echo "Added zsh hook to ~/.zshrc"
fi

# Install daemon as systemd user service
mkdir -p ~/.config/systemd/user
cat > ~/.config/systemd/user/terminal-agent.service <<EOF
[Unit]
Description=Terminal AI Error Agent Daemon

[Service]
ExecStart=$(which python3) $(pwd)/agent/daemon.py
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable terminal-agent
systemctl --user start terminal-agent

echo "Done. Restart your shell or run: source ~/.bashrc"
```

---

### 6.2 Daemon (Agent Core)

**File:** `agent/daemon.py`

```python
import asyncio
import json
import logging
import signal
from pathlib import Path

from agent.context import ContextCollector
from agent.prompt import PromptBuilder
from agent.llm import LLMClient
from agent.parser import ResponseParser
from agent.approval import ApprovalGate
from agent.patcher import FilePatcher
from agent.runner import ShellRunner
from agent.logger import SessionLogger
from memory.vectordb import VectorDB
from agentic.agent import build_agent

SOCKET_PATH = "/tmp/terminal-agent.sock"
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger(__name__)


async def handle_error(payload: dict):
    session_id = SessionLogger.new_id()
    logger = SessionLogger()
    collector = ContextCollector()
    vector_db = VectorDB()

    try:
        # 1. Collect context
        context = collector.collect(payload)
        logger.write(session_id, context)

        # 2. Quick rule-based check (no LLM needed for obvious cases)
        quick_fix = collector.classify_quick(context)
        if quick_fix:
            ApprovalGate.show_and_apply(quick_fix, context, session_id, logger)
            return

        # 3. Vector DB lookup
        similar_fixes = vector_db.query_similar(
            stderr=context["stderr"],
            command=context["command"],
            language=context["language"],
            k=3
        )

        # 4. Build prompt
        prompt = PromptBuilder.build(context, similar_fixes)

        # 5. Run agentic reasoning (smolagents ReAct loop)
        agent = build_agent()
        fix_result = agent.run(prompt)

        # 6. Parse response
        parsed = ResponseParser.parse(fix_result)
        logger.update(session_id, {"model_output": fix_result, "parsed": parsed})

        # 7. Approval gate
        ApprovalGate.show_and_apply(parsed, context, session_id, logger, vector_db)

    except Exception as e:
        log.error(f"Agent error: {e}", exc_info=True)
        logger.update(session_id, {"failure_reason": str(e)})


async def handle_client(reader, writer):
    try:
        data = await asyncio.wait_for(reader.read(65536), timeout=5.0)
        payload = json.loads(data.decode())
        asyncio.create_task(handle_error(payload))
    except Exception as e:
        log.error(f"Socket error: {e}")
    finally:
        writer.close()


async def main():
    socket_path = Path(SOCKET_PATH)
    if socket_path.exists():
        socket_path.unlink()

    server = await asyncio.start_unix_server(handle_client, path=SOCKET_PATH)
    log.info(f"Terminal agent daemon started on {SOCKET_PATH}")

    loop = asyncio.get_event_loop()
    loop.add_signal_handler(signal.SIGTERM, server.close)

    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
```

---

### 6.3 Context Collector

**File:** `agent/context.py`

```python
import re
import os
from pathlib import Path

IGNORED_PATHS = ["/etc", os.path.expanduser("~/.ssh"), ".env", "secrets"]

ERROR_PATTERNS = {
    "ModuleNotFoundError": r"No module named '([^']+)'",
    "ImportError":         r"cannot import name '([^']+)'",
    "SyntaxError":         r"SyntaxError: (.+)",
    "FileNotFoundError":   r"No such file or directory: '([^']+)'",
    "PermissionError":     r"Permission denied: '([^']+)'",
    "TypeError":           r"TypeError: (.+)",
    "NameError":           r"NameError: name '([^']+)' is not defined",
    "CommandNotFound":     r"command not found: (.+)",
    "CompileError":        r"error\[E\d+\]",  # Rust
    "TSError":             r"TS\d+:",          # TypeScript
}

QUICK_FIXES = {
    "ModuleNotFoundError": lambda m, lang: f"pip install {m.group(1)}" if lang == "python" else None,
    "CommandNotFound":     lambda m, lang: f"# Install {m.group(1)} — check your package manager",
    "PermissionError":     lambda m, lang: f"chmod +x {m.group(1)}",
}

FILE_EXTENSIONS = {
    ".py": "python", ".ts": "typescript", ".js": "javascript",
    ".rs": "rust", ".go": "go", ".rb": "ruby", ".sh": "bash",
    ".cpp": "cpp", ".c": "c", ".java": "java",
}


class ContextCollector:

    def collect(self, payload: dict) -> dict:
        stderr = payload.get("stderr", "")
        command = payload.get("command", "")
        cwd = payload.get("cwd", os.getcwd())
        exit_code = payload.get("exit_code", 1)

        file_path = self._extract_file_path(stderr, command, cwd)
        file_content = self._read_file_snippet(file_path, stderr)
        error_type = self._detect_error_type(stderr)
        language = self._detect_language(file_path, command)

        return {
            "command": command,
            "stderr": stderr[:2000],  # cap at 2k chars
            "exit_code": exit_code,
            "cwd": cwd,
            "file_path": file_path,
            "file_content": file_content,
            "error_type": error_type,
            "language": language,
        }

    def classify_quick(self, context: dict) -> dict | None:
        """Rule-based fixes that don't need an LLM."""
        stderr = context["stderr"]
        language = context["language"]

        for error_type, pattern in ERROR_PATTERNS.items():
            match = re.search(pattern, stderr)
            if match and error_type in QUICK_FIXES:
                cmd = QUICK_FIXES[error_type](match, language)
                if cmd:
                    return {
                        "fix_type": "shell_command",
                        "fix_command": cmd,
                        "explanation": f"Detected {error_type}. Applying quick fix.",
                        "confidence": 0.99,
                    }
        return None

    def _extract_file_path(self, stderr: str, command: str, cwd: str) -> str | None:
        # Try to extract file path from stderr (e.g. "File 'app.py', line 14")
        patterns = [
            r'File "([^"]+\.(?:py|ts|js|rs|go|rb|sh))"',
            r"error in ([^\s]+\.(?:py|ts|js|rs|go|rb|sh))",
            r"([^\s]+\.(?:py|ts|js|rs|go|rb|sh)):\d+",
        ]
        for p in patterns:
            m = re.search(p, stderr)
            if m:
                path = m.group(1)
                if not os.path.isabs(path):
                    path = os.path.join(cwd, path)
                if os.path.exists(path) and not self._is_ignored(path):
                    return path

        # Fall back: look at the command itself (e.g. "python app.py")
        parts = command.split()
        for part in parts:
            if "." in part and os.path.exists(os.path.join(cwd, part)):
                full = os.path.join(cwd, part)
                if not self._is_ignored(full):
                    return full
        return None

    def _read_file_snippet(self, file_path: str | None, stderr: str) -> str:
        if not file_path or not os.path.exists(file_path):
            return ""
        try:
            lines = Path(file_path).read_text().splitlines()
            # Try to center snippet on error line number
            line_no = self._extract_line_number(stderr)
            if line_no:
                start = max(0, line_no - 20)
                end = min(len(lines), line_no + 20)
            else:
                start, end = 0, min(40, len(lines))
            snippet = "\n".join(f"{i+1}: {l}" for i, l in enumerate(lines[start:end], start=start))
            return snippet
        except Exception:
            return ""

    def _extract_line_number(self, stderr: str) -> int | None:
        m = re.search(r"line (\d+)", stderr)
        return int(m.group(1)) if m else None

    def _detect_error_type(self, stderr: str) -> str:
        for error_type, pattern in ERROR_PATTERNS.items():
            if re.search(pattern, stderr):
                return error_type
        return "UnknownError"

    def _detect_language(self, file_path: str | None, command: str) -> str:
        if file_path:
            ext = Path(file_path).suffix
            if ext in FILE_EXTENSIONS:
                return FILE_EXTENSIONS[ext]
        for lang, cmd in [("python","python"), ("node","node"), ("rust","cargo"), ("go","go")]:
            if cmd in command:
                return lang
        return "unknown"

    def _is_ignored(self, path: str) -> bool:
        return any(ignored in path for ignored in IGNORED_PATHS)
```

---

### 6.4 Prompt Builder

**File:** `agent/prompt.py`

```python
SYSTEM_PROMPT = """You are an expert terminal error fixing agent.
You will be given:
1. The command that failed
2. The stderr output
3. Relevant file content around the error
4. Similar past fixes that worked (few-shot examples)

Your task:
- Identify the root cause precisely
- Propose a fix as a unified diff (for file changes) AND/OR a shell command
- Be concise — output ONLY the structured fix, no prose

Output format (use exactly these XML tags):
<explanation>One sentence root cause</explanation>
<fix_type>file_patch | shell_command | both</fix_type>
<fix_command>pip install fastapi</fix_command>
<fix_diff>
--- a/app.py
+++ b/app.py
@@ -1,3 +1,4 @@
+import os
 import sys
</fix_diff>
<confidence>0.0-1.0</confidence>
"""


class PromptBuilder:

    @staticmethod
    def build(context: dict, similar_fixes: list) -> str:
        parts = [SYSTEM_PROMPT, "\n---\n"]

        parts.append(f"**Command:** `{context['command']}`")
        parts.append(f"**Exit code:** {context['exit_code']}")
        parts.append(f"**Language:** {context['language']}")
        parts.append(f"**Error type:** {context['error_type']}")
        parts.append(f"\n**stderr:**\n```\n{context['stderr']}\n```")

        if context.get("file_content"):
            parts.append(f"\n**File ({context['file_path']}):**\n```{context['language']}\n{context['file_content']}\n```")

        if similar_fixes:
            parts.append("\n**Similar past fixes (use as guidance):**")
            for i, fix in enumerate(similar_fixes, 1):
                meta = fix["metadata"]
                parts.append(f"\n[Example {i}]")
                parts.append(f"Error: {meta.get('stderr','')[:200]}")
                if meta.get("fix_command"):
                    parts.append(f"Fix command: {meta['fix_command']}")
                if meta.get("fix_diff"):
                    parts.append(f"Fix diff:\n{meta['fix_diff'][:500]}")

        return "\n".join(parts)
```

---

### 6.5 LLM Client

**File:** `agent/llm.py`

```python
from openai import OpenAI
import yaml, os

def load_config():
    config_path = os.path.expanduser("~/.terminal-agent/config.yaml")
    if os.path.exists(config_path):
        return yaml.safe_load(open(config_path))
    return {}

config = load_config()

client = OpenAI(
    base_url=config.get("llm_endpoint", "http://localhost:8000/v1"),
    api_key=config.get("api_key", "not-needed-for-local"),
)

MODEL = config.get("model", "Qwen2.5-Coder-7B-Instruct")


def call_llm(prompt: str, max_tokens: int = 1024) -> str:
    response = client.chat.completions.create(
        model=MODEL,
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,
        temperature=0.1,   # low temp for deterministic fixes
    )
    return response.choices[0].message.content
```

---

### 6.6 Response Parser

**File:** `agent/parser.py`

```python
import re


class ResponseParser:

    @staticmethod
    def parse(text: str) -> dict:
        def extract(tag: str) -> str:
            m = re.search(rf"<{tag}>(.*?)</{tag}>", text, re.DOTALL)
            return m.group(1).strip() if m else ""

        confidence_raw = extract("confidence")
        try:
            confidence = float(confidence_raw)
        except ValueError:
            confidence = 0.5

        return {
            "explanation":   extract("explanation"),
            "fix_type":      extract("fix_type") or "shell_command",
            "fix_command":   extract("fix_command"),
            "fix_diff":      extract("fix_diff"),
            "confidence":    confidence,
        }
```

---

### 6.7 Approval Gate

**File:** `agent/approval.py`

```python
from rich.console import Console
from rich.syntax import Syntax
from rich.panel import Panel
from rich.prompt import Confirm

console = Console()

AUTO_APPROVE_THRESHOLD = 0.95
AUTO_APPROVE_TYPES = {"shell_command"}  # never auto-approve file patches


class ApprovalGate:

    @staticmethod
    def show_and_apply(parsed: dict, context: dict, session_id: str, logger, vector_db=None):
        from agent.patcher import FilePatcher
        from agent.runner import ShellRunner

        console.print(Panel(
            f"[bold cyan]Root cause:[/bold cyan] {parsed['explanation']}\n"
            f"[bold]Confidence:[/bold] {parsed['confidence']:.0%}",
            title="Terminal Agent Fix",
            border_style="cyan"
        ))

        if parsed.get("fix_diff"):
            console.print(Syntax(parsed["fix_diff"], "diff", theme="monokai"))

        if parsed.get("fix_command"):
            console.print(f"\n[bold yellow]Shell command:[/bold yellow] [green]{parsed['fix_command']}[/green]")

        # Auto-approve logic
        auto = (
            parsed["confidence"] >= AUTO_APPROVE_THRESHOLD
            and parsed["fix_type"] in AUTO_APPROVE_TYPES
        )

        if auto:
            console.print("[dim]Auto-approving (high confidence shell fix)...[/dim]")
            approved = True
        else:
            approved = Confirm.ask("Apply this fix?")

        fix_success = False
        if approved:
            if parsed.get("fix_diff") and context.get("file_path"):
                FilePatcher.apply(parsed["fix_diff"], context["file_path"])
            if parsed.get("fix_command"):
                ShellRunner.run(parsed["fix_command"])

            # Retry original command
            result = ShellRunner.run(context["command"])
            fix_success = result.returncode == 0

            if fix_success:
                console.print("[bold green]Fix worked![/bold green]")
            else:
                console.print("[bold red]Fix didn't resolve the error.[/bold red]")

        # Log outcome
        logger.update(session_id, {
            "fix_type": parsed["fix_type"],
            "fix_command": parsed.get("fix_command"),
            "fix_diff": parsed.get("fix_diff"),
            "approved_by": "auto" if auto else ("user" if approved else "skipped"),
            "retry_exit_code": result.returncode if approved else None,
            "fix_success": fix_success,
        })

        # Write-back to vector DB on success
        if fix_success and vector_db:
            from memory.writeback import promote_to_vector_db
            promote_to_vector_db(context, parsed, session_id, vector_db)
```

---

### 6.8 File Patcher

**File:** `agent/patcher.py`

```python
import shutil
import subprocess
from pathlib import Path


class FilePatcher:

    @staticmethod
    def apply(diff: str, file_path: str) -> bool:
        # Always create backup first
        backup = file_path + ".bak"
        shutil.copy2(file_path, backup)

        # Write diff to temp file
        diff_file = "/tmp/terminal_agent.patch"
        Path(diff_file).write_text(diff)

        try:
            result = subprocess.run(
                ["patch", "--no-backup-if-mismatch", file_path, diff_file],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode != 0:
                # Restore backup on failure
                shutil.copy2(backup, file_path)
                return False
            return True
        except Exception:
            shutil.copy2(backup, file_path)
            return False
```

---

## 7. Memory Architecture

### 7.1 Vector DB Schema (ChromaDB)

**File:** `memory/vectordb.py`

```python
import chromadb
from chromadb.utils import embedding_functions
from datetime import datetime, timezone
import uuid


COLLECTION_NAME = "error_fixes"
EMBEDDING_MODEL = "all-MiniLM-L6-v2"   # 384-dim, CPU-friendly


class VectorDB:

    def __init__(self, path: str = "~/.terminal-agent/vectordb"):
        import os
        self.client = chromadb.PersistentClient(path=os.path.expanduser(path))
        self.embed_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=EMBEDDING_MODEL
        )
        self.collection = self.client.get_or_create_collection(
            name=COLLECTION_NAME,
            embedding_function=self.embed_fn,
            metadata={"hnsw:space": "cosine"}
        )

    def _build_document(self, error: dict) -> str:
        """The string that gets embedded — must be semantically rich."""
        return (
            f"COMMAND: {error.get('command','')}\n"
            f"ERROR: {error.get('stderr','')[:800]}\n"
            f"LANGUAGE: {error.get('language','')}\n"
            f"ERROR_TYPE: {error.get('error_type','')}"
        ).strip()

    def add_fix(self, context: dict, fix: dict, session_id: str):
        doc = self._build_document(context)
        record_id = f"fix_{uuid.uuid4().hex[:8]}"
        now = datetime.now(timezone.utc).isoformat()

        self.collection.add(
            ids=[record_id],
            documents=[doc],
            metadatas=[{
                # Error context
                "command":       context.get("command", ""),
                "stderr":        context.get("stderr", "")[:500],
                "error_type":    context.get("error_type", ""),
                "language":      context.get("language", ""),
                "file_path":     context.get("file_path", "") or "",
                "file_ext":      context.get("file_ext", "") or "",
                "cwd":           context.get("cwd", ""),
                # Fix
                "fix_type":      fix.get("fix_type", ""),
                "fix_command":   fix.get("fix_command", "") or "",
                "fix_diff":      fix.get("fix_diff", "") or "",
                "fix_model":     fix.get("model", "unknown"),
                "confidence":    str(fix.get("confidence", 0.0)),
                # Outcome
                "fix_success":   True,
                "session_id":    session_id,
                # Bookkeeping
                "created_at":    now,
                "use_count":     1,
                "last_used_at":  now,
            }]
        )
        return record_id

    def query_similar(self, stderr: str, command: str, language: str, k: int = 3) -> list:
        query_doc = f"COMMAND: {command}\nERROR: {stderr[:800]}\nLANGUAGE: {language}"
        results = self.collection.query(
            query_texts=[query_doc],
            n_results=k,
            where={"fix_success": True},
            include=["documents", "metadatas", "distances"]
        )
        # Flatten results
        fixes = []
        for i, meta in enumerate(results["metadatas"][0]):
            fixes.append({
                "metadata": meta,
                "distance": results["distances"][0][i],
            })
        return fixes

    def upsert_use_count(self, record_id: str):
        """Increment use_count when a stored fix is reused."""
        existing = self.collection.get(ids=[record_id], include=["metadatas"])
        if existing["metadatas"]:
            meta = existing["metadatas"][0]
            meta["use_count"] = int(meta.get("use_count", 1)) + 1
            meta["last_used_at"] = datetime.now(timezone.utc).isoformat()
            self.collection.update(ids=[record_id], metadatas=[meta])
```

> **For team deployment:** Replace ChromaDB with `pgvector` on a shared Postgres instance. The `query_similar` interface stays identical — only the client changes. Use `pgvector` with `HNSW` index for fast approximate nearest-neighbor search at scale.

---

### 7.2 Session Log Schema (SQLite)

**File:** `agent/logger.py`

```python
import sqlite3
import uuid
import os
from datetime import datetime, timezone
from pathlib import Path


DB_PATH = os.path.expanduser("~/.terminal-agent/sessions.db")


CREATE_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS sessions (
    session_id          TEXT PRIMARY KEY,
    created_at          TEXT NOT NULL,

    -- error context
    command             TEXT NOT NULL,
    stderr              TEXT,
    exit_code           INTEGER,
    cwd                 TEXT,
    file_path           TEXT,
    file_content        TEXT,
    language            TEXT,
    error_type          TEXT,

    -- inference metadata
    model_used          TEXT,
    prompt_tokens       INTEGER,
    completion_tokens   INTEGER,
    latency_ms          INTEGER,
    lmcache_hit         INTEGER DEFAULT 0,
    vector_hits         INTEGER DEFAULT 0,

    -- fix applied
    fix_type            TEXT,
    fix_command         TEXT,
    fix_diff            TEXT,
    approved_by         TEXT,

    -- outcome
    retry_exit_code     INTEGER,
    fix_success         INTEGER,
    failure_reason      TEXT
);

CREATE INDEX IF NOT EXISTS idx_success  ON sessions (fix_success, created_at);
CREATE INDEX IF NOT EXISTS idx_language ON sessions (language, error_type);
"""


class SessionLogger:

    def __init__(self):
        Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(DB_PATH)
        self.conn.executescript(CREATE_TABLE_SQL)
        self.conn.commit()

    @staticmethod
    def new_id() -> str:
        return f"sess_{uuid.uuid4().hex[:8]}"

    def write(self, session_id: str, context: dict):
        self.conn.execute("""
            INSERT INTO sessions (session_id, created_at, command, stderr, exit_code,
                                  cwd, file_path, file_content, language, error_type)
            VALUES (?,?,?,?,?,?,?,?,?,?)
        """, (
            session_id,
            datetime.now(timezone.utc).isoformat(),
            context.get("command",""),
            context.get("stderr",""),
            context.get("exit_code", 1),
            context.get("cwd",""),
            context.get("file_path",""),
            context.get("file_content",""),
            context.get("language",""),
            context.get("error_type",""),
        ))
        self.conn.commit()

    def update(self, session_id: str, fields: dict):
        set_clause = ", ".join(f"{k} = ?" for k in fields)
        values = list(fields.values()) + [session_id]
        self.conn.execute(
            f"UPDATE sessions SET {set_clause} WHERE session_id = ?", values
        )
        self.conn.commit()
```

---

### 7.3 LMCache Integration

LMCache slots between your prompt and vLLM. It stores computed attention KV tensors so that if the same prompt prefix arrives again, vLLM skips re-computing prefill entirely.

**File:** `models/lmcache_config.yaml`

```yaml
# LMCache configuration
chunk_size: 256              # tokens per KV cache chunk
local_cpu:
  enabled: true
  max_size_gb: 8             # CPU RAM allocation for hot KV cache

local_disk:
  enabled: true
  path: ~/.terminal-agent/kvcache
  max_size_gb: 50            # Disk allocation for warm KV cache

remote_s3:
  enabled: false             # Enable for multi-node team deployment
  bucket: your-bucket
  prefix: terminal-agent/kvcache/

retrieval_priority:
  - local_cpu
  - local_disk
  - remote_s3
```

**When LMCache gives the biggest win for this agent:**

The system prompt + few-shot examples are identical for every error of the same type. For example, every `ModuleNotFoundError` in Python shares the same 400-token prefix. After the first developer hits this error and the KV cache is written to disk, every subsequent developer's query skips prefill entirely — response latency drops from ~3s to ~0.4s.

---

### 7.4 Write-back Logic

**File:** `memory/writeback.py`

```python
def should_promote(session: dict) -> bool:
    return (
        session.get("fix_success") == True
        and session.get("fix_type") != "skipped"
        and session.get("retry_exit_code") == 0
        and len(session.get("stderr", "")) > 10
    )


def promote_to_vector_db(context: dict, fix: dict, session_id: str, vector_db):
    """Called after fix_success = True is confirmed."""
    # Check if a near-identical fix already exists (cosine distance < 0.05)
    similar = vector_db.query_similar(
        stderr=context["stderr"],
        command=context["command"],
        language=context["language"],
        k=1
    )
    if similar and similar[0]["distance"] < 0.05:
        # Upsert: increment use_count on existing record
        # (extract id from metadata if stored, or skip)
        return

    # New fix: add to collection
    vector_db.add_fix(context, fix, session_id)
```

---

## 8. Hugging Face Agentic Layer (smolagents)

`smolagents` is the Hugging Face library for building reasoning agents. It implements the **ReAct loop**: the model alternates between Thought (reasoning), Action (calling a tool), and Observation (reading tool output) until it reaches a final answer.

For this agent, use `CodeAgent` — it writes Python code to call tools, which is more flexible than simple tool-call JSON for complex multi-step fixes.

### 8.1 Custom Tools

**File:** `agentic/tools/file_reader.py`

```python
from smolagents import tool
from pathlib import Path


@tool
def read_file(path: str) -> str:
    """
    Read the contents of a file at the given path.
    Use this to inspect the file that caused the error.

    Args:
        path: Absolute or relative path to the file.

    Returns:
        File contents as a string, or an error message.
    """
    try:
        return Path(path).read_text()
    except Exception as e:
        return f"Error reading file: {e}"
```

**File:** `agentic/tools/shell_tool.py`

```python
from smolagents import tool
import subprocess


ALLOWED_COMMANDS = ["pip", "npm", "cargo", "go", "chmod", "mkdir", "python", "node"]
TIMEOUT = 30


@tool
def run_shell(command: str) -> dict:
    """
    Run a shell command and return its output.
    Only use for safe operations: pip install, npm install, cargo build, chmod, etc.
    Do NOT use for destructive commands (rm -rf, etc.).

    Args:
        command: Shell command string to execute.

    Returns:
        Dict with stdout, stderr, and exit_code.
    """
    base_cmd = command.strip().split()[0]
    if base_cmd not in ALLOWED_COMMANDS:
        return {"stdout": "", "stderr": f"Command '{base_cmd}' not in allowed list.", "exit_code": 1}

    result = subprocess.run(
        command, shell=True, capture_output=True, text=True, timeout=TIMEOUT
    )
    return {
        "stdout": result.stdout[:2000],
        "stderr": result.stderr[:500],
        "exit_code": result.returncode,
    }
```

**File:** `agentic/tools/vector_search.py`

```python
from smolagents import tool
from memory.vectordb import VectorDB

_db = VectorDB()


@tool
def search_past_fixes(stderr: str, language: str = "python") -> list:
    """
    Search the vector database for similar past errors and their fixes.
    Use this before proposing any fix — it may have an exact solution.

    Args:
        stderr: The error message from the terminal.
        language: Programming language (python, javascript, rust, go, etc.)

    Returns:
        List of similar past fixes with fix_command and fix_diff fields.
    """
    results = _db.query_similar(stderr=stderr, command="", language=language, k=3)
    return [
        {
            "fix_command": r["metadata"].get("fix_command", ""),
            "fix_diff":    r["metadata"].get("fix_diff", ""),
            "error_type":  r["metadata"].get("error_type", ""),
            "similarity":  round(1 - r["distance"], 3),
        }
        for r in results
    ]
```

**File:** `agentic/tools/patcher_tool.py`

```python
from smolagents import tool
from agent.patcher import FilePatcher


@tool
def apply_patch(diff: str, file_path: str) -> bool:
    """
    Apply a unified diff patch to a file.
    Always creates a .bak backup before patching.

    Args:
        diff: Unified diff string (--- a/file / +++ b/file format).
        file_path: Absolute path to the file to patch.

    Returns:
        True if patch applied successfully, False otherwise.
    """
    return FilePatcher.apply(diff, file_path)
```

---

### 8.2 Agent Initialization

**File:** `agentic/agent.py`

```python
from smolagents import CodeAgent, HfApiModel, LiteLLMModel
import yaml, os

from agentic.tools.file_reader import read_file
from agentic.tools.shell_tool import run_shell
from agentic.tools.vector_search import search_past_fixes
from agentic.tools.patcher_tool import apply_patch


def load_config():
    config_path = os.path.expanduser("~/.terminal-agent/config.yaml")
    if os.path.exists(config_path):
        return yaml.safe_load(open(config_path))
    return {}


def build_agent() -> CodeAgent:
    config = load_config()
    endpoint = config.get("llm_endpoint", "http://localhost:8000/v1")

    # Use LiteLLMModel to point at local vLLM OpenAI-compat endpoint
    model = LiteLLMModel(
        model_id=f"openai/{config.get('model','Qwen2.5-Coder-7B-Instruct')}",
        api_base=endpoint,
        api_key=config.get("api_key", "not-needed"),
        temperature=0.1,
        max_tokens=1024,
    )

    agent = CodeAgent(
        tools=[read_file, run_shell, search_past_fixes, apply_patch],
        model=model,
        max_steps=6,           # max ReAct iterations before giving up
        verbosity_level=1,     # show reasoning steps in terminal
    )

    return agent
```

---

### 8.3 ReAct Loop Explained

When `agent.run(prompt)` is called, `smolagents` runs this loop internally:

```
Step 1 — Thought:
  "I should first search for similar past fixes before attempting anything."

Step 2 — Action:
  search_past_fixes(stderr="ModuleNotFoundError: No module named 'fastapi'", language="python")

Step 3 — Observation:
  [{"fix_command": "pip install fastapi==0.104.1", "similarity": 0.97}]

Step 4 — Thought:
  "High-confidence past fix found. I'll propose this shell command."

Step 5 — Action:
  final_answer({
    "explanation": "Missing fastapi package",
    "fix_type": "shell_command",
    "fix_command": "pip install fastapi==0.104.1",
    "confidence": 0.97
  })
```

For complex cascading errors, the agent may call `read_file` to inspect the file, `run_shell` to probe the environment (e.g. `pip list`), then propose a multi-part fix.

---

## 9. Model Recommendations

| Tier | Model | VRAM | Speed | Best for |
|---|---|---|---|---|
| GPU 16GB+ | `Qwen2.5-Coder-32B-Instruct` | 20GB (4-bit) | ~1-2s | Best accuracy, complex errors |
| GPU 8-12GB | `Qwen2.5-Coder-7B-Instruct` | 8GB | ~1-3s | Good balance — recommended default |
| GPU 6-8GB | `DeepSeek-Coder-6.7B-Instruct` | 6GB | ~1-2s | Alternative to Qwen 7B |
| CPU only | `Qwen2.5-Coder-3B-Instruct` (GGUF Q4) | 0 | ~4-8s | Laptop without GPU |
| No local GPU | HF Inference Endpoints | — | ~1-2s | Managed, pay-per-use |

**Download model:**

```bash
# Via huggingface-cli
huggingface-cli download Qwen/Qwen2.5-Coder-7B-Instruct \
  --local-dir ./models/Qwen2.5-Coder-7B-Instruct

# Or via ollama (easiest for local dev)
ollama pull qwen2.5-coder:7b
```

---

## 10. Fine-Tuning Loop

### Export training data

**File:** `finetune/export_sft.py`

```python
import sqlite3, json, os

DB_PATH = os.path.expanduser("~/.terminal-agent/sessions.db")

conn = sqlite3.connect(DB_PATH)
rows = conn.execute("""
    SELECT command, stderr, file_content, error_type, language,
           fix_type, fix_command, fix_diff
    FROM sessions
    WHERE fix_success = 1
    ORDER BY created_at DESC
""").fetchall()

output_path = "finetune/sft_data.jsonl"
with open(output_path, "w") as f:
    for row in rows:
        cmd, stderr, file_content, error_type, language, fix_type, fix_cmd, fix_diff = row
        instruction = (
            f"Fix this {language} terminal error.\n"
            f"COMMAND: {cmd}\n"
            f"STDERR: {stderr}\n"
        )
        if file_content:
            instruction += f"FILE:\n{file_content[:1000]}\n"

        output_parts = []
        if fix_cmd:
            output_parts.append(f"<fix_command>{fix_cmd}</fix_command>")
        if fix_diff:
            output_parts.append(f"<fix_diff>{fix_diff}</fix_diff>")

        f.write(json.dumps({"instruction": instruction, "output": "\n".join(output_parts)}) + "\n")

print(f"Exported {len(rows)} training pairs to {output_path}")
```

### QLoRA fine-tuning

**File:** `finetune/train.py`

```python
from transformers import AutoModelForCausalLM, AutoTokenizer
from trl import SFTTrainer, SFTConfig
from peft import LoraConfig, get_peft_model
from datasets import load_dataset
import torch

BASE_MODEL = "Qwen/Qwen2.5-Coder-7B-Instruct"
OUTPUT_DIR = "./finetune/adapter"
DATA_PATH  = "./finetune/sft_data.jsonl"

# Load model in 4-bit (QLoRA)
model = AutoModelForCausalLM.from_pretrained(
    BASE_MODEL,
    load_in_4bit=True,
    torch_dtype=torch.float16,
    device_map="auto",
)
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL)
tokenizer.pad_token = tokenizer.eos_token

# LoRA config
lora_config = LoraConfig(
    r=16,
    lora_alpha=32,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj"],
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
)

model = get_peft_model(model, lora_config)
model.print_trainable_parameters()  # should be ~0.5-1% of total params

# Dataset
def format_sample(sample):
    return f"### Instruction:\n{sample['instruction']}\n\n### Response:\n{sample['output']}"

dataset = load_dataset("json", data_files=DATA_PATH, split="train")
dataset = dataset.map(lambda x: {"text": format_sample(x)})

# Train
trainer = SFTTrainer(
    model=model,
    train_dataset=dataset,
    tokenizer=tokenizer,
    args=SFTConfig(
        output_dir=OUTPUT_DIR,
        num_train_epochs=3,
        per_device_train_batch_size=4,
        gradient_accumulation_steps=4,
        warmup_steps=50,
        learning_rate=2e-4,
        fp16=True,
        logging_steps=10,
        save_strategy="epoch",
        dataset_text_field="text",
        max_seq_length=2048,
    ),
)

trainer.train()
trainer.save_model(OUTPUT_DIR)
print(f"Adapter saved to {OUTPUT_DIR}")
```

### Push adapter to HF Hub

**File:** `finetune/push_adapter.py`

```python
from peft import PeftModel
from transformers import AutoModelForCausalLM
from huggingface_hub import HfApi
import sys

ADAPTER_PATH = "./finetune/adapter"
HUB_REPO = sys.argv[1] if len(sys.argv) > 1 else "your-org/terminal-agent-adapter"

api = HfApi()
api.create_repo(repo_id=HUB_REPO, exist_ok=True)

# Push adapter weights only (not the full base model)
from peft import PeftConfig
config = PeftConfig.from_pretrained(ADAPTER_PATH)
model = AutoModelForCausalLM.from_pretrained(config.base_model_name_or_path)
model = PeftModel.from_pretrained(model, ADAPTER_PATH)
model.push_to_hub(HUB_REPO)
print(f"Adapter pushed to https://huggingface.co/{HUB_REPO}")
```

---

## 11. vLLM + LMCache Server Config

**File:** `models/serve.sh`

```bash
#!/usr/bin/env bash
set -e

MODEL=${1:-"Qwen/Qwen2.5-Coder-7B-Instruct"}
LORA_ADAPTER=${2:-""}   # e.g. "your-org/terminal-agent-adapter"
PORT=${PORT:-8000}

LMCACHE_ARGS="--kv-cache-dtype auto"

LORA_ARGS=""
if [ -n "$LORA_ADAPTER" ]; then
    LORA_ARGS="--enable-lora --lora-modules terminal-agent=$LORA_ADAPTER"
fi

# Set LMCache config path
export LMCACHE_CONFIG_FILE="$(pwd)/models/lmcache_config.yaml"

python -m vllm.entrypoints.openai.api_server \
    --model "$MODEL" \
    --port "$PORT" \
    --host 0.0.0.0 \
    --max-model-len 8192 \
    --tensor-parallel-size 1 \
    --dtype auto \
    --gpu-memory-utilization 0.85 \
    $LMCACHE_ARGS \
    $LORA_ARGS

# Usage:
# Basic:          bash models/serve.sh
# With adapter:   bash models/serve.sh Qwen/Qwen2.5-Coder-7B-Instruct your-org/terminal-agent-adapter
# 32B model:      bash models/serve.sh Qwen/Qwen2.5-Coder-32B-Instruct
```

---

## 12. Team Deployment

### Shared server setup

```
[Developer laptops]
  shell hook → sends JSON over HTTPS to shared inference server

[Shared GPU server]
  vLLM (port 8000) ← LMCache (GPU→CPU→Disk)
  ChromaDB → pgvector (shared Postgres)
  SQLite per-user → central Postgres (optional)
```

### Install script for team members

```bash
# models/serve.sh runs on the GPU server
# Developers run this on their laptops:

curl -sSL https://your-internal/install.sh | bash

# install.sh writes ~/.terminal-agent/config.yaml:
cat > ~/.terminal-agent/config.yaml <<EOF
llm_endpoint: http://inference-server.internal:8000/v1
model: terminal-agent          # the LoRA-adapted model name
api_key: your-shared-secret
vector_db_host: postgres.internal:5432
auto_approve_threshold: 0.95
ignored_paths:
  - /etc
  - ~/.ssh
  - .env
  - secrets/
  - "**/*.pem"
EOF
```

### Monitoring metrics to track

```
fix_success_rate        # % of applied fixes that resolved the error
lmcache_hit_rate        # % of requests served from KV cache
avg_latency_ms          # end-to-end time from error to fix displayed
vector_db_query_time_ms # time for ChromaDB similarity search
top_error_types         # most common errors — focus fine-tuning here
```

---

## 13. Safety Rules

These rules must be enforced in code — not just in documentation.

1. **Never auto-apply file patches.** `auto_approve` is only for `fix_type = shell_command`. File patches always require explicit `y`.
2. **Always create `.bak` before patching.** `FilePatcher.apply()` must call `shutil.copy2(file_path, file_path + ".bak")` as its first line.
3. **Respect `ignored_paths`.** The context collector must check every file path against the ignored list. This list must include `/etc`, `~/.ssh`, `.env`, `secrets/`, `**/*.pem`, `**/*.key`.
4. **Shell command allowlist.** `ShellRunner` must only execute commands whose base command is in `ALLOWED_COMMANDS = ["pip", "npm", "cargo", "go", "chmod", "mkdir", "python", "node", "npx", "yarn"]`.
5. **Never run the original failed command automatically** after applying a fix without the user seeing the retry output. The retry result must be displayed.
6. **Timeout all subprocess calls.** All `subprocess.run()` calls must have `timeout=30`.
7. **Cap file reads.** Never read more than 100KB from any file. The context collector truncates at this limit.
8. **Log everything.** Every session must be logged to SQLite, including failures and rejections.

---

## 14. Environment Variables & Config

### `config.yaml` (full schema)

```yaml
# ~/.terminal-agent/config.yaml

# LLM
llm_endpoint: "http://localhost:8000/v1"
model: "Qwen2.5-Coder-7B-Instruct"
api_key: "not-needed-for-local"
max_tokens: 1024
temperature: 0.1

# Approval
auto_approve_threshold: 0.95          # 0-1.0, confidence above which shell fixes auto-apply
auto_approve_types: ["shell_command"] # file_patch is never auto-approved

# Memory
vector_db_path: "~/.terminal-agent/vectordb"
session_db_path: "~/.terminal-agent/sessions.db"
embedding_model: "all-MiniLM-L6-v2"
vector_k: 3                           # number of similar fixes to retrieve

# Safety
ignored_paths:
  - "/etc"
  - "~/.ssh"
  - ".env"
  - "secrets/"
  - "**/*.pem"
  - "**/*.key"
allowed_shell_commands:
  - pip
  - npm
  - cargo
  - go
  - chmod
  - mkdir
  - python
  - node

# Daemon
socket_path: "/tmp/terminal-agent.sock"
request_timeout_s: 5
max_file_read_bytes: 102400           # 100KB cap

# Logging
log_level: "INFO"
log_path: "~/.terminal-agent/agent.log"
```

### `requirements.txt`

```
# Core
openai>=1.0.0
chromadb>=0.5.0
sentence-transformers>=3.0.0
rich>=13.0.0
pyyaml>=6.0
aiofiles>=23.0.0

# Agentic
smolagents>=1.0.0

# Inference (install separately on GPU machine)
# vllm>=0.6.0
# lmcache>=0.2.0

# Fine-tuning (install separately on fine-tuning machine)
# transformers>=4.40.0
# trl>=0.8.0
# peft>=0.10.0
# datasets>=2.0.0
# accelerate>=0.27.0
# bitsandbytes>=0.43.0

# Testing
pytest>=8.0.0
pytest-asyncio>=0.23.0
```

---

## 15. Testing Strategy

### Unit tests

```
tests/test_context.py       — test file path extraction, error type detection, language detection
tests/test_prompt.py        — test prompt builds correctly with and without few-shot examples
tests/test_patcher.py       — test patch apply, backup creation, rollback on failure
tests/test_parser.py        — test XML tag extraction from LLM output
tests/test_vectordb.py      — test add, query, upsert round-trip
```

### Integration test fixtures

Put these in `tests/fixtures/` — each is a broken file with a known correct fix:

```
fixtures/python_module_not_found/    broken_app.py + expected_fix_command.txt
fixtures/python_syntax_error/        broken_script.py + expected_diff.patch
fixtures/typescript_type_error/      broken_component.ts + expected_diff.patch
fixtures/rust_compile_error/         broken_main.rs + expected_diff.patch
fixtures/permission_denied/          broken_script.sh + expected_fix_command.txt
```

### Eval harness

```python
# tests/eval_harness.py
import subprocess, json

FIXTURES = [...]

def run_eval():
    results = []
    for fixture in FIXTURES:
        # Inject error into daemon
        # Capture proposed fix
        # Compare to expected fix
        # Record pass/fail
        ...
    print(f"Accuracy: {sum(r['pass'] for r in results)}/{len(results)}")
```

Run this automatically in CI on every new LoRA adapter before deploying.

---

## 16. Agent Instructions

> **If you are a coding agent reading this document, follow these instructions precisely.**

### Build order

Follow phases in order. Do not skip ahead. Each phase has a clear "done when" criterion — verify it before proceeding.

1. Start with `Phase 0`: set up the repo structure from Section 3, install requirements, write the simplest shell hook, verify it fires, stand up SQLite.
2. Build `Phase 1` components in this order: `context.py` → `prompt.py` → `llm.py` → `parser.py` → `patcher.py` → `approval.py` → `daemon.py`. Test each independently before wiring together.
3. Do not write any agentic code until Phase 1 is working end-to-end with a real error.
4. In `Phase 2`, add ChromaDB before connecting LMCache — verify few-shot retrieval works first, then add the KV cache layer.
5. In `Phase 3`, implement tools one at a time, test each with `tool.run(...)` before wiring into `CodeAgent`.

### Code standards

- All files must have type hints.
- All external calls (LLM, subprocess, file read) must have try/except with logged errors.
- All subprocess calls must have `timeout=30`.
- Follow the safety rules in Section 13 without exception.
- The daemon must never crash on a malformed payload — always catch and log.

### Configuration

- Never hardcode paths, endpoints, or model names. Always read from `config.yaml`.
- The default `config.yaml` location is `~/.terminal-agent/config.yaml`.
- All paths support `~` expansion via `os.path.expanduser()`.

### Testing

- Write a unit test for every function in `context.py` and `patcher.py` before moving to the next phase.
- Use the fixture files in `tests/fixtures/` to run integration tests after Phase 1.
- Run `pytest tests/ -v` before each phase transition.

### When in doubt

- Prefer safety over speed: if unsure whether to auto-apply a fix, show it to the user.
- Prefer a working narrow feature over a broken broad one.
- Log every decision with enough context to debug it from the log file alone.

---

*End of specification. This document is the single source of truth for the terminal AI error agent.*
