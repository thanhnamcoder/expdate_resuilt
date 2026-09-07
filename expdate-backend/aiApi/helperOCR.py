import asyncio
import ast
import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

import requests
from dotenv import load_dotenv
from dotenv import set_key

from .authCopilot import create_token_client, get_token_copilot_quota


logger = logging.getLogger("packing_ocr")


PROJECT_ROOT = Path(__file__).resolve().parent.parent
load_dotenv(PROJECT_ROOT / ".env")

MAX_IMAGES_PER_TOKEN = max(1, int(os.getenv("OCR_MAX_IMAGES_PER_TOKEN", "1")))
MAX_CONCURRENT_COPILOT_RUNTIMES = max(
	1,
	int(os.getenv("OCR_MAX_CONCURRENT_COPILOT_RUNTIMES", "1")),
)
DOWNLOAD_LIMIT_BYTES = 15 * 1024 * 1024
PROMPT_PATH = Path(__file__).with_name("promptOCR.txt")
TOKEN_QUARANTINE_PATH = Path(
	os.getenv("COPILOT_TOKEN_QUARANTINE_FILE") or PROJECT_ROOT / ".token_quarantine.json"
)
TOKEN_QUARANTINE_FALLBACK_SECONDS = 31 * 24 * 60 * 60
TOKEN_QUARANTINE_LOCK = threading.Lock()
COPILOT_CONFIG_LOCK = threading.Lock()


def _reload_copilot_env():
	load_dotenv(PROJECT_ROOT / ".env", override=True)


def _load_ocr_prompt():
	try:
		source = PROMPT_PATH.read_text(encoding="utf-8")
		tree = ast.parse(source, filename=str(PROMPT_PATH))
	except (OSError, SyntaxError) as error:
		raise RuntimeError(f"Không đọc được prompt OCR: {PROMPT_PATH}") from error

	for statement in tree.body:
		if isinstance(statement, ast.Assign):
			for target in statement.targets:
				if isinstance(target, ast.Name) and target.id == "OCR_PROMPT":
					try:
						prompt = ast.literal_eval(statement.value)
					except (ValueError, TypeError) as error:
						raise RuntimeError("OCR_PROMPT trong promptOCR.txt không hợp lệ") from error
					if not isinstance(prompt, str) or not prompt.strip():
						raise RuntimeError("OCR_PROMPT trong promptOCR.txt đang rỗng")
					return prompt

	raise RuntimeError("Không tìm thấy biến OCR_PROMPT trong promptOCR.txt")


OCR_PROMPT = _load_ocr_prompt()


class CopilotOCRRequestError(Exception):
	def __init__(self, status_code, detail):
		super().__init__(detail)
		self.status_code = status_code
		self.detail = detail


def _token_key(token):
	return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _is_valid_copilot_token(token):
	return token.startswith("github_pat_") and len(token) > len("github_pat_")


def _read_quarantined_tokens():
	try:
		with TOKEN_QUARANTINE_PATH.open(encoding="utf-8") as quarantine_file:
			stored = json.load(quarantine_file)
	except (FileNotFoundError, json.JSONDecodeError, OSError):
		return {}

	now = time.time()
	return {
		key: float(expires_at)
		for key, expires_at in stored.items()
		if float(expires_at) > now
	}


def _write_quarantined_tokens(tokens):
	TOKEN_QUARANTINE_PATH.parent.mkdir(parents=True, exist_ok=True)
	temporary_path = TOKEN_QUARANTINE_PATH.with_suffix(".tmp")
	with temporary_path.open("w", encoding="utf-8") as quarantine_file:
		json.dump(tokens, quarantine_file, indent=2)
	os.replace(temporary_path, TOKEN_QUARANTINE_PATH)


def is_token_quarantined(token):
	with TOKEN_QUARANTINE_LOCK:
		return _token_key(token) in _read_quarantined_tokens()


def _quota_reset_timestamp(token):
	try:
		credit = get_token_copilot_quota(token)
		reset_value = credit.get("quota_reset_date_utc") or credit.get("quota_reset_date")
		if not reset_value:
			return None
		if len(reset_value) == 10:
			reset_value = f"{reset_value}T00:00:00+00:00"
		reset_at = datetime.fromisoformat(reset_value.replace("Z", "+00:00"))
		if reset_at.tzinfo is None:
			reset_at = reset_at.replace(tzinfo=timezone.utc)
		timestamp = reset_at.timestamp()
		return timestamp if timestamp > time.time() else None
	except Exception as error:
		logger.warning("Không lấy được ngày reset quota của token ...%s: %s", token[-4:], error)
		return None


def quarantine_token(token):
	expires_at = _quota_reset_timestamp(token)
	if expires_at is None:
		expires_at = time.time() + TOKEN_QUARANTINE_FALLBACK_SECONDS
	with TOKEN_QUARANTINE_LOCK:
		quarantined = _read_quarantined_tokens()
		quarantined[_token_key(token)] = expires_at
		_write_quarantined_tokens(quarantined)
	logger.warning(
		"Token ...%s bị quota, không dùng đến %s",
		token[-4:],
		datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat(),
	)


def get_copilot_tokens(include_quarantined=False):
	_reload_copilot_env()
	raw_tokens = os.getenv("COPILOT_GITHUB_TOKENS", "")
	tokens = [
		token.strip()
		for token in re.split(r"[,\r\n]+", raw_tokens)
		if _is_valid_copilot_token(token.strip())
	]
	if not tokens:
		token = os.getenv("COPILOT_GITHUB_TOKEN", "").strip()
		if _is_valid_copilot_token(token):
			tokens.append(token)
	if not tokens:
		raise CopilotOCRRequestError(
			500,
			"Thiếu COPILOT_GITHUB_TOKENS hoặc COPILOT_GITHUB_TOKEN trong .env",
		)
	if include_quarantined:
		logger.info("Đã nạp %d token để kiểm tra credit", len(tokens))
		return tokens
	active_tokens = [token for token in tokens if not is_token_quarantined(token)]
	if not active_tokens:
		raise CopilotOCRRequestError(503, "Tất cả token Copilot đang chờ reset quota")
	logger.info(
		"Đã nạp %d/%d token OCR khả dụng: %s",
		len(active_tokens),
		len(tokens),
		[f"...{token[-4:]}" for token in active_tokens],
	)
	return active_tokens


def get_copilot_config():
	"""Return safe Copilot configuration metadata for the admin API."""
	tokens = get_copilot_tokens(include_quarantined=True)
	return {
		"model": os.getenv("COPILOT_MODEL", "").strip(),
		"tokens": [f"...{token[-4:]}" for token in tokens],
	}


def update_copilot_config(model=None, token=None):
	"""Persist Copilot model and optionally append one token to .env."""
	_reload_copilot_env()
	if model is not None:
		model = str(model).strip()
		if not model:
			raise ValueError("model không được để trống")
	if token is not None:
		token = str(token).strip()
		if not token:
			raise ValueError("token không được để trống")
		if not _is_valid_copilot_token(token):
			raise ValueError("token không đúng định dạng")

	with COPILOT_CONFIG_LOCK:
		current_tokens = [
			item.strip()
			for item in re.split(r"[,\r\n]+", os.getenv("COPILOT_GITHUB_TOKENS", ""))
			if _is_valid_copilot_token(item.strip())
		]
		if not current_tokens:
			fallback = os.getenv("COPILOT_GITHUB_TOKEN", "").strip()
			if _is_valid_copilot_token(fallback):
				current_tokens.append(fallback)
		token_exists = token is not None and token in current_tokens
		if token and not token_exists:
			current_tokens.append(token)

		if model is not None:
			set_key(str(PROJECT_ROOT / ".env"), "COPILOT_MODEL", model)
			os.environ["COPILOT_MODEL"] = model
		if token is not None and not token_exists:
			set_key(
				str(PROJECT_ROOT / ".env"),
				"COPILOT_GITHUB_TOKENS",
				",".join(current_tokens),
			)
			os.environ["COPILOT_GITHUB_TOKENS"] = ",".join(current_tokens)

	config = get_copilot_config()
	if token_exists:
		config["message"] = "Token đã tồn tại"
		config["added"] = False
	elif token is not None:
		config["message"] = "Đã thêm token"
		config["added"] = True
	return config


def _download_image(image_url):
	logger.info("Bắt đầu tải ảnh: %s", image_url)
	parsed_url = urlparse(image_url)
	if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
		raise CopilotOCRRequestError(400, "image_url phải là URL http hoặc https hợp lệ")

	try:
		response = requests.get(image_url, stream=True, timeout=20)
		response.raise_for_status()
	except requests.RequestException as error:
		raise CopilotOCRRequestError(502, f"Không tải được ảnh: {error}") from error

	content_type = response.headers.get("content-type", "").split(";", 1)[0]
	if content_type and not content_type.startswith("image/"):
		response.close()
		raise CopilotOCRRequestError(400, "URL không trỏ tới một file ảnh")

	suffix = Path(parsed_url.path).suffix or ".img"
	temporary = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
	temporary_path = Path(temporary.name)
	downloaded_size = 0
	try:
		for chunk in response.iter_content(chunk_size=1024 * 1024):
			if not chunk:
				continue
			downloaded_size += len(chunk)
			if downloaded_size > DOWNLOAD_LIMIT_BYTES:
				raise CopilotOCRRequestError(400, "Ảnh vượt quá giới hạn 15 MB")
			temporary.write(chunk)
		logger.info("Tải ảnh thành công: %s (%.1f KB)", image_url, downloaded_size / 1024)
		return temporary_path
	except CopilotOCRRequestError:
		temporary_path.unlink(missing_ok=True)
		raise
	except requests.RequestException as error:
		temporary_path.unlink(missing_ok=True)
		raise CopilotOCRRequestError(502, f"Không tải được ảnh: {error}") from error
	finally:
		temporary.close()
		response.close()


async def _ocr_one(image_number, image_url, session, token, prompt):
	started_at = time.perf_counter()
	image_path = await asyncio.to_thread(_download_image, image_url)
	try:
		logger.info("Ảnh %s gửi request OCR trong session của token ...%s", image_number, token[-4:])
		response = await session.send_and_wait(
			prompt,
			attachments=[
				{
					"type": "file",
					"path": str(image_path),
					"displayName": image_path.name,
					"mimeType": "image/jpeg",
				}
			],
			timeout=float(os.getenv("OCR_TIMEOUT_SECONDS", "120")),
		)
		if response is None or not getattr(response, "data", None):
			raise CopilotOCRRequestError(502, "Copilot không trả về kết quả OCR")
		result = {
			"image_index": image_number,
			"image_url": image_url,
			"token_suffix": token[-4:],
			"data": response.data.content,
		}
		logger.info("Ảnh %s OCR thành công bằng token ...%s sau %.1fs", image_number, token[-4:], time.perf_counter() - started_at)
		return result
	except Exception as error:
		logger.exception(
			"CopilotSession.send_and_wait failed for image %s with token ...%s",
			image_number,
			token[-4:],
		)
		raise CopilotOCRRequestError(502, f"OCR thất bại: {error}") from error
	finally:
		image_path.unlink(missing_ok=True)


async def ocr_image_urls(image_urls, prompt, model=None):
	"""OCR URLs with one Copilot session per token and batches of three images."""
	if not image_urls:
		raise CopilotOCRRequestError(400, "Cần ít nhất một image_url")
	if not prompt or not prompt.strip():
		raise CopilotOCRRequestError(400, "Thiếu prompt OCR")

	tokens = get_copilot_tokens()
	logger.info("Nhận batch OCR: %d ảnh, %d token, tối đa %d ảnh/token", len(image_urls), len(tokens), MAX_IMAGES_PER_TOKEN)
	queue = asyncio.Queue()
	results = {}
	runtime_limiter = asyncio.Semaphore(MAX_CONCURRENT_COPILOT_RUNTIMES)
	use_one_image_per_token = len(tokens) >= len(image_urls)
	if not use_one_image_per_token:
		for image_number, image_url in enumerate(image_urls):
			await queue.put((image_number, image_url))

	async def run_token_worker(token, assigned_item=None):
		if is_token_quarantined(token):
			logger.info("Bỏ qua token ...%s đang quarantine", token[-4:])
			return
		async with runtime_limiter:
			logger.info("Khởi động Copilot runtime cho token ...%s", token[-4:])
			client = create_token_client(token)
			try:
				await client.start()
				session = await client.create_session(model=model or os.getenv("COPILOT_MODEL"))
				logger.info("Tạo 1 Copilot session cho token ...%s", token[-4:])
				while True:
					direct_batch = assigned_item is not None
					if direct_batch:
						batch = [assigned_item]
						assigned_item = None
					elif queue.empty():
						break
					else:
						batch = []
						while len(batch) < MAX_IMAGES_PER_TOKEN and not queue.empty():
							batch.append(await queue.get())
					if not batch:
						break
					batch_results = await asyncio.gather(
						*(_ocr_one(number, url, session, token, prompt) for number, url in batch),
						return_exceptions=True,
					)
					quota_hit = False
					for item, result in zip(batch, batch_results):
						number, url = item
						if isinstance(result, CopilotOCRRequestError):
							if is_quota_error(result):
								quota_hit = True
								await queue.put(item)
							else:
								results[number] = {"image_index": number, "image_url": url, "error": result.detail}
						else:
							results[number] = result
					if quota_hit:
						if direct_batch:
							await queue.put(batch[0])
						await asyncio.to_thread(quarantine_token, token)
						logger.warning("Token ...%s hết quota, ảnh được chuyển sang token khác", token[-4:])
						break
					if not direct_batch:
						for _ in batch:
							queue.task_done()
			finally:
				await client.stop()

	if use_one_image_per_token:
		await asyncio.gather(
			*(run_token_worker(
				token,
				(image_number, image_urls[image_number])
				if image_number < len(image_urls)
				else None,
			)
			 for image_number, token in enumerate(tokens))
		)
	else:
		await asyncio.gather(*(run_token_worker(token) for token in tokens))
	while not queue.empty():
		number, url = await queue.get()
		results[number] = {"image_index": number, "image_url": url, "error": "Không còn token khả dụng"}
		queue.task_done()
	ordered_results = [results[index] for index in range(len(image_urls))]
	errors = sum(1 for result in ordered_results if "error" in result)
	logger.info("Hoàn tất batch OCR: %d/%d ảnh thành công", len(ordered_results) - errors, len(ordered_results))
	if errors == len(ordered_results):
		raise CopilotOCRRequestError(502, ordered_results[0]["error"])
	return ordered_results


def is_quota_error(error):
	message = str(error).lower()
	return any(
		marker in message
		for marker in (
			"exceeded your monthly quota",
			"monthly quota",
			"quota exceeded",
			"rate limit",
		)
	)

def get_health():
	return {"status": "ok"}
