# End-to-end tests

Real-browser tests of the shopping journey (browse, register, pay with the test gateway, see the order).

1. API: `cd backend && DEBUG=true python manage.py migrate && python manage.py seed_demo && python manage.py runserver`
2. `cd e2e && npm install && npx playwright install chromium` (or set `E2E_CHANNEL=chrome` to use an installed Chrome)
3. `npm test` (starts the web app itself unless `E2E_NO_WEBSERVER=1`)

The tests use the "Test payment" gateway, which exists only when the API runs with `DEBUG=true`.
