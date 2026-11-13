# Performance and load testing

`loadtest/locustfile.py` simulates shoppers browsing: the catalogue, search, categories, product pages, delivery quotes and payment methods. It places no orders and takes no stock, so it is safe on staging with real data. Do not run it against production.

```
pip install locust
locust -f loadtest/locustfile.py --host https://your-staging-api --headless -u 50 -r 5 -t 2m --csv loadtest/out
```

`-u` is the number of shoppers, `-r` how many arrive per second, `-t` how long to run. Leave out `--headless` for a live dashboard at http://localhost:8089.

## Request limits

Visitors are limited per IP address (`THROTTLE_ANON`, default 1000/hour) and signed-in users per account (`THROTTLE_USER`, default 5000/hour). A load test sends every request from one IP, so it will hit the visitor limit and show 429 errors. On staging, raise `THROTTLE_ANON` (for example `100000/hour`) for the test and put it back afterwards. Many Ghanaian shoppers share one address through their mobile network, so do not set the visitor limit low in production.

## Baseline

Measured in development on 2026-11-13: Django's development server, SQLite, one process, 20 shoppers, 40 seconds, a few hundred requests.

| Result | Value |
| --- | --- |
| Failures | 0 of 334 |
| Average response | 14 ms |
| 99th percentile | 75 ms |
| Slowest (product list, 99th percentile) | 96 ms |

This is a sanity check, not a capacity figure: it does not use the production database, workers or network. Before launch, repeat on staging with production-like data and agree targets, for example a 95th percentile under 800 ms at your expected busiest hour and no failures. Record the numbers here.

| Date | Environment | Shoppers | Failures | p95 | p99 |
| --- | --- | --- | --- | --- | --- |
| 2026-11-13 | Local dev server (SQLite) | 20 | 0 | 64 ms | 75 ms |
|  | Staging |  |  |  |  |
