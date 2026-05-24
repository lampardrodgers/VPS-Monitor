from __future__ import annotations

from urllib.parse import quote
from urllib.request import Request, urlopen
import json
import os

from .config import NotificationConfig


def send_notification(config: NotificationConfig, title: str, body: str) -> None:
    errors: list[str] = []
    if config.telegram.enabled:
        try:
            _send_telegram(config.telegram.bot_token_env, config.telegram.chat_id_env, title, body)
        except Exception as exc:  # pragma: no cover - network error path
            errors.append(f"telegram: {exc}")
    if config.bark.enabled:
        try:
            _send_bark(config.bark.url_env, title, body)
        except Exception as exc:  # pragma: no cover - network error path
            errors.append(f"bark: {exc}")
    if errors:
        print("notification errors:", "; ".join(errors))


def _send_telegram(bot_token_env: str, chat_id_env: str, title: str, body: str) -> None:
    bot_token = os.getenv(bot_token_env)
    chat_id = os.getenv(chat_id_env)
    if not bot_token or not chat_id:
        return
    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    payload = json.dumps({"chat_id": chat_id, "text": f"{title}\n{body}"}).encode("utf-8")
    request = Request(url, data=payload, headers={"Content-Type": "application/json"}, method="POST")
    with urlopen(request, timeout=10) as response:
        response.read()


def _send_bark(url_env: str, title: str, body: str) -> None:
    base_url = os.getenv(url_env)
    if not base_url:
        return
    url = base_url.rstrip("/") + f"/{quote(title)}/{quote(body)}"
    with urlopen(url, timeout=10) as response:
        response.read()
