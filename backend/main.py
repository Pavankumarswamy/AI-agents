import sys
import asyncio
if sys.platform == "win32":
    try:
        asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
    except Exception:
        pass # Handle cases where the loop is already running

"""
main.py – FastAPI backend for the Autonomous CI/CD Healing Agent
Endpoints:
  POST /analyze  – start an agent pipeline run
  GET  /results/{run_id} – poll for live status / final results
"""

import os
import uuid
import shutil
import logging
import zipfile
import threading
import sqlite3
import json
import asyncio
import subprocess
from pathlib import Path
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, StreamingResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agents import run_pipeline
from llm_client import _call_nvidia, _strip_markdown

# ---------------------------------------------------------------------------
# Database & Path Initialization
# ---------------------------------------------------------------------------
if getattr(sys, 'frozen', False):
    # Running in a bundle (e.g. PyInstaller)
    # Use AppData for writable data in production
    APP_DATA = Path(os.getenv("APPDATA", os.path.expanduser("~"))) / "GGU AI-CICD-Healing-Agent"
    APP_DATA.mkdir(parents=True, exist_ok=True)
    
    ROOT_DIR = APP_DATA
    DB_PATH = APP_DATA / "chat_history.db"
    
    # We still need to know where the backend.exe is located for reference if needed
    EXE_DIR = Path(sys.executable).parent
else:
    BACKEND_DIR = Path(__file__).parent
    ROOT_DIR = BACKEND_DIR.parent
    DB_PATH = BACKEND_DIR / "chat_history.db"

CLONES_DIR = ROOT_DIR / "cloned_repos"
CLONES_DIR.mkdir(parents=True, exist_ok=True)



def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''
        CREATE TABLE IF NOT EXISTS chat_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            run_id TEXT NOT NULL,
            session_id TEXT,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    conn.commit()
    conn.close()

init_db()

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# In-memory run store
runs: dict = {}
RUN_PATHS: dict = {}  # Map run_id -> absolute Path on disk

# ---------------------------------------------------------------------------
# Project Persistence
# ---------------------------------------------------------------------------
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
PROJECTS_FILE = DATA_DIR / "projects.json"

def save_projects():
    try:
        data = {
            "RUN_PATHS": {k: str(v) for k, v in RUN_PATHS.items()},
            "TERMINAL_HISTORY": {k: v["live"].get("terminal_output", "") for k, v in runs.items() if "live" in v}
        }
        PROJECTS_FILE.write_text(json.dumps(data), encoding="utf-8")
    except Exception as e:
        logger.warning(f"Failed to save projects: {e}")

def load_projects():
    if PROJECTS_FILE.exists():
        try:
            data = json.loads(PROJECTS_FILE.read_text(encoding="utf-8"))
            for k, v in data.get("RUN_PATHS", {}).items():
                RUN_PATHS[k] = Path(v)
            for k, v in data.get("TERMINAL_HISTORY", {}).items():
                if k not in runs:
                    runs[k] = {
                        "status": "completed",
                        "live": {
                            "phase": "done",
                            "message": "Project restored",
                            "terminal_output": v,
                            "files": [],
                            "iterations": []
                        }
                    }
        except Exception as e:
            logger.warning(f"Failed to load projects: {e}")

load_projects()

# ---------------------------------------------------------------------------
# App Initialization
# ---------------------------------------------------------------------------
app = FastAPI(title="CI/CD Healing Agent API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition"],
)

# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class ConfigUpdate(BaseModel):
    github_pat: Optional[str] = None
    nvidia_api_key: Optional[str] = None

class AnalyzeRequest(BaseModel):
    repo_url: str
    team_name: str
    leader_name: str

class SaveFileRequest(BaseModel):
    run_id: str
    file_path: str
    content: str

class CreateItemRequest(BaseModel):
    run_id: str
    parent_path: str
    name: str
    type: str

class TerminalRequest(BaseModel):
    run_id: str
    command: str
    cwd: Optional[str] = None

class LocalOpenRequest(BaseModel):
    path: str
    team_name: str
    leader_name: str

class BrowseFolderRequest(BaseModel):
    path: Optional[str] = None

class AnalyzeResponse(BaseModel):
    run_id: str
    message: str
    branch_name: str

class ChatRequest(BaseModel):
    message: str
    run_id: Optional[str] = None
    file_path: Optional[str] = None
    file_content: Optional[str] = None
    api_data: Optional[dict] = None
    repo_context: Optional[list[dict]] = None
    session_id: Optional[str] = "default"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def get_repo_path(run_id: str) -> Path | None:
    """Resolve the physical disk path for a given run_id."""
    if run_id in RUN_PATHS:
        return RUN_PATHS[run_id]
    
    # Fallback to scanning CLONES_DIR (for past sessions or cloned repos)
    if not CLONES_DIR.exists():
        return None
        
    try:
        # Check if run_id is a prefix of any directory in CLONES_DIR
        target = next((item for item in CLONES_DIR.iterdir() if item.is_dir() and item.name.split('_')[0] == run_id), None)
        return target
    except Exception:
        return None

def derive_branch_name(team_name: str, leader_name: str) -> str:
    import re
    team = re.sub(r"[^A-Za-z0-9 ]", "", team_name).strip().upper().replace(" ", "_")
    leader = re.sub(r"[^A-Za-z0-9 ]", "", leader_name).strip().upper().replace(" ", "_")
    return f"{team}_{leader}_AI_Fix"

def _background_run(run_id: str, repo_url: str, team_name: str, leader_name: str, branch_name: str):
    runs[run_id]["status"] = "running"
    try:
        logger.info(f"[{run_id}] Starting pipeline for {repo_url}")
        result = run_pipeline(
            run_id=run_id,
            repo_url=repo_url,
            team_name=team_name,
            leader_name=leader_name,
            branch_name=branch_name,
            runs=runs,
        )
        runs[run_id]["status"] = "completed"
        runs[run_id]["result"] = result
        logger.info(f"[{run_id}] Pipeline completed.")
    except Exception as exc:
        logger.exception(f"[{run_id}] Pipeline failed: {exc}")
        runs[run_id]["status"] = "failed"
        runs[run_id]["error"] = str(exc)

# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze(req: AnalyzeRequest):
    if not req.repo_url.startswith("http"):
        raise HTTPException(status_code=400, detail="repo_url must be a valid HTTP/HTTPS GitHub URL")

    run_id = str(uuid.uuid4())[:8]
    branch_name = derive_branch_name(req.team_name, req.leader_name)

    runs[run_id] = {
        "status": "running",
        "live": {
            "phase": "initializing",
            "message": "Starting pipeline...",
            "files": [],
            "terminal_output": "",
            "iterations": []
        }
    }

    threading.Thread(target=_background_run, args=(run_id, req.repo_url, req.team_name, req.leader_name, branch_name), daemon=True).start()
    return AnalyzeResponse(run_id=run_id, message="Agent started", branch_name=branch_name)

@app.post("/local/open")
async def open_local_folder(req: LocalOpenRequest):
    """Mount an existing local folder as a project."""
    path = Path(req.path).resolve()
    if not path.is_dir():
        raise HTTPException(status_code=400, detail=f"Path not found or not a directory: {req.path}")
        
    run_id = f"local_{str(uuid.uuid4())[:6]}"
    RUN_PATHS[run_id] = path
    save_projects()
    
    from git_utils import get_all_files
    try:
        class MockRepo:
            def __init__(self, p): self.working_dir = str(p)
        
        files = get_all_files(MockRepo(path))
        
        runs[run_id] = {
            "status": "completed",
            "live": {
                "phase": "done",
                "message": f"Local project mounted: {path.name}",
                "files": files,
                "terminal_output": f">>> Mounted local folder: {path}\n",
                "iterations": []
            }
        }
        return {"run_id": run_id, "message": "Local folder mounted", "files": files}
    except Exception as e:
        logger.exception(f"Local mount failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/local/browse")
async def browse_local_folders(req: BrowseFolderRequest):
    """List subdirectories for a folder picker UI."""
    try:
        if not req.path:
            # Default to User home or current project root
            start_path = Path.home()
        else:
            start_path = Path(req.path).resolve()

        if not start_path.exists() or not start_path.is_dir():
             # If path invalid, fallback to home
             start_path = Path.home()

        folders = []
        # Filter: Skip hidden folders and common system dirs for speed/safety
        skip_patterns = {".", "$", "AppData", "Program Files", "Windows", "node_modules", "vendor"}
        
        try:
            for item in start_path.iterdir():
                if item.is_dir():
                    if any(item.name.startswith(p) for p in [".", "$"]): continue
                    if item.name in skip_patterns: continue
                    folders.append({
                        "name": item.name,
                        "path": str(item.absolute()),
                        "type": "directory"
                    })
        except PermissionError:
            pass # Skip folders we can't read

        # Sort alphabetically
        folders.sort(key=lambda x: x["name"].lower())

        return {
            "current_path": str(start_path.absolute()),
            "parent_path": str(start_path.parent.absolute()) if start_path.parent != start_path else None,
            "folders": folders
        }
    except Exception as e:
        logger.error(f"Browse failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat_with_agent(req: ChatRequest):
    try:
        msg_lower = req.message.lower()
        system_instruction = (
            "ALWAYS use the following Markdown patterns for premium display:\n"
            "1. Use `#### Header Name` for important section titles (this triggers larger fonts).\n"
            "2. Use `[File.py]` or `[Citation]` brackets to cite specific source files or points.\n"
            "3. Use **Tables** and **Numbered Lists** whenever appropriate.\n\n"
            "--- AUTONOMOUS CREATION PROTOCOL ---\n"
            "If you need to create or modify a file, you MUST end your response with this EXACT block for EACH file:\n"
            "CREATE_FILE: path/to/file.ext\n"
            "```\ncontent here\n```\n"
            "DO NOT just describe the files. You MUST use the block above to actually write them to disk. "
            "This applies to ANY file generation request.\n"
        )

        if "summary" in msg_lower:
            system_prompt = (
                "You are GGU AI, an Autonomous CI/CD Healing Agent. "
                "Generate a high-level architectural summary of the provided repository context.\n"
                f"{system_instruction}"
                "Be sure to cite the main modules using the citation brackets [module_name.py]."
            )
        elif any(k in msg_lower for k in ["fix", "correct", "logic", "unused", "syntax"]):
            if not req.file_path or not req.file_content:
                return {"response": "I can help with that, but I need you to select a file in the editor first!"}
            return {
                "response": f"Understood. I am deploying my **GGU AI-Heal-Agent** to `{req.file_path}` to address your request.",
                "action": "trigger_fix",
                "metadata": {"file": req.file_path}
            }
        elif any(k in msg_lower for k in ["scan", "find", "tests", "discover"]):
            return {
                "response": "Starting my **GGU AI-Scan-Agent** to discover relevant files and tests…",
                "action": "trigger_discovery"
            }
        elif any(k in msg_lower for k in ["run", "verify", "execute"]):
            return {
                "response": "Engaging the **GGU AI-Test-Agent** to execute tests and verify the current state…",
                "action": "trigger_execution"
            }
        elif any(k in msg_lower for k in ["create", "new file", "new folder", "generate code"]):
            system_prompt = (
                "You are GGU AI, the Autonomous Creator. Your goal is to help the user build new features by creating files and folders.\n"
                f"{system_instruction}"
            )
        else:
            system_prompt = (
                "You are GGU AI, an Autonomous CI/CD Healing Agent. "
                "Your goal is to be a helpful workspace companion. "
                "If the user says 'hi' or greets you, respond conversationally (e.g., 'Hello! I am GGU AI. How can I assist you with your project today?'). "
                "Otherwise, assist the developer by analyzing their code and explaining logic.\n"
                f"{system_instruction}"
            )

        # Context logic
        context_parts = []
        repo_files = []
        if req.run_id and req.run_id in runs:
            repo_files = runs[req.run_id].get("live", {}).get("files", [])
        elif req.repo_context:
            repo_files = req.repo_context

        if repo_files:
            file_list = [f.get("path") for f in repo_files if f.get("path")]
            context_parts.append(f"### PROJECT REPOSITORY STRUCTURE (Map)\n- " + "\n- ".join(file_list))
        
        if req.file_path and req.file_content:
            context_parts.append(f"### CURRENT ACTIVE FILE (`{req.file_path}`)\n```\n{req.file_content}\n```")

        full_requested = any(k in msg_lower for k in ["full code", "entire repo", "all files", "architecture summary", "project overview"])
        if repo_files:
            for f in repo_files:
                path, content = f.get("path"), f.get("content", "")
                if not path or not content or path == req.file_path: continue
                if full_requested or (path.lower() in msg_lower or path.split("/")[-1].lower() in msg_lower):
                    context_parts.append(f"### REFERENCED FILE: `{path}`\n```\n{content}\n```")
                    if len(context_parts) > 10: break

        context_str = "\n\n" + "\n\n".join(context_parts) if context_parts else "\n\n(No project context available.)"

        # LLM Logic
        messages = [{"role": "system", "content": f"{system_prompt}\n\n{context_str}"}]
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("INSERT INTO chat_messages (run_id, session_id, role, content) VALUES (?, ?, ?, ?)",
                      (req.run_id or "unknown", req.session_id or "default", "user", req.message))
            c.execute("SELECT role, content FROM chat_messages WHERE run_id = ? AND session_id = ? ORDER BY timestamp DESC LIMIT 10",
                      (req.run_id or "unknown", req.session_id or "default"))
            history_rows = c.fetchall()
            history_rows.reverse()
            for h in history_rows:
                role = "assistant" if h[0] == "agent" else h[0]
                messages.append({"role": role, "content": h[1]})
            
            response = _call_nvidia(messages, api_data=req.api_data)
            stripped = _strip_markdown(response)
            
            c.execute("INSERT INTO chat_messages (run_id, session_id, role, content) VALUES (?, ?, ?, ?)",
                      (req.run_id or "unknown", req.session_id or "default", "agent", stripped))
            conn.commit()
            conn.close()
        except Exception as db_err:
            logger.error(f"DB error during chat: {db_err}")
            response = _call_nvidia([{"role": "user", "content": f"{system_prompt}\n\n{context_str}\n\n{req.message}"}], api_data=req.api_data)
            stripped = _strip_markdown(response)

        # Autonomous Creation logic
        import re
        # Improved pattern: Handles optional spaces and multiple newlines
        creation_pattern = r"(?:CREATE_FILE:|WRITE_FILE:)\s*([^\s\n]+)\s*\n*```(?:\w+)?\n(.*?)\n```"
        matches = list(re.finditer(creation_pattern, response, re.DOTALL))
        updated_live = None
        
        if matches and req.run_id:
            repo_path = get_repo_path(req.run_id)
            
            if repo_path:

                for match in matches:
                    target, content = match.group(1).strip(), match.group(2)
                    full_p = (repo_path / target).resolve()
                    if str(full_p).startswith(str(repo_path.resolve())):
                        full_p.parent.mkdir(parents=True, exist_ok=True)
                        full_p.write_text(content, encoding="utf-8")
                        logger.info(f"[CREATE] Created: {target}")
                
                from git_utils import get_all_files
                from git import Repo
                try:
                    repo_obj = Repo(repo_path)
                    updated_live = get_all_files(repo_obj)
                    runs[req.run_id]["live"]["files"] = updated_live
                except Exception as e:
                    logger.error(f"Refresh failed: {e}")

        payload = {"response": stripped}
        if updated_live: payload["live"] = {"files": updated_live}
        return payload

    except Exception as e:
        logger.exception(f"Chat failed: {e}")
        return {"response": f"⚠️ I hit an error: {str(e)}"}

@app.get("/chat/history/{run_id}")
async def get_chat_history(run_id: str, session_id: str = "default"):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT role, content, timestamp FROM chat_messages WHERE run_id = ? AND session_id = ? ORDER BY timestamp ASC", (run_id, session_id))
        rows = c.fetchall()
        conn.close()
        return {"history": [{"role": r[0], "content": r[1], "timestamp": r[2]} for r in rows]}
    except Exception as e:
        logger.error(f"History fetch failed: {e}")
        return {"history": []}

@app.get("/chat/sessions/{run_id}")
async def get_chat_sessions(run_id: str):
    try:
        conn = sqlite3.connect(DB_PATH)
        c = conn.cursor()
        c.execute("SELECT DISTINCT session_id FROM chat_messages WHERE run_id = ?", (run_id,))
        rows = c.fetchall()
        conn.close()
        sessions = [r[0] for r in rows if r[0]]
        if "default" not in sessions: sessions.insert(0, "default")
        return {"sessions": sessions}
    except Exception as e:
        logger.error(f"Sessions fetch failed: {e}")
        return {"sessions": ["default"]}

@app.get("/results/{run_id}")
async def get_results(run_id: str):
    if run_id not in runs: raise HTTPException(status_code=404, detail="Run not found")
    run = runs[run_id]
    return {
        "run_id": run_id,
        "status": run["status"],
        "branch_name": run.get("branch_name"),
        "repo_url": run.get("repo_url"),
        "team_name": run.get("team_name"),
        "leader_name": run.get("leader_name"),
        "started_at": run.get("started_at"),
        "live": run.get("live", {}),
        "result": run.get("result"),
        "error": run.get("error"),
    }

@app.get("/config")
async def get_config():
    from llm_client import NVIDIA_MODEL
    return {
        "github_pat_set": bool(os.getenv("GITHUB_PAT") and "your_github" not in os.getenv("GITHUB_PAT", "").lower()),
        "nvidia_api_key_set": bool(os.getenv("NVIDIA_API_KEY")),
        "nvidia_model": os.getenv("NVIDIA_MODEL") or NVIDIA_MODEL,
    }

@app.post("/config")
async def update_config(conf: ConfigUpdate):
    env_path = Path(__file__).parent / ".env"
    lines = env_path.read_text().splitlines() if env_path.exists() else []
    updates = {}
    if conf.github_pat: updates["GITHUB_PAT"] = conf.github_pat
    if conf.nvidia_api_key: updates["NVIDIA_API_KEY"] = conf.nvidia_api_key
    
    new_lines = []
    seen = set()
    for line in lines:
        if "=" in line:
            key = line.split("=")[0].strip()
            if key in updates:
                new_lines.append(f"{key}={updates[key]}")
                seen.add(key)
                continue
        new_lines.append(line)
    for key, val in updates.items():
        if key not in seen: new_lines.append(f"{key}={val}")
    env_path.write_text("\n".join(new_lines) + "\n")
    for key, val in updates.items(): os.environ[key] = val
    return {"message": "Config updated"}

@app.get("/repos")
async def list_repos():
    clones_dir = CLONES_DIR
    if not clones_dir.exists():
        clones_dir.mkdir(parents=True, exist_ok=True)
        return []
    repo_list = []
    for item in clones_dir.iterdir():
        if item.is_dir():
            run_id = item.name.split("_")[0]
            repo_name = item.name.replace(f"{run_id}_", "")
            try:
                stat_info = item.stat()
                total_size = sum(f.stat().st_size for f in item.rglob('*') if f.is_file())
                repo_list.append({
                    "run_id": run_id,
                    "repo_name": repo_name,
                    "folder_name": item.name,
                    "size_mb": round(total_size / (1024 * 1024), 2),
                    "created_at": datetime.fromtimestamp(stat_info.st_ctime).isoformat(),
                })
            except Exception: continue
    repo_list.sort(key=lambda x: x["created_at"], reverse=True)
    return repo_list

@app.delete("/repos/{run_id}")
async def delete_repo(run_id: str):
    clones_dir = CLONES_DIR
    target = next((item for item in clones_dir.iterdir() if item.is_dir() and item.name.split('_')[0] == run_id), None) if clones_dir.exists() else None
    if target:
        try:
            def on_rm_error(func, path, exc_info):
                import stat
                try:
                    os.chmod(path, stat.S_IWRITE)
                    func(path)
                except Exception: pass
            shutil.rmtree(target, onerror=on_rm_error)
            zip_p = Path(__file__).parent / "downloads" / f"fixed_{run_id}.zip"
            if zip_p.exists(): os.remove(zip_p)
            return {"message": f"Deleted {run_id}"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    raise HTTPException(status_code=404, detail="Not found")

@app.post("/save")
async def save_file(req: SaveFileRequest):
    target = get_repo_path(req.run_id)
    if not target: raise HTTPException(status_code=404, detail="Project path not found")
    
    full_p = (target / req.file_path).resolve()
    # Path safety: Ensure we are inside the project
    if not str(full_p).startswith(str(target.resolve())): 
        raise HTTPException(status_code=403, detail="Illegal path traversal attempt")
        
    full_p.parent.mkdir(parents=True, exist_ok=True)
    full_p.write_text(req.content, encoding="utf-8")
    return {"message": "Saved"}

@app.post("/create")
async def create_item(req: CreateItemRequest):
    target = get_repo_path(req.run_id)
    if not target: raise HTTPException(status_code=404, detail="Project path not found")
    
    rel_p = f"{req.parent_path}/{req.name}" if req.parent_path else req.name
    full_p = (target / rel_p).resolve()
    if not str(full_p).startswith(str(target.resolve())): 
        raise HTTPException(status_code=403, detail="Illegal path traversal attempt")
    try:
        if req.type == "folder": full_p.mkdir(parents=True, exist_ok=True)
        else:
            full_p.parent.mkdir(parents=True, exist_ok=True)
            if not full_p.exists(): full_p.write_text("", encoding="utf-8")
        from git_utils import get_all_files
        from git import Repo
        updated_live = get_all_files(Repo(target))
        if req.run_id in runs: runs[req.run_id]["live"]["files"] = updated_live
        return {"message": "Created", "files": updated_live}
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

@app.websocket("/ws/terminal/{run_id}")
async def terminal_websocket(websocket: WebSocket, run_id: str):
    """Handle real-time terminal command execution and log streaming."""
    logger.info(f"[WS] Accepting terminal connection for {run_id}")
    await websocket.accept()
    
    repo_root = get_repo_path(run_id)
    if not repo_root:
        try:
            await websocket.send_json({"type": "error", "content": "Project not found"})
            await websocket.close()
        except: pass
        return

    loop = asyncio.get_running_loop()
    logger.info(f"[WS] Session active: {run_id} | Loop: {type(loop).__name__}")
    
    # Send existing history if any (limited to avoid overflow)
    if run_id in runs and "live" in runs[run_id]:
        history = runs[run_id]["live"].get("terminal_output", "")
        if history:
            try: await websocket.send_json({"type": "output", "content": history[-10000:]})
            except: pass
        
    try:
        while True:
            try:
                data = await websocket.receive_json()
            except WebSocketDisconnect:
                logger.info(f"[WS] Client disconnected: {run_id}")
                break
            except Exception as e:
                logger.warning(f"[WS] Receive error: {e}")
                break

            command = data.get("command")
            if not command: continue
            
            cwd = data.get("cwd") or str(repo_root)

            # Resolve start_dir
            if not cwd:
                start_dir = repo_root
            else:
                try:
                    start_dir = Path(cwd)
                    if not str(start_dir.resolve()).startswith(str(repo_root.resolve())):
                        start_dir = repo_root
                except Exception:
                    start_dir = repo_root

            # Chain to capture new CWD after command
            # Force UTF-8 on Windows
            chained_cmd = f"chcp 65001 >nul & cd /d \"{start_dir}\" & {command} & echo --END_OF_COMMAND-- & cd"
            
            queue = asyncio.Queue()
            loop = asyncio.get_event_loop()

            def pipe_reader(pipe, msg_type):
                line_buffer = ""
                try:
                    while True:
                        char = pipe.read(1)
                        if not char:
                            break
                        
                        line_buffer += char
                        if char == '\n' or char == '\r':
                            if "--END_OF_COMMAND--" in line_buffer:
                                # The CWD follow-up is coming
                                rest = pipe.readline().strip()
                                loop.call_soon_threadsafe(queue.put_nowait, {"type": "cwd", "content": rest})
                                line_buffer = ""
                                continue
                            
                            # Flush the line (or part of line if \r)
                            loop.call_soon_threadsafe(queue.put_nowait, {"type": msg_type, "content": line_buffer})
                            line_buffer = ""
                        
                        # Optimization: if the line gets very long without a newline, flush it anyway
                        if len(line_buffer) > 200:
                            loop.call_soon_threadsafe(queue.put_nowait, {"type": msg_type, "content": line_buffer})
                            line_buffer = ""
                            
                except Exception:
                    pass
                finally:
                    pipe.close()

            # Start the process using standard subprocess (works in any loop)
            process = subprocess.Popen(
                chained_cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                shell=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                universal_newlines=True
            )

            # Read pipes in threads
            t1 = threading.Thread(target=pipe_reader, args=(process.stdout, "output"), daemon=True)
            t2 = threading.Thread(target=pipe_reader, args=(process.stderr, "error"), daemon=True)
            t1.start()
            t2.start()

            # Async loop to consume the queue and send to websocket
            try:
                while t1.is_alive() or t2.is_alive() or not queue.empty():
                    try:
                        # Non-blocking get with timeout
                        msg = await asyncio.wait_for(queue.get(), timeout=0.1)
                        
                        if msg["type"] in ["output", "error"]:
                            if run_id in runs:
                                old = runs[run_id]["live"].get("terminal_output", "")
                                runs[run_id]["live"]["terminal_output"] = (old + msg["content"])[-20000:]
                        
                        await websocket.send_json(msg)
                    except asyncio.TimeoutError:
                        continue
                    except (WebSocketDisconnect, RuntimeError):
                        logger.info(f"[WS] Session closed during execution: {run_id}")
                        process.kill()
                        return # Exit the entire handler
                    except Exception as e:
                        logger.error(f"[WS] Streaming error: {e}")
                        break
            finally:
                save_projects()
                process.wait()
                try: await websocket.send_json({"type": "done", "exit_code": process.returncode})
                except: pass

    except WebSocketDisconnect:
        logger.info(f"Terminal WS disconnected: {run_id}")
    except Exception as e:
        logger.exception(f"Terminal WS error for {run_id}")
        try: await websocket.send_json({"type": "error", "content": str(e)})
        except: pass

@app.post("/terminal")
async def execute_terminal_command(req: TerminalRequest):
    """Execute a shell command with stateful CWD, supporting both cloned and local repos."""
    repo_root = get_repo_path(req.run_id)
    
    if repo_root:
        start_dir = Path(req.cwd) if req.cwd else repo_root
        # Path Safety: Ensure we don't 'cd' out of the project boundaries
        if not str(start_dir.resolve()).startswith(str(repo_root.resolve())):
            start_dir = repo_root
    else:
        # Global fallback if no project is active (allows basic commands in root)
        start_dir = Path(req.cwd) if req.cwd else CLONES_DIR.resolve()
        if not start_dir.exists(): start_dir = Path.cwd()

    import subprocess
    # start_dir is already resolved above based on project context or fallback
    try:
        # Use '&' instead of '&&' so that the second command (cd) ALWAYS runs even if the first fails.
        # This ensures we always get the new CWD back to the frontend.
        chained_cmd = f"cd /d \"{start_dir}\" & {req.command} & echo --END_OF_COMMAND-- & cd"
        
        process = subprocess.run(
            chained_cmd,
            shell=True,
            capture_output=True,
            text=True,
            timeout=30
        )
        
        full_output = process.stdout
        error = process.stderr
        
        # Split output to find the new CWD
        parts = full_output.split("--END_OF_COMMAND--")
        output = parts[0].strip()
        new_cwd = parts[1].strip() if len(parts) > 1 else str(start_dir)
        
        if error and not output:
             output = f"Error: Command execution returned non-zero status.\n{error}"

        return {
            "output": output,
            "error": error if process.returncode != 0 else "",
            "exit_code": process.returncode,
            "cwd": new_cwd
        }
    except Exception as e:
        logger.error(f"[TERMINAL] Command failed: {e}")
        return {"output": "", "error": f"Internal Shell Error: {str(e)}", "exit_code": 1, "cwd": str(start_dir)}

@app.get("/download/{run_id}")
async def download_fixed_code(run_id: str):
    target = get_repo_path(run_id)
    if not target: raise HTTPException(status_code=404, detail="Project not found")
    
    zip_root = Path(__file__).parent / "downloads"
    zip_root.mkdir(exist_ok=True)
    zip_full_path = zip_root / f"project_{run_id}.zip"
    
    try:
        if zip_full_path.exists(): os.remove(zip_full_path)
        with zipfile.ZipFile(zip_full_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            for root, dirs, files in os.walk(target):
                if '.git' in dirs: dirs.remove('.git')
                for file in files:
                    file_p = Path(root) / file
                    try: zipf.write(file_p, file_p.relative_to(target))
                    except: continue
        def iterfile():
            with open(zip_full_path, "rb") as f: yield from f
        return StreamingResponse(iterfile(), media_type="application/zip", headers={"Content-Disposition": f"attachment; filename=project_{run_id}.zip"})
    except Exception as e: raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8000, reload=False)

