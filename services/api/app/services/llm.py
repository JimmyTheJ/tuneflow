import json
from typing import Any

import httpx

from app.config import settings
from app.schemas import AiInsights, AiRecommendations, AiSuggestion, LlmStatus, TrackRead
from app.services.piped import piped_client


class LlmClient:
    def __init__(self) -> None:
        self.base_url = settings.llm_base_url.rstrip("/")
        self.api_key = settings.llm_api_key
        self.model = settings.llm_model
        self.timeout = settings.llm_timeout_sec

    @property
    def configured(self) -> bool:
        return bool(self.base_url and self.model)

    async def status(self) -> LlmStatus:
        if not settings.llm_enabled:
            return LlmStatus(
                enabled=False,
                configured=self.configured,
                reachable=False,
                base_url=self.base_url,
                model=self.model,
                detail="LLM disabled in server config",
            )

        if not self.configured:
            return LlmStatus(
                enabled=True,
                configured=False,
                reachable=False,
                base_url=self.base_url,
                model=self.model,
                detail="Set LLM_BASE_URL and LLM_MODEL",
            )

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/models",
                    headers=self._headers(),
                )
                response.raise_for_status()
            return LlmStatus(
                enabled=True,
                configured=True,
                reachable=True,
                base_url=self.base_url,
                model=self.model,
            )
        except httpx.HTTPError as exc:
            return LlmStatus(
                enabled=True,
                configured=True,
                reachable=False,
                base_url=self.base_url,
                model=self.model,
                detail=str(exc),
            )

    def _headers(self) -> dict[str, str]:
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        return headers

    async def chat_json(self, system_prompt: str, user_prompt: str) -> dict[str, Any]:
        payload = {
            "model": self.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.4,
        }

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/chat/completions",
                headers=self._headers(),
                json=payload,
            )
            response.raise_for_status()
            data = response.json()

        content = data["choices"][0]["message"]["content"]
        return json.loads(_extract_json(content))

    async def recommendations(self, history_lines: list[str], display_name: str) -> AiRecommendations:
        system_prompt = (
            "You are a music recommendation assistant for a family music app. "
            "Respond with valid JSON only. Use this shape: "
            '{"summary":"...", "suggestions":[{"query":"artist song", "reason":"..."}]} '
            "Provide 5 suggestions. Queries should be good YouTube music searches."
        )
        user_prompt = (
            f"User: {display_name}\n"
            f"Recent listening history:\n- " + "\n- ".join(history_lines or ["No history yet"])
        )
        data = await self.chat_json(system_prompt, user_prompt)
        suggestions: list[AiSuggestion] = []
        for item in data.get("suggestions", [])[:5]:
            query = str(item.get("query", "")).strip()
            reason = str(item.get("reason", "")).strip()
            tracks: list[TrackRead] = []
            if query:
                try:
                    tracks = await piped_client.search(query, limit=3)
                except Exception:
                    tracks = []
            suggestions.append(AiSuggestion(query=query, reason=reason, tracks=tracks))
        return AiRecommendations(summary=str(data.get("summary", "")), suggestions=suggestions)

    async def insights(self, history_lines: list[str], display_name: str) -> AiInsights:
        system_prompt = (
            "You analyze personal music listening history for a family music app. "
            "Respond with valid JSON only. Use this shape: "
            '{"summary":"...", "top_artists":["..."], "listening_patterns":["..."], "recommendations":["..."]}'
        )
        user_prompt = (
            f"User: {display_name}\n"
            f"Recent listening history:\n- " + "\n- ".join(history_lines or ["No history yet"])
        )
        data = await self.chat_json(system_prompt, user_prompt)
        return AiInsights(
            summary=str(data.get("summary", "")),
            top_artists=[str(item) for item in data.get("top_artists", [])[:8]],
            listening_patterns=[str(item) for item in data.get("listening_patterns", [])[:6]],
            recommendations=[str(item) for item in data.get("recommendations", [])[:6]],
        )


def _extract_json(content: str) -> str:
    content = content.strip()
    if content.startswith("```"):
        content = content.strip("`")
        if content.startswith("json"):
            content = content[4:].strip()
    start = content.find("{")
    end = content.rfind("}")
    if start != -1 and end != -1:
        return content[start : end + 1]
    return content


llm_client = LlmClient()
