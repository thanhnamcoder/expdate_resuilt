from django.urls import path

from . import views


urlpatterns = [
    path("health/", views.health, name="aiapi-health"),
    path("credit/", views.credit, name="aiapi-credit"),
    path("ocr/", views.ocr, name="aiapi-ocr"),
]