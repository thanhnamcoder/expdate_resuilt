from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView
from .models_wishlist import Wishlist
from .serializers_wishlist import WishlistSerializer

class WishlistListView(generics.ListAPIView):
    serializer_class = WishlistSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Wishlist.objects.filter(user=self.request.user)

class WishlistAddView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        product_code = request.data.get('product_code')
        if not product_code:
            return Response({'error': 'Missing product_code'}, status=400)
        wishlist, created = Wishlist.objects.get_or_create(user=request.user, product_code=product_code)
        if created:
            return Response({'status': 'added'}, status=201)
        return Response({'status': 'exists'}, status=200)

class WishlistRemoveView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        product_code = request.data.get('product_code')
        if not product_code:
            return Response({'error': 'Missing product_code'}, status=400)
        Wishlist.objects.filter(user=request.user, product_code=product_code).delete()
        return Response({'status': 'removed'}, status=200)
