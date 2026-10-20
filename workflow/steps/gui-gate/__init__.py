"""Human review gate answered from the ZCode MCP App panel.

This step is a drop-in replacement for Spec Kit's built-in ``gate`` step with
one addition: when the workflow runs without a TTY (the normal case for an
agent), it writes a hash-bound *pending request* under ``review/gui-gates/``
and pauses. The MCP server in ``workflow/mcp/approval-server.mjs`` renders that
request in ZCode's chat as an MCP App panel; only the panel can write the
matching verdict, and the workflow resumes with that verdict.

Design rules:

* A verdict is bound to ``runId``, ``stepId``, the message, the options, the
  on-reject policy, and the SHA-256 of every reviewed file. Changing any of
  them invalidates the verdict and opens a fresh gate.
* ``reviewedArtifacts`` in a sibling self-review JSON (for example
  ``review/self-review-script.json`` next to ``review/self-review-script.md``)
  are re-hashed before the gate opens. A stale self-review fails closed; the AI
  self-review must be re-run rather than silently approved.
* ``verdict_input`` is rejected outright. That built-in feature reads a value
  from ``resume -i`` and would let an agent cast the human's vote.
* The panel token lives only in the MCP server and in the rendered panel; the
  nonce is per request. A tool call without both is refused by the server.

The step still behaves like ``gate`` in an interactive terminal, so a teacher
who runs the workflow directly can answer without ZCode.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import secrets
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from specify_cli.workflows.base import StepBase, StepContext, StepResult, StepStatus
from specify_cli.workflows.expressions import evaluate_expression

SCHEMA_VERSION = "1.0"
STATE_DIR_ENV = "COURSEWARE_GATE_STATE_DIR"
DEFAULT_STATE_DIR = "review/gui-gates"
PANEL_TOOL = "courseware_gate_open"

#: Control characters except tab: C0 (including LF), DEL, and C1. Stripped from
#: anything shown in the terminal fallback so review material cannot inject
#: ANSI escapes. The GUI panel uses textContent and is not affected.
_CONTROL_CHARS = re.compile(r"[\x00-\x08\x0a-\x1f\x7f-\x9f]")
_SHA256_RE = re.compile(r"^[0-9a-fA-F]{64}$")
_NONCE_RE = re.compile(r"^[0-9a-f]{32}$")
_URL_RE = re.compile(r"https?://[^\s<>\"'）】]+", re.IGNORECASE)

#: Directories never walked when an explicit artifact is a directory.
_SKIP_DIRS = {
    ".git",
    ".hg",
    ".svn",
    "node_modules",
    ".venv",
    "venv",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
}

#: How many bytes of a review file are sent to the panel. The panel is a
#: review aid, not a full document reader; the Review file remains the source.
MAX_EXCERPT_BYTES = 24 * 1024
MAX_EXCERPT_LINES = 400


class GateSetupError(RuntimeError):
    """Raised when the gate cannot establish trustworthy review evidence."""


def _now() -> str:
    return (
        datetime.now(timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z")
    )


def _read_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeDecodeError):
        return None


def _write_json(path: Path, value: Any) -> None:
    """Atomically write JSON, retrying around Windows file sharing."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp")
    tmp.write_text(
        json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    for attempt in range(10):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 9:
                raise
            time.sleep(0.05)


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _relative(project_root: Path, path: Path) -> str:
    try:
        return path.relative_to(project_root).as_posix()
    except ValueError:
        return str(path)


class GuiGateStep(StepBase):
    """Hash-bound review gate that pauses for the MCP App panel."""

    type_key = "gui-gate"

    #: Maximum number of ``show_file`` lines rendered in the terminal fallback.
    MAX_SHOW_FILE_LINES = 200

    # ------------------------------------------------------------------ API
    def validate(self, config: dict[str, Any]) -> list[str]:
        errors = super().validate(config)
        if "message" not in config:
            errors.append(
                f"gui-gate step {config.get('id', '?')!r} is missing 'message'."
            )
        options = config.get("options", ["approve", "reject"])
        if not isinstance(options, list) or not options:
            errors.append(
                f"gui-gate step {config.get('id', '?')!r}: 'options' must be a "
                "non-empty list."
            )
        elif not all(isinstance(option, str) for option in options):
            errors.append(
                f"gui-gate step {config.get('id', '?')!r}: all options must be strings."
            )
        on_reject = config.get("on_reject", "abort")
        if on_reject not in ("abort", "skip", "retry"):
            errors.append(
                f"gui-gate step {config.get('id', '?')!r}: 'on_reject' must be "
                "'abort', 'skip', or 'retry'."
            )
        if (
            on_reject in ("abort", "retry")
            and isinstance(options, list)
            and all(isinstance(option, str) for option in options)
            and not any(option.lower() in ("reject", "abort") for option in options)
        ):
            errors.append(
                f"gui-gate step {config.get('id', '?')!r}: on_reject={on_reject!r} "
                "but options has no 'reject' or 'abort' choice."
            )
        if "verdict_input" in config:
            errors.append(
                f"gui-gate step {config.get('id', '?')!r}: 'verdict_input' is not "
                "supported; a human verdict must come from the approval panel."
            )
        for key in ("show_file",):
            value = config.get(key)
            if value is not None and not isinstance(value, str):
                errors.append(
                    f"gui-gate step {config.get('id', '?')!r}: '{key}' must be a string."
                )
        artifacts = config.get("artifacts")
        if artifacts is not None:
            if isinstance(artifacts, str):
                pass
            elif isinstance(artifacts, list) and all(
                isinstance(item, str) and item for item in artifacts
            ):
                pass
            else:
                errors.append(
                    f"gui-gate step {config.get('id', '?')!r}: 'artifacts' must be a "
                    "string or a list of non-empty strings."
                )
        return errors

    def execute(self, config: dict[str, Any], context: StepContext) -> StepResult:
        step_id = config.get("id", "?")
        try:
            message = self._evaluate(config.get("message", "Review required."), context)
        except Exception as exc:  # noqa: BLE001 - surface a gate-config error
            return StepResult(
                status=StepStatus.FAILED,
                error=f"gui-gate {step_id!r}: cannot resolve 'message': {exc}",
            )
        message = str(message)
        options = config.get("options", ["approve", "reject"])
        on_reject = config.get("on_reject", "abort")
        show_file = config.get("show_file")
        try:
            show_file = self._evaluate(show_file, context) if show_file is not None else None
        except Exception as exc:  # noqa: BLE001
            return StepResult(
                status=StepStatus.FAILED,
                error=f"gui-gate {step_id!r}: cannot resolve 'show_file': {exc}",
            )
        if show_file is not None:
            show_file = str(show_file)

        output: dict[str, Any] = {
            "message": message,
            "options": options,
            "on_reject": on_reject,
            "show_file": show_file,
            "choice": None,
        }

        # ``validate`` normally runs before execution, but the engine does not
        # enforce that contract on every path. Guard here for the same reasons
        # the built-in gate does: a malformed config must fail loudly instead of
        # falling through to an approval.
        if (
            not isinstance(options, list)
            or not options
            or not all(isinstance(option, str) and option for option in options)
        ):
            return StepResult(
                status=StepStatus.FAILED,
                output=output,
                error=(
                    f"gui-gate {step_id!r}: 'options' must be a non-empty list of "
                    f"strings, got {type(options).__name__}."
                ),
            )
        if on_reject not in ("abort", "skip", "retry"):
            return StepResult(
                status=StepStatus.FAILED,
                output=output,
                error=(
                    f"gui-gate {step_id!r}: 'on_reject' must be 'abort', 'skip', or "
                    f"'retry', got {on_reject!r}."
                ),
            )
        if "verdict_input" in config:
            return StepResult(
                status=StepStatus.FAILED,
                output=output,
                error=(
                    f"gui-gate {step_id!r}: 'verdict_input' is not supported. A human "
                    "verdict must be recorded from the approval panel."
                ),
            )

        project_root = Path(context.project_root or os.getcwd()).resolve()
        run_id = str(context.run_id or "local")

        # Windows maps an ignored stdin to NUL, where isatty() can still return
        # True. The fail-closed wrapper sets this marker for non-interactive
        # runs, so do not trust isatty alone there.
        noninteractive = os.environ.get("COURSEWARE_GATE_NONINTERACTIVE") == "1"
        if sys.stdin.isatty() and not noninteractive:
            choice = self._prompt(
                self._compose_prompt(message, show_file, project_root), options
            )
            return self._decide(
                choice=choice,
                options=options,
                on_reject=on_reject,
                output=output,
                mode="terminal",
                step_id=step_id,
            )

        return self._execute_gui(
            config=config,
            context=context,
            project_root=project_root,
            run_id=run_id,
            step_id=step_id,
            message=message,
            options=options,
            on_reject=on_reject,
            show_file=show_file,
            output=output,
        )

    # ------------------------------------------------------------- GUI path
    def _execute_gui(
        self,
        *,
        config: dict[str, Any],
        context: StepContext,
        project_root: Path,
        run_id: str,
        step_id: str,
        message: str,
        options: list[str],
        on_reject: str,
        show_file: str | None,
        output: dict[str, Any],
    ) -> StepResult:
        state_dir = self._state_dir(project_root)
        try:
            entries, show_path, excerpt, links = self._collect_evidence(
                config=config,
                context=context,
                project_root=project_root,
                show_file=show_file,
                message=message,
            )
            digest, _payload = self._digest(
                run_id=run_id,
                step_id=step_id,
                message=message,
                options=options,
                on_reject=on_reject,
                entries=entries,
            )
        except GateSetupError as exc:
            return StepResult(
                status=StepStatus.FAILED,
                output=output,
                error=f"gui-gate {step_id!r}: {exc}",
            )
        except Exception as exc:  # noqa: BLE001 - fail the gate, never self-approve
            return StepResult(
                status=StepStatus.FAILED,
                output=output,
                error=f"gui-gate {step_id!r}: cannot build review evidence: {exc}",
            )

        gate_key = digest[:24]
        pending_path = state_dir / "pending" / f"{gate_key}.json"
        verdict_path = state_dir / "verdicts" / f"{gate_key}.json"
        pending = _read_json(pending_path)
        verdict = _read_json(verdict_path)

        if isinstance(verdict, dict):
            choice = self._current_verdict_choice(
                verdict=verdict,
                pending=pending if isinstance(pending, dict) else None,
                gate_key=gate_key,
                digest=digest,
                run_id=run_id,
                step_id=step_id,
                options=options,
            )
            if choice is not None:
                # A verdict is one-shot. Marking it consumed before the step
                # returns means an accidental second resume cannot replay it.
                consumed = dict(verdict)
                consumed["consumedAt"] = _now()
                consumed["consumedByPid"] = os.getpid()
                consumed["outcome"] = choice
                _write_json(verdict_path, consumed)
                self._update_pending(
                    pending_path,
                    status="consumed",
                    choice=choice,
                    extra={"consumedAt": consumed["consumedAt"]},
                )
                request = pending if isinstance(pending, dict) else None
                return self._decide(
                    choice=choice,
                    options=options,
                    on_reject=on_reject,
                    output=output,
                    mode="gui",
                    step_id=step_id,
                    state_dir=state_dir,
                    project_root=project_root,
                    request=request,
                    message=message,
                    show_file=show_file,
                    gate_key=gate_key,
                    digest=digest,
                    entries=entries,
                    excerpt=excerpt,
                    links=links,
                    run_id=run_id,
                )

        reuse = (
            isinstance(pending, dict)
            and pending.get("gateKey") == gate_key
            and pending.get("digest") == digest
            and pending.get("runId") == run_id
            and pending.get("stepId") == step_id
            and pending.get("status") == "pending"
            and isinstance(pending.get("nonce"), str)
            and bool(_NONCE_RE.match(pending["nonce"]))
        )
        if reuse:
            request = pending
        else:
            self._mark_stale(
                state_dir=state_dir,
                run_id=run_id,
                step_id=step_id,
                keep_gate_key=gate_key,
            )
            request = self._new_request(
                run_id=run_id,
                step_id=step_id,
                message=message,
                options=options,
                on_reject=on_reject,
                gate_key=gate_key,
                digest=digest,
                show_path=show_path,
                project_root=project_root,
                entries=entries,
                excerpt=excerpt,
                links=links,
            )
            _write_json(pending_path, request)

        output["guiGate"] = self._gate_output(
            request=request,
            state_dir=state_dir,
            project_root=project_root,
        )
        return StepResult(status=StepStatus.PAUSED, output=output)

    # --------------------------------------------------------------- decide
    def _decide(
        self,
        *,
        choice: str,
        options: list[str],
        on_reject: str,
        output: dict[str, Any],
        mode: str,
        step_id: str,
        state_dir: Path | None = None,
        project_root: Path | None = None,
        request: dict[str, Any] | None = None,
        message: str = "",
        show_file: str | None = None,
        gate_key: str = "",
        digest: str = "",
        entries: list[dict[str, Any]] | None = None,
        excerpt: str = "",
        links: list[dict[str, str]] | None = None,
        run_id: str = "",
    ) -> StepResult:
        output["choice"] = choice
        output["decisionMode"] = mode
        rejected = choice.lower() in ("reject", "abort")

        if rejected and on_reject == "abort":
            output["aborted"] = True
            if mode == "gui" and state_dir is not None and gate_key:
                self._update_pending(
                    state_dir / "pending" / f"{gate_key}.json",
                    status="rejected",
                    choice=choice,
                    extra={"rejectedAt": _now()},
                )
            return StepResult(
                status=StepStatus.FAILED,
                output=output,
                error=f"gui-gate rejected by user at step {step_id!r}",
            )

        if rejected and on_reject == "retry":
            if mode == "gui" and state_dir is not None and project_root is not None:
                # The old request is consumed; open a fresh one with a new
                # nonce so the panel must ask the human again.
                fresh = self._new_request(
                    run_id=run_id,
                    step_id=step_id,
                    message=message,
                    options=options,
                    on_reject=on_reject,
                    gate_key=gate_key,
                    digest=digest,
                    show_path=None,
                    show_file_rel=(
                        request.get("reviewFile") if isinstance(request, dict) else None
                    ),
                    project_root=project_root,
                    entries=entries or [],
                    excerpt=excerpt,
                    links=links or [],
                    previous_nonce=request.get("nonce") if request else None,
                )
                _write_json(state_dir / "pending" / f"{gate_key}.json", fresh)
                output["guiGate"] = self._gate_output(
                    request=fresh,
                    state_dir=state_dir,
                    project_root=project_root,
                )
            return StepResult(status=StepStatus.PAUSED, output=output)

        # Approve, an extra configured option, or reject with on_reject=skip.
        if mode == "gui" and state_dir is not None and gate_key:
            self._update_pending(
                state_dir / "pending" / f"{gate_key}.json",
                status="consumed",
                choice=choice,
                extra={"consumedAt": _now()},
            )
        return StepResult(status=StepStatus.COMPLETED, output=output)

    # -------------------------------------------------------------- evidence
    def _collect_evidence(
        self,
        *,
        config: dict[str, Any],
        context: StepContext,
        project_root: Path,
        show_file: str | None,
        message: str,
    ) -> tuple[
        list[dict[str, Any]], Path | None, str, list[dict[str, str]]
    ]:
        entries: dict[str, dict[str, Any]] = {}
        show_path: Path | None = None

        if show_file:
            show_path = self._resolve(project_root, show_file, what="show_file")
            if not show_path.is_file():
                raise GateSetupError(f"show_file is not a file: {show_file}")
            self._add_entry(entries, project_root, show_path, role="show")

        artifacts = config.get("artifacts")
        if isinstance(artifacts, str):
            artifacts = [artifacts]
        elif artifacts is None:
            artifacts = []
        elif not isinstance(artifacts, list):
            raise GateSetupError("'artifacts' must be a string or a list of strings.")
        for raw in artifacts:
            if not isinstance(raw, str) or not raw:
                raise GateSetupError("'artifacts' entries must be non-empty strings.")
            resolved = self._evaluate(raw, context)
            resolved = str(resolved)
            path = self._resolve(project_root, resolved, what="artifact")
            if path.is_file():
                self._add_entry(entries, project_root, path, role="artifact")
            elif path.is_dir():
                self._add_tree(entries, project_root, path)
            else:
                raise GateSetupError(f"artifact does not exist: {resolved}")

        # A sibling ``<name>.json`` next to the shown ``<name>.md`` is the
        # AI self-review record. Bind it, and verify every reviewed artifact's
        # hash so a stale self-review fails instead of being approved.
        if show_path is not None and show_path.suffix.lower() == ".md":
            sibling = show_path.with_suffix(".json")
            if sibling.is_file():
                self._add_entry(entries, project_root, sibling, role="review")
                self._bind_self_review(entries, project_root, sibling)

        ordered = sorted(entries.values(), key=lambda item: item["path"])
        excerpt, links = self._review_excerpt(show_path, message, context)
        return ordered, show_path, excerpt, links

    def _bind_self_review(
        self, entries: dict[str, dict[str, Any]], project_root: Path, sibling: Path
    ) -> None:
        try:
            data = json.loads(sibling.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, ValueError) as exc:
            raise GateSetupError(f"cannot read self-review record {sibling}: {exc}") from exc
        if not isinstance(data, dict):
            raise GateSetupError(f"self-review record is not an object: {sibling}")
        reviewed = data.get("reviewedArtifacts", [])
        if reviewed is None:
            reviewed = []
        if not isinstance(reviewed, list):
            raise GateSetupError(f"self-review 'reviewedArtifacts' is not a list: {sibling}")
        for item in reviewed:
            if not isinstance(item, dict):
                raise GateSetupError(f"malformed reviewed artifact in {sibling}")
            rel = item.get("path")
            expected = item.get("sha256")
            if not isinstance(rel, str) or not rel:
                raise GateSetupError(f"reviewed artifact without a path in {sibling}")
            if not isinstance(expected, str) or not _SHA256_RE.match(expected):
                raise GateSetupError(
                    f"reviewed artifact {rel!r} in {sibling} has no valid sha256"
                )
            path = self._resolve(project_root, rel, what=f"reviewed artifact {rel!r}")
            if not path.is_file():
                raise GateSetupError(f"reviewed artifact is missing: {rel}")
            actual = _sha256_file(path)
            if actual.lower() != expected.lower():
                raise GateSetupError(
                    f"self-review is stale: {rel} changed after it was reviewed "
                    f"(expected {expected.lower()}, found {actual}). Re-run the "
                    "self-review before asking for human approval."
                )
            self._add_entry(entries, project_root, path, role="reviewed")

    def _add_tree(
        self, entries: dict[str, dict[str, Any]], project_root: Path, root: Path
    ) -> None:
        found = False
        for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
            current = Path(dirpath)
            dirnames[:] = sorted(
                name
                for name in dirnames
                if name not in _SKIP_DIRS and not (current / name).is_symlink()
            )
            for name in sorted(filenames):
                path = current / name
                if path.is_symlink() or not path.is_file():
                    continue
                self._add_entry(entries, project_root, path, role="artifact")
                found = True
        if not found:
            raise GateSetupError(
                f"artifact directory has no files: {_relative(project_root, root)}"
            )

    def _add_entry(
        self,
        entries: dict[str, dict[str, Any]],
        project_root: Path,
        path: Path,
        *,
        role: str,
    ) -> None:
        rel = _relative(project_root, path)
        existing = entries.get(rel)
        if existing is not None:
            # Keep the strongest role for display; the hash is the same file.
            precedence = {"show": 4, "review": 3, "artifact": 2, "reviewed": 1}
            if precedence.get(role, 0) > precedence.get(existing["role"], 0):
                existing["role"] = role
            return
        entries[rel] = {
            "path": rel,
            "role": role,
            "sha256": _sha256_file(path),
            "size": path.stat().st_size,
        }

    def _resolve(self, project_root: Path, raw: str, *, what: str) -> Path:
        candidate = Path(raw).expanduser()
        if not candidate.is_absolute():
            candidate = project_root / candidate
        try:
            resolved = candidate.resolve()
        except (OSError, RuntimeError) as exc:
            raise GateSetupError(f"cannot resolve {what}: {raw}: {exc}") from exc
        try:
            resolved.relative_to(project_root)
        except ValueError as exc:
            raise GateSetupError(
                f"{what} resolves outside the project root: {raw}"
            ) from exc
        return resolved

    def _digest(
        self,
        *,
        run_id: str,
        step_id: str,
        message: str,
        options: list[str],
        on_reject: str,
        entries: list[dict[str, Any]],
    ) -> tuple[str, dict[str, Any]]:
        payload = {
            "schema": "courseware-gui-gate/v1",
            "runId": run_id,
            "stepId": step_id,
            "messageSha256": _sha256_text(message),
            "options": list(options),
            "onReject": on_reject,
            "files": [
                {
                    "role": entry["role"],
                    "path": entry["path"],
                    "sha256": entry["sha256"],
                }
                for entry in entries
            ],
        }
        encoded = json.dumps(
            payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
        ).encode("utf-8")
        return hashlib.sha256(encoded).hexdigest(), payload

    def _review_excerpt(
        self, show_path: Path | None, message: str, context: StepContext
    ) -> tuple[str, list[dict[str, str]]]:
        excerpt = ""
        if show_path is not None:
            try:
                text = show_path.read_text(encoding="utf-8", errors="replace")
            except OSError as exc:
                excerpt = f"(could not read {show_path.name}: {exc})"
            else:
                lines = text.splitlines()
                truncated = len(lines) > MAX_EXCERPT_LINES
                excerpt = "\n".join(lines[:MAX_EXCERPT_LINES])
                encoded = excerpt.encode("utf-8")
                if len(encoded) > MAX_EXCERPT_BYTES:
                    excerpt = encoded[:MAX_EXCERPT_BYTES].decode(
                        "utf-8", errors="ignore"
                    )
                    truncated = True
                if truncated:
                    excerpt += "\n\n…（审核文件已截断，完整内容见审核文件）"

        links: list[dict[str, str]] = []
        seen: set[str] = set()

        def add(label: str, url: str) -> None:
            if url and url not in seen:
                seen.add(url)
                links.append({"label": label, "url": url})

        deck_url = context.inputs.get("deck_url") if context.inputs else None
        if isinstance(deck_url, str) and deck_url.startswith(("http://", "https://")):
            add("打开课件", deck_url)
        # The gate message carries the shell preview or deck URL; surface it
        # as a link next to the verdict buttons. The excerpt may carry another.
        for source in (message, excerpt):
            for match in _URL_RE.finditer(source):
                add(
                    "打开审核页面",
                    match.group(0).rstrip(".,;:!?)]}>，。；：！？）】"),
                )
        return excerpt, links

    # --------------------------------------------------------------- request
    def _new_request(
        self,
        *,
        run_id: str,
        step_id: str,
        message: str,
        options: list[str],
        on_reject: str,
        gate_key: str,
        digest: str,
        show_path: Path | None,
        project_root: Path,
        entries: list[dict[str, Any]],
        excerpt: str,
        links: list[dict[str, str]],
        previous_nonce: str | None = None,
        show_file_rel: str | None = None,
    ) -> dict[str, Any]:
        review_file = (
            _relative(project_root, show_path) if show_path else show_file_rel
        )
        request: dict[str, Any] = {
            "schemaVersion": SCHEMA_VERSION,
            "gateKey": gate_key,
            "nonce": secrets.token_hex(16),
            "digest": digest,
            "runId": run_id,
            "stepId": step_id,
            "message": message,
            "messageSha256": _sha256_text(message),
            "options": list(options),
            "onReject": on_reject,
            "showFile": review_file,
            "reviewFile": review_file,
            "reviewExcerpt": excerpt,
            "links": links,
            "files": entries,
            "status": "pending",
            "createdAt": _now(),
            "createdByPid": os.getpid(),
        }
        if previous_nonce:
            request["previousNonce"] = previous_nonce
        return request

    def _gate_output(
        self, *, request: dict[str, Any], state_dir: Path, project_root: Path
    ) -> dict[str, Any]:
        gate_key = request["gateKey"]
        return {
            "schemaVersion": SCHEMA_VERSION,
            "mode": "gui",
            "panelTool": PANEL_TOOL,
            "runId": request["runId"],
            "stepId": request["stepId"],
            "gateKey": gate_key,
            "nonce": request["nonce"],
            "digest": request["digest"],
            "requestFile": _relative(project_root, state_dir / "pending" / f"{gate_key}.json"),
            "stateDir": _relative(project_root, state_dir),
            "showFile": request.get("showFile"),
            "fileCount": len(request.get("files") or []),
            "options": request.get("options") or [],
            "onReject": request.get("onReject"),
            "message": request.get("message") or "",
            "createdAt": request.get("createdAt"),
        }

    def _current_verdict_choice(
        self,
        *,
        verdict: dict[str, Any],
        pending: dict[str, Any] | None,
        gate_key: str,
        digest: str,
        run_id: str,
        step_id: str,
        options: list[str],
    ) -> str | None:
        if verdict.get("schemaVersion") != SCHEMA_VERSION:
            return None
        if verdict.get("accepted") is not True:
            return None
        if verdict.get("gateKey") != gate_key or verdict.get("digest") != digest:
            return None
        if verdict.get("runId") != run_id or verdict.get("stepId") != step_id:
            return None
        nonce = verdict.get("nonce")
        if not isinstance(nonce, str) or not _NONCE_RE.match(nonce):
            return None
        if verdict.get("consumedAt"):
            return None
        if pending is not None:
            if pending.get("gateKey") != gate_key:
                return None
            if pending.get("nonce") != nonce:
                # A retry opened a fresh request with a new nonce.
                return None
            if pending.get("status") not in ("pending", "decided"):
                return None
        raw_choice = verdict.get("choice")
        if not isinstance(raw_choice, str):
            return None
        for option in options:
            if option.lower() == raw_choice.lower():
                return option
        return None

    def _update_pending(
        self,
        path: Path,
        *,
        status: str,
        choice: str,
        extra: dict[str, Any] | None = None,
    ) -> None:
        pending = _read_json(path)
        if not isinstance(pending, dict):
            return
        pending["status"] = status
        pending["choice"] = choice
        pending.update(extra or {})
        _write_json(path, pending)

    def _mark_stale(
        self, *, state_dir: Path, run_id: str, step_id: str, keep_gate_key: str
    ) -> None:
        pending_dir = state_dir / "pending"
        if not pending_dir.is_dir():
            return
        for path in pending_dir.glob("*.json"):
            record = _read_json(path)
            if not isinstance(record, dict):
                continue
            if (
                record.get("runId") == run_id
                and record.get("stepId") == step_id
                and record.get("gateKey") != keep_gate_key
                and record.get("status") in ("pending", "decided")
            ):
                record["status"] = "stale"
                record["staleAt"] = _now()
                record["staleReason"] = "artifact-or-gate-changed"
                _write_json(path, record)

    def _state_dir(self, project_root: Path) -> Path:
        raw = os.environ.get(STATE_DIR_ENV)
        if raw:
            path = Path(raw).expanduser()
            if not path.is_absolute():
                path = project_root / path
            return path.resolve()
        return (project_root / DEFAULT_STATE_DIR).resolve()

    # --------------------------------------------------------------- helpers
    @staticmethod
    def _evaluate(value: Any, context: StepContext) -> Any:
        if isinstance(value, str) and "{{" in value:
            return evaluate_expression(value, context)
        return value

    @classmethod
    def _compose_prompt(
        cls, message: str, show_file: str | None, project_root: Path
    ) -> str:
        text = str(message)
        if not show_file:
            return text
        header = f"{_CONTROL_CHARS.sub('', show_file)}:"
        path = Path(show_file)
        if not path.is_absolute():
            path = project_root / path
        body = "\n".join(
            [header, *(f"  {line}" for line in cls._read_show_file(path))]
        )
        return f"{text}\n\n{body}"

    @classmethod
    def _read_show_file(cls, path: Path) -> list[str]:
        lines: list[str] = []
        truncated = False
        try:
            with path.open(encoding="utf-8") as handle:
                for line in handle:
                    if len(lines) >= cls.MAX_SHOW_FILE_LINES:
                        truncated = True
                        break
                    lines.append(_CONTROL_CHARS.sub("", line.rstrip("\n")))
        except (OSError, UnicodeDecodeError, ValueError) as exc:
            return [_CONTROL_CHARS.sub("", f"(could not read file: {exc})")]
        if not lines and not truncated:
            return ["(file is empty)"]
        if truncated:
            lines.append(
                f"… (output truncated at {cls.MAX_SHOW_FILE_LINES} lines)"
            )
        return lines

    @staticmethod
    def _prompt(message: str, options: list[str]) -> str:
        print("\n  ┌─ Gate ─────────────────────────────────────")
        for line in message.split("\n"):
            print(f"  │ {line}" if line else "  │")
        print("  │")
        for index, option in enumerate(options, 1):
            print(f"  │  [{index}] {option}")
        print("  └────────────────────────────────────────────")
        while True:
            try:
                raw = input(f"  Choose [1-{len(options)}]: ").strip()
            except (EOFError, KeyboardInterrupt):
                print()
                return options[-1]
            if raw.isdecimal() and 1 <= int(raw) <= len(options):
                return options[int(raw) - 1]
            if raw.lower() in [option.lower() for option in options]:
                return next(
                    option for option in options if option.lower() == raw.lower()
                )
            print(f"  Invalid choice. Enter 1-{len(options)} or an option name.")
