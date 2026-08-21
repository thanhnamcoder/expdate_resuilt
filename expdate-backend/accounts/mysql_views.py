from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from unidecode import unidecode
from django.db.models import Q
from .models import ProductData, GroupWishlist


class ProductDataView(APIView):
    def get(self, request, barcode):
        try:
            query = (barcode or '').strip()
            if not query:
                return Response({"message": "No product found"}, status=status.HTTP_404_NOT_FOUND)

            products = ProductData.objects.filter(
                Q(item_barcode__icontains=query) |
                Q(item_code__icontains=query) |
                Q(item_name__icontains=query)
            ).values()
            if products:
                return Response({
                    "message": "Product data retrieved successfully",
                    "data": list(products)
                }, status=status.HTTP_200_OK)
            else:
                return Response({"message": "No product found"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as err:
            return Response({"error": str(err)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ProductSearchView(APIView):
    def get(self, request):
        # Support incremental sync via `since` query param (id-based)
        # If `since` is present, return only rows with id > since.
        # Otherwise preserve original behavior and optionally accept `text`.
        try:
            since_param = request.GET.get('since', None)
            if since_param is not None:
                try:
                    since = int(since_param)
                except Exception:
                    return Response({"error": "Invalid 'since' parameter"}, status=status.HTTP_400_BAD_REQUEST)
                products = list(ProductData.objects.filter(id__gt=since).order_by('id').values(
                    "id", "item_barcode", "item_name", "item_code", "department", "category", "sub_category", "vendor_code", "vendor_name", "unit_cost"
                ))
                max_id = since
                if products:
                    max_id = products[-1]['id']
                return Response({
                    "message": "Incremental products fetched",
                    "since": since,
                    "max_id": max_id,
                    "data": products
                }, status=status.HTTP_200_OK)

            # Fallback: full fetch (supports optional text search)
            search_text = request.GET.get('text', '').strip()
            # Trả về tất cả sản phẩm, không cần search nữa
            all_products = list(ProductData.objects.all().values(
                "id", "item_barcode", "item_name", "item_code", "department", "category", "sub_category", "vendor_code", "vendor_name", "unit_cost"
            ))
            user = request.user
            if not user.is_authenticated:
                return Response({
                    "error": "Authentication required",
                    "product_ids": [],
                    "data": all_products
                }, status=status.HTTP_401_UNAUTHORIZED)
            group = getattr(getattr(user, 'profile', None), 'group', None)
            if group:
                product_ids = list(GroupWishlist.objects.filter(group=group).values_list('product_id', flat=True).distinct())
            else:
                product_ids = []
            return Response({
                "message": "All products fetched successfully",
                "search_text": search_text,
                "product_ids": product_ids,
                "data": all_products
            }, status=status.HTTP_200_OK)
        except Exception as err:
            return Response({"error": str(err)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ProductDetailView(APIView):
    def get(self, request, id):
        try:
            product = ProductData.objects.filter(id=id).values(
                "id", "item_barcode", "item_name", "item_code", "department", "category", "sub_category", "vendor_code", "vendor_name", "unit_cost"
            ).first()
            if product:
                return Response({
                    "message": "Product data retrieved successfully",
                    "data": product
                }, status=status.HTTP_200_OK)
            else:
                return Response({"message": "No product found with the given ID"}, status=status.HTTP_404_NOT_FOUND)
        except Exception as err:
            return Response({"error": str(err)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
