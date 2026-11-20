import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { api, BASE, getTokens } from "./api";

/** Downloads a file the server only gives to signed-in staff (an invoice, a label, a CSV), then opens the phone's share sheet. */
export async function downloadAndShare(path: string, filename: string): Promise<void> {
  await api("/auth/me/"); // refreshes the sign-in first if it has run out
  const tokens = await getTokens();
  const target = new File(Paths.cache, filename);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(`${BASE}${path}`, target, { headers: tokens ? { Authorization: `Bearer ${tokens.access}` } : {}, idempotent: true });
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(file.uri);
}
