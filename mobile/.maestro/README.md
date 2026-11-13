# Phone flows (Maestro)

These scripts drive the real app on an emulator or a phone, the way a shopper would. They are the phone counterpart of the browser tests in `e2e/`.

They could not be run in the environment where they were written (no emulator), so treat them as a starting point: run them once, and fix any line where the screen text or layout differs on your build.

## Run them

1. Install Maestro: https://maestro.mobile.dev/getting-started/installing-maestro
2. Start the API with demo data (`python manage.py seed_demo`) and, for the guest flow, `GUEST_CHECKOUT_ENABLED=true`.
3. Start an Android emulator or plug in a phone, then build and open the app: from `mobile/`, `npx expo run:android` (or install your EAS build).
4. From `mobile/`: `maestro test .maestro` runs every flow, or `maestro test .maestro/browse.yaml` runs one.

`appId` is `com.wolbiroyal.mpanko`. The test account used by `signin.yaml` is created by `seed_demo` : customer@mpanko.test with password Mpanko-demo-123 (DEBUG only). Change them in the file if yours differ.
