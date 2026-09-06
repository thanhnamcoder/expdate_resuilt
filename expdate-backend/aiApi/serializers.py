from rest_framework import serializers


class CopilotModelSerializer(serializers.Serializer):
    model = serializers.CharField(required=True, allow_blank=False)


class CopilotTokenSerializer(serializers.Serializer):
    token = serializers.CharField(required=True, allow_blank=False)

    def validate_token(self, value):
        if not value.startswith("github_pat_") or len(value) <= len("github_pat_"):
            raise serializers.ValidationError("Token không đúng định dạng")
        return value
