from rest_framework import serializers
from django.contrib.auth.models import User, Group
from .models import Profile

class RegisterSerializer(serializers.ModelSerializer):
    password = serializers.CharField(write_only=True)
    full_name = serializers.CharField(write_only=True)
    email = serializers.EmailField()
    group = serializers.CharField(write_only=True)

    class Meta:
        model = User
        fields = ['username', 'password', 'full_name', 'email', 'group']

    def create(self, validated_data):
        username = validated_data.pop('username', '').strip().lower()
        email = validated_data.pop('email', '').strip().lower()
        full_name = validated_data.pop('full_name', '')
        group_name = validated_data.pop('group', '').strip().lower()
        password = validated_data.pop('password')

        print(f"Creating user with username: {username}, email: {email}, full_name: {full_name}, group: {group_name}")

        # Kiểm tra username hoặc email đã tồn tại (không phân biệt chữ hoa/thường)
        if User.objects.filter(username__iexact=username).exists():
            raise serializers.ValidationError({'username': 'Username already exists.'})


        user = User.objects.create_user(username=username, password=password, email=email)

        # Tách tên riêng & họ
        name_parts = full_name.split(' ', 1)
        user.first_name = name_parts[0]
        user.last_name = name_parts[1] if len(name_parts) > 1 else ''
        user.save()

        # Profile
        profile, _ = Profile.objects.get_or_create(user=user)
        profile.fullname = full_name
        profile.group = group_name
        profile.save()

        # Group
        group_obj, _ = Group.objects.get_or_create(name=group_name)
        user.groups.add(group_obj)

        return user

