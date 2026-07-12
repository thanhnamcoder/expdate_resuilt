from django.db import models
from django.conf import settings

class Wishlist(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name='wishlists')
    product_code = models.CharField(max_length=100)  # Lưu item_code của sản phẩm
    added_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        unique_together = ('user', 'product_code')
        ordering = ['-added_at']

    def __str__(self):
        return f"{self.user.username} - {self.product_code}"
