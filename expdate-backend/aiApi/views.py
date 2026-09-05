import json

from asgiref.sync import async_to_sync
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt

from .main import OCRServiceError, credit as get_credit, health as get_health, ocr_batch


def health(request):
	return JsonResponse(get_health())


def credit(request):
	try:
		return JsonResponse(get_credit())
	except OCRServiceError as error:
		return JsonResponse({"detail": error.detail}, status=error.status_code)


def _query_image_urls(request):
	return [
		url.strip()
		for value in request.GET.getlist("image_url")
		for url in value.split(",")
		if url.strip()
	]


def _token_index(request):
	try:
		return int(request.GET.get("token_index", "0"))
	except ValueError:
		raise OCRServiceError(400, "token_index không hợp lệ") from None


def _run_ocr(request, image_urls):
	try:
		result = async_to_sync(ocr_batch)(image_urls, _token_index(request))
		return JsonResponse(result)
	except OCRServiceError as error:
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
