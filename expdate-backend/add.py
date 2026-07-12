import sqlite3
import random
from faker import Faker
from datetime import timedelta

# Khởi tạo Faker và kết nối SQLite
faker = Faker()
conn = sqlite3.connect("db.sqlite3")
cursor = conn.cursor()

# Lấy danh sách user_id từ bảng accounts_profile
cursor.execute("SELECT id FROM accounts_profile;")
profile_user_ids = [row[0] for row in cursor.fetchall()]

# Tạo và chèn dữ liệu với 100 expdate khác nhau cho mỗi user
items_to_insert = []
for user_id in profile_user_ids:
    start_date = faker.date_between(start_date='today', end_date='+1y')
    unique_dates = set()
    while len(unique_dates) < 100:
        date = start_date + timedelta(days=random.randint(1, 730))  # trong vòng 2 năm
        unique_dates.add(date)

    for expdate in sorted(unique_dates):  # dùng sorted để dễ kiểm tra sau này
        barcode = faker.unique.ean13()
        itemname = faker.word().capitalize()
        quantity = random.randint(1, 100)
        items_to_insert.append((barcode, itemname, quantity, expdate, user_id))

# Chèn vào cơ sở dữ liệu
cursor.executemany("""
    INSERT INTO accounts_item (barcode, itemname, quantity, expdate, user_id)
    VALUES (?, ?, ?, ?, ?);
""", items_to_insert)

conn.commit()
conn.close()

print(f"Đã thêm {len(items_to_insert)} bản ghi với expdate không trùng lặp cho mỗi user.")
