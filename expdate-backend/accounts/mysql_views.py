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
        search_text = request.GET.get('text', '').strip()
        # Trả về tất cả sản phẩm, không cần search nữa
        all_products = list(ProductData.objects.all().values(
            "id", "item_barcode", "item_name", "item_code", "department", "category", "sub_category", "vendor_code", "vendor_name"
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


class ProductDetailView(APIView):
    def get(self, request, id):
        try:
            product = ProductData.objects.filter(id=id).values(
                "id", "item_barcode", "item_name", "item_code", "department", "category", "sub_category", "vendor_code", "vendor_name"
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
