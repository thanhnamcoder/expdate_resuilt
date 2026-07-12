from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.base import MIMEBase
from email import encoders

from .models import WriteOffBatch
from .writeoff_export_utils import build_writeoff_export_data


class SendEmailAPIView(APIView):
    def post(self, request):
        to_email = request.data.get("to_email")
        subject = request.data.get("subject")
        body_html = request.data.get("body_html")
        batch_id = request.data.get("batch_id")  # Thêm batch_id

        msg = MIMEMultipart("mixed")
        msg["Subject"] = subject
        msg["From"] = "sg0330.sm@store.circlek.com.vn"
        msg["To"] = to_email

        # Nội dung thư — đánh dấu rõ "inline" để mail client hiểu đây là nội
        # dung email, không phải file đính kèm. Nếu không có header này, một số
        # mail client (đặc biệt Outlook/Zimbra) sẽ hiển thị phần HTML này như
        # 1 file đính kèm không tên (noname, không đuôi).
        full_html = body_html or ''
        html_part = MIMEText(full_html, "html")
        html_part.add_header('Content-Disposition', 'inline')
        msg.attach(html_part)

        # Nếu có batch_id, lấy dữ liệu Excel + ảnh (đã xử lý sẵn ở
        # writeoff_export_utils) rồi đính kèm rời từng file — không zip.
        if batch_id:
            try:
                batch = WriteOffBatch.objects.get(id=batch_id)
                export_data = build_writeoff_export_data(batch)

                # Đính kèm Excel
                excel_part = MIMEBase(
                    'application',
                    'vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                )
                excel_part.set_payload(export_data['excel_bytes'])
                encoders.encode_base64(excel_part)
                excel_part.add_header(
                    'Content-Disposition',
                    'attachment; filename="Data.xlsx"'
                )
                msg.attach(excel_part)

                # Đính kèm từng ảnh riêng lẻ
                for image in export_data['images']:
                    img_part = MIMEBase(image['maintype'], image['subtype'])
                    img_part.set_payload(image['data'])
                    encoders.encode_base64(img_part)
                    img_part.add_header('Content-Disposition', f'attachment; filename="{image["filename"]}"')
                    msg.attach(img_part)
            except WriteOffBatch.DoesNotExist:
                return Response({"error": "Batch không tồn tại"}, status=status.HTTP_404_NOT_FOUND)
            except Exception as e:
                return Response({"error": f"Lỗi tạo file: {str(e)}"}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        try:
            with smtplib.SMTP("mail.circlek.com.vn", 587) as server:
                server.starttls()
                server.login("sg0330.sm@store.circlek.com.vn", "Itck@sg0330")
                server.sendmail(msg["From"], msg["To"], msg.as_string())
            return Response({"message": "✅ Gửi email thành công"}, status=status.HTTP_200_OK)
        except Exception as e:
            return Response({"error": str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)