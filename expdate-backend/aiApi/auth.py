import logging

import requests
from copilot import CopilotClient

logger = logging.getLogger("packing_ocr")


def get_token_user(token):
    response = requests.get(
        "https://api.github.com/user",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
        },
        timeout=10,
    )
    if not response.ok:
        logger.warning("GitHub API trả lỗi HTTP %s khi lấy thông tin user", response.status_code)
        raise RuntimeError(
            f"Token không đọc được thông tin GitHub account: "
            f"HTTP {response.status_code}"
        )
    return response.json()


def get_token_copilot_quota(token):
    response = requests.get(
        "https://api.github.com/copilot_internal/user",
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "Editor-Version": "vscode/1.0.0",
            "Editor-Plugin-Version": "copilot-api/1.0.0",
        },
        timeout=10,
    )
    if not response.ok:
        logger.warning(
            "Copilot API trả lỗi HTTP %s khi lấy quota",
            response.status_code,
        )
        raise RuntimeError(
            "Không đọc được Copilot quota: "
            f"HTTP {response.status_code}"
        )
    return response.json()


def create_token_client(token):
    return CopilotClient(
        github_token=token,
        use_logged_in_user=False,
    )