import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function getToken(ask: boolean): Promise<string | null> {
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", { name: "Store alerts", importance: Notifications.AndroidImportance.HIGH });
  }
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted" && ask) status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId;
  try {
    return (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
  } catch {
    return null; // simulators and Expo Go without a project id cannot get a token
  }
}

/** Registers this phone for store alerts and turns the phone channel on for this staff member. Returns false if it could not. */
export async function enablePush(): Promise<boolean> {
  const token = await getToken(true);
  if (!token) return false;
  await api("/notifications/devices/", { method: "POST", body: { token, platform: Platform.OS } });
  await api("/notifications/preferences/", { method: "PUT", body: { staff: { push: true } } });
  return true;
}

/** Each launch: keep the registration current without asking again. */
export async function refreshPushRegistration(): Promise<void> {
  const token = await getToken(false);
  if (token) await api("/notifications/devices/", { method: "POST", body: { token, platform: Platform.OS } }).catch(() => undefined);
}

/** On sign-out, while still signed in: this phone must stop receiving the previous person's alerts. */
export async function unregisterDevice(): Promise<void> {
  const token = await getToken(false);
  if (token) await api("/notifications/devices/", { method: "DELETE", body: { token } }).catch(() => undefined);
}

export { Notifications };
