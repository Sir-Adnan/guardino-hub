from __future__ import annotations
from dataclasses import dataclass

@dataclass
class TaskRunStats:
    scanned_users: int = 0
    affected_users: int = 0
    remote_actions: int = 0
    remote_failures: int = 0
    errors: int = 0
