"""Opt-in, read-only AdaptiveOS process observation client.

Only basic permitted process metadata is collected. CPU percentages are
observations over a sampling window, not exact CPU burst durations.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import psutil


def iso_utc(timestamp: float | None) -> str | None:
    if timestamp is None:
        return None
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def collect_snapshot(observation_seconds: float) -> dict:
    """Collect a process list, sample CPU use, and tolerate per-process errors."""
    sampled: list[tuple[psutil.Process, dict]] = []
    for process in psutil.process_iter():
        try:
            process.cpu_percent(interval=None)
            info = process.as_dict(
                attrs=["pid", "name", "create_time", "status", "memory_info"],
                ad_value=None,
            )
            sampled.append((process, info))
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        except Exception as exc:  # Some platforms expose process metadata differently.
            print(f"Skipped one process during collection: {exc}", file=sys.stderr)

    time.sleep(observation_seconds)
    processes: list[dict] = []
    for process, info in sampled:
        try:
            cpu_percent = max(0.0, float(process.cpu_percent(interval=None) or 0.0))
            memory_info = info.get("memory_info")
            memory_mb = (
                round(memory_info.rss / (1024 * 1024), 2)
                if memory_info is not None
                else None
            )
            name = info.get("name") or f"process-{info.get('pid', 'unknown')}"
            processes.append(
                {
                    "pid": int(info["pid"]),
                    "name": str(name)[:160],
                    "createdAt": iso_utc(info.get("create_time")),
                    "status": str(info.get("status") or "")[:40] or None,
                    "cpuPercent": round(cpu_percent, 2),
                    "memoryMb": memory_mb,
                }
            )
        except (psutil.NoSuchProcess, psutil.AccessDenied, psutil.ZombieProcess):
            continue
        except (KeyError, TypeError, ValueError, OverflowError):
            continue

    return {
        "schemaVersion": "1",
        "observedAt": datetime.now(timezone.utc).isoformat(),
        "observationSeconds": observation_seconds,
        "processes": processes[:2000],
    }


def send_snapshot(server_url: str, snapshot: dict, token: str | None) -> None:
    base = server_url.rstrip("/")
    if not base.startswith(("http://", "https://")):
        raise ValueError("Server URL must start with http:// or https://.")
    endpoint = f"{base}/api/agent/snapshots"
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = Request(
        endpoint,
        data=json.dumps(snapshot).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8"))
        print(
            "Snapshot uploaded: "
            f"id={payload.get('id')} processes={payload.get('processCount')}"
        )


def summarize(snapshot: dict, active_only: bool) -> None:
    processes = snapshot["processes"]
    if active_only:
        processes = [
            process
            for process in processes
            if process["status"] == "running" or (process["cpuPercent"] or 0) >= 0.5
        ]
    top = sorted(processes, key=lambda process: process["cpuPercent"] or 0, reverse=True)[:8]
    print(
        f"Observed {len(snapshot['processes'])} accessible processes over "
        f"{snapshot['observationSeconds']:.1f}s."
    )
    print("PID      CPU %    Memory MB   Name")
    for process in top:
        cpu = process["cpuPercent"] if process["cpuPercent"] is not None else 0
        memory = process["memoryMb"] if process["memoryMb"] is not None else 0
        print(
            f"{process['pid']:<8} {cpu:>6.1f}    {memory:>9.1f}   {process['name']}"
        )
    print("CPU and memory are observations. Burst times are estimated by AdaptiveOS.")


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Opt-in, read-only AdaptiveOS process observation agent."
    )
    parser.add_argument(
        "--server-url",
        default=os.environ.get("ADAPTIVEOS_SERVER_URL", "http://127.0.0.1:5000"),
        help="Backend origin, e.g. http://127.0.0.1:5000 or https://your-app.example",
    )
    parser.add_argument(
        "--token",
        default=os.environ.get("AGENT_ACCESS_TOKEN"),
        help="Optional access token; may also be set in AGENT_ACCESS_TOKEN.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=2.0,
        help="CPU observation period in seconds (0.2–3600, default: 2).",
    )
    parser.add_argument(
        "--repeat",
        action="store_true",
        help="Repeat snapshots every observation interval until Ctrl+C.",
    )
    parser.add_argument(
        "--active-only",
        action="store_true",
        help="Print a summary of running/CPU-active processes; upload still includes accessible processes.",
    )
    parser.add_argument(
        "--no-upload",
        action="store_true",
        help="Show a local summary without sending the snapshot.",
    )
    args = parser.parse_args()
    if not 0.2 <= args.interval <= 3600:
        parser.error("--interval must be between 0.2 and 3600 seconds.")

    try:
        while True:
            print("Sampling accessible process metadata. Press Ctrl+C to stop.")
            snapshot = collect_snapshot(args.interval)
            summarize(snapshot, args.active_only)
            if not args.no_upload:
                try:
                    send_snapshot(args.server_url, snapshot, args.token)
                except HTTPError as exc:
                    message = exc.read().decode("utf-8", errors="replace")[:400]
                    print(f"Upload rejected (HTTP {exc.code}): {message}", file=sys.stderr)
                except (URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as exc:
                    print(f"Could not upload snapshot: {exc}", file=sys.stderr)
            if not args.repeat:
                return 0
            time.sleep(args.interval)
    except KeyboardInterrupt:
        print("\nAgent stopped. No processes were modified.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
