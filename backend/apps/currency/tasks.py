from celery import shared_task

from .services import refresh_live_rates


@shared_task
def refresh_fx_rates():
    return refresh_live_rates()
