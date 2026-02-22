import uvicorn
import os
import sys
from pathlib import Path
from dotenv import load_dotenv

# Ensure the current directory is in sys.path so main can be imported
current_dir = Path(__file__).parent
sys.path.append(str(current_dir))

# Load environment variables
load_dotenv(current_dir / ".env")

# Import the FastAPI app
try:
    from main import app
except ImportError as e:
    print(f"Error importing app: {e}")
    sys.exit(1)

if __name__ == "__main__":
    print("Starting CI/CD Healing Agent Backend...")
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")
