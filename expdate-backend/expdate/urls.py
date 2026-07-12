"""
URL configuration for expdate project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/5.2/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  path('', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  path('', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.urls import include, path
    2. Add a URL to urlpatterns:  path('blog/', include('blog.urls'))
"""
import os
from django.conf import settings
from django.contrib import admin
from django.urls import path, include
from django.views.static import serve
from accounts.item_views import ItemCreateView
from accounts.mysql_views import ProductDataView, ProductSearchView, ProductDetailView
from django.contrib.auth import views as auth_views

urlpatterns = [
    path('admin/', admin.site.urls),
    # Serve ảnh WriteOff được lưu tại BASE_DIR/Image (đường dẫn khớp với file_paths
    # dạng "Image/<ten_file>" lưu trong WriteOffBatch). Chỉ dùng cho dev; production
    # nên cấu hình Nginx/Apache hoặc chuyển sang MEDIA_ROOT + django.conf.urls.static.
    path('Image/<path:path>', serve, {'document_root': os.path.join(settings.BASE_DIR, 'Image')}),
    path('api/accounts/', include('accounts.urls')),  # đường dẫn chính cho accounts
    path('accounts/', include('accounts.urls')),
    path('api/items/', ItemCreateView.as_view(), name='item-create'),  # Direct mapping for /api/items/
    path('api/product/<path:barcode>/', ProductDataView.as_view(), name='product-data'),  # Direct mapping for /api/product/<barcode>/ (accept slashes)
    path('api/product-search/', ProductSearchView.as_view(), name='product-search'),
    path('api/product-detail/<int:id>/', ProductDetailView.as_view(), name='product-detail'),
    path('api/', include('accounts.urls')),

    # Django default password reset URLs
    path('password_reset/', auth_views.PasswordResetView.as_view(), name='password_reset'),
    path('password_reset/done/', auth_views.PasswordResetDoneView.as_view(), name='password_reset_done'),
    path('reset/<uidb64>/<token>/', auth_views.PasswordResetConfirmView.as_view(), name='password_reset_confirm'),
    path('reset/done/', auth_views.PasswordResetCompleteView.as_view(), name='password_reset_complete'),
]