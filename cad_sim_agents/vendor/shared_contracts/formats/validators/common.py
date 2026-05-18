from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass
class FailedCheck:
    check: str
    object_id: str | None
    message: str
    suggested_fix: str | None = None

    def to_dict(self) -> dict[str, Any]:
        data: dict[str, Any] = {
            "check": self.check,
            "message": self.message,
        }
        if self.object_id is not None:
            data["object_id"] = self.object_id
        if self.suggested_fix is not None:
            data["suggested_fix"] = self.suggested_fix
        return data


@dataclass
class ValidationResult:
    stage: str
    failed_checks: list[FailedCheck] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failed_checks

    def fail(
        self,
        check: str,
        message: str,
        object_id: str | None = None,
        suggested_fix: str | None = None,
    ) -> None:
        self.failed_checks.append(
            FailedCheck(
                check=check,
                object_id=object_id,
                message=message,
                suggested_fix=suggested_fix,
            )
        )

    def warn(self, message: str) -> None:
        self.warnings.append(message)

    def extend(self, other: "ValidationResult") -> None:
        self.failed_checks.extend(other.failed_checks)
        self.warnings.extend(other.warnings)

    def to_dict(self) -> dict[str, Any]:
        return {
            "ok": self.ok,
            "stage": self.stage,
            "failed_checks": [check.to_dict() for check in self.failed_checks],
            "warnings": list(self.warnings),
        }
