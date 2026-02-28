"""
agents.py – Multi-agent CI/CD Healing Pipeline

Architecture (sequential phases with concurrent test execution):
  1. GGU AI-Scan-Agent   – find all test files in the cloned repo
  2. GGU AI-Test-Agent   – run tests in parallel (concurrent.futures + Docker/subprocess)
  3. GGU AI-Diagnosis-Agent   – classify failures by bug type
  4. GGU AI-Heal-Agent         – call LLM to generate and apply patches
  5. GGU AI-Verification-Agent – commit, push, poll GitHub CI status (up to 5 retries)

The shared `runs` dict is updated throughout for live frontend polling.
"""

import os
import re
import time
import logging
import requests
import concurrent.futures
from pathlib import Path
from datetime import datetime, timezone

from dotenv import load_dotenv

from git_utils import clone_repo, create_branch, commit_changes, push_changes, get_all_files, cleanup_clone
from docker_runner import run_tests
from llm_client import generate_fix, explain_error, generate_tests_for_code
from results_generator import generate_results

load_dotenv()
logger = logging.getLogger(__name__)

GITHUB_PAT = os.getenv("GITHUB_PAT", "")
MAX_RETRIES = 5
MAX_WORKERS = 4   # parallel test execution


# ---------------------------------------------------------------------------
# Public entry point called from main.py
# ---------------------------------------------------------------------------

def run_pipeline(
    run_id: str,
    repo_url: str,
    team_name: str,
    leader_name: str,
    branch_name: str,
    runs: dict,
) -> dict:
    """
    Full autonomous healing pipeline.
    Returns the final results dict (also written to results.json in the clone dir).
    """
    start_time = datetime.now(timezone.utc)
    live = runs[run_id]["live"]
    commit_count = 0
    all_fixes = []
    ci_timeline = []
    repo = None

    def update_live(phase: str | None = None, message: str | None = None, append_terminal: str | None = None):
        if phase: live["phase"] = phase
        if message: live["message"] = message
        if append_terminal: live["terminal_output"] += append_terminal
        logger.info(f"[{run_id}] [{phase}] {message}")

    try:
        # ---------------------------------------------------------------
        # 1. DISCOVERY – clone & find tests
        # ---------------------------------------------------------------
        update_live("discovery", "Cloning repository…")
        repo = clone_repo(repo_url, run_id, pat=GITHUB_PAT or None, team_name=team_name, leader_name=leader_name)

        # Populate file tree for Monaco editor
        live["files"] = get_all_files(repo)
        update_live("discovery", f"Cloned repo – {len(live['files'])} files indexed")

        # Discover test files AND source files for comprehensive checking
        test_files = _discover_tests(repo.working_dir, include_source=True)
        update_live("discovery", f"Found {len(test_files)} file(s) to scan: {test_files}")

        if not test_files:
            update_live("generation", "No files found to scan.")
            return _build_empty_result(
                run_id, repo_url, team_name, leader_name, branch_name,
                start_time, "PASSED", repo.working_dir
            )

        # ---------------------------------------------------------------
        # 2. Create the AI-Fix branch BEFORE touching anything
        # ---------------------------------------------------------------
        update_live("branching", f"Creating branch: {branch_name}")
        create_branch(repo, branch_name)

        # ---------------------------------------------------------------
        # 3. ITERATIVE HEAL LOOP (up to MAX_RETRIES)
        # ---------------------------------------------------------------
        final_status = "FAILED"

        for iteration in range(1, MAX_RETRIES + 1):
            iter_start = datetime.now(timezone.utc)
            update_live(
                "execution",
                f"Iteration {iteration}/{MAX_RETRIES} – running {len(test_files)} test file(s) in parallel…"
            )
            update_live(append_terminal=f"\n>>> Running tests: {', '.join(test_files)}\n")

            # --- Parallel test execution ---
            all_failures = []
            output_blocks = []
            with concurrent.futures.ThreadPoolExecutor(max_workers=MAX_WORKERS) as executor:
                future_to_file = {
                    executor.submit(run_tests, repo.working_dir, tf): tf
                    for tf in test_files
                }
                for future in concurrent.futures.as_completed(future_to_file):
                    tf = future_to_file[future]
                    try:
                        result = future.result()
                        # Capture output for frontend
                        output_blocks.append(f"--- OUTPUT FOR {tf} ---\n{result.stdout}\n{result.stderr}\n")
                        if not result.passed:
                            all_failures.extend(result.failures)
                    except Exception as exc:
                        logger.exception(f"Test execution error for {tf}: {exc}")
            
            # Update live output
            if output_blocks:
                update_live(append_terminal="\n" + "\n".join(output_blocks) + "\n")

            iter_status = "PASS" if not all_failures else "FAIL"
            ci_timeline.append({
                "iteration": iteration,
                "status": iter_status,
                "timestamp": iter_start.isoformat(),
                "failures_count": len(all_failures),
                "message": f"{'All tests passed' if not all_failures else f'{len(all_failures)} failure(s) found'}",
            })
            live["iterations"] = ci_timeline

            if not all_failures:
                final_status = "PASSED"
                update_live("done", f"✅ All tests passing after iteration {iteration}!")
                break

            # --- Diagnose & Fix ---
            filtered_failures = []
            for failure in all_failures:
                err_msg = failure.get("error_message", "")
                if err_msg and str(err_msg).strip() and str(err_msg).strip().lower() != "none":
                    filtered_failures.append(failure)
                else:
                    update_live(append_terminal=f"\n[SKIP] Ignoring failure in {failure.get('file', 'unknown')} as it has no error description.\n")
            
            all_failures = filtered_failures

            update_live("fixing", f"Found {len(all_failures)} valid failure(s) – applying LLM fixes…")
            fixed_files = []

            for i, failure in enumerate(all_failures):
                current_file = failure.get("file", "unknown")
                update_live("fixing", f"Applying LLM fix {i+1}/{len(all_failures)}: {current_file}")
                # Build a comprehensive project context by including the content of all indexed source files.
                # This helps the AI fix cross-file logic errors and understand the full architecture.
                project_context_parts = ["Full Project Source Code Context:"]
                extensions = {".py", ".js", ".ts", ".jsx", ".tsx"}
                # Use current in-memory content which reflects any fixes applied in this iteration so far
                for f in live.get("files", []):
                    path = f["path"]
                    if path.lower().endswith(tuple(extensions)):
                        project_context_parts.append(f"--- File: {path} ---\n{f.get('content', '')}\n")
                context_str = "\n".join(project_context_parts)

                fix_entry = _apply_fix(repo.working_dir, failure, iteration, project_context=context_str)
                all_fixes.append(fix_entry)
                if fix_entry["status"] == "fixed":
                    fixed_files.append(fix_entry["file"])
                    # Update live files in memory for the Monaco editor
                    for f in live.get("files", []):
                        # Normalize slashes to ensure it matches
                        if f["path"].replace("\\", "/") == fix_entry["file"].replace("\\", "/"):
                            try:
                                f["content"] = (Path(repo.working_dir) / f["path"]).read_text(encoding="utf-8", errors="replace")
                            except Exception as e:
                                logger.error(f"Failed to update live file content for {f['path']}: {e}")

            # Re-enable local commits for fixed files (per user request: separate commit and push)
            if fixed_files:
                update_live("fixing", f"✅ Applied fixes to {len(fixed_files)} file(s). Committing locally...")
                for f in fixed_files:
                    update_live(append_terminal=f"\n[WRITE] Fixed {f}\n")
                
                try:
                    commit_msg = f"Fixed issues in: {', '.join(fixed_files)}"
                    sha = commit_changes(repo, [], commit_msg)
                    update_live("fixing", f"✅ Committed locally: {sha}. Remember to push to GitHub if desired.")
                    commit_count += 1
                except Exception as e:
                    logger.error(f"Local commit failed: {e}")
                
                # Push is handled separately or prompted in UI
                push_success = False 
            else:
                push_success = False

            # --- Poll GitHub CI (optional, best-effort) ---
            if GITHUB_PAT and push_success:
                update_live("ci_poll", "Waiting for GitHub Actions CI to complete...")
                ci_status = _poll_github_ci(repo_url, branch_name)
                update_live("ci_poll", f"GitHub CI Status: {ci_status}")
            elif GITHUB_PAT:
                update_live("ci_poll", "Skipping CI poll (push failed or no changes).")

            if iteration == MAX_RETRIES:
                update_live("done", f"❌ Max retries ({MAX_RETRIES}) reached – some failures remain.")

        # ---------------------------------------------------------------
        # 4. Generate results
        # ---------------------------------------------------------------
        end_time = datetime.now(timezone.utc)
        results = generate_results(
            run_id=run_id,
            repo_url=repo_url,
            team_name=team_name,
            leader_name=leader_name,
            branch_name=branch_name,
            fixes=all_fixes,
            ci_iterations=ci_timeline,
            start_time=start_time,
            end_time=end_time,
            final_status=final_status,
            commit_count=commit_count,
            output_dir=repo.working_dir,
        )
        # ---------------------------------------------------------------------------
        # Record the local path for terminal / file access
        # ---------------------------------------------------------------------------
        from state import RUN_PATHS, save_projects
        RUN_PATHS[run_id] = Path(repo.working_dir)
        save_projects()

        return results

    finally:
        # The user wants to download the fixed code, so we skip cleanup for now.
        # Cleanups should be handled by a separate background task or periodic check.
        logger.info(f"[{run_id}] Skipping cleanup to allow for download.")
        pass


# ---------------------------------------------------------------------------
# Sub-agent: Discovery
# ---------------------------------------------------------------------------

def _discover_tests(repo_dir: str, include_source: bool = False) -> list[str]:
    """
    Find all test files (test_*.py, *_test.py, *.test.js, *.test.ts, etc.) in the repo.
    If include_source=True, also includes all .py, .js, .ts files for scanning.
    Returns relative paths.
    """
    root = Path(repo_dir)
    test_files = []
    skip = {".git", "__pycache__", ".tox", "node_modules", ".venv", "venv", "dist", "build"}
    
    # Python files
    for p in root.rglob("*.py"):
        if any(s in p.parts for s in skip): continue
        if include_source or p.stem.startswith("test_") or p.stem.endswith("_test"):
            test_files.append(str(p.relative_to(root)).replace("\\", "/"))
            
    # JS/TS files
    for ext in ("*.js", "*.ts", "*.jsx", "*.tsx"):
        for p in root.rglob(ext):
            if any(s in p.parts for s in skip): continue
            if include_source or ".test." in p.name or ".spec." in p.name:
                test_files.append(str(p.relative_to(root)).replace("\\", "/"))
                
    return list(set(test_files)) # deduplicate just in case


def _generate_tests(repo_dir: str, files: list[dict]) -> list[str]:
    """
    Generate multiple test files based on the most relevant source files.
    Returns a list of generated test filenames.
    """
    # Score all files and pick top candidates
    scored_files = []
    extensions = {".py", ".js", ".ts", ".jsx", ".tsx"}
    
    for f in files:
        path = f["path"]
        ext = Path(path).suffix.lower()
        if ext in extensions and "test" not in path.lower() and "spec" not in path.lower() and "setup" not in path.lower():
            content = f.get("content", "")
            score = len(content)
            if "src/" in path or "lib/" in path:
                score *= 2
            scored_files.append({"score": score, "file": f})
    
    # Sort by score descending and take top 5
    scored_files.sort(key=lambda x: x["score"], reverse=True)
    candidates = [x["file"] for x in scored_files[:5]]
    
    if not candidates:
        logger.warning("No suitable source files found for test generation.")
        return []
    
    generated_files = []
    
    # Build a comprehensive project context by including the content of all indexed files.
    # This fulfills the user request to "pass all the code to the api".
    project_context_parts = ["Full Project Source Code Context:"]
    for f in files:
        path = f["path"]
        content = f.get("content", "")
        # Only include source files to keep context manageable but comprehensive
        if path.lower().endswith(tuple(extensions)):
            project_context_parts.append(f"--- File: {path} ---\n{content}\n")
    
    project_context = "\n".join(project_context_parts)
    
    lang_map = {".py": "Python", ".js": "JavaScript", ".ts": "TypeScript", ".jsx": "JavaScript (React)", ".tsx": "TypeScript (React)"}

    for candidate in candidates:
        path_obj = Path(candidate["path"])
        language = lang_map.get(path_obj.suffix, "Unknown")
        
        try:
            test_code = generate_tests_for_code(candidate["content"], language=language, project_context=project_context)
            
            # Determine test filename
            if path_obj.suffix == ".py":
                test_filename = f"test_{path_obj.stem}.py"
            else:
                test_filename = f"{path_obj.stem}.test{path_obj.suffix}"
                
            test_path = Path(repo_dir) / test_filename
            test_path.write_text(test_code, encoding="utf-8")
            logger.info(f"Generated autonomous {language} test file: {test_filename}")
            generated_files.append(test_filename)
        except Exception as exc:
            logger.error(f"Failed to generate tests for {candidate['path']}: {exc}")
            
    return generated_files


# ---------------------------------------------------------------------------
# Sub-agent: Fix
# ---------------------------------------------------------------------------

def _apply_fix(repo_dir: str, failure: dict, iteration: int, project_context: str = "") -> dict:
    """
    Apply an LLM-generated fix to the failing file.
    Returns a fix_entry dict for the results table.
    """
    src_file = failure.get("file", "")
    line_no = failure.get("line", 0)
    error_msg = failure.get("error_message", "")
    bug_type = failure.get("bug_type", "LOGIC")

    full_path = Path(repo_dir) / src_file
    
    fix_entry = {
        "file": src_file,
        "bug_type": bug_type,
        "line": line_no,
        "error_message": error_msg,
        "commit_message": "",
        "status": "failed",
        "sha": None,
        "iteration": iteration,
        "agent": "GGU AI-Heal-Agent",
    }

    fpath_str = str(full_path).replace("\\", "/")
    if "site-packages" in fpath_str or ".venv" in fpath_str or "AppData" in fpath_str:
        logger.warning(f"BLOCKED: Attempted to fix file outside of repository context: {src_file}")
        return fix_entry

    if not full_path.exists():
        logger.warning(f"Source file not found: {full_path}")
        return fix_entry

    try:
        original_code = full_path.read_text(encoding="utf-8", errors="replace")
        fixed_code = generate_fix(
            bug_type=bug_type,
            file_path=src_file,
            line_number=line_no,
            error_message=error_msg,
            original_code=original_code,
            project_context=project_context,
        )

        if fixed_code and fixed_code != original_code:
            full_path.write_text(fixed_code, encoding="utf-8")
            commit_msg = explain_error(bug_type, error_msg)
            fix_entry["commit_message"] = commit_msg
            fix_entry["status"] = "fixed"
            logger.info(f"Fixed {src_file}:{line_no} ({bug_type})")
        else:
            logger.warning(f"LLM returned same code for {src_file} – no change applied")

    except Exception as exc:
        logger.exception(f"Fix failed for {src_file}: {exc}")
        fix_entry["error"] = str(exc)

    return fix_entry


# ---------------------------------------------------------------------------
# Sub-agent: GitHub CI Polling
# ---------------------------------------------------------------------------

def _poll_github_ci(repo_url: str, branch: str, max_polls: int = 10, interval: int = 15) -> str:
    """
    Poll GitHub Checks API for the latest CI status on *branch*.
    Returns 'success', 'failure', 'pending', or 'unknown'.
    Requires GITHUB_PAT with repo scope.
    """
    # Parse owner/repo from URL
    match = re.search(r"github\.com[:/](.+?)/(.+?)(?:\.git)?$", repo_url)
    if not match:
        return "unknown"
    owner, repo_name = match.group(1), match.group(2)

    headers = {
        "Authorization": f"token {GITHUB_PAT}",
        "Accept": "application/vnd.github.v3+json",
    }
    url = f"https://api.github.com/repos/{owner}/{repo_name}/commits/{branch}/check-runs"

    for _ in range(max_polls):
        try:
            resp = requests.get(url, headers=headers, timeout=10)
            if resp.status_code == 200:
                data = resp.json()
                runs = data.get("check_runs", [])
                if not runs:
                    time.sleep(interval)
                    continue
                statuses = [r["conclusion"] for r in runs if r.get("conclusion")]
                if "failure" in statuses:
                    return "failure"
                if all(s == "success" for s in statuses) and statuses:
                    return "success"
                time.sleep(interval)
            elif resp.status_code in (401, 403):
                logger.error(f"GitHub API Auth Failed (403). Check GITHUB_PAT permissions.")
                return "auth_error"
            else:
                break
        except Exception as exc:
            logger.warning(f"CI poll error: {exc}")
            break

    return "pending"


# ---------------------------------------------------------------------------
# Helper
# ---------------------------------------------------------------------------

def _build_empty_result(run_id, repo_url, team_name, leader_name, branch_name, start_time, status, output_dir):
    """Return a minimal results dict when there's nothing to fix."""
    end_time = datetime.now(timezone.utc)
    return generate_results(
        run_id=run_id,
        repo_url=repo_url,
        team_name=team_name,
        leader_name=leader_name,
        branch_name=branch_name,
        fixes=[],
        ci_iterations=[{
            "iteration": 1,
            "status": "PASS",
            "timestamp": start_time.isoformat(),
            "failures_count": 0,
            "message": "No test files found – treated as passing",
        }],
        start_time=start_time,
        end_time=end_time,
        final_status=status,
        commit_count=0,
        output_dir=output_dir,
    )

