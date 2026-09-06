from django.db import models


class CopilotModelConfig(models.Model):
	name = models.CharField(max_length=50, unique=True, default="default")
	model = models.CharField(max_length=255)
	updated_at = models.DateTimeField(auto_now=True)

	class Meta:
		verbose_name = "Copilot model"
		verbose_name_plural = "Copilot model"

	def __str__(self):
		return f"{self.name}: {self.model}"


class CopilotToken(models.Model):
	token = models.CharField(max_length=255, unique=True)
	is_active = models.BooleanField(default=True)
	created_at = models.DateTimeField(auto_now_add=True)

	class Meta:
		ordering = ["-created_at"]
		verbose_name = "Copilot token"
		verbose_name_plural = "Copilot tokens"

	def __str__(self):
		return f"...{self.token[-4:]}"
