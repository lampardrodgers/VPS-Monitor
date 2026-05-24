from __future__ import annotations

from pathlib import Path
import re
import shutil
import subprocess

MIN_CHECK_INTERVAL_SECONDS = 1
MAX_CHECK_INTERVAL_SECONDS = 86400
DEFAULT_CHECK_INTERVAL_SECONDS = 900
DEFAULT_TIMER_PATH = Path("/etc/systemd/system/vpsmon-agent.timer")


def validate_check_interval(seconds: int) -> int:
    seconds = int(seconds)
    if seconds < MIN_CHECK_INTERVAL_SECONDS or seconds > MAX_CHECK_INTERVAL_SECONDS:
        raise ValueError(
            f"check interval must be between {MIN_CHECK_INTERVAL_SECONDS} and {MAX_CHECK_INTERVAL_SECONDS} seconds"
        )
    return seconds


def render_timer_unit(interval_seconds: int) -> str:
    interval_seconds = validate_check_interval(interval_seconds)
    return f"""# /etc/systemd/system/vpsmon-agent.timer
[Unit]
Description=Run VPSMonitor agent every {interval_seconds} seconds

[Timer]
OnBootSec=2min
OnUnitActiveSec={interval_seconds}s
AccuracySec=1s
Persistent=true

[Install]
WantedBy=timers.target

# Enable with:
# sudo systemctl daemon-reload
# sudo systemctl enable --now vpsmon-agent.timer
"""


def read_timer_interval_seconds(timer_path: Path = DEFAULT_TIMER_PATH) -> int | None:
    try:
        content = timer_path.read_text()
    except OSError:
        return None
    match = re.search(r"^OnUnitActiveSec=(\S+)\s*$", content, re.MULTILINE)
    if not match:
        return None
    return _parse_systemd_duration(match.group(1))


def apply_timer_interval(interval_seconds: int, timer_path: Path = DEFAULT_TIMER_PATH) -> dict[str, object]:
    interval_seconds = validate_check_interval(interval_seconds)
    current = read_timer_interval_seconds(timer_path)
    if current == interval_seconds:
        return {"applied": True, "changed": False, "current_interval_seconds": current}
    if shutil.which("systemctl") is None:
        return {
            "applied": False,
            "changed": False,
            "current_interval_seconds": current,
            "error": "systemctl is not available",
        }
    try:
        timer_path.write_text(render_timer_unit(interval_seconds))
        subprocess.run(["systemctl", "daemon-reload"], check=True, capture_output=True, text=True, timeout=10)
        subprocess.run(
            ["systemctl", "restart", "vpsmon-agent.timer"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        return {
            "applied": False,
            "changed": False,
            "current_interval_seconds": current,
            "error": str(exc),
        }
    return {
        "applied": True,
        "changed": True,
        "current_interval_seconds": interval_seconds,
    }


def _parse_systemd_duration(value: str) -> int | None:
    match = re.fullmatch(r"(\d+)(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hour|hours)?", value)
    if not match:
        return None
    amount = int(match.group(1))
    unit = match.group(2) or "s"
    if unit.startswith("h"):
        return amount * 3600
    if unit.startswith("m"):
        return amount * 60
    return amount
