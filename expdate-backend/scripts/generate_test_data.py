import os
import sys
import django
import random
# Thêm thư mục cha vào sys.path để import được expdate
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'expdate.settings')
django.setup()
from accounts.models import User, Item
from django.contrib.auth.models import Group


def create_test_data():
    group_name = "sg0330"
    user_count = 10
    items_per_user = 10

    for i in range(user_count):
        username = f"test_user_{i}"
        user, created = User.objects.get_or_create(username=username)
        if created:
            print(f"Created user: {username}")
        # Gán group cho profile
        if hasattr(user, 'profile'):
            user.profile.group = group_name
            user.profile.fullname = username
            user.profile.save()
        else:
            from accounts.models import Profile
            Profile.objects.create(user=user, fullname=username, group=group_name)

        for j in range(items_per_user):
            item_name = f"Item_{j}_User_{i}"
            barcode = f"{random.randint(100000, 999999)}"
            quantity = random.randint(1, 50)
            expdate = random.choice(["2025-06-10", "2025-06-20", "2025-07-01"])

            Item.objects.create(
                user=user,
                itemname=item_name,
                barcode=barcode,
                quantity=quantity,
                expdate=expdate
            )

    print("Test data created successfully.")

def delete_test_data():
    group_name = "sg0330"
    from accounts.models import Profile
    users = User.objects.filter(profile__group=group_name)
    users.delete()
    print("Test data deleted successfully.")

if __name__ == "__main__":
    action = input("Enter 'create' to generate test data or 'delete' to remove test data: ").strip().lower()
    if action == "create":
        create_test_data()
    elif action == "delete":
        delete_test_data()
    else:
        print("Invalid action.")
