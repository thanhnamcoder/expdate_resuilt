from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from django.contrib.auth import authenticate
from django.contrib.auth import get_user_model
from rest_framework_simplejwt.tokens import RefreshToken  # ✅ JWT
from .serializers import RegisterSerializer
from rest_framework import serializers


class RegisterView(APIView):
    def post(self, request):
        serializer = RegisterSerializer(data=request.data)
        if serializer.is_valid():
            user = serializer.save()
            return Response({"detail": "User created"}, status=status.HTTP_201_CREATED)
        else:
            print(serializer.errors)
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)


class LoginView(APIView):
    def post(self, request):
        username = request.data.get('username')
        password = request.data.get('password')

        user = authenticate(username=username, password=password)
        if user:
            refresh = RefreshToken.for_user(user)

            # ✅ Lấy full_name
            full_name = f"{user.first_name} {user.last_name}".strip()

            data = {
                'message': 'Login successful',
                'access': str(refresh.access_token),
                'full_name': full_name,
                'is_staff': user.is_staff,
                'is_superuser': user.is_superuser,
                'is_active': user.is_active,
            }

            resp = Response(data)
            # Set refresh token as HttpOnly, Secure cookie (not exposed in JSON)
            resp.set_cookie(
                'refresh',
                str(refresh),
                httponly=True,
                secure=True,
                samesite='Strict',
                max_age=30 * 24 * 60 * 60,
                path='/'
            )

            return resp
        else:
            return Response({'error': 'Invalid credentials'}, status=status.HTTP_401_UNAUTHORIZED)


class TokenRefreshFromCookieView(APIView):
    """Read refresh token from HttpOnly cookie and return a new access token.

    This view attempts to blacklist the used refresh (if blacklist app enabled),
    then issues a new refresh token and sets it as HttpOnly cookie (rotation).
    """
    def post(self, request):
        token = request.COOKIES.get('refresh')
        if not token:
            return Response({'detail': 'Refresh token not found'}, status=status.HTTP_401_UNAUTHORIZED)

        try:
            refresh = RefreshToken(token)
        except Exception:
            return Response({'detail': 'Invalid refresh token'}, status=status.HTTP_401_UNAUTHORIZED)

        # Create access token from the provided refresh
        access_token = str(refresh.access_token)

        # Try to blacklist the used refresh token (if configured)
        try:
            refresh.blacklist()
        except Exception:
            pass

        # Rotate: issue a new refresh token for the same user
        try:
            user_id = refresh.get('user_id')
            User = get_user_model()
            user = User.objects.get(id=user_id)
            new_refresh = RefreshToken.for_user(user)
        except Exception:
            # If rotation fails, still return access (no new refresh cookie)
            resp = Response({'access': access_token})
            return resp

        resp = Response({'access': access_token})
        resp.set_cookie(
            'refresh',
            str(new_refresh),
            httponly=True,
            secure=True,
            samesite='Strict',
            max_age=30 * 24 * 60 * 60,
            path='/'
        )

        return resp

