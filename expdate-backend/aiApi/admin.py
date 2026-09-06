from django.contrib import admin
from django import forms

from .helperOCR import update_copilot_config
from .models import CopilotModelConfig, CopilotToken


class CopilotModelConfigForm(forms.ModelForm):
	class Meta:
		model = CopilotModelConfig
		fields = ["name", "model"]

	def save(self, commit=True):
		instance = super().save(commit=commit)
		update_copilot_config(model=instance.model)
		return instance


class CopilotTokenForm(forms.ModelForm):
	class Meta:
		model = CopilotToken
		fields = ["token", "is_active"]

	def clean_token(self):
		token = self.cleaned_data["token"].strip()
		if not token.startswith("github_pat_") or len(token) <= len("github_pat_"):
			raise forms.ValidationError("Token không đúng định dạng")
		return token

	def save(self, commit=True):
		instance = super().save(commit=commit)
		if instance.is_active:
			update_copilot_config(token=instance.token)
		return instance


@admin.register(CopilotModelConfig)
class CopilotModelConfigAdmin(admin.ModelAdmin):
	form = CopilotModelConfigForm
	list_display = ["name", "model", "updated_at"]
	search_fields = ["name", "model"]


@admin.register(CopilotToken)
class CopilotTokenAdmin(admin.ModelAdmin):
	form = CopilotTokenForm
	list_display = ["masked_token", "is_active", "created_at"]
	list_filter = ["is_active"]
	search_fields = ["token"]

	@admin.display(description="Token")
	def masked_token(self, obj):
		return f"...{obj.token[-4:]}"
