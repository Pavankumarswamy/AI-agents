import asyncio
import websockets
import json

async def test_terminal(run_id):
    uri = f"ws://127.0.0.1:8000/ws/terminal/{run_id}"
    try:
        async with websockets.connect(uri) as websocket:
            print(f"Connected to {uri}")
            while True:
                response = await websocket.recv()
                data = json.loads(response)
                print(f"Received: {data}")
                if data.get("type") == "error":
                    break
    except Exception as e:
        print(f"Connection failed: {e}")

if __name__ == "__main__":
    import sys
    rid = sys.argv[1] if len(sys.argv) > 1 else "local_67ce02"
    asyncio.run(test_terminal(rid))
