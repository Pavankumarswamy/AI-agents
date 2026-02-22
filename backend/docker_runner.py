"""
docker_runner.py – Execute tests inside a sandboxed Docker container.

Falls back to running pytest directly (subprocess) if Docker is unavailable.
"""

import os
import logging
import sys
import subprocess
import tempfile
from pathlib import Path
from typing import NamedTuple

logger = logging.getLogger(__name__)


class TestResult(NamedTuple):
    test_file: str
    passed: bool
    stdout: str
    stderr: str
    failures: list[dict]   # [{ file, line, error_message, bug_type }]


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def run_tests(repo_path: str, test_file: str) -> TestResult:
    """
    Run *test_file* inside a Docker container (python:3.11-slim).
    Falls back to local subprocess if Docker is not available.
    """
    if _docker_available():
        res = _run_in_docker(repo_path, test_file)
    else:
        logger.warning("Docker not available – running tests locally (fallback)")
        res = _run_locally(repo_path, test_file)

    # NEW: Check for manually added improvement markers (e.g. # ❌ unused import)
    # This allows the agent to be proactive even if tests pass.
    markers = _check_custom_markers(repo_path, test_file)
    if markers:
        combined_failures = res.failures + markers
        # Deduplicate
        seen = set()
        unique = []
        for f in combined_failures:
            key = (f["line"], f["error_message"][:100])
            if key not in seen:
                seen.add(key)
                unique.append(f)
        return res._replace(passed=False, failures=unique)

    return res


def _check_custom_markers(repo_path: str, test_file: str) -> list[dict]:
    """Scan a file for '❌' markers and report them as failures."""
    failures = []
    full_path = Path(repo_path) / test_file
    if not full_path.exists() or not full_path.is_file():
        return []

    try:
        # Check file extension
        ext = full_path.suffix.lower()
        if ext not in (".py", ".js", ".ts", ".jsx", ".tsx"):
            return []

        content = full_path.read_text(encoding="utf-8", errors="replace")
        lines = content.splitlines()
        for i, line in enumerate(lines, 1):
            if "❌" in line:
                # Extract message after the emoji
                msg = line.split("❌", 1)[1].strip()
                # Classify based on the message
                bug_type = _classify_bug(msg)
                failures.append({
                    "file": test_file,
                    "line": i,
                    "error_message": f"Improvement item: {msg}",
                    "bug_type": bug_type
                })
    except Exception as e:
        logger.warning(f"Failed to check markers in {test_file}: {e}")
    
    return failures


def _docker_available() -> bool:
    """Return True if the docker CLI is reachable."""
    try:
        result = subprocess.run(
            ["docker", "info"],
            capture_output=True,
            timeout=10,
        )
        return result.returncode == 0
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Docker runner
# ---------------------------------------------------------------------------

def _run_in_docker(repo_path: str, test_file: str) -> TestResult:
    """Run pytest inside python:3.11-slim with the repo volume-mounted."""
    repo_path = str(Path(repo_path).resolve())

    # Install deps then run pytest with JSON output
    cmd = [
        "docker", "run", "--rm",
        "--network", "none",          # no internet inside container
        "-v", f"{repo_path}:/app:ro", # read-only mount
        "python:3.11-slim",
        "bash", "-c",
        (
            "pip install pytest --quiet 2>&1 | tail -3 && "
            f"cd /app && python -m pytest {test_file} "
            "--tb=line -p no:cacheprovider -q 2>&1"
        ),
    ]

    return _execute_and_parse(test_file, cmd, cwd=repo_path)


# ---------------------------------------------------------------------------
# Local subprocess fallback
# ---------------------------------------------------------------------------

def _run_locally(repo_path: str, test_file: str) -> TestResult:
    """Run tests or lint checks locally when Docker is unavailable."""
    ext = Path(test_file).suffix
    is_test = "test" in test_file.lower() or "spec" in test_file.lower()
    
    if ext == ".py":
        if is_test:
            cmd = [sys.executable, "-m", "pytest", test_file, "--tb=line", "-p", "no:cacheprovider", "-q"]
        else:
            # For non-test python files, run a syntax check
            cmd = [sys.executable, "-m", "py_compile", test_file]
    elif ext in (".js", ".ts", ".jsx", ".tsx"):
        if is_test:
            if os.path.exists(os.path.join(repo_path, "bun.lockb")):
                cmd = ["bun", "test", test_file]
            else:
                cmd = ["npx", "jest", test_file, "--passWithNoTests"]
        else:
            # For non-test JS/TS files, run a node syntax check
            cmd = ["node", "--check", test_file]
    else:
        return TestResult(test_file, False, "", f"Unsupported file extension: {ext}", [])

    logger.info(f"Running {'test' if is_test else 'check'} command: {' '.join(cmd)}")
    return _execute_and_parse(test_file, cmd, cwd=repo_path)


# ---------------------------------------------------------------------------
# Shared execution + parsing
# ---------------------------------------------------------------------------

def _execute_and_parse(test_file: str, cmd: list[str], cwd: str) -> TestResult:
    """Execute *cmd* and parse pytest output into a TestResult."""
    try:
        # On Windows, we need shell=True to find npx.cmd, npm.cmd, python.exe, etc.
        use_shell = (os.name == "nt")
        
        if use_shell and isinstance(cmd, list):
            # On Windows, shell=True with a list can be flaky; a string is safer.
            command_str = subprocess.list2cmdline(cmd)
        else:
            command_str = " ".join(cmd) if isinstance(cmd, list) else cmd
        
        proc = subprocess.run(
            command_str if use_shell else cmd,
            capture_output=True,
            text=True,
            cwd=cwd,
            timeout=300,
            shell=use_shell,
        )
        stdout = proc.stdout or ""
        stderr = proc.stderr or ""
        combined = stdout + "\n" + stderr
        passed = proc.returncode == 0
        failures = _parse_failures(combined, test_file)

        # If the command failed but no specific test failures were parsed, 
        # add a generic execution failure to ensure the agent doesn't skip it.
        if not passed and not failures:
            failures.append({
                "file": test_file,
                "line": 0,
                "error_message": f"Test runner execution failed (return code {proc.returncode}).\n{combined.strip()}",
                "bug_type": "LOGIC",
            })

        return TestResult(
            test_file=test_file,
            passed=passed,
            stdout=stdout,
            stderr=stderr,
            failures=failures,
        )
    except subprocess.TimeoutExpired:
        logger.error(f"Timeout running {test_file}")
        return TestResult(
            test_file=test_file,
            passed=False,
            stdout="",
            stderr="Test run timed out after 300 seconds.",
            failures=[{
                "file": test_file,
                "line": 0,
                "error_message": "Timeout",
                "bug_type": "LOGIC",
            }],
        )
    except Exception as exc:
        logger.exception(f"Error running {test_file}: {exc}")
        return TestResult(
            test_file=test_file,
            passed=False,
            stdout="",
            stderr=str(exc),
            failures=[{
                "file": test_file,
                "line": 0,
                "error_message": str(exc),
                "bug_type": "LOGIC",
            }],
        )


def _parse_failures(output: str, test_file: str) -> list[dict]:
    """
    Heuristically parse pytest short-traceback output into structured failures.
    Each failure: { file, line, error_message, bug_type }
    """
    failures = []
    lines = output.splitlines()

    # Priority 1: Specific files mentioned in the traceback (e.g. E File "...")
    i = 0
    found_specific_src = False
    
    while i < len(lines):
        line = lines[i].strip()
        
        # Look for "File "path/to/file.py", line 123" (Python traceback style)
        # It might have a prefix like "E     File"
        if 'File "' in line and '.py", line ' in line:
            try:
                # Extract EVERYTHING between the first and last double quote on the line
                # to handle spaces in paths
                path_start = line.find('"') + 1
                path_end = line.find('"', path_start)
                raw_path = line[path_start:path_end]
                
                # Extract line number
                lineno_part = line.split('", line ')[1].split()[0].rstrip(',')
                lineno = int(lineno_part)
                
                # Check for error message in subsequent lines
                error_msg = ""
                for j in range(1, 4):
                    if i + j < len(lines):
                        next_line = lines[i+j].strip()
                        # Handle "E   SyntaxError", "E FileNotFoundError" or just "SyntaxError"
                        if any(err in next_line for err in ("SyntaxError", "IndentationError", "NameError", "TypeError", "AttributeError", "ImportError", "FileNotFoundError", "ModuleNotFoundError")):
                            error_msg = next_line
                            break
                
                if not error_msg:
                    error_msg = "Error detected in this file (check traceback)"

                # Handle Windows paths and make relative to repo
                source_file = raw_path
                if "cloned_repos" in raw_path.replace("\\", "/"):
                    parts_path = raw_path.replace("\\", "/").split("/")
                    if "cloned_repos" in parts_path:
                        idx = parts_path.index("cloned_repos")
                        if idx + 2 < len(parts_path):
                            source_file = "/".join(parts_path[idx+2:])

                if "site-packages" not in raw_path and ".venv" not in raw_path:
                    bug_type = _classify_bug(error_msg + " " + output)
                    failures.append({
                        "file": source_file,
                        "line": lineno,
                        "error_message": error_msg,
                        "bug_type": bug_type,
                    })
                    found_specific_src = True
            except (IndexError, ValueError):
                pass

        # Also look for the "path/to/file.py:123: Error" style
        # Careful with Windows drive letters (C:) 
        elif ".py:" in line and ": " in line:
            # Skip library paths
            if "site-packages" in line or ".venv" in line or "AppData" in line:
                i += 1
                continue
                
            # Split by ": " to find the error message first
            parts_msg = line.split(": ", 1)
            if len(parts_msg) == 2:
                file_line_part = parts_msg[0].strip().lstrip("E").strip()
                error_msg = parts_msg[1].strip()
                
                # Split file_line_part by ":" from the right to get line number
                parts_path = file_line_part.rsplit(":", 1)
                if len(parts_path) == 2:
                    raw_path = parts_path[0]
                    try:
                        lineno = int(parts_path[1])
                    except ValueError:
                        lineno = 0
                    
                    source_file = raw_path
                    if "cloned_repos" in raw_path.replace("\\", "/"):
                        pp = raw_path.replace("\\", "/").split("/")
                        if "cloned_repos" in pp:
                            idx = pp.index("cloned_repos")
                            if idx + 2 < len(pp):
                                source_file = "/".join(pp[idx+2:])

                    bug_type = _classify_bug(error_msg + " " + output)
                    failures.append({
                        "file": source_file,
                        "line": lineno,
                        "error_message": error_msg,
                        "bug_type": bug_type,
                    })
                    found_specific_src = True

        i += 1

    # Priority 2: Fallback to the test file itself ONLY if no specific source file was found
    if not found_specific_src:
        for line in lines:
            if "::ERROR" in line or ("FAILED" in line and "::" in line):
                error_msg = line.strip()
                bug_type = _classify_bug(error_msg, output)
                failures.append({
                    "file": test_file,
                    "line": 0,
                    "error_message": error_msg,
                    "bug_type": bug_type,
                })

    # Deduplicate by (file, line, error_message)
    seen = set()
    unique = []
    for f in failures:
        key = (f["file"], f["line"], f["error_message"][:100])
        if key not in seen:
            seen.add(key)
            unique.append(f)
    if unique:
        logger.info(f"Parsed {len(unique)} unique failure(s) for {test_file}")
    return unique


def _classify_bug(text: str, full_output: str = "") -> str:
    """
    Classify a bug into one of the six categories based on keywords.
    Categories: LINTING | SYNTAX | LOGIC | TYPE_ERROR | IMPORT | INDENTATION
    """
    t = (text + " " + full_output).lower()
    if "indentationerror" in t or "unexpected indent" in t or "indentation" in t:
        return "INDENTATION"
    if "syntaxerror" in t or "invalid syntax" in t or "syntax" in t or "colon" in t or "missing" in t:
        return "SYNTAX"
    if "importerror" in t or "modulenotfounderror" in t or "cannot import" in t:
        return "IMPORT"
    if "typeerror" in t or "type error" in t or "unsupported operand" in t:
        return "TYPE_ERROR"
    if "flake8" in t or "pylint" in t or "pep8" in t or "lint" in t or "unused" in t or "import" in t:
        return "LINTING"
    return "LOGIC"
