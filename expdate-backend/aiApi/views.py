import json
import logging

from asgiref.sync import async_to_sync
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from rest_framework.response import Response
from rest_framework.exceptions import ParseError
from rest_framework.generics import GenericAPIView
from rest_framework.views import APIView

from accounts.models import ProductData
from .authCopilot import get_token_copilot_quota, get_token_user
from .helperOCR import (
    CopilotOCRRequestError,
    OCR_PROMPT,
    get_copilot_tokens,
	get_copilot_config,
    get_health,
    ocr_image_urls,
	update_copilot_config,
)
from .serializers import CopilotModelSerializer, CopilotTokenSerializer


logger = logging.getLogger("packing_ocr")


def health(request):
	return JsonResponse(get_health())


class DocsView(APIView):
	def get(self, request):
		return Response({
		"base_url": "/api/ai/",
		"routes": [
			{
				"path": "docs/",
				"methods": ["GET"],
				"description": "Liệt kê các route AI và chức năng.",
			},
			{
				"path": "health/",
				"methods": ["GET"],
				"description": "Kiểm tra trạng thái backend AI.",
			},
			{
				"path": "credit/",
				"methods": ["GET"],
				"description": "Lấy quota Copilot của các token đã cấu hình.",
			},
			{
				"path": "copilot-config/",
				"methods": ["GET", "POST"],
				"description": "Xem hoặc cập nhật model và token Copilot.",
			},
			{
				"path": "model/",
				"methods": ["GET", "POST"],
				"description": "Ghi đè model Copilot hiện tại.",
				"parameters": {"model": "Tên model mới"},
			},
			{
				"path": "token/",
				"methods": ["GET", "POST"],
				"description": "Thêm token Copilot vào danh sách hiện tại.",
				"parameters": {"token": "Token Copilot mới"},
			},
			{
				"path": "ocr/",
				"methods": ["GET", "POST"],
				"description": "OCR danh sách ảnh bằng Copilot.",
				"parameters": {"image_url": "URL ảnh hoặc image_urls là danh sách URL"},
			},
		],
		})


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


class CopilotConfigView(APIView):
	def get(self, request):
		try:
			return Response(get_copilot_config())
		except CopilotOCRRequestError as error:
			return Response({"detail": error.detail}, status=error.status_code)

	def post(self, request):
		model = request.data.get("model")
		token = request.data.get("token")
		if model is None and token is None:
			return Response(
				{"detail": "Cần gửi model hoặc token"},
				status=400,
			)
		try:
			return Response(update_copilot_config(model=model, token=token))
		except ValueError as error:
			return Response({"detail": str(error)}, status=400)
		except OSError as error:
			return Response(
				{"detail": f"Không thể lưu cấu hình Copilot: {error}"},
				status=500,
			)


class CopilotModelView(GenericAPIView):
	serializer_class = CopilotModelSerializer

	def _save_model(self, model):
		if model is None:
			return Response({"detail": "Cần gửi model"}, status=400)
		try:
			return Response(update_copilot_config(model=model))
		except ValueError as error:
			return Response({"detail": str(error)}, status=400)
		except OSError as error:
			return Response(
				{"detail": f"Không thể lưu model Copilot: {error}"},
				status=500,
			)

	def get(self, request):
		try:
			return Response(get_copilot_config())
		except CopilotOCRRequestError as error:
			return Response({"detail": error.detail}, status=error.status_code)

	def post(self, request):
		try:
			model = request.data.get("model")
		except ParseError:
			model = None
		model = model or request.query_params.get("model")
		serializer = self.get_serializer(data={"model": model})
		serializer.is_valid(raise_exception=True)
		return self._save_model(serializer.validated_data["model"])


class CopilotTokenView(GenericAPIView):
	serializer_class = CopilotTokenSerializer

	def _save_token(self, token):
		if token is None:
			return Response({"detail": "Cần gửi token"}, status=400)
		try:
			return Response(update_copilot_config(token=token))
		except ValueError as error:
			return Response({"detail": str(error)}, status=400)
		except OSError as error:
			return Response(
				{"detail": f"Không thể lưu token Copilot: {error}"},
				status=500,
			)

	def get(self, request):
		try:
			return Response(get_copilot_config())
		except CopilotOCRRequestError as error:
			return Response({"detail": error.detail}, status=error.status_code)

	def post(self, request):
		try:
			token = request.data.get("token")
		except ParseError:
			token = None
		token = token or request.query_params.get("token")
		serializer = self.get_serializer(data={"token": token})
		serializer.is_valid(raise_exception=True)
		return self._save_token(serializer.validated_data["token"])


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
		_enrich_ocr_results(result)
		return JsonResponse({"results": result})
	except CopilotOCRRequestError as error:
		return JsonResponse({"detail": error.detail}, status=error.status_code)
	except Exception as error:
		logger.exception("OCR thất bại khi gọi bằng %s", request.method)
		return JsonResponse(
			{"detail": f"OCR thất bại: {error}"},
			status=502,
		)


def _enrich_ocr_results(results):
	"""Add catalog barcode and item name to OCR rows using their item codes."""
	parsed_results = []
	item_codes = set()
	for result in results:
		data = result.get("data")
		if isinstance(data, str):
			try:
				data = json.loads(data)
			except json.JSONDecodeError:
				parsed_results.append((result, None))
				continue
		if not isinstance(data, dict) or not isinstance(data.get("rows"), list):
			parsed_results.append((result, None))
			continue
		for row in data["rows"]:
			if isinstance(row, dict):
				item_code = row.get("item_code")
				if item_code is not None and str(item_code).strip():
					item_codes.add(str(item_code).strip())
		parsed_results.append((result, data))

	products_by_code = {}
	if item_codes:
		products = ProductData.objects.filter(
			item_code__in=item_codes,
		).order_by("id").values("item_code", "item_barcode", "item_name")
		for product in products:
			products_by_code.setdefault(str(product["item_code"]).strip(), product)

	for result, data in parsed_results:
		if data is None:
			continue
		for row in data["rows"]:
			if not isinstance(row, dict):
				continue
			product = products_by_code.get(str(row.get("item_code")).strip())
			row["barcode"] = product["item_barcode"] if product else None
			row["itemname"] = product["item_name"] if product else None
		result["data"] = data



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
