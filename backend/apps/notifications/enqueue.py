"""Hand a job to the background queue without ever failing the request that asked for it."""
import logging

logger = logging.getLogger(__name__)


def enqueue(task, *args, **kwargs):
    """
    Queue `task`. If the queue is unreachable, run it right now instead; if that fails too, log it and carry on.
    A mail or alert problem must never turn a saved order, payment or sign-up into a 500 error. Never raises.
    Returns True if the job was queued or ran.
    """
    try:
        task.delay(*args, **kwargs)
        return True
    except Exception as exc:  # noqa: BLE001 — broker down, bad broker URL, missing transport package ...
        logger.error("Could not queue %s (%s). Running it now instead.", getattr(task, "name", task), exc)
    try:
        task.apply(args=args, kwargs=kwargs)
        return True
    except Exception:  # noqa: BLE001
        logger.exception("Could not run %s either. Skipping it.", getattr(task, "name", task))
        return False
