import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

/** Asks permission and returns this phone's Expo push token, or null if the shopper said no or this isn't a real device. */
async function getToken(): Promise<string | null> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Order updates", importance: Notifications.AndroidImportance.DEFAULT });
  }
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  try {
    return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch {
    return null; // simulators and Expo Go without a project id cannot get a token
  }
}

/** Turns order and support push notifications on for this phone. Returns false if it couldn't. */
export async function enablePush(): Promise<boolean> {
  const token = await getToken();
  if (!token) return false;
  await api("/notifications/devices/", { method: "POST", body: { token, platform: Platform.OS } });
  await api("/auth/me/", { method: "PATCH", body: { notify_push: true } });
  return true;
}

export async function disablePush(): Promise<void> {
  const token = await getToken();
  if (token) await api("/notifications/devices/", { method: "DELETE", body: { token } }).catch(() => undefined);
  await api("/auth/me/", { method: "PATCH", body: { notify_push: false } });
}

/** Refreshes the registration each launch (tokens can change). Silent: never prompts. */
export async function refreshPushRegistration(): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") return;
  const token = await getToken();
  if (token) await api("/notifications/devices/", { method: "POST", body: { token, platform: Platform.OS } }).catch(() => undefined);
}

/** On sign-out: stop this phone receiving the previous customer's updates. Must run while still signed in. */
export async function unregisterDevice(): Promise<void> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") return;
  const token = await getToken();
  if (token) await api("/notifications/devices/", { method: "DELETE", body: { token } }).catch(() => undefined);
}

export { Notifications };
