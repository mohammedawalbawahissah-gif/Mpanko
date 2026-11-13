# Backups, restore and monitoring

## What to protect

| Data | Where it lives | How it is protected |
| --- | --- | --- |
| Orders, customers, products, settings | Railway PostgreSQL | Railway backups plus your own dump (below) |
| Product photos, shipping labels, invoices | Cloudflare R2 bucket | R2 object versioning, or a copy to a second bucket |
| Code and settings | GitHub, Railway variables | Keep a private copy of the variable list in a password manager |

## Turn on database backups

1. Railway project > the Postgres service > Backups. Enable daily backups and keep at least 7.
2. Also keep your own copy off Railway, weekly. From a computer with `pg_dump` installed, using the public connection string from Railway:

```
pg_dump "DATABASE_PUBLIC_URL" --format=custom --file=mpanko-YYYY-MM-DD.dump
```

Store the file somewhere that is not the same account as Railway (an encrypted drive or another cloud). The dump holds customer data: encrypt it and delete old copies.

## Restore

Always restore into a new, empty database first and check it. Never restore over production without a fresh dump of the current state.

```
createdb mpanko_restore
pg_restore --no-owner --dbname=mpanko_restore mpanko-YYYY-MM-DD.dump
```

Then point a staging copy of the api at `mpanko_restore` and check that you can sign in, see recent orders and open a product page. To go live on the restored copy, change `DATABASE_URL` on the api, worker and beat services and redeploy.

Do a practice restore once before launch and again every quarter. A backup that has never been restored is not a backup. Write the date and result here: __________

## After a restore

- Run `python manage.py migrate` so the schema matches the deployed code.
- Orders placed after the backup are lost from the database. Check Paystack for payments in that window and match them to orders by hand.
- Tell customers whose orders are affected.

## Monitoring

- Uptime: add a free monitor (UptimeRobot or Better Stack) for `https://YOUR-API/ready/` (it checks the database and Redis; `/health/` only checks that the server answers) and for the shop home page, every 5 minutes, alerting your phone and email.
- Errors: set `SENTRY_DSN` (see GO-LIVE section 5e) and turn on email alerts for new issues.
- Disk and database size: check the Railway usage page monthly.
- Payments: reconcile Paystack against orders weekly with the Reconciliation page in the admin.
