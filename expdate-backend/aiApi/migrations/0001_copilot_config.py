# Generated manually for Copilot configuration models.
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="CopilotModelConfig",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(default="default", max_length=50, unique=True)),
                ("model", models.CharField(max_length=255)),
                ("updated_at", models.DateTimeField(auto_now=True)),
            ],
            options={
                "verbose_name": "Copilot model",
                "verbose_name_plural": "Copilot model",
            },
        ),
        migrations.CreateModel(
            name="CopilotToken",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("token", models.CharField(max_length=255, unique=True)),
                ("is_active", models.BooleanField(default=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
            ],
            options={
                "verbose_name": "Copilot token",
                "verbose_name_plural": "Copilot tokens",
                "ordering": ["-created_at"],
            },
        ),
    ]