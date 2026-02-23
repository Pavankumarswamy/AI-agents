import sys
from pathlib import Path
import json

# Mocking the globals from main.py
RUN_PATHS = {}
CLONES_DIR = Path("cloned_repos") # Assumed sibling

def get_repo_path(run_id: str) -> Path | None:
    if run_id in RUN_PATHS:
        return RUN_PATHS[run_id]
    
    if not CLONES_DIR.exists():
        return None
        
    try:
        for item in CLONES_DIR.iterdir():
            if item.is_dir():
                prefix = item.name.split('_')[0]
                if prefix == run_id:
                    return item
        return None
    except Exception:
        return None

def test_persistence():
    projects_file = Path("../data/projects.json")
    if not projects_file.exists():
        print("projects.json not found")
        return

    data = json.loads(projects_file.read_text(encoding="utf-8"))
    saved_paths = data.get("RUN_PATHS", {})
    for k, v in saved_paths.items():
        RUN_PATHS[k] = Path(v)
    
    print(f"Loaded {len(RUN_PATHS)} paths.")
    for run_id in RUN_PATHS:
        path = get_repo_path(run_id)
        exists = "EXISTS" if path and path.exists() else "MISSING"
        print(f"[{run_id}] -> {path} ({exists})")

if __name__ == "__main__":
    test_persistence()
