import asyncio
import concurrent.futures
import json
import os
from collections.abc import Mapping, Sequence
from types import SimpleNamespace
from typing import Any

import dotenv

try:
    from openai import AsyncOpenAI, OpenAI
except ImportError:  # pragma: no cover - optional dependency for legacy callers.
    OpenAI = None
    AsyncOpenAI = None

dotenv.load_dotenv()


class LLMClient:
    """Manages communication with the LLM provider."""

    def __init__(self, think_mode=False):
        if OpenAI is None or AsyncOpenAI is None:
            raise ImportError("The openai package is required to use LLMClient.")
        model_name = (
            os.environ["CHAT_MODEL_NAME"]
            if not think_mode
            else os.environ["CHAT_MODEL_NAME_THINK"]
        )
        model_url = os.environ["CHAT_MODEL_BASE_URL"]
        self.model = model_name
        self.client = OpenAI(
            api_key=os.environ["CHAT_MODEL_API_KEY"], base_url=model_url
        )
        self.async_client = AsyncOpenAI(
            api_key=os.environ["CHAT_MODEL_API_KEY"], base_url=model_url
        )
        self.think_mode = think_mode

    def get_json_response(self, messages):
        response = self.client.chat.completions.create(
            model=self.model,
            messages=messages,
            response_format={"type": "json_object"},
            extra_body={
                "chat_template_kwargs": {"enable_thinking": False},
            },
        )
        return json.loads(response.choices[0].message.content)

    def get_response(self, messages):
        response = self.get_response_stream(messages)
        return self.get_ouput_message(response)

    def get_response_stream(self, messages):
        return self.client.chat.completions.create(
            model=self.model, messages=messages, stream=True
        )

    def get_ouput_message(self, response):
        message = ""
        for chunk in response:
            if chunk.choices and chunk.choices[0].delta.content:
                message += chunk.choices[0].delta.content
        return message


def run_in_new_loop(llm, message_list, is_json):
    """在新事件循环中运行，使用新的 AsyncOpenAI 客户端避免跨线程冲突"""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    # 在新线程中创建新的 AsyncOpenAI 客户端
    if AsyncOpenAI is None:
        raise ImportError("The openai package is required to use async_process.")
    api_key = getattr(llm, "api_key", None) or os.environ["CHAT_MODEL_API_KEY"]
    base_url = getattr(llm, "base_url", None) or os.environ["CHAT_MODEL_BASE_URL"]
    timeout = getattr(llm, "timeout_seconds", None)
    async_client = AsyncOpenAI(
        api_key=api_key,
        base_url=base_url,
        timeout=timeout,
    )

    async def _process_with_new_client():
        try:
            semaphore_num = int(
                getattr(llm, "concurrency", None) or os.getenv("LLM_CONCURRENCY", "10")
            )
            semaphore = asyncio.Semaphore(semaphore_num)

            async def _get_response(request_item):
                async with semaphore:
                    request = _async_request_body(llm, request_item, is_json)
                    response = await async_client.chat.completions.create(**request)
                    return response.choices[0].message.content

            tasks = [_get_response(query) for query in message_list]
            return await asyncio.gather(*tasks)
        finally:
            await async_client.close()

    try:
        return loop.run_until_complete(_process_with_new_client())
    finally:
        # 清理事件循环
        pending = asyncio.all_tasks(loop)
        if pending:
            for task in pending:
                task.cancel()
            loop.run_until_complete(asyncio.gather(*pending, return_exceptions=True))
        loop.run_until_complete(loop.shutdown_asyncgens())
        loop.close()


def async_process(llm, message_list, is_json=False):
    if not message_list:
        return []
    # 使用线程池在独立线程中运行，避免与主事件循环冲突
    with concurrent.futures.ThreadPoolExecutor() as executor:
        future = executor.submit(run_in_new_loop, llm, message_list, is_json)
        return future.result()


def async_chat_completions(
    llm_config: Any,
    prompts: Sequence[Mapping[str, Any] | tuple[Any, ...]],
    return_exceptions: bool = False,
    is_json: bool = False,
    temperature: float = 0,
    strip: bool = True,
) -> list[str | Exception]:
    if not prompts:
        return []
    llm = SimpleNamespace(
        model=llm_config.model,
        api_key=getattr(llm_config, "api_key", None),
        base_url=getattr(llm_config, "base_url", None),
        timeout_seconds=getattr(llm_config, "timeout_seconds", None),
        concurrency=getattr(llm_config, "concurrency", None),
    )
    requests = [_prompt_request(prompt, temperature, strip) for prompt in prompts]
    try:
        results = async_process(llm, requests, is_json=is_json)
    except Exception as exc:
        if return_exceptions:
            return [exc for _ in prompts]
        raise
    output: list[str | Exception] = []
    for request, result in zip(requests, results, strict=False):
        if isinstance(result, str) and request.get("strip", strip):
            output.append(result.strip())
        else:
            output.append(result)
    return output


def _prompt_request(
    prompt: Mapping[str, Any] | tuple[Any, ...],
    temperature: float,
    strip: bool,
) -> dict[str, Any]:
    if isinstance(prompt, Mapping):
        request: dict[str, Any] = {
            "messages": [
                {"role": "system", "content": str(prompt["system_prompt"])},
                {"role": "user", "content": str(prompt["user_prompt"])},
            ],
            "temperature": float(prompt.get("temperature", temperature)),
            "strip": bool(prompt.get("strip", strip)),
        }
        for key in ("max_tokens", "response_format", "extra_body"):
            if prompt.get(key) is not None:
                request[key] = prompt[key]
        return request
    system_prompt, user_prompt, *rest = prompt
    request = {
        "messages": [
            {"role": "system", "content": str(system_prompt)},
            {"role": "user", "content": str(user_prompt)},
        ],
        "temperature": temperature,
        "strip": strip,
    }
    if rest:
        request["max_tokens"] = rest[0]
    return request


def _async_request_body(llm: Any, request_item: Any, is_json: bool) -> dict[str, Any]:
    if isinstance(request_item, Mapping) and "messages" in request_item:
        body: dict[str, Any] = {
            "model": llm.model,
            "messages": request_item["messages"],
            "stream": False,
        }
        for key in ("max_tokens", "temperature", "response_format"):
            if request_item.get(key) is not None:
                body[key] = request_item[key]
        if is_json and "response_format" not in body:
            body["response_format"] = {"type": "json_object"}
        extra_body = dict(request_item.get("extra_body") or {})
        if is_json:
            extra_body.setdefault("chat_template_kwargs", {"enable_thinking": False})
        if extra_body:
            body["extra_body"] = extra_body
        return body
    body = {
        "model": llm.model,
        "messages": request_item,
        "stream": False,
    }
    if is_json:
        body["response_format"] = {"type": "json_object"}
        body["extra_body"] = {"chat_template_kwargs": {"enable_thinking": False}}
    return body


def llm_concurrency(
    llm_config: Any, env_var: str = "COMPLIANCE_LLM_CONCURRENCY", default: int = 1
) -> int:
    raw_value = os.getenv(env_var, "")
    if raw_value.strip():
        try:
            return max(1, int(raw_value))
        except ValueError:
            pass
    return max(1, int(getattr(llm_config, "concurrency", default) or default))
