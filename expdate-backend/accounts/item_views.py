from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework import serializers
from .models import Item, GroupWishlist, ProductData, GroupWishlistName, PackingList, WriteOffBatch, WriteOffItem, ProductCost  # Thêm GroupWishlistName, PackingList
from django.contrib.auth.models import User  # Import the User model
from django.utils.timezone import now
from rest_framework.permissions import IsAuthenticated
from rest_framework_simplejwt.authentication import JWTAuthentication
from datetime import timedelta
from decimal import Decimal
from django.db import DatabaseError, OperationalError
from django.db.models import Sum, Min, Count
import threading
import time
from django.core.mail import send_mail as django_send_mail
from django.conf import settings
from django.utils import timezone
import datetime
from rest_framework.decorators import api_view, permission_classes, authentication_classes
from django.http import HttpResponse
from openpyxl import Workbook
import os
import json
import io
import re
import zipfile

class ProductCostLookupView(APIView):
    def get(self, request, item_code):
        product_cost = ProductCost.objects.filter(item_code=item_code).first()
        if not product_cost:
            return Response({'error': 'Cost not found'}, status=status.HTTP_404_NOT_FOUND)

        return Response({
            'item_code': product_cost.item_code,
            'item_name': product_cost.item_name,
            'unit_cost': float(product_cost.unit_cost) if product_cost.unit_cost is not None else None,
        }, status=status.HTTP_200_OK)


class ProductCostListView(APIView):
    def get(self, request):
        product_costs = ProductCost.objects.all().order_by('item_code')
        data = []
        for item in product_costs:
            data.append({
                'item_code': item.item_code,
                'item_name': item.item_name,
                'unit_cost': float(item.unit_cost) if item.unit_cost is not None else None,
            })
        return Response({'count': len(data), 'data': data}, status=status.HTTP_200_OK)


# Xóa toàn bộ sản phẩm của user (đặt ở cuối file để đảm bảo import APIView)
class UserDeleteAllItemsView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    def delete(self, request, user_id):
        current_user = request.user
        is_manage = current_user.is_staff or current_user.is_superuser
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        # Chỉ cho phép xóa nếu là chính user hoặc là quản lý
        if not (user == current_user or is_manage):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        # mode can be provided as query param to delete only stocktake items or only non-stocktake (date) items
        mode = request.query_params.get('mode', '').lower()
        qs = Item.objects.filter(user=user)
        if mode == 'stocktake':
            if hasattr(Item, 'stocktake'):
                qs = qs.filter(stocktake=True)
            else:
                qs = Item.objects.none()
        elif mode == 'date' or mode == 'nonstocktake':
            if hasattr(Item, 'stocktake'):
                qs = qs.filter(stocktake=False)
            else:
                qs = qs

        deleted_count, _ = qs.delete()

        # After deletion, compute updated counts (exclude stocktake items from counts)
        from datetime import timedelta
        today = now().date()
        soon_threshold = today + timedelta(days=15)
        user_items = Item.objects.filter(user=user)
        if hasattr(Item, 'stocktake'):
            user_items = user_items.filter(stocktake=False)
        expired_count = user_items.filter(expdate__lt=today).count()
        soon_expire_count = user_items.filter(expdate__gte=today, expdate__lte=soon_threshold).count()
        valid_count = user_items.filter(expdate__gt=soon_threshold).count()

        return Response({
            'message': f'Deleted {deleted_count} items for user {user.username}',
            'deleted_count': deleted_count,
            'user_id': user.id,
            'expired_count': expired_count,
            'soon_expire_count': soon_expire_count,
            'valid_count': valid_count
        }, status=status.HTTP_200_OK)

class ItemSerializer(serializers.Serializer):
    barcode = serializers.CharField(max_length=100)
    itemname = serializers.CharField(max_length=255)
    item_code = serializers.CharField(max_length=100, required=False, allow_blank=True)  # Thêm trường item_code
    unit_cost = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, allow_null=True)
    quantity = serializers.IntegerField()
    expdate = serializers.DateField(input_formats=['%d/%m/%Y'], required=False)
    stocktake = serializers.BooleanField(required=False)
    writeoff = serializers.BooleanField(required=False)

class ItemCreateView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    def post(self, request):
        print("[ItemCreateView] Payload received:", request.data)
        serializer = ItemSerializer(data=request.data)
        # Vietnam timezone (UTC+7)
        tz_vn = timezone.get_fixed_timezone(7 * 60)
        if serializer.is_valid():
            # Process the valid data here
            data = serializer.validated_data
            user = request.user
            stocktake_flag = data.get('stocktake', False)
            writeoff_flag = data.get('writeoff', False)
            uploaded_files = request.FILES.getlist('files') if hasattr(request, 'FILES') else []

            # Log the IP address of the client
            client_ip = request.META.get('REMOTE_ADDR', '')
            print(f"Request received from IP: {client_ip} at {now()}")

            # Prepare fields
            expdate = data.get('expdate')
            item_code = data.get('item_code', '')
            # If writeoff, default missing expdate to today
            if expdate is None and writeoff_flag:
                expdate = now().date()
            if expdate is None and not writeoff_flag:
                return Response({'error': 'expdate is required for non-writeoff items.'}, status=status.HTTP_400_BAD_REQUEST)
            # Ensure quantity is int
            if 'quantity' in data and isinstance(data['quantity'], str):
                try:
                    data['quantity'] = int(data['quantity'])
                except Exception:
                    data['quantity'] = 1
            if isinstance(expdate, str):
                from datetime import datetime
                try:
                    expdate = datetime.strptime(expdate, '%Y-%m-%d').date()
                except ValueError:
                    try:
                        expdate = datetime.strptime(expdate, '%d/%m/%Y').date()
                    except Exception:
                        pass

            # Build filter to find matching items (date only)
            filter_kwargs = {'barcode': data['barcode'], 'expdate': expdate, 'user': user}
            if hasattr(Item, 'item_code'):
                filter_kwargs['item_code'] = item_code
            if hasattr(Item, 'stocktake'):
                filter_kwargs['stocktake'] = bool(stocktake_flag)
            if hasattr(Item, 'writeoff'):
                filter_kwargs['writeoff'] = bool(writeoff_flag)

            # Find matching items ordered by newest first
            matching_qs = Item.objects.filter(**filter_kwargs).order_by('-created_at')
            existing_item = None
            # Merge into the most recent matching item only if it was created within the same minute (VN timezone)
            if matching_qs.exists():
                latest = matching_qs.first()
                try:
                    if getattr(latest, 'created_at', None):
                        latest_vn = timezone.localtime(latest.created_at, tz_vn)
                        now_vn = timezone.localtime(timezone.now(), tz_vn)
                        # Require exact same second to merge; even 1 second difference creates a new row
                        same_second = latest_vn.strftime('%Y-%m-%d %H:%M:%S') == now_vn.strftime('%Y-%m-%d %H:%M:%S')
                    else:
                        same_second = False
                except Exception:
                    same_second = False
                if same_second:
                    existing_item = latest

            def format_expdate(dt):
                if not dt:
                    return ''
                return dt.strftime('%d/%m/%Y')

            if existing_item:
                # Update the quantity of the existing item
                existing_item.quantity += data['quantity']
                if hasattr(existing_item, 'item_code') and item_code and existing_item.item_code != item_code:
                    existing_item.item_code = item_code
                if hasattr(existing_item, 'unit_cost'):
                    if data.get('unit_cost') is not None:
                        existing_item.unit_cost = data.get('unit_cost')
                if hasattr(existing_item, 'stocktake'):
                    existing_item.stocktake = stocktake_flag
                if hasattr(existing_item, 'writeoff'):
                    existing_item.writeoff = writeoff_flag
                existing_item.save()
                serializer_data = serializer.data.copy()
                serializer_data['quantity'] = existing_item.quantity
                serializer_data['expdate'] = format_expdate(existing_item.expdate)
                serializer_data['item_code'] = getattr(existing_item, 'item_code', '') if hasattr(existing_item, 'item_code') else ''
                serializer_data['unit_cost'] = float(existing_item.unit_cost) if getattr(existing_item, 'unit_cost', None) is not None else None
                serializer_data['stocktake'] = getattr(existing_item, 'stocktake', False) if hasattr(existing_item, 'stocktake') else False
                item_obj = existing_item
                created_at_val = getattr(existing_item, 'created_at', None)
                if created_at_val:
                    serializer_data['created_at'] = timezone.localtime(created_at_val, tz_vn).strftime('%d/%m/%Y %H:%M:%S')
            else:
                # Create new item
                item_create_kwargs = {
                    'barcode': data['barcode'],
                    'itemname': data['itemname'],
                    'quantity': data['quantity'],
                    'expdate': data['expdate'],
                    'user': user
                }
                if hasattr(Item, 'item_code'):
                    item_create_kwargs['item_code'] = str(item_code) if item_code is not None else ''
                if hasattr(Item, 'unit_cost') and data.get('unit_cost') is not None:
                    item_create_kwargs['unit_cost'] = data.get('unit_cost')
                if hasattr(Item, 'stocktake'):
                    item_create_kwargs['stocktake'] = bool(stocktake_flag)
                if hasattr(Item, 'writeoff'):
                    item_create_kwargs['writeoff'] = bool(writeoff_flag)
                item = Item.objects.create(**item_create_kwargs)
                serializer_data = serializer.data.copy()
                serializer_data['expdate'] = format_expdate(item.expdate)
                serializer_data['item_code'] = getattr(item, 'item_code', item_code) if hasattr(item, 'item_code') else item_code
                serializer_data['unit_cost'] = float(item.unit_cost) if getattr(item, 'unit_cost', None) is not None else None
                serializer_data['stocktake'] = getattr(item, 'stocktake', False) if hasattr(item, 'stocktake') else False
                created_at_val = getattr(item, 'created_at', None)
                if created_at_val:
                    serializer_data['created_at'] = timezone.localtime(created_at_val, tz_vn).strftime('%d/%m/%Y %H:%M:%S')
                item_obj = item

            if writeoff_flag:
                if not uploaded_files:
                    return Response({'error': 'WO requires at least one file upload.'}, status=status.HTTP_400_BAD_REQUEST)

                file_paths = []
                upload_dir = os.path.join(settings.BASE_DIR, 'Image')
                os.makedirs(upload_dir, exist_ok=True)
                for uploaded_file in uploaded_files:
                    file_name = f"{timezone.now().strftime('%Y%m%d%H%M%S')}_{uploaded_file.name}"
                    file_path = os.path.join(upload_dir, file_name)
                    with open(file_path, 'wb+') as destination:
                        for chunk in uploaded_file.chunks():
                            destination.write(chunk)
                    file_paths.append(f"Image/{file_name}")
                total_cost = Decimal('0')
                try:
                    quantity = int(data.get('quantity', 1))
                    unit_cost = request.data.get('unit_cost')
                    if unit_cost is not None:
                        total_cost = Decimal(str(unit_cost)) * quantity
                except Exception:
                    total_cost = Decimal('0')

                writeoff_batch = WriteOffBatch.objects.create(
                    user=user,
                    name=data['itemname'],
                    file_paths='|'.join(file_paths) if file_paths else '',
                    total_cost=total_cost,
                )
                # Persist per-item unit_cost; per-item total_cost is deprecated and set to 0
                unit_cost_value = None
                try:
                    if unit_cost is not None:
                        unit_cost_value = Decimal(str(unit_cost))
                except Exception:
                    unit_cost_value = None

                writeoff_record, created = WriteOffItem.objects.update_or_create(
                    barcode=data['barcode'],
                    itemname=data['itemname'],
                    item_code=item_code,
                    writeoff_batch=writeoff_batch,
                    defaults={
                        'quantity': 0,
                        'unit_cost': unit_cost_value,
                    },
                )
                if created:
                    writeoff_record.quantity = int(data['quantity'])
                else:
                    writeoff_record.quantity += int(data['quantity'])
                writeoff_record.writeoff_batch = writeoff_batch
                if unit_cost_value is not None:
                    writeoff_record.unit_cost = unit_cost_value
                writeoff_record.save()

            # --- Nếu là stocktake, đồng thời lưu/cộng dồn vào bảng PackingList (sqlite của Zeid_Bot) ---
            # Không quan tâm username. Trùng barcode + item_code + expdate => cộng dồn quantity, không thì tạo mới.
            if stocktake_flag == False and not writeoff_flag:
                packing_exp_date = format_expdate(expdate)
                packing_item_code = str(item_code) if item_code is not None else ''
                try:
                    def normalize_packing_quantity(value):
                        try:
                            return int(value)
                        except (TypeError, ValueError):
                            return 0

                    existing_packing = PackingList.objects.using('sqlite').filter(
                        barcode=data['barcode'],
                        item_code=packing_item_code,
                        exp_date=packing_exp_date,
                    ).first()
                    if existing_packing:
                        existing_packing.quantity = normalize_packing_quantity(existing_packing.quantity) + int(data['quantity'])
                        existing_packing.description = data['itemname']
                        existing_packing.save(using='sqlite')
                    else:
                        # Fallback for rows that already exist under the same item_code/exp_date
                        # but were created before the barcode-based merge logic.
                        fallback_packing = PackingList.objects.using('sqlite').filter(
                            item_code=packing_item_code,
                            exp_date=packing_exp_date,
                        ).first()
                        if fallback_packing:
                            fallback_packing.barcode = data['barcode']
                            fallback_packing.quantity = normalize_packing_quantity(fallback_packing.quantity) + int(data['quantity'])
                            fallback_packing.description = data['itemname']
                            fallback_packing.save(using='sqlite')
                        else:
                            PackingList.objects.using('sqlite').create(
                                item_code=packing_item_code,
                                barcode=data['barcode'],
                                description=data['itemname'],
                                exp_date=packing_exp_date,
                                quantity=int(data['quantity']),
                            )
                except Exception as packing_err:
                    print(f"[ItemCreateView] Failed to write PackingList: {packing_err}")

            # Recompute counts using aggregated groups (unique product+date)
            today = now().date()
            soon_threshold = today + timedelta(days=15)
            qs_counts = Item.objects.filter(user=user)
            if hasattr(Item, 'stocktake'):
                qs_counts = qs_counts.filter(stocktake=False)
            group_fields_counts = ['barcode', 'itemname', 'expdate']
            if hasattr(Item, 'item_code'):
                group_fields_counts.append('item_code')
            grouped_counts = qs_counts.values(*group_fields_counts).annotate(total_quantity=Sum('quantity'))
            expired_count = grouped_counts.filter(expdate__lt=today).count()
            soon_expire_count = grouped_counts.filter(expdate__gte=today, expdate__lte=soon_threshold).count()
            valid_count = grouped_counts.filter(expdate__gt=soon_threshold).count()
            return Response({
                "message": "Item created successfully" if not existing_item else "Item quantity updated successfully",
                "data": serializer_data,
                "iid": item_obj.id,
                "user_id": user.id,
                "expired_count": expired_count,
                "soon_expire_count": soon_expire_count,
                "valid_count": valid_count
            }, status=status.HTTP_201_CREATED if not existing_item else status.HTTP_200_OK)
        
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

    def get(self, request):
        """
        Search for items by barcode (and optional username and date).
        Query params:
          - barcode (required)
          - username (optional, defaults to request.user.username)
          - date (optional, YYYY-MM-DD or DD/MM/YYYY, defaults to today)
          - stocktake (optional, 'true'/'false') to filter stocktake flag if model supports it
        Returns: { data: [ ...items ] }
        """
        barcode = request.query_params.get('barcode')
        if not barcode:
            return Response({'error': 'barcode query param is required'}, status=status.HTTP_400_BAD_REQUEST)

        username = request.query_params.get('username')
        date_param = request.query_params.get('date')
        stocktake_param = request.query_params.get('stocktake')

        # Determine user
        if username:
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist:
                return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        else:
            user = request.user

        # Parse date
        query_date = None
        if date_param:
            from datetime import datetime
            try:
                query_date = datetime.strptime(date_param, '%Y-%m-%d').date()
            except Exception:
                try:
                    query_date = datetime.strptime(date_param, '%d/%m/%Y').date()
                except Exception:
                    return Response({'error': 'Invalid date format. Use YYYY-MM-DD or DD/MM/YYYY.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            query_date = now().date()

        try:
            qs = Item.objects.filter(user=user, barcode=barcode, expdate=query_date)
        except (DatabaseError, OperationalError) as db_err:
            return Response({'error': 'Database error when querying items. Have you run migrations to add new fields?','details': str(db_err)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        if stocktake_param is not None and hasattr(Item, 'stocktake'):
            stocktake_flag = str(stocktake_param).lower() in ('1', 'true', 'yes')
            qs = qs.filter(stocktake=stocktake_flag)

        items_data = []
        # Vietnam timezone for formatting
        tz_vn = timezone.get_fixed_timezone(7 * 60)
        for item in qs:
            item_code_val = ''
            if hasattr(item, 'item_code'):
                item_code_val = item.item_code if item.item_code is not None else ''
            def fmt(d):
                if not d:
                    return ''
                return d.strftime('%d/%m/%Y')
            items_data.append({
                'id': item.id,
                'barcode': item.barcode,
                'itemname': item.itemname,
                'quantity': item.quantity,
                'expdate': fmt(item.expdate),
                'created_at': timezone.localtime(item.created_at, tz_vn).strftime('%d/%m/%Y %H:%M:%S') if getattr(item, 'created_at', None) else '',
                'can_edit': (request.user.is_staff or request.user.is_superuser) or (item.user == request.user),
                'can_delete': (request.user.is_staff or request.user.is_superuser) or (item.user == request.user),
                'item_code': str(item_code_val),
                'stocktake': getattr(item, 'stocktake', False) if hasattr(item, 'stocktake') else False,
            })

        return Response({'data': items_data}, status=status.HTTP_200_OK)


class ItemBatchCreateView(APIView):
    """Accepts a multipart/form-data request with a 'payload' field containing
    JSON mapping top-level names to arrays of item objects. Files sent in
    'files' are attached to each writeoff record for the batch.

    Example payload:
      {
        "WO Name 1": [ {"barcode": "123", "quantity": 2, "item_code": "A1"}, ... ],
        "WO Name 2": [ ... ]
      }
    """
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload_raw = request.data.get('payload') or request.POST.get('payload')
        if not payload_raw:
            return Response({'error': 'Missing payload'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = json.loads(payload_raw)
        except Exception as e:
            return Response({'error': 'Invalid JSON payload', 'details': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        files = request.FILES.getlist('files') if hasattr(request, 'FILES') else []
        if not files:
            return Response({'error': 'WO requires at least one file upload for the batch.'}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        created = 0
        errors = []
        tz_vn = timezone.get_fixed_timezone(7 * 60)

        # Save files once and keep their saved paths to store in WriteOffItem
        upload_dir = os.path.join(settings.BASE_DIR, 'Image')
        os.makedirs(upload_dir, exist_ok=True)
        saved_paths = []
        try:
            from django.utils import timezone as djtz
            for uploaded_file in files:
                file_name = f"{djtz.now().strftime('%Y%m%d%H%M%S')}_{uploaded_file.name}"
                file_path = os.path.join(upload_dir, file_name)
                with open(file_path, 'wb+') as dest:
                    for chunk in uploaded_file.chunks():
                        dest.write(chunk)
                saved_paths.append(f"Image/{file_name}")
        except Exception as e:
            return Response({'error': 'Failed saving uploaded files', 'details': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Iterate payload
        for name_key, items in payload.items():
            if not isinstance(items, list):
                errors.append({'name': name_key, 'error': 'items must be an array'})
                continue

            today = now().date()
            total_cost = Decimal('0')
            for it in items:
                try:
                    quantity = int(it.get('quantity', 1))
                    unit_cost = it.get('unit_cost')
                    if unit_cost is not None:
                        total_cost += Decimal(str(unit_cost)) * quantity
                except Exception:
                    continue

            writeoff_batch = WriteOffBatch.objects.create(
                user=user,
                name=name_key,
                file_paths='|'.join(saved_paths) if saved_paths else '',
                total_cost=total_cost,
            )

            for it in items:
                try:
                    barcode = str(it.get('barcode', '')).strip()
                    itemname = str(it.get('itemname', '')).strip() or name_key
                    quantity = int(it.get('quantity', 1))
                    item_code = str(it.get('item_code', '') or '').strip()
                    unit_cost_raw = it.get('unit_cost')
                    unit_cost_value = None
                    if unit_cost_raw is not None:
                        unit_cost_value = Decimal(str(unit_cost_raw))
                    item_total_cost = unit_cost_value * quantity if unit_cost_value is not None else Decimal('0')

                    # Create Item record
                    item = Item.objects.create(
                        barcode=barcode,
                        itemname=itemname,
                        quantity=quantity,
                        expdate=today,
                        user=user,
                        item_code=item_code,
                        stocktake=False,
                        writeoff=True,
                    )

                    # Create/update WriteOffItem within the batch
                    writeoff_record, created_flag = WriteOffItem.objects.update_or_create(
                        barcode=barcode,
                        itemname=itemname,
                        item_code=item_code,
                        writeoff_batch=writeoff_batch,
                        defaults={
                            'quantity': 0,
                            'unit_cost': unit_cost_value,
                        },
                    )
                    if created_flag:
                        writeoff_record.quantity = int(quantity)
                    else:
                        writeoff_record.quantity = writeoff_record.quantity + int(quantity)
                    writeoff_record.writeoff_batch = writeoff_batch
                    # Always persist unit_cost when provided
                    if unit_cost_value is not None:
                        writeoff_record.unit_cost = unit_cost_value
                    elif created_flag:
                        writeoff_record.unit_cost = None
                    writeoff_record.save()

                    created += 1
                except Exception as e:
                    errors.append({'name': name_key, 'item': it, 'error': str(e)})

        return Response({'created': created, 'errors': errors}, status=status.HTTP_201_CREATED if created else status.HTTP_400_BAD_REQUEST)

def build_writeoff_image_urls(request, file_paths):
    """Convert the pipe-separated relative file paths stored on a WriteOffBatch
    (e.g. 'Image/20250101_x.jpg|Image/20250101_y.png') into absolute URLs the
    frontend can load directly in an <img> tag."""
    if not file_paths:
        return []
    urls = []
    for p in file_paths.split('|'):
        p = p.strip()
        if not p:
            continue
        urls.append(request.build_absolute_uri('/' + p.lstrip('/')))
    return urls


class WriteOffBatchExportView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, batch_id):
        try:
            batch = WriteOffBatch.objects.get(id=batch_id)
        except WriteOffBatch.DoesNotExist:
            return Response({'error': 'WriteOff batch not found'}, status=status.HTTP_404_NOT_FOUND)

        if batch.user_id != request.user.id and not (request.user.is_staff or request.user.is_superuser):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        items = WriteOffItem.objects.filter(writeoff_batch=batch).order_by('id')

        workbook = Workbook()
        sheet = workbook.active
        sheet.title = 'Items'
        sheet.append(['Barcode', 'Tên hàng', 'Item Code', 'Số lượng', 'Giá cost', 'Tổng'])
        for item in items:
            unit_cost_value = float(item.unit_cost) if item.unit_cost is not None else 0
            quantity_value = int(item.quantity or 0)
            row_total = unit_cost_value * quantity_value
            sheet.append([
                item.barcode or '',
                item.itemname or '',
                item.item_code or '',
                quantity_value,
                unit_cost_value,
                row_total,
            ])

        if items.exists():
            total_row = [''] * 4 + ['Tổng batch', float(batch.total_cost or 0)]
            sheet.append([])
            sheet.append(total_row)

        excel_buffer = io.BytesIO()
        workbook.save(excel_buffer)
        excel_buffer.seek(0)

        archive_buffer = io.BytesIO()
        with zipfile.ZipFile(archive_buffer, 'w', zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(f'{batch.name or "writeoff_batch"}.xlsx', excel_buffer.getvalue())

            image_paths = [p.strip() for p in (batch.file_paths or '').split('|') if p.strip()]
            for rel_path in image_paths:
                full_path = os.path.join(settings.BASE_DIR, rel_path.lstrip('/'))
                if not os.path.exists(full_path):
                    continue
                archive.write(full_path, arcname=os.path.join('images', os.path.basename(full_path)))

        archive_buffer.seek(0)
        response = HttpResponse(archive_buffer.getvalue(), content_type='application/zip')
        safe_name = re.sub(r'[\\/:*?"<>|]', '_', batch.name or 'writeoff_batch')
        response['Content-Disposition'] = f'attachment; filename="{safe_name}.zip"'
        return response


class WriteOffBatchListView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        batches = WriteOffBatch.objects.annotate(item_count=Count('writeoff_items')).order_by('-created_at')
        data = []
        for batch in batches:
            creator = batch.user
            data.append({
                'id': batch.id,
                'name': batch.name,
                'created_at': batch.created_at.isoformat() if batch.created_at else None,
                'total_cost': float(batch.total_cost) if batch.total_cost is not None else 0,
                'user_id': creator.id,
                'username': creator.username,
                'full_name': creator.get_full_name() or creator.username,
                'item_count': batch.item_count,
                'images': build_writeoff_image_urls(request, batch.file_paths),
            })
        return Response({'batches': data}, status=status.HTTP_200_OK)

class WriteOffBatchItemsView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request, batch_id):
        try:
            batch = WriteOffBatch.objects.get(id=batch_id)
        except WriteOffBatch.DoesNotExist:
            return Response({'error': 'WriteOff batch not found'}, status=status.HTTP_404_NOT_FOUND)

        items = WriteOffItem.objects.filter(writeoff_batch=batch)
        data = []
        for item in items:
            data.append({
                'id': item.id,
                'barcode': item.barcode,
                'itemname': item.itemname,
                'item_code': item.item_code,
                'quantity': item.quantity,
                'unit_cost': float(item.unit_cost) if getattr(item, 'unit_cost', None) is not None else None,
            })
        return Response({
            'batch': {
                'id': batch.id,
                'name': batch.name,
                'created_at': batch.created_at.isoformat() if batch.created_at else None,
                'total_cost': float(batch.total_cost) if batch.total_cost is not None else 0,
                'user_id': batch.user.id,
                'username': batch.user.username,
                'full_name': batch.user.get_full_name() or batch.user.username,
                'item_count': items.count(),
                'images': build_writeoff_image_urls(request, batch.file_paths),
            },
            'items': data,
        }, status=status.HTTP_200_OK)


class WriteOffItemDeleteView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def delete(self, request, item_id):
        user = request.user
        try:
            item = WriteOffItem.objects.get(id=item_id)
        except WriteOffItem.DoesNotExist:
            return Response({'error': 'Write-off item not found'}, status=status.HTTP_404_NOT_FOUND)

        batch = item.writeoff_batch
        if batch and batch.user_id != user.id and not (user.is_staff or user.is_superuser):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        item.delete()
        remaining_count = batch.writeoff_items.count() if batch else 0
        return Response({
            'message': 'Write-off item deleted successfully',
            'batch_id': batch.id if batch else None,
            'remaining_items': remaining_count,
        }, status=status.HTTP_200_OK)


class WriteOffBatchDeleteView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def delete(self, request, batch_id):
        user = request.user
        try:
            batch = WriteOffBatch.objects.get(id=batch_id)
        except WriteOffBatch.DoesNotExist:
            return Response({'error': 'Write-off batch not found'}, status=status.HTTP_404_NOT_FOUND)

        if batch.user_id != user.id and not (user.is_staff or user.is_superuser):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

        if batch.file_paths:
            for rel_path in batch.file_paths.split('|'):
                rel_path = rel_path.strip()
                if not rel_path:
                    continue
                full_path = os.path.join(settings.BASE_DIR, rel_path.lstrip('/'))
                if os.path.exists(full_path):
                    try:
                        os.remove(full_path)
                    except OSError:
                        pass

        batch.delete()
        return Response({'message': 'Write-off batch deleted successfully'}, status=status.HTTP_200_OK)


class ItemBatchCreateView(APIView):
    """Accepts a multipart/form-data request with a 'payload' field containing
    JSON mapping top-level names to arrays of item objects. Files sent in
    'files' are attached to each writeoff record for the batch.

    Example payload:
      {
        "WO Name 1": [ {"barcode": "123", "quantity": 2, "item_code": "A1"}, ... ],
        "WO Name 2": [ ... ]
      }
    """
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        payload_raw = request.data.get('payload') or request.POST.get('payload')
        if not payload_raw:
            return Response({'error': 'Missing payload'}, status=status.HTTP_400_BAD_REQUEST)
        try:
            payload = json.loads(payload_raw)
        except Exception as e:
            return Response({'error': 'Invalid JSON payload', 'details': str(e)}, status=status.HTTP_400_BAD_REQUEST)

        files = request.FILES.getlist('files') if hasattr(request, 'FILES') else []
        if not files:
            return Response({'error': 'WO requires at least one file upload for the batch.'}, status=status.HTTP_400_BAD_REQUEST)

        user = request.user
        created = 0
        errors = []
        tz_vn = timezone.get_fixed_timezone(7 * 60)

        # Save files once and keep their saved paths to store in WriteOffItem
        upload_dir = os.path.join(settings.BASE_DIR, 'Image')
        os.makedirs(upload_dir, exist_ok=True)
        saved_paths = []
        try:
            from django.utils import timezone as djtz
            for uploaded_file in files:
                file_name = f"{djtz.now().strftime('%Y%m%d%H%M%S')}_{uploaded_file.name}"
                file_path = os.path.join(upload_dir, file_name)
                with open(file_path, 'wb+') as dest:
                    for chunk in uploaded_file.chunks():
                        dest.write(chunk)
                saved_paths.append(f"Image/{file_name}")
        except Exception as e:
            return Response({'error': 'Failed saving uploaded files', 'details': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        # Iterate payload
        for name_key, items in payload.items():
            if not isinstance(items, list):
                errors.append({'name': name_key, 'error': 'items must be an array'})
                continue

            today = now().date()
            total_cost = Decimal('0')
            for it in items:
                try:
                    quantity = int(it.get('quantity', 1))
                    unit_cost = it.get('unit_cost')
                    if unit_cost is not None:
                        total_cost += Decimal(str(unit_cost)) * quantity
                except Exception:
                    continue

            writeoff_batch = WriteOffBatch.objects.create(
                user=user,
                name=name_key,
                file_paths='|'.join(saved_paths) if saved_paths else '',
                total_cost=total_cost,
            )

            for it in items:
                try:
                    barcode = str(it.get('barcode', '')).strip()
                    itemname = str(it.get('itemname', '')).strip() or name_key
                    quantity = int(it.get('quantity', 1))
                    item_code = str(it.get('item_code', '') or '').strip()
                    unit_cost_raw = it.get('unit_cost')
                    unit_cost_value = None
                    if unit_cost_raw is not None:
                        unit_cost_value = Decimal(str(unit_cost_raw))
                    item_total_cost = unit_cost_value * quantity if unit_cost_value is not None else Decimal('0')

                    # Create Item record
                    item = Item.objects.create(
                        barcode=barcode,
                        itemname=itemname,
                        quantity=quantity,
                        expdate=today,
                        user=user,
                        item_code=item_code,
                        stocktake=False,
                        writeoff=True,
                    )

                    # Create/update WriteOffItem within the batch
                    writeoff_record, created_flag = WriteOffItem.objects.update_or_create(
                        barcode=barcode,
                        itemname=itemname,
                        item_code=item_code,
                        writeoff_batch=writeoff_batch,
                        defaults={
                            'quantity': 0,
                            'unit_cost': unit_cost_value,
                        },
                    )
                    if created_flag:
                        writeoff_record.quantity = int(quantity)
                    else:
                        writeoff_record.quantity = writeoff_record.quantity + int(quantity)
                    writeoff_record.writeoff_batch = writeoff_batch
                    if unit_cost_value is not None:
                        writeoff_record.unit_cost = unit_cost_value
                    elif created_flag:
                        writeoff_record.unit_cost = None
                    writeoff_record.save()

                    created += 1
                except Exception as e:
                    errors.append({'name': name_key, 'item': it, 'error': str(e)})

        return Response({'created': created, 'errors': errors}, status=status.HTTP_201_CREATED if created else status.HTTP_400_BAD_REQUEST)

    def get(self, request):
        """
        Search for items by barcode (and optional username and date).
        Query params:
          - barcode (required)
          - username (optional, defaults to request.user.username)
          - date (optional, YYYY-MM-DD or DD/MM/YYYY, defaults to today)
          - stocktake (optional, 'true'/'false') to filter stocktake flag if model supports it
        Returns: { data: [ ...items ] }
        """
        barcode = request.query_params.get('barcode')
        if not barcode:
            return Response({'error': 'barcode query param is required'}, status=status.HTTP_400_BAD_REQUEST)

        username = request.query_params.get('username')
        date_param = request.query_params.get('date')
        stocktake_param = request.query_params.get('stocktake')

        # Determine user
        if username:
            try:
                user = User.objects.get(username=username)
            except User.DoesNotExist:
                return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        else:
            user = request.user

        # Parse date
        query_date = None
        if date_param:
            from datetime import datetime
            try:
                query_date = datetime.strptime(date_param, '%Y-%m-%d').date()
            except Exception:
                try:
                    query_date = datetime.strptime(date_param, '%d/%m/%Y').date()
                except Exception:
                    return Response({'error': 'Invalid date format. Use YYYY-MM-DD or DD/MM/YYYY.'}, status=status.HTTP_400_BAD_REQUEST)
        else:
            query_date = now().date()

        try:
            qs = Item.objects.filter(user=user, barcode=barcode, expdate=query_date)
        except (DatabaseError, OperationalError) as db_err:
            # Likely missing DB column (e.g., after adding `created_at` without running migrations)
            return Response({'error': 'Database error when querying items. Have you run migrations to add new fields?','details': str(db_err)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        if stocktake_param is not None and hasattr(Item, 'stocktake'):
            stocktake_flag = str(stocktake_param).lower() in ('1', 'true', 'yes')
            qs = qs.filter(stocktake=stocktake_flag)

        items_data = []
        # Vietnam timezone for formatting
        tz_vn = timezone.get_fixed_timezone(7 * 60)
        for item in qs:
            item_code_val = ''
            if hasattr(item, 'item_code'):
                item_code_val = item.item_code if item.item_code is not None else ''
            def fmt(d):
                if not d:
                    return ''
                return d.strftime('%d/%m/%Y')
            items_data.append({
                'id': item.id,
                'barcode': item.barcode,
                'itemname': item.itemname,
                'quantity': item.quantity,
                'expdate': fmt(item.expdate),
                'created_at': timezone.localtime(item.created_at, tz_vn).strftime('%d/%m/%Y %H:%M:%S') if getattr(item, 'created_at', None) else '',
                'can_edit': (request.user.is_staff or request.user.is_superuser) or (item.user == request.user),
                'can_delete': (request.user.is_staff or request.user.is_superuser) or (item.user == request.user),
                'item_code': str(item_code_val),
                'stocktake': getattr(item, 'stocktake', False) if hasattr(item, 'stocktake') else False,
            })

        return Response({'data': items_data}, status=status.HTTP_200_OK)

class ItemListByGroupView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    def post(self, request):
        user = request.user
        # Xóa các item hết hạn > 30 ngày
        today = now().date()
        threshold = today - timedelta(days=30)
        Item.objects.filter(expdate__lt=threshold).delete()
        try:
            group = user.profile.group
        except AttributeError:
            return Response({'error': 'User or group not found'}, status=status.HTTP_404_NOT_FOUND)
        users_in_group = User.objects.filter(profile__group=group)
        is_manage = user.is_staff or user.is_superuser
        soon_threshold = today + timedelta(days=15)
        users_data = []
        for u in users_in_group:
            # Aggregate items by barcode/item_code/itemname/expdate so duplicates (stocktake vs date) count as one
            qs = Item.objects.filter(user=u)
            # Exclude stocktake items from counts (we only count date/non-stocktake groups)
            if hasattr(Item, 'stocktake'):
                qs = qs.filter(stocktake=False)
            group_fields = ['barcode', 'itemname', 'expdate']
            if hasattr(Item, 'item_code'):
                group_fields.append('item_code')

            grouped = qs.values(*group_fields).annotate(total_quantity=Sum('quantity'))
            # Now compute counts based on grouped expdate values (unique product+date groups)
            expired_count = grouped.filter(expdate__lt=today).count()
            soon_expire_count = grouped.filter(expdate__gte=today, expdate__lte=soon_threshold).count()
            valid_count = grouped.filter(expdate__gt=soon_threshold).count()
            users_data.append({
                'id': u.id,
                'username': u.username,
                'full_name': u.profile.fullname if hasattr(u, 'profile') else '',
                'expired_count': expired_count,
                'soon_expire_count': soon_expire_count,
                'valid_count': valid_count
                
            })
        return Response({'group': group, 'users': users_data, 'is_manage': is_manage}, status=status.HTTP_200_OK)

class GroupWishlistView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    def post(self, request):
        user = request.user
        try:
            group = user.profile.group
        except AttributeError:
            return Response({'error': 'User or group not found'}, status=status.HTTP_404_NOT_FOUND)
        wishlist_names = GroupWishlistName.objects.filter(group=group)
        # Only return wishlistname and id
        wishlist_list = [
            {'wishlistname': wname.wishlistname, 'id': wname.id}
            for wname in wishlist_names
        ]
        return Response({'wishlist': wishlist_list}, status=status.HTTP_200_OK)

class UserItemListView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    def get(self, request, user_id):
        current_user = request.user
        is_manage = current_user.is_staff or current_user.is_superuser
        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response({'error': 'User not found'}, status=status.HTTP_404_NOT_FOUND)
        # Aggregate items by barcode, item_code (if present), itemname, expdate (date-only) and stocktake flag
        qs = Item.objects.filter(user=user)

        group_fields = ['barcode', 'itemname', 'expdate', 'stocktake']
        if hasattr(Item, 'item_code'):
            group_fields.append('item_code')

        # Annotate with summed quantity, pick a representative id, and preserve unit_cost when available
        annotate_kwargs = {'quantity': Sum('quantity'), 'id': Min('id')}
        if hasattr(Item, 'unit_cost'):
            annotate_kwargs['unit_cost'] = Min('unit_cost')
        aggregated = qs.values(*group_fields).annotate(**annotate_kwargs).order_by('itemname')

        items_data = []
        def fmt_date(d):
            if not d:
                return ''
            return d.strftime('%d/%m/%Y')

        for row in aggregated:
            item_code_val = row.get('item_code', '') if 'item_code' in row else ''
            stocktake_val = row.get('stocktake', False)
            items_data.append({
                'id': row.get('id'),
                'barcode': row.get('barcode'),
                'itemname': row.get('itemname'),
                'quantity': row.get('quantity') or 0,
                'expdate': fmt_date(row.get('expdate')),
                'created_at': '',
                'can_edit': is_manage or (user == current_user),
                'can_delete': is_manage or (user == current_user),
                'item_code': str(item_code_val) if item_code_val is not None else '',
                'stocktake': bool(stocktake_val),
                'unit_cost': row.get('unit_cost'),
            })

        return Response({'user_id': user.id, 'username': user.username, 'items': items_data}, status=status.HTTP_200_OK)

class ItemDeleteView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def delete(self, request, item_id):
        user = request.user
        try:
            item = Item.objects.get(id=item_id)
        except Item.DoesNotExist:
            return Response({'error': 'Item not found'}, status=status.HTTP_404_NOT_FOUND)

        if item.user == user or user.is_staff or user.is_superuser:
            item_user = item.user
            item.delete()
            # Tính lại số lượng các loại sản phẩm của user sau khi xóa
            from datetime import timedelta
            today = now().date()
            soon_threshold = today + timedelta(days=15)
            user_items = Item.objects.filter(user=item_user)
            if hasattr(Item, 'stocktake'):
                user_items = user_items.filter(stocktake=False)
            expired_count = user_items.filter(expdate__lt=today).count()
            soon_expire_count = user_items.filter(expdate__gte=today, expdate__lte=soon_threshold).count()
            valid_count = user_items.filter(expdate__gt=soon_threshold).count()
            return Response({
                'message': 'Item deleted successfully',
                'expired_count': expired_count,
                'soon_expire_count': soon_expire_count,
                'valid_count': valid_count
            }, status=status.HTTP_200_OK)

        return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)

class ItemUpdateView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    def put(self, request, item_id):
        user = request.user
        try:
            item = Item.objects.get(id=item_id)
        except Item.DoesNotExist:
            return Response({'error': 'Item not found'}, status=status.HTTP_404_NOT_FOUND)
        # Chỉ cho phép sửa nếu là chủ sở hữu hoặc manage
        if not (item.user == user or user.is_staff or user.is_superuser):
            return Response({'error': 'Permission denied'}, status=status.HTTP_403_FORBIDDEN)
        serializer = ItemSerializer(item, data=request.data, partial=True)
        if serializer.is_valid():
            data = serializer.validated_data
            # Kiểm tra nếu có barcode, itemname, expdate trùng với item khác thì chỉ update quantity
            barcode = data.get('barcode', item.barcode)
            itemname = data.get('itemname', item.itemname)
            expdate = data.get('expdate', item.expdate)
            # Nếu có trường stocktake trong payload thì dùng giá trị đó để so sánh, nếu không thì dùng giá trị hiện tại của item
            stocktake_val = None
            if hasattr(Item, 'stocktake'):
                if 'stocktake' in data:
                    stocktake_val = bool(data.get('stocktake'))
                else:
                    stocktake_val = getattr(item, 'stocktake', False)
            # Đảm bảo expdate là date
            if isinstance(expdate, str):
                from datetime import datetime
                try:
                    expdate = datetime.strptime(expdate, '%Y-%m-%d').date()
                except ValueError:
                    try:
                        expdate = datetime.strptime(expdate, '%d/%m/%Y').date()
                    except Exception:
                        pass
            duplicate_filter = {'barcode': barcode, 'itemname': itemname, 'expdate': expdate, 'user': user}
            if stocktake_val is not None and hasattr(Item, 'stocktake'):
                duplicate_filter['stocktake'] = stocktake_val
            duplicate = Item.objects.filter(**duplicate_filter).exclude(id=item.id).first()
            # On edit: do NOT merge into another record. Always update the
            # current item and set its created_at to the current time so the
            # updated record remains distinct.
            new_created_at = timezone.now()
            for attr, value in data.items():
                setattr(item, attr, value)
            try:
                item.created_at = new_created_at
            except Exception:
                # If created_at is read-only or unavailable, ignore the assignment
                pass
            item.save()
            # Tính lại số lượng các loại sản phẩm của user
            from datetime import timedelta
            today = now().date()
            soon_threshold = today + timedelta(days=15)
            user_items = Item.objects.filter(user=user)
            if hasattr(Item, 'stocktake'):
                user_items = user_items.filter(stocktake=False)
            expired_count = user_items.filter(expdate__lt=today).count()
            soon_expire_count = user_items.filter(expdate__gte=today, expdate__lte=soon_threshold).count()
            valid_count = user_items.filter(expdate__gt=soon_threshold).count()
            # Build response item data and include created_at (VN timezone) if present
            tz_vn = timezone.get_fixed_timezone(7 * 60)
            item_data = ItemSerializer(item).data
            # Use the instance's created_at (which we've set to now on edit)
            created_at_val = getattr(item, 'created_at', None)
            if created_at_val:
                item_data['created_at'] = timezone.localtime(created_at_val, tz_vn).strftime('%d/%m/%Y %H:%M:%S')
            else:
                item_data['created_at'] = ''

            return Response({
                'message': 'Item updated successfully',
                'item': item_data,
                'id': item.id,
                'expired_count': expired_count,
                'soon_expire_count': soon_expire_count,
                'valid_count': valid_count
            }, status=status.HTTP_200_OK)
        return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

# Gửi mail sử dụng SMTP thủ công (từ mail_api.py)
def send_expiry_email(to_email, subject, body_html):
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText
    
    # Template HTML cơ bản cho email
    def get_email_template(content, email_type="info"):
        """
        Tạo template email đồng bộ
        email_type: 'warning' (sắp hết hạn), 'danger' (đã hết hạn), 'info' (thông tin chung)
        """
        # Màu sắc theo loại email
        colors = {
            'warning': {
                'primary': '#f39c12',
                'secondary': '#e67e22',
                'text': '#8b4513'
            },
            'danger': {
                'primary': '#e74c3c',
                'secondary': '#c0392b',
                'text': '#722f37'
            },
            'info': {
                'primary': '#3498db',
                'secondary': '#2980b9',
                'text': '#2c3e50'
            }
        }
        
        color_scheme = colors.get(email_type, colors['info'])
        
        signature = f"""
        <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid {color_scheme['primary']};">
            <div style="font-size: 14px; color: #555555; line-height: 1.6;">
                Trân trọng,<br>
                <strong style="color: {color_scheme['primary']}; font-size: 16px;">Thành Nam</strong><br>
                <span style="color: #888;">Founder @ nguyenthanhnam.io.vn</span><br>
                <a href="https://nguyenthanhnam.io.vn/wp" style="color: {color_scheme['primary']}; text-decoration: none;">
                    https://nguyenthanhnam.io.vn/wp
                </a>
            </div>
        </div>
        """
        
        return f"""
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Thông Báo Hạn Sử Dụng</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                
                <!-- Header -->
                <div style="background: linear-gradient(135deg, {color_scheme['primary']} 0%, {color_scheme['secondary']} 100%); padding: 30px 40px; text-align: center;">
                    <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600; letter-spacing: 0.5px;">
                        📦 Quản Lý Hạn Sử Dụng
                    </h1>
                    <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
                        Hệ thống thông báo tự động
                    </p>
                </div>
                
                <!-- Content -->
                <div style="padding: 40px;">
                    {content}
                </div>
                
                <!-- Signature -->
                {signature}
                
                <!-- Footer -->
                <div style="background-color: #f8f9fa; padding: 20px 40px; text-align: center; border-top: 1px solid #e9ecef;">
                    <p style="color: #6c757d; font-size: 12px; margin: 0;">
                        © 2025 nguyenthanhnam.io.vn - Hệ thống quản lý tự động
                    </p>
                </div>
                
            </div>
        </body>
        </html>
        """
    
    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = "thanhnamsuken@gmail.com"
    msg["To"] = to_email
    msg.attach(MIMEText(body_html, "html"))
    
    try:
        with smtplib.SMTP("smtp.gmail.com", 587) as server:
            server.starttls()
            server.login("thanhnamsuken@gmail.com", "hnvjgqonbzpsxnvk")
            server.sendmail(msg["From"], msg["To"], msg.as_string())
    except Exception as e:
        print(f"Send mail error: {e}")

def create_item_card(item, now_date, card_type="warning"):
    """
    Tạo card sản phẩm với thiết kế đồng bộ
    card_type: 'warning' (sắp hết hạn), 'danger' (đã hết hạn)
    """
    if card_type == "warning":
        days_left = (item.expdate - now_date).days
        status_text = 'hôm nay' if days_left == 0 else f'{days_left} ngày'
        status_color = '#f39c12' if days_left > 3 else '#e74c3c'
        border_color = '#f39c12'
        icon = '⚠️'
    else:  # danger
        days_expired = (now_date - item.expdate).days
        status_text = f'{days_expired} ngày'
        status_color = '#e74c3c'
        border_color = '#e74c3c'
        icon = '❌'
    
    return f"""
    <div style="
        border: 2px solid {border_color}; 
        border-radius: 12px; 
        padding: 20px; 
        margin-bottom: 16px; 
        background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
        box-shadow: 0 2px 8px rgba(0,0,0,0.1);
        position: relative;
    ">
        <div style="position: absolute; top: -1px; right: 15px; font-size: 20px;">{icon}</div>
        
        <div style="display: grid; gap: 8px;">
            <div style="display: flex; align-items: center;">
                <span style="font-weight: 600; color: #2c3e50; font-size: 16px; margin-right: 8px;">📦</span>
                <span style="font-weight: 600; color: #2c3e50; font-size: 16px;">{item.itemname}</span>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;">
                <div>
                    <span style="color: #888; font-size: 13px; font-weight: 500;">BARCODE</span><br>
                    <span style="color: #495057; font-weight: 500;">{item.barcode}</span>
                </div>
                <div>
                    <span style="color: #888; font-size: 13px; font-weight: 500;">SỐ LƯỢNG</span><br>
                    <span style="color: #e67e22; font-weight: 600;">{item.quantity}</span>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 8px;">
                <div>
                    <span style="color: #888; font-size: 13px; font-weight: 500;">HẠN SỬ DỤNG</span><br>
                    <span style="color: #c0392b; font-weight: 600;">{item.expdate.strftime('%d/%m/%Y')}</span>
                </div>
                <div>
                    <span style="color: #888; font-size: 13px; font-weight: 500;">
                        {'CÒN LẠI' if card_type == 'warning' else 'ĐÃ HẾT HẠN'}
                    </span><br>
                    <span style="color: {status_color}; font-weight: 700; font-size: 15px;">{status_text}</span>
                </div>
            </div>
        </div>
    </div>
    """

def seconds_until_next_midnight():
    import datetime
    now = datetime.datetime.now()
    tomorrow = now + datetime.timedelta(days=1)
    midnight = datetime.datetime.combine(tomorrow.date(), datetime.time(0, 0, 0))
    return (midnight - now).total_seconds()

# Hàm kiểm tra và gửi mail định kỳ - CẢI TIẾN
def check_and_notify_expiring_items():
    while True:
        now_date = timezone.now().date()
        soon_threshold = now_date + timedelta(days=15)
        users = User.objects.all()
        
        for user in users:
            email = user.email
            if not email:
                continue
                
            expiring_items = Item.objects.filter(
                user=user, 
                expdate__gte=now_date, 
                expdate__lte=soon_threshold
            )

            # Exclude stocktake items from email notifications
            if hasattr(Item, 'stocktake'):
                expiring_items = expiring_items.filter(stocktake=False)
            
            if expiring_items.exists():
                # Tạo danh sách sản phẩm với design mới
                item_cards = "".join([
                    create_item_card(item, now_date, "warning")
                    for item in expiring_items
                ])
                
                import datetime
                now_str = datetime.datetime.now().strftime('%d/%m/%Y %H:%M:%S')
                subject = f"⚠️ Thông báo sản phẩm sắp hết hạn [{now_str}]"
                
                # Nội dung email với thiết kế mới
                content = f"""
                <div style="text-align: center; margin-bottom: 30px;">
                    <div style="background: linear-gradient(135deg, #fff3cd 0%, #ffeaa7 100%); 
                                padding: 20px; border-radius: 12px; border-left: 4px solid #f39c12;">
                        <h2 style="color: #8b4513; margin: 0 0 8px 0; font-size: 20px;">
                            🔔 Cảnh Báo Hạn Sử Dụng
                        </h2>
                        <p style="color: #8b4513; margin: 0; font-size: 15px;">
                            Bạn có <strong>{expiring_items.count()} sản phẩm</strong> sắp hết hạn trong 15 ngày tới
                        </p>
                    </div>
                </div>
                
                <div style="margin-bottom: 30px;">
                    {item_cards}
                </div>
                
                <div style="background-color: #e8f4fd; padding: 20px; border-radius: 12px; text-align: center;">
                    <p style="color: #2980b9; margin: 0; font-size: 14px; font-weight: 500;">
                        💡 <strong>Gợi ý:</strong> Vui lòng kiểm tra và đưa sản phẩm lên UPSELLING để tối ưu doanh thu!
                    </p>
                </div>
                """
                
                # Sử dụng template mới
                def get_email_template(content, email_type="warning"):
                    colors = {
                        'warning': {'primary': '#f39c12', 'secondary': '#e67e22'},
                        'danger': {'primary': '#e74c3c', 'secondary': '#c0392b'},
                    }
                    color_scheme = colors.get(email_type, colors['warning'])
                    
                    signature = f"""
                    <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid {color_scheme['primary']};">
                        <div style="font-size: 14px; color: #555555; line-height: 1.6;">
                            Trân trọng,<br>
                            <strong style="color: {color_scheme['primary']}; font-size: 16px;">Thành Nam</strong><br>
                            <span style="color: #888;">Founder @ nguyenthanhnam.io.vn</span><br>
                            <a href="https://nguyenthanhnam.io.vn/wp" style="color: {color_scheme['primary']}; text-decoration: none;">
                                https://nguyenthanhnam.io.vn/wp
                            </a>
                        </div>
                    </div>
                    """
                    
                    return f"""
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    </head>
                    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa;">
                        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                            <div style="background: linear-gradient(135deg, {color_scheme['primary']} 0%, {color_scheme['secondary']} 100%); padding: 30px 40px; text-align: center;">
                                <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">
                                    📦 Quản Lý Hạn Sử Dụng
                                </h1>
                                <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
                                    Hệ thống thông báo tự động
                                </p>
                            </div>
                            <div style="padding: 40px;">
                                {content}
                            </div>
                            {signature}
                            <div style="background-color: #f8f9fa; padding: 20px 40px; text-align: center; border-top: 1px solid #e9ecef;">
                                <p style="color: #6c757d; font-size: 12px; margin: 0;">
                                    © 2025 nguyenthanhnam.io.vn - Hệ thống quản lý tự động
                                </p>
                            </div>
                        </div>
                    </body>
                    </html>
                    """
                
                body_html = get_email_template(content, "warning")
                send_expiry_email(email, subject, body_html)
                
        # Chỉ gửi mail đúng vào 12 giờ đêm mỗi ngày
        time.sleep(seconds_until_next_midnight())

# Hàm kiểm tra sản phẩm đã hết hạn - CẢI TIẾN
def check_and_notify_expired_items():
    while True:
        now_date = timezone.now().date()
        users = User.objects.all()
        
        for user in users:
            email = user.email
            if not email:
                continue
                
            expired_items = Item.objects.filter(user=user, expdate__lt=now_date)

            # Exclude stocktake items from email notifications
            if hasattr(Item, 'stocktake'):
                expired_items = expired_items.filter(stocktake=False)
            
            if expired_items.exists():
                # Tạo danh sách sản phẩm đã hết hạn
                item_cards = "".join([
                    create_item_card(item, now_date, "danger")
                    for item in expired_items
                ])
                
                import datetime
                now_str = datetime.datetime.now().strftime('%d/%m/%Y %H:%M:%S')
                subject = f"🚨 Thông báo sản phẩm đã hết hạn [{now_str}]"
                
                content = f"""
                <div style="text-align: center; margin-bottom: 30px;">
                    <div style="background: linear-gradient(135deg, #f8d7da 0%, #f5c6cb 100%); 
                                padding: 20px; border-radius: 12px; border-left: 4px solid #e74c3c;">
                        <h2 style="color: #722f37; margin: 0 0 8px 0; font-size: 20px;">
                            🚨 Cảnh Báo Khẩn Cấp
                        </h2>
                        <p style="color: #722f37; margin: 0; font-size: 15px;">
                            Bạn có <strong>{expired_items.count()} sản phẩm</strong> đã hết hạn sử dụng
                        </p>
                    </div>
                </div>
                
                <div style="margin-bottom: 30px;">
                    {item_cards}
                </div>
                
                <div style="background-color: #fee; padding: 20px; border-radius: 12px; text-align: center; border: 1px solid #fcc;">
                    <p style="color: #c0392b; margin: 0; font-size: 14px; font-weight: 600;">
                        ⚠️ <strong>Hành động ngay:</strong> Vui lòng kiểm tra và lấy sản phẩm ra khỏi kệ để đảm bảo an toàn!
                    </p>
                </div>
                """
                
                def get_email_template_danger(content):
                    signature = """
                    <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e74c3c;">
                        <div style="font-size: 14px; color: #555555; line-height: 1.6;">
                            Trân trọng,<br>
                            <strong style="color: #e74c3c; font-size: 16px;">Thành Nam</strong><br>
                            <span style="color: #888;">Founder @ nguyenthanhnam.io.vn</span><br>
                            <a href="https://nguyenthanhnam.io.vn/wp" style="color: #e74c3c; text-decoration: none;">
                                https://nguyenthanhnam.io.vn/wp
                            </a>
                        </div>
                    </div>
                    """
                    
                    return f"""
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    </head>
                    <body style="margin: 0; padding: 0; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8f9fa;">
                        <div style="max-width: 600px; margin: 0 auto; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.15);">
                            <div style="background: linear-gradient(135deg, #e74c3c 0%, #c0392b 100%); padding: 30px 40px; text-align: center;">
                                <h1 style="color: #ffffff; margin: 0; font-size: 24px; font-weight: 600;">
                                    🚨 Cảnh Báo Hết Hạn
                                </h1>
                                <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0 0; font-size: 14px;">
                                    Yêu cầu xử lý ngay lập tức
                                </p>
                            </div>
                            <div style="padding: 40px;">
                                {content}
                            </div>
                            {signature}
                            <div style="background-color: #f8f9fa; padding: 20px 40px; text-align: center; border-top: 1px solid #e9ecef;">
                                <p style="color: #6c757d; font-size: 12px; margin: 0;">
                                    © 2025 nguyenthanhnam.io.vn - Hệ thống quản lý tự động
                                </p>
                            </div>
                        </div>
                    </body>
                    </html>
                    """
                
                body_html = get_email_template_danger(content)
                send_expiry_email(email, subject, body_html)
                
        # Chỉ gửi mail đúng vào 12 giờ đêm mỗi ngày
        time.sleep(seconds_until_next_midnight())

# Khởi động thread kiểm tra khi server chạy
def start_expiry_check_thread():
    import threading
    t1 = threading.Thread(target=check_and_notify_expiring_items, daemon=True)
    t2 = threading.Thread(target=check_and_notify_expired_items, daemon=True)
    t1.start()
    t2.start()

# start_expiry_check_thread()

class WishlistAPIView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        """
        Chỉ cho phép mỗi group có 1 wishlistname duy nhất. Nếu đã tồn tại wishlistname cho group thì chỉ thêm sản phẩm vào wishlist đó, không tạo mới.
        Body: {"wishlistname": "Tên wishlist", "product_id": 123}
        """
        user = request.user
        group = getattr(user.profile, 'group', None)
        wishlistname = request.data.get('wishlistname')
        product_id = request.data.get('product_id')
        if not (group and wishlistname and product_id):
            return Response({'error': 'Missing group, wishlistname hoặc product_id'}, status=400)
        # Đảm bảo luôn có bản ghi GroupWishlistName
        wishlistname_obj, created = GroupWishlistName.objects.get_or_create(group=group, wishlistname=wishlistname)
        try:
            product = ProductData.objects.get(id=product_id)
        except ProductData.DoesNotExist:
            return Response({'error': 'Product not found'}, status=404)
        # Kiểm tra đã có sản phẩm này trong wishlist chưa
        if GroupWishlist.objects.filter(group=group, wishlistname=wishlistname, product=product).exists():
            return Response({'error': 'Sản phẩm đã có trong wishlist này.'}, status=400)
        obj = GroupWishlist.objects.create(
            group=group, wishlistname=wishlistname, product=product
        )
        # Nếu là sản phẩm đầu tiên của wishlist này thì trả về message tạo mới, nếu không thì chỉ báo đã thêm
        is_new_wishlist = GroupWishlist.objects.filter(group=group, wishlistname=wishlistname).count() == 1
        if is_new_wishlist:
            return Response({'message': 'Wishlist created và đã thêm sản phẩm', 'id_product': obj.product.id, 'wishlistname': wishlistname_obj.wishlistname, 'id': wishlistname_obj.id}, status=201)
        else:
            return Response({'message': 'Đã thêm sản phẩm vào wishlist', 'id_product': obj.product.id, 'wishlistname': wishlistname_obj.wishlistname, 'id': wishlistname_obj.id}, status=200)

    def delete(self, request):
        """
        Xóa sản phẩm khỏi wishlistname của group hiện tại, hoặc xóa toàn bộ wishlist nếu không truyền product_id.
        Body: {"wishlistname": "Tên wishlist", "product_id": 123 (tùy chọn)}
        """
        user = request.user
        group = getattr(user.profile, 'group', None)
        wishlistname = request.data.get('wishlistname')
        product_id = request.data.get('product_id', None)
        if not (group and wishlistname):
            return Response({'error': 'Missing group hoặc wishlistname'}, status=400)
        # Lấy id của GroupWishlistName nếu có
        wishlistname_obj = GroupWishlistName.objects.filter(group=group, wishlistname=wishlistname).first()
        wishlistname_id = wishlistname_obj.id if wishlistname_obj else None
        if product_id:
            # Xóa sản phẩm khỏi wishlist, nhưng KHÔNG xóa GroupWishlistName nếu là sản phẩm cuối cùng
            deleted, _ = GroupWishlist.objects.filter(
                group=group, wishlistname=wishlistname, product_id=product_id
            ).delete()
            if deleted:
                # Kiểm tra nếu wishlist này đã hết sản phẩm thì KHÔNG xóa GroupWishlistName (giữ nguyên)
                return Response({'message': 'Deleted from wishlist', 'id': wishlistname_id}, status=200)
            else:
                return Response({'error': 'Not found'}, status=404)
        else:
            # Xóa toàn bộ sản phẩm khỏi wishlist, kể cả khi không còn sản phẩm nào (cho phép xóa wishlist rỗng)
            qs = GroupWishlist.objects.filter(
                group=group, wishlistname=wishlistname
            )
            product_ids = list(qs.values_list('product_id', flat=True))
            deleted, _ = qs.delete()
            # Sau khi xóa, cũng xóa GroupWishlistName (cho phép xóa wishlist rỗng)
            GroupWishlistName.objects.filter(group=group, wishlistname=wishlistname).delete()
            return Response({'message': f'Đã xóa wishlist "{wishlistname}"', 'product_ids': product_ids, 'id': wishlistname_id}, status=200)

# New API to get product_ids by wishlistname and group
class WishlistProductsByNameView(APIView):
    authentication_classes = [JWTAuthentication]
    permission_classes = [IsAuthenticated]
    def get(self, request):
        user = request.user
        group = getattr(user.profile, 'group', None)
        wishlistname = request.query_params.get('wishlistname')
        if not (group and wishlistname):
            return Response({'error': 'Missing group or wishlistname'}, status=400)
        product_ids = list(GroupWishlist.objects.filter(group=group, wishlistname=wishlistname).values_list('product_id', flat=True))
        return Response({'wishlistname': wishlistname, 'product_ids': product_ids}, status=200)