from django.urls import path
from .views import RegisterView, LoginView, TokenRefreshFromCookieView
from .item_views import ItemCreateView, ItemBatchCreateView, ItemListByGroupView, ItemDeleteView, ItemUpdateView, UserItemListView, GroupWishlistView, WishlistProductsByNameView, UserDeleteAllItemsView, WriteOffBatchListView, WriteOffBatchItemsView, WriteOffItemDeleteView, WriteOffBatchDeleteView, WriteOffBatchExportView, ProductCostLookupView, ProductCostListView
from .item_views_wishlist import WishlistListView, WishlistAddView, WishlistRemoveView
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView
from .mail_api import SendEmailAPIView

urlpatterns = [
    path('register/', RegisterView.as_view()),
    path('login/', LoginView.as_view()),
    path('items/', ItemCreateView.as_view(), name='item-create'),
    path('items/batch/', ItemBatchCreateView.as_view(), name='item-create-batch'),
    path('items/writeoff_batches/', WriteOffBatchListView.as_view(), name='writeoff-batch-list'),
    path('items/writeoff_batches/<int:batch_id>/items/', WriteOffBatchItemsView.as_view(), name='writeoff-batch-items'),
    path('items/writeoff_batches/<int:batch_id>/delete/', WriteOffBatchDeleteView.as_view(), name='writeoff-batch-delete'),
    path('items/writeoff_batches/<int:batch_id>/export/', WriteOffBatchExportView.as_view(), name='writeoff-batch-export'),
    path('items/writeoff_items/<int:item_id>/delete/', WriteOffItemDeleteView.as_view(), name='writeoff-item-delete'),
    path('items/group/', ItemListByGroupView.as_view(), name='item-list-by-group'),
    path('items/<int:item_id>/delete/', ItemDeleteView.as_view(), name='item-delete'),
    path('items/<int:item_id>/update/', ItemUpdateView.as_view(), name='item-update'),
    path('items/user/<int:user_id>/', UserItemListView.as_view(), name='user-item-list'),
    path('items/user/<int:user_id>/delete_all/', UserDeleteAllItemsView.as_view(), name='user-delete-all-items'),
    path('product-cost/', ProductCostListView.as_view(), name='product-cost-list'),
    path('product-cost/<str:item_code>/', ProductCostLookupView.as_view(), name='product-cost-lookup'),
    path('token/', TokenObtainPairView.as_view(), name='token_obtain_pair'),
    path('token/refresh/', TokenRefreshFromCookieView.as_view(), name='token_refresh'),
    path('send-email/', SendEmailAPIView.as_view(), name='send-email'),
    path('group-wishlist/', GroupWishlistView.as_view(), name='group-wishlist'),
    path('wishlist-products/', WishlistProductsByNameView.as_view(), name='wishlist-products-by-name'),
    path('wishlist/', WishlistListView.as_view(), name='wishlist-list'),
    path('wishlist/add/', WishlistAddView.as_view(), name='wishlist-add'),
    path('wishlist/remove/', WishlistRemoveView.as_view(), name='wishlist-remove'),
]