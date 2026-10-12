#!/usr/bin/env python3
"""GitLab MR watch helper for the land skill.

Monitors CI pipelines, review discussions, and MR head changes in parallel.
Exits with a code indicating the action the agent should take.

Exit codes:
  0: CI green, no outstanding review → merge
  2: Review comments detected → address feedback
  3: CI checks failed → fix and re-run
  4: MR head updated → pull/amend/force-push to retrigger CI
  5: Merge conflicts → resolve before proceeding
"""
import asyncio
import json
import random
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any

POLL_SECONDS = 10
CHECKS_APPEAR_TIMEOUT_SECONDS = 120
MAX_GLAB_RETRIES = 5
BASE_GLAB_BACKOFF_SECONDS = 2


@dataclass
class MrInfo:
    number: int
    iid: int
    project_id: int
    head_sha: str
    merge_status: str | None
    has_conflicts: bool


class RateLimitError(RuntimeError):
    pass


def is_rate_limit_error(error: str) -> bool:
    return "HTTP 429" in error or "rate limit" in error.lower()


async def run_glab(*args: str) -> str:
    max_delay = BASE_GLAB_BACKOFF_SECONDS * (2 ** (MAX_GLAB_RETRIES - 1))
    delay_seconds = BASE_GLAB_BACKOFF_SECONDS
    last_error = "glab command failed"
    for attempt in range(1, MAX_GLAB_RETRIES + 1):
        proc = await asyncio.create_subprocess_exec(
            "glab",
            *args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode == 0:
            return stdout.decode()
        error = stderr.decode().strip() or "glab command failed"
        if not is_rate_limit_error(error):
            raise RuntimeError(error)
        last_error = error
        if attempt >= MAX_GLAB_RETRIES:
            break
        jitter = random.uniform(0, delay_seconds)
        await asyncio.sleep(min(delay_seconds + jitter, max_delay))
        delay_seconds = min(delay_seconds * 2, max_delay)
    raise RateLimitError(last_error)


async def get_mr_info() -> MrInfo:
    data = await run_glab("mr", "view", "--output", "json")
    parsed = json.loads(data)
    return MrInfo(
        number=parsed.get("id", 0),
        iid=parsed.get("iid", 0),
        project_id=parsed.get("project_id", 0),
        head_sha=parsed.get("sha", ""),
        merge_status=parsed.get("detailed_merge_status") or parsed.get("merge_status"),
        has_conflicts=parsed.get("has_conflicts", False),
    )


async def get_paginated_list(endpoint: str) -> list[dict[str, Any]]:
    page = 1
    items: list[dict[str, Any]] = []
    while True:
        data = await run_glab("api", endpoint, "-f", f"per_page=100", "-f", f"page={page}")
        batch = json.loads(data)
        if not batch:
            break
        items.extend(batch)
        page += 1
    return items


async def get_discussions(mr_iid: int) -> list[dict[str, Any]]:
    return await get_paginated_list(f"projects/:id/merge_requests/{mr_iid}/discussions")


async def get_pipelines(mr_iid: int) -> list[dict[str, Any]]:
    return await get_paginated_list(f"projects/:id/merge_requests/{mr_iid}/pipelines")


async def get_approvals(mr_iid: int) -> dict[str, Any]:
    data = await run_glab("api", f"projects/:id/merge_requests/{mr_iid}/approvals")
    return json.loads(data)


def parse_time(value: str) -> datetime:
    normalized = value.replace("Z", "+00:00")
    return datetime.fromisoformat(normalized)


CONTROL_CHARS_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f-\x9f]")


def sanitize_terminal_output(value: str) -> str:
    return CONTROL_CHARS_RE.sub("", value)


def pipeline_timestamp(pipeline: dict[str, Any]) -> datetime | None:
    for key in ("finished_at", "started_at", "created_at"):
        value = pipeline.get(key)
        if value:
            return parse_time(value)
    return None


def dedupe_pipelines(pipelines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    latest_by_name: dict[str, dict[str, Any]] = {}
    for pipeline in pipelines:
        name = pipeline.get("name", pipeline.get("id", "unknown"))
        timestamp = pipeline_timestamp(pipeline)
        if name not in latest_by_name:
            latest_by_name[name] = pipeline
            continue
        existing = latest_by_name[name]
        existing_timestamp = pipeline_timestamp(existing)
        if timestamp is None:
            continue
        if existing_timestamp is None or timestamp > existing_timestamp:
            latest_by_name[name] = pipeline
    return list(latest_by_name.values())


def summarize_pipelines(pipelines: list[dict[str, Any]]) -> tuple[bool, bool, list[str]]:
    if not pipelines:
        return True, False, ["no pipelines reported"]
    pipelines = dedupe_pipelines(pipelines)
    pending = False
    failed = False
    failures: list[str] = []
    for pipeline in pipelines:
        status = pipeline.get("status")
        name = pipeline.get("name", pipeline.get("id", "unknown"))
        if status not in ("success", "skipped"):
            pending = True
        if status not in ("success", "skipped", "running", "pending"):
            failed = True
            failures.append(f"{name}: {status}")
    return pending, failed, failures


def comment_time(comment: dict[str, Any]) -> datetime | None:
    timestamp = comment.get("updated_at") or comment.get("created_at")
    if not timestamp:
        return None
    return parse_time(timestamp)


def is_bot_user(user: dict[str, Any]) -> bool:
    login = user.get("username") or ""
    if user.get("type") == "Bot":
        return True
    return login.endswith("[bot]") or login.endswith("_bot")


def filter_human_discussions(
    discussions: list[dict[str, Any]],
    latest_agent_reply_at: datetime | None,
) -> list[dict[str, Any]]:
    filtered: list[dict[str, Any]] = []
    for discussion in discussions:
        notes = discussion.get("notes", [])
        if not notes:
            continue
        for note in notes:
            user = note.get("author", {})
            if is_bot_user(user):
                continue
            body = (note.get("body") or "").strip()
            if not body:
                continue
            created_time = comment_time(note)
            if (
                latest_agent_reply_at is not None
                and created_time is not None
                and created_time <= latest_agent_reply_at
            ):
                continue
            filtered.append(note)
    return filtered


def latest_agent_reply_time(discussions: list[dict[str, Any]]) -> datetime | None:
    latest: datetime | None = None
    for discussion in discussions:
        notes = discussion.get("notes", [])
        for note in notes:
            user = note.get("author", {})
            if is_bot_user(user):
                continue
            body = (note.get("body") or "").strip()
            created_time = comment_time(note)
            if created_time is None:
                continue
            if latest is None or created_time > latest:
                latest = created_time
    return latest


def is_merge_conflicting(mr: MrInfo) -> bool:
    return mr.has_conflicts or mr.merge_status in ("conflict", "cannot_merge")


async def wait_for_review(mr_iid: int, checks_done: asyncio.Event) -> None:
    print("Waiting for review feedback...", flush=True)
    while True:
        discussions = await get_discussions(mr_iid)
        latest_reply = latest_agent_reply_time(discussions)
        human_comments = filter_human_discussions(discussions, latest_reply)
        if human_comments:
            print("Review comments detected. Address before merge.")
            for comment in human_comments:
                body = sanitize_terminal_output(comment.get("body") or "").strip()
                if body:
                    print(f"- {body}")
            raise SystemExit(2)
        if checks_done.is_set():
            return
        await asyncio.sleep(POLL_SECONDS)


async def wait_for_checks(mr_iid: int, checks_done: asyncio.Event) -> None:
    print("Waiting for CI pipelines...", flush=True)
    empty_seconds = 0
    while True:
        pipelines = await get_pipelines(mr_iid)
        if not pipelines:
            empty_seconds += POLL_SECONDS
            if empty_seconds >= CHECKS_APPEAR_TIMEOUT_SECONDS:
                print("No pipelines detected after 120s; check CI configuration")
                raise SystemExit(3)
            await asyncio.sleep(POLL_SECONDS)
            continue
        empty_seconds = 0
        pending, failed, failures = summarize_pipelines(pipelines)
        if failed:
            print("Pipelines failed:")
            for failure in failures:
                print(f"- {failure}")
            raise SystemExit(3)
        if not pending:
            print("Pipelines passed")
            checks_done.set()
            return
        await asyncio.sleep(POLL_SECONDS)


async def watch_mr() -> None:
    mr = await get_mr_info()
    if is_merge_conflicting(mr):
        print("MR has merge conflicts. Resolve/rebase against main and push before running land_watch again.")
        raise SystemExit(5)
    head_sha = mr.head_sha
    checks_done = asyncio.Event()
    review_task = asyncio.create_task(wait_for_review(mr.iid, checks_done))
    checks_task = asyncio.create_task(wait_for_checks(mr.iid, checks_done))

    async def head_monitor() -> None:
        while True:
            current = await get_mr_info()
            if is_merge_conflicting(current):
                print("MR has merge conflicts. Resolve/rebase against main and push before running land_watch again.")
                raise SystemExit(5)
            if current.head_sha != head_sha:
                print("MR head updated; pull/amend/force-push to retrigger CI")
                raise SystemExit(4)
            await asyncio.sleep(POLL_SECONDS)

    monitor_task = asyncio.create_task(head_monitor())
    success_task = asyncio.gather(review_task, checks_task)

    done, pending = await asyncio.wait(
        [monitor_task, success_task],
        return_when=asyncio.FIRST_COMPLETED,
    )
    for task in pending:
        task.cancel()
    for task in done:
        exc = task.exception()
        if exc:
            raise exc


if __name__ == "__main__":
    try:
        asyncio.run(watch_mr())
    except SystemExit as exc:
        raise SystemExit(exc.code) from None
