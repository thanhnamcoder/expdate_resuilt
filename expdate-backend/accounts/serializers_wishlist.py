from rest_framework import serializers
from .models_wishlist import Wishlist

class WishlistSerializer(serializers.ModelSerializer):
    class Meta:
        model = Wishlist
        fields = ['id', 'user', 'product_code', 'added_at']
        read_only_fields = ['id', 'user', 'added_at']
