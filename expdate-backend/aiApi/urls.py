from django.urls import path

from . import views


urlpatterns = [
    path("docs/", views.DocsView.as_view(), name="aiapi-docs"),
    path("health/", views.health, name="aiapi-health"),
    path("credit/", views.credit, name="aiapi-credit"),
    path("copilot-config/", views.CopilotConfigView.as_view(), name="aiapi-copilot-config"),
    path("model/", views.CopilotModelView.as_view(), name="aiapi-copilot-model"),
    path("token/", views.CopilotTokenView.as_view(), name="aiapi-copilot-token"),
    path("ocr/", views.ocr, name="aiapi-ocr"),
]