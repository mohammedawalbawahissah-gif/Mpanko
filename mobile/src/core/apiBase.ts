/** The API address the app talks to. A release build must be given a real https address; only development may fall back to the emulator's localhost. */
export const DEV_API_URL = "http://10.0.2.2:8000/api/v1";

export function resolveApiBase(env: string | undefined, dev: boolean): string {
  const value = (env ?? "").trim();
  if (!value) {
    if (dev) return DEV_API_URL;
    throw new Error("EXPO_PUBLIC_API_URL is not set. Set it in eas.json (or the build environment) to your API's https address.");
  }
  if (!dev && (/YOUR-API/i.test(value) || !/^https:\/\//i.test(value))) {
    throw new Error(`EXPO_PUBLIC_API_URL must be a real https address for a release build, not "${value}".`);
  }
  return value.replace(/\/+$/, "");
}
