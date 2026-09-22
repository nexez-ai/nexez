#!/usr/bin/env python3

"""Independent A2A v1 interoperability checks using the official Python SDK."""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
import time
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Awaitable, Callable

import httpx
from a2a.client import A2ACardResolver, ClientConfig, create_client
from a2a.client.errors import A2AClientError
from a2a.types import (
    GetExtendedAgentCardRequest,
    GetTaskRequest,
    ListTasksRequest,
    Role,
    SendMessageConfiguration,
    SendMessageRequest,
    TaskState,
)
from a2a.helpers import new_text_message
from importlib.metadata import version

SDK_VERSION = "1.1.5"
MODE = os.getenv("NEXEZ_A2A_PYTHON_INTEROP_MODE", "public").strip().lower()
AGENT_BASE = os.getenv("NEXEZ_A2A_INTEROP_BASE_URL", "https://nexez.app").rstrip("/")
APP_BASE = os.getenv("NEXEZ_A2A_INTEROP_APP_BASE_URL", "https://app.nexez.ai").rstrip("/")
HEALTH_URL = f"{APP_BASE}/api/internal/launch-health"
API_KEY = os.getenv("NEXEZ_A2A_CERT_API_KEY", "")
RELEASE_SECRET = os.getenv("NEXEZ_RELEASE_CERT_SECRET", "")
COMMIT_SHA = os.getenv("NEXEZ_COMMIT_SHA", os.getenv("GITHUB_SHA", "")).strip().lower()
REPORT_PATH = Path(os.getenv("NEXEZ_A2A_PYTHON_INTEROP_REPORT_PATH", "a2a-python-interop.json"))
REQUEST_SECONDS = float(os.getenv("NEXEZ_A2A_INTEROP_REQUEST_TIMEOUT_SECONDS", "90"))
DEPLOY_SECONDS = float(os.getenv("NEXEZ_A2A_INTEROP_DEPLOYMENT_WAIT_SECONDS", "600" if os.getenv("GITHUB_ACTIONS") else "1"))
STARTED_AT = datetime.now(UTC).isoformat()
CHECKS: list[dict[str, Any]] = []
TASK_IDS: dict[str, str] = {}
CARD: Any = None


async def main() -> int:
    if MODE not in {"public", "authenticated"}:
        raise ValueError("NEXEZ_A2A_PYTHON_INTEROP_MODE must be public or authenticated")

    await check("sdk-discovery", "Official Python SDK discovery and protocol selection", sdk_discovery)
    await check("anonymous-auth", "Anonymous SendMessage receives the Bearer challenge", anonymous_auth)
    await check("invalid-auth", "Invalid Bearer credential is rejected", invalid_auth)
    await check("capability-card", "Agent Card keeps optional capabilities disabled", capability_card)

    if MODE == "authenticated":
        await check("authenticated-config", "Authenticated Python SDK configuration", authenticated_config)
        await check("deployed-revision", "Exact production revision", deployed_revision)
        await check("blocking-send", "Python SDK parses a blocking Nexez Task", blocking_send)
        await check("get-task", "Python SDK retrieves the same Nexez Task", get_task)
        await check("streaming", "Python SDK parses Nexez streaming task events", streaming)
        await check("disabled-methods", "Disabled optional methods honor advertised capabilities", disabled_methods)

    passed = all(item["status"] == "pass" for item in CHECKS)
    report = {
        "schemaVersion": 1,
        "status": "passed" if passed else "failed",
        "mode": MODE,
        "sdk": {"package": "a2a-sdk", "version": version("a2a-sdk")},
        "commitSha": COMMIT_SHA if valid_sha(COMMIT_SHA) else None,
        "startedAt": STARTED_AT,
        "completedAt": datetime.now(UTC).isoformat(),
        "agentBase": AGENT_BASE,
        "checks": CHECKS,
        "taskIds": TASK_IDS,
    }
    REPORT_PATH.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    passed_count = sum(item["status"] == "pass" for item in CHECKS)
    failed_count = len(CHECKS) - passed_count
    print(f"{'PASS' if passed else 'FAIL'} A2A Python SDK interoperability: {passed_count} passed, {failed_count} failed.")
    print(f"Report: {REPORT_PATH}")
    return 0 if passed else 1


async def check(check_id: str, label: str, action: Callable[[], Awaitable[str]]) -> None:
    started = time.monotonic()
    try:
        detail = clean(await action())
        CHECKS.append({"id": check_id, "label": label, "status": "pass", "durationMs": elapsed_ms(started), "detail": detail})
        print(f"PASS {label}")
    except Exception as error:
        detail = safe_error(error)
        CHECKS.append({"id": check_id, "label": label, "status": "fail", "durationMs": elapsed_ms(started), "detail": detail})
        print(f"FAIL {label}: {detail}", file=sys.stderr)


async def sdk_discovery() -> str:
    global CARD
    assert version("a2a-sdk") == SDK_VERSION, f"Expected a2a-sdk {SDK_VERSION}"
    async with httpx.AsyncClient(timeout=REQUEST_SECONDS) as transport:
        CARD = await A2ACardResolver(transport, AGENT_BASE).get_agent_card()
        await create_client(CARD, ClientConfig(streaming=False, httpx_client=transport))
        interfaces = list(CARD.supported_interfaces)
        assert len(interfaces) == 1, "Agent Card must expose exactly one interface"
        interface = interfaces[0]
        assert interface.url == f"{AGENT_BASE}/api/v1/a2a", "Agent Card endpoint does not match"
        assert interface.protocol_binding == "JSONRPC", "Agent Card binding is not JSONRPC"
        assert interface.protocol_version == "1.0", "Agent Card protocol version is not 1.0"
        assert CARD.capabilities.streaming is True, "Streaming is not advertised"
        assert CARD.capabilities.push_notifications is False, "Push is incorrectly advertised"
        assert CARD.capabilities.extended_agent_card is False, "Extended card is incorrectly advertised"
    return "Discovered one JSONRPC 1.0 interface with the official Python SDK."


async def anonymous_auth() -> str:
    error = await rejected_send("")
    assert_http_401(error)
    return "Anonymous SendMessage was rejected with HTTP 401."


async def invalid_auth() -> str:
    error = await rejected_send(f"nxz_live_invalid_{uuid.uuid4().hex}")
    assert_http_401(error)
    return "The official Python client injected Bearer auth and Nexez rejected the unknown key."


async def capability_card() -> str:
    assert CARD is not None, "Agent Card was not discovered"
    assert CARD.capabilities.push_notifications is False, "Push must remain disabled"
    assert CARD.capabilities.extended_agent_card is False, "Extended Agent Card must remain disabled"
    return "Push notifications and the extended Agent Card remain unadvertised."


async def authenticated_config() -> str:
    assert len(API_KEY) >= 16, "NEXEZ_A2A_CERT_API_KEY is required"
    assert len(RELEASE_SECRET) >= 32, "NEXEZ_RELEASE_CERT_SECRET is required"
    assert valid_sha(COMMIT_SHA), "A full NEXEZ_COMMIT_SHA is required"
    return f"Configured exact revision {COMMIT_SHA[:12]}."


async def deployed_revision() -> str:
    deadline = time.monotonic() + DEPLOY_SECONDS
    last = "deployment health did not respond"
    headers = {"Authorization": f"Bearer {RELEASE_SECRET}", "Accept": "application/json"}
    async with httpx.AsyncClient(timeout=REQUEST_SECONDS) as transport:
        while True:
            try:
                response = await transport.get(HEALTH_URL, headers=headers)
                if response.status_code == 401:
                    raise RuntimeError("Release-certification credential was rejected")
                body = response.json()
                revision = str(body.get("deployment", {}).get("revision", "")).lower()
                if revision == COMMIT_SHA:
                    return f"Production serves {revision[:12]}."
                last = f"production serves {revision[:12]}" if valid_sha(revision) else f"health returned HTTP {response.status_code} without a revision"
            except Exception as error:
                last = safe_error(error)
            if time.monotonic() >= deadline:
                raise RuntimeError(f"Timed out waiting for {COMMIT_SHA[:12]}: {last}")
            await asyncio.sleep(min(1, max(0, deadline - time.monotonic())))


async def blocking_send() -> str:
    responses = await collect_send(
        "blocking",
        "Reply briefly that the official A2A Python SDK reached Nexez. Do not call tools or propose a transaction.",
        streaming=False,
    )
    assert len(responses) == 1, "Blocking SendMessage did not return one response"
    assert responses[0].WhichOneof("payload") == "task", "Blocking response was not a Task"
    task = responses[0].task
    assert task.status.state == TaskState.TASK_STATE_COMPLETED, f"Blocking task ended in {state_name(task.status.state)}"
    assert len(task.artifacts) > 0, "Blocking task has no artifacts"
    TASK_IDS["blocking"] = task.id
    return f"Decoded completed task {short(task.id)} through StreamResponse.task."


async def get_task() -> str:
    task_id = TASK_IDS.get("blocking", "")
    assert task_id, "Blocking task was not created"
    async with authorized_client(streaming=False) as client:
        task = await client.get_task(GetTaskRequest(id=task_id, history_length=2))
    assert task.id == task_id, "GetTask returned a different task"
    assert task.status.state == TaskState.TASK_STATE_COMPLETED, f"GetTask returned {state_name(task.status.state)}"
    return f"GetTask returned {short(task.id)} with the completed state."


async def streaming() -> str:
    responses = await collect_send(
        "streaming",
        "Explain briefly why interoperable A2A streams are useful. Do not call tools.",
        streaming=True,
    )
    cases = [response.WhichOneof("payload") for response in responses]
    assert cases and cases[0] == "task", f"First stream payload was {cases[0] if cases else 'missing'}"
    assert "status_update" in cases, "Stream contained no status update"
    assert "artifact_update" in cases, "Stream contained no artifact update"
    task_id = next((response.task.id for response in responses if response.WhichOneof("payload") == "task"), "")
    states = [response.status_update.status.state for response in responses if response.WhichOneof("payload") == "status_update"]
    assert states and states[-1] == TaskState.TASK_STATE_COMPLETED, f"Stream ended in {state_name(states[-1]) if states else 'unknown'}"
    assert task_id, "Stream exposed no task ID"
    TASK_IDS["streaming"] = task_id
    return f"Parsed {len(responses)} events for {short(task_id)}, Task first and completed."


async def disabled_methods() -> str:
    async with authorized_client(streaming=False) as client:
        list_error = await capture_failure(client.list_tasks(ListTasksRequest(page_size=1)))
        cached_card = await client.get_extended_agent_card(GetExtendedAgentCardRequest())
    assert_sdk_http_error(list_error, "ListTasks")
    await assert_list_tasks_protocol_error()
    assert cached_card.capabilities.extended_agent_card is False, "Python SDK returned an advertised extended card"
    assert list(cached_card.supported_interfaces) == list(CARD.supported_interfaces), "Python SDK changed the cached Agent Card interfaces"
    return "ListTasks returned protocol error -32004 through the official SDK HTTP wrapper, and the disabled extended card stayed cached."


async def assert_list_tasks_protocol_error() -> None:
    async with httpx.AsyncClient(
        timeout=REQUEST_SECONDS,
        headers={"Authorization": f"Bearer {API_KEY}", "A2A-Version": "1.0"},
    ) as transport:
        response = await transport.post(
            f"{AGENT_BASE}/api/v1/a2a",
            json={"jsonrpc": "2.0", "id": "python-list-tasks", "method": "ListTasks", "params": {"pageSize": 1}},
        )
    assert response.status_code == 400, f"ListTasks returned HTTP {response.status_code} instead of 400"
    body = response.json()
    assert body.get("error", {}).get("code") == -32004, "ListTasks did not return JSON-RPC error -32004"


async def rejected_send(api_key: str) -> Exception:
    headers = {"User-Agent": f"nexez-a2a-python-interop/{SDK_VERSION}"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    async with httpx.AsyncClient(timeout=REQUEST_SECONDS, headers=headers) as transport:
        client = await create_client(AGENT_BASE, ClientConfig(streaming=False, httpx_client=transport))
        request = message_request("auth", "Nexez official Python SDK authentication probe. Do not call tools.")
        try:
            async for _ in client.send_message(request):
                pass
        except Exception as error:
            return error
    raise AssertionError("SendMessage unexpectedly succeeded")


async def collect_send(label: str, text: str, *, streaming: bool) -> list[Any]:
    async with authorized_client(streaming=streaming) as client:
        return [response async for response in client.send_message(message_request(label, text))]


def message_request(label: str, text: str) -> SendMessageRequest:
    message = new_text_message(text, role=Role.ROLE_USER)
    message.message_id = f"a2a-cert-python-{label}-{uuid.uuid4().hex}"
    return SendMessageRequest(
        message=message,
        configuration=SendMessageConfiguration(
            accepted_output_modes=["text/plain", "application/json"],
            history_length=2,
            return_immediately=False,
        ),
    )


class authorized_client:
    def __init__(self, *, streaming: bool):
        self.streaming = streaming
        self.transport: httpx.AsyncClient | None = None
        self.client: Any = None

    async def __aenter__(self) -> Any:
        self.transport = httpx.AsyncClient(
            timeout=REQUEST_SECONDS,
            headers={"Authorization": f"Bearer {API_KEY}", "User-Agent": f"nexez-a2a-python-interop/{SDK_VERSION}"},
        )
        self.client = await create_client(AGENT_BASE, ClientConfig(streaming=self.streaming, httpx_client=self.transport))
        return self.client

    async def __aexit__(self, *_: Any) -> None:
        if self.transport:
            await self.transport.aclose()


async def capture_failure(awaitable: Awaitable[Any]) -> Exception:
    try:
        await awaitable
    except Exception as error:
        return error
    raise AssertionError("Unsupported method unexpectedly succeeded")


def assert_http_401(error: Exception) -> None:
    assert re.search(r"(?:HTTP\s*)?401", str(error), re.IGNORECASE), "Request did not fail with HTTP 401"


def assert_sdk_http_error(error: Exception, method: str) -> None:
    assert isinstance(error, A2AClientError), f"{method} did not return the official SDK A2AClientError"
    assert re.search(r"^HTTP Error 400:", str(error)), f"{method} did not preserve the expected HTTP status"


def valid_sha(value: str) -> bool:
    return bool(re.fullmatch(r"[0-9a-f]{40}", value))


def state_name(value: int) -> str:
    return TaskState.Name(value)


def short(value: str) -> str:
    return value[:8] if value else "unknown"


def elapsed_ms(started: float) -> int:
    return round((time.monotonic() - started) * 1000)


def clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:500]


def safe_error(error: Exception) -> str:
    value = clean(error)
    value = re.sub(r"nxz_live_[A-Za-z0-9_-]+", "[redacted-api-key]", value)
    value = re.sub(r"Bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]", value, flags=re.IGNORECASE)
    return value


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
