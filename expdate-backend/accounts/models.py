from django.db import models
from django.contrib.auth.models import User
from .models_wishlist import Wishlist
class ProductCost(models.Model):
    item_code = models.CharField(max_length=100, unique=True)
    item_name = models.CharField(max_length=255)
    unit_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    class Meta:
        db_table = 'product_cost'

    def __str__(self):
        return f"{self.item_code} - {self.item_name}"
    
class GroupWishlistName(models.Model):
    group = models.CharField(max_length=100)
    wishlistname = models.CharField(max_length=100)
    class Meta:
        unique_together = ('group', 'wishlistname')
class Profile(models.Model):
    user = models.OneToOneField(User, on_delete=models.CASCADE, related_name='profile')
    fullname = models.CharField(max_length=150)
    group = models.CharField(max_length=100)

    def __str__(self):
        return self.fullname

class Item(models.Model):
    barcode = models.CharField(max_length=100)
    itemname = models.CharField(max_length=255)
    quantity = models.IntegerField()
    expdate = models.DateField()
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='items')
    # Record when the item was created (to distinguish multiple additions on the same day)
    created_at = models.DateTimeField(auto_now_add=True, null=True, blank=True)
    item_code = models.CharField(max_length=100, blank=True, null=True, default='')  # Thêm trường item_code
    unit_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)
    # Flag to indicate this item was added during a stocktake operation
    stocktake = models.BooleanField(default=False)
    writeoff = models.BooleanField(default=False)

    def __str__(self):
        return f"{self.itemname} ({self.barcode})"


class WriteOffBatch(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='writeoff_batches')
    name = models.CharField(max_length=255)
    file_paths = models.TextField(blank=True, default='')
    total_cost = models.DecimalField(max_digits=14, decimal_places=2, default=0, blank=True)
    created_at = models.DateTimeField(auto_now_add=True, null=True, blank=True)

    def __str__(self):
        return f"{self.name} ({self.user.username})"

class WriteOffItem(models.Model):
    writeoff_batch = models.ForeignKey('WriteOffBatch', on_delete=models.CASCADE, related_name='writeoff_items', null=True, blank=True)
    barcode = models.CharField(max_length=100)
    itemname = models.CharField(max_length=255)
    quantity = models.IntegerField(default=0)
    item_code = models.CharField(max_length=100, blank=True, null=True, default='')
    unit_cost = models.DecimalField(max_digits=14, decimal_places=2, null=True, blank=True)

    def __str__(self):
        return f"{self.itemname} ({self.barcode})"
    
class ProductData(models.Model):
    id = models.AutoField(primary_key=True)
    item_barcode = models.CharField(max_length=50)
    item_code = models.CharField(max_length=50)
    item_name = models.CharField(max_length=255)
    department = models.CharField(max_length=100)
    category = models.CharField(max_length=100)
    sub_category = models.CharField(max_length=100)
    vendor_code = models.CharField(max_length=50)
    vendor_name = models.CharField(max_length=255)

    class Meta:
        db_table = 'product_data'  # Khớp đúng với bảng trong MySQL

    def __str__(self):
        return self.item_name

class GroupWishlist(models.Model):
    group = models.CharField(max_length=100)  # Tên hoặc id của group
    product = models.ForeignKey(ProductData, on_delete=models.CASCADE)
    wishlistname = models.CharField(max_length=255)

    class Meta:
        unique_together = ('group', 'product', 'wishlistname')

    def __str__(self):
        return f"{self.group} - {self.wishlistname} - {self.product.id}"
    
class PackingList(models.Model):
    # Bảng này đã tồn tại sẵn trong sqlite.db của Zeid_Bot (database alias 'sqlite').
    # managed = False vì Django không tạo/migrate bảng này, chỉ đọc/ghi vào bảng có sẵn.
    id = models.AutoField(primary_key=True)
    item_code = models.CharField(max_length=100, blank=True, null=True)
    barcode = models.CharField(max_length=100)
    description = models.CharField(max_length=255)
    exp_date = models.CharField(max_length=20)  # lưu dạng chuỗi 'DD/MM/YYYY' giống dữ liệu hiện có
    quantity = models.IntegerField()
 
    class Meta:
        db_table = 'PackingList'
        managed = False
 
    def __str__(self):
        return f"{self.description} ({self.barcode})"
