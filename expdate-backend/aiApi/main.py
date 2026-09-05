import argparse
import asyncio
import hashlib
import json
import logging
import os
import re
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv
import requests

from .auth import create_token_client, get_token_copilot_quota, get_token_user


# =========================================================
# Load config từ .env
# =========================================================

load_dotenv(Path(__file__).with_name(".env"))

TOKEN_QUARANTINE_FALLBACK_SECONDS = 31 * 24 * 60 * 60
TOKEN_QUARANTINE_PATH = Path(
    os.getenv("COPILOT_TOKEN_QUARANTINE_FILE")
    or Path(__file__).with_name(".token_quarantine.json")
)
TOKEN_QUARANTINE_LOCK = threading.Lock()

# =========================================================
# Logging: log toàn bộ quá trình xử lý ra console
# =========================================================

logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO").upper(),
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("packing_ocr")


def mask_token(token: str) -> str:
    """Không bao giờ log token đầy đủ, chỉ log vài ký tự cuối để phân biệt."""
    if not token:
        return "<empty>"
    return f"...{token[-4:]}" if len(token) > 4 else "***"


def _token_key(token):
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _read_quarantined_tokens():
    try:
        with TOKEN_QUARANTINE_PATH.open(encoding="utf-8") as quarantine_file:
            stored = json.load(quarantine_file)
    except FileNotFoundError:
        return {}
    except (OSError, json.JSONDecodeError) as error:
        logger.warning("Không đọc được danh sách token quarantine: %s", error)
        return {}

    now = time.time()
    active = {}
    for key, expires_at in stored.items():
        try:
            if float(expires_at) > now:
                active[key] = float(expires_at)
        except (TypeError, ValueError):
            continue
    return active


def _write_quarantined_tokens(tokens):
    TOKEN_QUARANTINE_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary_path = TOKEN_QUARANTINE_PATH.with_suffix(".tmp")
    with temporary_path.open("w", encoding="utf-8") as quarantine_file:
        json.dump(tokens, quarantine_file, indent=2)
    os.replace(temporary_path, TOKEN_QUARANTINE_PATH)


def is_token_quarantined(token):
    with TOKEN_QUARANTINE_LOCK:
        return _token_key(token) in _read_quarantined_tokens()


def get_quota_reset_timestamp(token):
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
        logger.warning(
            "Không lấy được thời điểm reset quota cho token %s: %s",
            mask_token(token),
            error,
        )
        return None


def quarantine_token(token, expires_at=None):
    if expires_at is None:
        expires_at = time.time() + TOKEN_QUARANTINE_FALLBACK_SECONDS
    with TOKEN_QUARANTINE_LOCK:
        quarantined = _read_quarantined_tokens()
        quarantined[_token_key(token)] = expires_at
        _write_quarantined_tokens(quarantined)
    logger.warning(
        "Đánh dấu token %s không dùng đến %s do hết quota",
        mask_token(token),
        datetime.fromtimestamp(expires_at, tz=timezone.utc).isoformat(),
    )


class OCRServiceError(Exception):
    def __init__(self, status_code, detail):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail


class InvalidItemCodeError(ValueError):
    """OCR trả item code có ký tự không phải chữ số."""


OCR_PROMPT = """
You are extracting a packing-list table from the attached image. Return ONLY
valid JSON, with no markdown, comments, or explanation. Use exactly this shape:
{
    "rows": [
        {
            "item_code": null,
            "barcodes": [],
            "exp_date": null,
            "planned_quantity": null
        }
    ]
}

EXTRACTION SCOPE
Extract exactly these four fields from every visible data row:
- item_code
- barcodes
- exp_date
- planned_quantity

COLUMN AND ROW ALIGNMENT RULES
1. First identify the table header and the left-to-right position of the target
    columns. Use the header and vertical column boundaries as the source of truth.
2. Read the table one horizontal row at a time. Values belong to the row whose
    horizontal band contains them; never move a value up or down to fill another
    row.
3. Assign a value only when its center lies inside the corresponding target
    column. Do not assign by appearance, data type, proximity to another value,
    or by trying to make a row look complete.
4. Keep the original left-to-right column order for every row. Do not shift
    values when a cell is blank, merged, wrapped, clipped, or unreadable.
5. Ignore columns not named by the four target fields, even when their values
    look like an item code, barcode, date, or quantity. Do not use a neighboring
    column as a substitute for a missing target column.
6. If the header, column boundary, row boundary, or cell association is
    ambiguous, set only the affected field to null (or [] for barcodes). Never
    guess from another row or copy a value.

FIELD RULES
- item_code: take only the value in the item-code column. It must contain
    digits only (0-9), with no letters, spaces, hyphens, or other symbols. If the
    extracted item code contains any non-digit character, the OCR result is
    invalid: re-read that cell and the complete row before returning. Do not
    replace letters with guessed digits and do not copy an item code from another
    row.
- barcodes: take all barcode values in the barcode column of that same row, in
  reading order. A barcode from another column or another row is forbidden.
- exp_date: take only the value in the expiry-date column of that same row.
- planned_quantity: take only the value in the planned-quantity column of that
  same row. Do not use shipped, actual, balance, or any other quantity column.

VALUE PRESERVATION AND FINAL CHECK
Preserve values exactly as printed, including leading zeroes, punctuation,
spaces that are part of a value, and date formatting. Use null for an unreadable
or missing scalar and [] for a missing or unreadable barcode list. Do not invent,
correct, calculate, or normalize values. Do not output headers, totals,
subtotals, labels, notes, or partially visible rows unless they are clearly a
data row.

Before returning, verify that every row object has exactly the four keys shown
above, that all values came from the same physical row, and that no value was
shifted into a neighboring column. Return an empty rows list if no complete or
clearly identifiable data row is visible.
"""


def get_tokens(include_quarantined=False):
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--token",
        action="append",
        help="Token của một account; có thể truyền nhiều lần",
    )
    args, _ = parser.parse_known_args()
    tokens = args.token or []
    if not tokens:
        env_tokens = os.getenv("COPILOT_GITHUB_TOKENS", "")
        tokens = [
            token.strip()
            for token in re.split(r"[,\r\n]+", env_tokens)
            if token.strip()
        ]
    if not tokens:
        env_token = os.getenv("COPILOT_GITHUB_TOKEN", "").strip()
        if env_token:
            tokens.append(env_token)
    if not tokens:
        raise RuntimeError(
            "Thiếu token. Dùng --token TOKEN hoặc đặt COPILOT_GITHUB_TOKENS."
        )
    if include_quarantined:
        logger.info("Đã nạp %d token để kiểm tra credit", len(tokens))
        return tokens

    active_tokens = [token for token in tokens if not is_token_quarantined(token)]
    if not active_tokens:
        raise RuntimeError("Tất cả Copilot token đang bị quarantine do hết quota.")
    logger.info(
        "Đã nạp %d/%d token khả dụng: %s",
        len(active_tokens),
        len(tokens),
        [mask_token(t) for t in active_tokens],
    )
    return active_tokens


REQUIRED_ROW_FIELDS = (
    "item_code",
    "barcodes",
    "exp_date",
    "planned_quantity",
)


def normalize_ocr_row(row):
    if not isinstance(row, dict):
        raise ValueError("Mỗi row OCR phải là object JSON")

    normalized = {}
    for field in REQUIRED_ROW_FIELDS:
        value = row.get(field)
        if field == "barcodes":
            if value is None:
                normalized[field] = []
            elif isinstance(value, list):
                normalized[field] = [str(item).strip() for item in value if str(item).strip()]
            elif isinstance(value, str):
                clean = value.strip()
                normalized[field] = [clean] if clean else []
            else:
                normalized[field] = [str(value).strip()] if str(value).strip() else []
        else:
            if value is None or value == "":
                normalized[field] = None
            else:
                clean = str(value).strip()
                if field == "item_code" and not re.fullmatch(r"[0-9]+", clean):
                    raise InvalidItemCodeError(
                        "OCR item_code không hợp lệ: phải chỉ gồm chữ số"
                    )
                else:
                    normalized[field] = clean

    return normalized


def parse_ocr_response(content):
    cleaned = content.strip()
    fenced = re.search(r"```(?:json)?\s*(.*?)\s*```", cleaned, re.DOTALL)
    if fenced:
        cleaned = fenced.group(1).strip()
    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError:
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start < 0 or end <= start:
            raise ValueError("Copilot không trả về JSON hợp lệ") from None
        try:
            result = json.loads(cleaned[start : end + 1])
        except json.JSONDecodeError as error:
            raise ValueError("Copilot không trả về JSON hợp lệ") from error

    if not isinstance(result, dict) or not isinstance(result.get("rows"), list):
        raise ValueError("JSON OCR thiếu trường rows dạng danh sách")

    normalized_rows = []
    for row in result["rows"]:
        normalized = normalize_ocr_row(row)
        normalized_rows.append(normalized)

    result["rows"] = normalized_rows
    return result


def is_token_error(error) -> bool:
    """Đoán xem lỗi có phải do token hết hạn / không hợp lệ / bị thu hồi hay không.

    Nếu đúng, ta nên thử token khác thay vì báo lỗi luôn cho ảnh đó.
    Các lỗi khác (ảnh mờ, JSON sai, timeout do ảnh quá phức tạp...) thì
    KHÔNG nên đổi token, vì đổi token sẽ không giải quyết được vấn đề và
    chỉ tốn thời gian thử lại vô ích trên toàn bộ token còn lại.
    """
    message = str(getattr(error, "detail", None) or error).lower()
    token_markers = (
        "401",
        "403",
        "unauthorized",
        "forbidden",
        "expired",
        "invalid token",
        "invalid_token",
        "bad credentials",
        "token revoked",
        "authentication failed",
        "access denied",
        "exceeded your monthly quota",
        "monthly quota",
        "quota exceeded",
        "rate limit",
    )
    return any(marker in message for marker in token_markers)


def is_quota_error(error) -> bool:
    message = str(getattr(error, "detail", None) or error).lower()
    quota_markers = (
        "exceeded your monthly quota",
        "monthly quota",
        "quota exceeded",
        "rate limit",
    )
    return any(marker in message for marker in quota_markers)


async def ocr_image(image_path, token):
    label = mask_token(token)
    started_at = time.perf_counter()
    logger.info("[token %s] Bắt đầu phiên Copilot cho ảnh %s", label, image_path.name)
    client = create_token_client(token)
    try:
        await client.start()
        session = await client.create_session(
            model=os.getenv("COPILOT_MODEL") or None,
        )
        for attempt in range(2):
            logger.info(
                "[token %s] Gửi ảnh %s để OCR (lần %d/2)",
                label, image_path.name, attempt + 1,
            )
            retry_instruction = ""
            if attempt:
                retry_instruction = (
                    "\n\nRETRY REQUIRED: The previous OCR result had an item_code "
                    "containing a non-digit character. Re-inspect the image, "
                    "header, row boundaries, and item-code column. Return a "
                    "corrected JSON result only."
                )
            response = await session.send_and_wait(
                OCR_PROMPT + retry_instruction,
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
                raise ValueError("Copilot không trả về kết quả OCR")
            try:
                result = parse_ocr_response(response.data.content)
                break
            except InvalidItemCodeError:
                if attempt == 1:
                    raise
                logger.warning(
                    "[token %s] Phát hiện item_code có chữ, yêu cầu OCR lại ảnh %s",
                    label, image_path.name,
                )
        elapsed = time.perf_counter() - started_at
        logger.info(
            "[token %s] OCR xong %s: %d dòng (%.1fs)",
            label, image_path.name, len(result.get("rows", [])), elapsed,
        )
        return result
    except Exception:
        elapsed = time.perf_counter() - started_at
        logger.exception("[token %s] OCR thất bại cho %s sau %.1fs", label, image_path.name, elapsed)
        raise
    finally:
        await client.stop()


def download_image(image_url):
    started_at = time.perf_counter()
    logger.info("Bắt đầu tải ảnh: %s", image_url)
    parsed_url = urlparse(image_url)
    if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
        raise ValueError("image_url phải là URL http hoặc https hợp lệ")

    response = requests.get(image_url, stream=True, timeout=20)
    response.raise_for_status()
    content_type = response.headers.get("content-type", "").split(";", 1)[0]
    if content_type and not content_type.startswith("image/"):
        raise ValueError("URL không trỏ tới một file ảnh")

    suffix = Path(parsed_url.path).suffix or ".img"
    temporary = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    temporary_path = Path(temporary.name)
    downloaded_size = 0
    try:
        for chunk in response.iter_content(chunk_size=1024 * 1024):
            if not chunk:
                continue
            downloaded_size += len(chunk)
            if downloaded_size > 15 * 1024 * 1024:
                raise ValueError("Ảnh vượt quá giới hạn 15 MB")
            temporary.write(chunk)
        elapsed = time.perf_counter() - started_at
        logger.info(
            "Tải xong ảnh %s: %.1f KB (%.1fs)",
            image_url, downloaded_size / 1024, elapsed,
        )
        return temporary_path
    except Exception:
        logger.exception("Tải ảnh thất bại: %s", image_url)
        temporary_path.unlink(missing_ok=True)
        raise
    finally:
        temporary.close()
        response.close()


def health():
    return {"status": "ok"}


def credit():
    try:
        tokens = get_tokens(include_quarantined=True)
    except RuntimeError as error:
        logger.error("Không có token nào để lấy thông tin credit: %s", error)
        raise OCRServiceError(500, str(error)) from error

    results = []
    for token_index, token in enumerate(tokens):
        result = {"token_name": get_token_name(token, token_index)}
        try:
            result["credit"] = get_token_copilot_quota(token)
        except Exception as error:
            logger.exception(
                "Không lấy được thông tin credit cho token %s",
                mask_token(token),
            )
            result["error"] = str(error)
        results.append(result)

    return {"results": results}


def run_ocr_jobs(image_urls: list[str], tokens: list[str], token_index: int = 0, worker_fn=None):
    if worker_fn is None:
        worker_fn = ocr_from_url_sync

    token_names = {
        token: get_token_name(token, index)
        for index, token in enumerate(tokens)
    }
    token_locks = {token: threading.Lock() for token in tokens}
    results_by_index = {}

    # Với failover, mỗi ảnh có thể thử qua nhiều token nếu token đầu bị lỗi,
    # nên số worker vẫn giới hạn theo min(số ảnh, số token) để tránh nhiều
    # luồng cùng giành nhau một token ngay từ đầu (mỗi token chỉ xử lý 1
    # ảnh tại một thời điểm, xem token_locks bên dưới).
    max_workers = max(1, min(len(image_urls), len(tokens)))
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {}
        for image_number, image_url in enumerate(image_urls):
            start_index = (token_index + image_number) % len(tokens)
            future = executor.submit(
                worker_fn,
                image_url,
                tokens,
                token_locks,
                token_names,
                start_index,
            )
            futures[future] = (image_number, start_index)

        for future in as_completed(futures):
            image_number, start_index = futures[future]
            image_url = image_urls[image_number]
            fallback_token_name = token_names[tokens[start_index]]
            try:
                result, used_token_name = future.result()
                results_by_index[image_number] = {
                    "image_url": image_url,
                    "token_name": used_token_name,
                    "data": result,
                }
            except Exception as error:
                results_by_index[image_number] = {
                    "image_url": image_url,
                    "token_name": fallback_token_name,
                    "error": str(error),
                }

    return [results_by_index[index] for index in range(len(image_urls))]


async def ocr_batch(image_urls: list[str], token_index: int = 0):
    batch_started_at = time.perf_counter()
    if not image_urls:
        raise OCRServiceError(400, "Cần ít nhất một image_url")
    try:
        tokens = get_tokens()
    except RuntimeError as error:
        logger.error("Không có token nào để chạy OCR: %s", error)
        raise OCRServiceError(500, str(error)) from error
    if token_index < 0 or token_index >= len(tokens):
        raise OCRServiceError(400, "token_index không hợp lệ")

    logger.info(
        "Nhận batch OCR: %d ảnh, %d token khả dụng, bắt đầu từ token_index=%d",
        len(image_urls), len(tokens), token_index,
    )

    formatted_results = await asyncio.to_thread(run_ocr_jobs, image_urls, tokens, token_index)
    error_count = sum(1 for item in formatted_results if "error" in item)
    elapsed = time.perf_counter() - batch_started_at
    logger.info(
        "Xong batch OCR: %d/%d ảnh thành công (%.1fs)",
        len(formatted_results) - error_count, len(formatted_results), elapsed,
    )

    if len(formatted_results) == 1:
        if "error" in formatted_results[0]:
            raise OCRServiceError(502, formatted_results[0]["error"])
        return {
            "token_name": formatted_results[0]["token_name"],
            **formatted_results[0]["data"],
        }
    return {"results": formatted_results}


def get_token_name(token, token_index):
    try:
        user = get_token_user(token)
        name = user.get("name") or user.get("login") or f"token_{token_index + 1}"
        logger.info("[token %s] Tên account: %s", mask_token(token), name)
        return name
    except Exception as error:
        logger.warning("[token %s] Không lấy được tên account: %s", mask_token(token), error)
        return f"token_{token_index + 1}"


def ocr_from_url_sync(
    image_url: str,
    tokens: list[str],
    token_locks: dict,
    token_names: dict,
    start_index: int,
):
    """Tải ảnh 1 lần, sau đó thử OCR lần lượt qua các token, bắt đầu từ
    start_index. Nếu token hiện tại có vẻ hết hạn/không hợp lệ thì chuyển
    sang token kế tiếp (vòng tròn qua hết danh sách); các lỗi khác (ảnh lỗi,
    JSON sai, timeout...) thì báo lỗi ngay, không đổi token vì đổi cũng
    không giải quyết được.

    Trả về (result, token_name_đã_dùng_thành_công).
    """
    started_at = time.perf_counter()
    try:
        temporary_path = download_image(image_url)
    except ValueError as error:
        logger.warning("Lỗi dữ liệu với %s: %s", image_url, error)
        raise OCRServiceError(400, str(error)) from error
    except requests.RequestException as error:
        logger.warning("Lỗi tải ảnh %s: %s", image_url, error)
        raise OCRServiceError(502, f"Không tải được ảnh: {error}") from error

    token_count = len(tokens)
    last_error = None
    try:
        for offset in range(token_count):
            token_index = (start_index + offset) % token_count
            token = tokens[token_index]
            label = mask_token(token)
            if is_token_quarantined(token):
                logger.info("[token %s] Bỏ qua token đang quarantine", label)
                continue
            lock = token_locks[token]
            if lock.locked():
                logger.info("[token %s] Đợi token rảnh để OCR ảnh %s", label, image_url)
            try:
                with lock:
                    result = asyncio.run(ocr_image(temporary_path, token))
                elapsed = time.perf_counter() - started_at
                logger.info("[token %s] Xong toàn bộ ảnh %s (%.1fs)", label, image_url, elapsed)
                return result, token_names[token]
            except (ValueError, TimeoutError) as error:
                # Lỗi về nội dung/thời gian, không liên quan token -> báo lỗi luôn.
                logger.warning("[token %s] OCR thất bại với %s: %s", label, image_url, error)
                raise OCRServiceError(502, f"OCR thất bại: {error}") from error
            except Exception as error:
                last_error = error
                is_last_token = offset == token_count - 1
                if is_quota_error(error):
                    quarantine_token(token, get_quota_reset_timestamp(token))
                if is_token_error(error) and not is_last_token:
                    logger.warning(
                        "[token %s] Có vẻ token hết hạn/không hợp lệ, thử token kế tiếp cho %s: %s",
                        label, image_url, error,
                    )
                    continue
                logger.warning("[token %s] OCR thất bại với %s: %s", label, image_url, error)
                raise OCRServiceError(502, f"OCR thất bại: {error}") from error
    finally:
        temporary_path.unlink(missing_ok=True)

    # Không nên tới được đây, nhưng vẫn phòng hờ.
    raise OCRServiceError(502, f"OCR thất bại: {last_error}")


async def ocr_from_url(
    image_url: str,
    tokens: list[str],
    token_locks: dict,
    token_names: dict,
    start_index: int,
):
    return await asyncio.to_thread(
        ocr_from_url_sync, image_url, tokens, token_locks, token_names, start_index
    )


# =========================================================
# Main
# =========================================================

def run_for_token(token, account_number):
    user = get_token_user(token)
    login = user.get("login") or "Unknown"
    name = user.get("name") or login

    print("=" * 50)
    print(f"GitHub account {account_number} (token)")
    print("=" * 50)
    print(f"Username : {login}")
    print(f"Name     : {name}")
    print("=" * 50)


def main():
    tokens = get_tokens()
    for account_number, token in enumerate(tokens, start=1):
        try:
            run_for_token(token, account_number)
        except Exception as error:
            print(f"Account {account_number} lỗi: {error}")


# =========================================================

if __name__ == "__main__":
    main()