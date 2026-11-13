from celery import shared_task


@shared_task
def run_retention():
    from .services import apply_retention

    return apply_retention()
