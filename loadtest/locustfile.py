"""Load test for the Mpanko API.

Run against a staging copy, never production:

    pip install locust
    locust -f loadtest/locustfile.py --host https://staging-api.example.com
    # headless: locust -f loadtest/locustfile.py --host URL --headless -u 50 -r 5 -t 2m --csv loadtest/out

Shoppers browse the catalogue, read product pages, check delivery quotes and payment methods.
Nobody here places an order, so the test creates no orders and takes no stock.
"""
import random

from locust import HttpUser, between, task


class Shopper(HttpUser):
    wait_time = between(1, 4)
    slugs: list[str] = []

    def on_start(self):
        r = self.client.get("/api/v1/products/?ordering=-created_at", name="/products/ (list)")
        if r.ok:
            self.slugs = [p["slug"] for p in r.json().get("results", [])]

    @task(5)
    def browse(self):
        self.client.get("/api/v1/products/?ordering=-created_at", name="/products/ (list)")

    @task(2)
    def search(self):
        self.client.get("/api/v1/products/?search=kente", name="/products/ (search)")

    @task(2)
    def categories(self):
        self.client.get("/api/v1/categories/")

    @task(4)
    def product(self):
        if self.slugs:
            self.client.get(f"/api/v1/products/{random.choice(self.slugs)}/", name="/products/{slug}/")

    @task(1)
    def delivery_quote(self):
        if self.slugs:
            self.client.get(f"/api/v1/shipping/quote/?country=GB&products={random.choice(self.slugs)}:1", name="/shipping/quote/")

    @task(1)
    def payment_methods(self):
        self.client.get("/api/v1/payments/methods/?currency=GHS", name="/payments/methods/")
