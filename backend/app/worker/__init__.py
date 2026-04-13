"""ARQ worker package."""

__all__ = ["WorkerSettings"]


def __getattr__(name: str):
    if name == "WorkerSettings":
        from app.worker.main import WorkerSettings

        return WorkerSettings
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
