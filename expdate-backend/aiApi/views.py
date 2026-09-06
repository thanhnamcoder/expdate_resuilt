import json

from asgiref.sync import async_to_sync
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .authCopilot import get_token_copilot_quota, get_token_user
from .helperOCR import (
    CopilotOCRRequestError,
    OCR_PROMPT,
    get_copilot_tokens,
    get_health,
    ocr_image_urls,
)


def health(request):
	return JsonResponse(get_health())


def credit(request):
	try:
		tokens = get_copilot_tokens(include_quarantined=True)
		results = []
		for index, token in enumerate(tokens, start=1):
			try:
				user = get_token_user(token)
				name = user.get("name") or user.get("login") or f"token_{index}"
			except Exception:
				name = f"token_{index}"
			try:
				quota = get_token_copilot_quota(token)
			except Exception as error:
				quota = None
				results.append({"token_name": name, "error": str(error)})
			else:
				results.append({"token_name": name, "credit": quota})
		return JsonResponse({"results": results})
	except CopilotOCRRequestError as error:
		return JsonResponse({"detail": error.detail}, status=error.status_code)


def _query_image_urls(request):
	return [
		url.strip()
		for value in request.GET.getlist("image_url")
		for url in value.split(",")
		if url.strip()
	]


def _run_ocr(request, image_urls):
	try:
		result = async_to_sync(ocr_image_urls)(image_urls, OCR_PROMPT)
		return JsonResponse({"results": result})
	except CopilotOCRRequestError as error:
		return JsonResponse({"detail": error.detail}, status=error.status_code)


@csrf_exempt
def ocr(request):
	if request.method == "GET":
		return _run_ocr(request, _query_image_urls(request))
	if request.method != "POST":
		return JsonResponse({"detail": "Method not allowed"}, status=405)

	try:
		payload = json.loads(request.body or "{}")
	except json.JSONDecodeError:
		return JsonResponse({"detail": "Request body phải là JSON hợp lệ"}, status=400)

	image_urls = payload.get("image_urls", [])
	if isinstance(image_urls, str):
		image_urls = [image_urls]
	if not isinstance(image_urls, list):
		return JsonResponse({"detail": "image_urls phải là danh sách URL"}, status=400)
	image_urls = [str(url).strip() for url in image_urls if str(url).strip()]
	image_url = payload.get("image_url")
	if image_url:
		image_urls.insert(0, str(image_url).strip())
	return _run_ocr(request, image_urls)

# Create your views here.
