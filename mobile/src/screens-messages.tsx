import { useEffect, useState } from "react";
import { Switch, View } from "react-native";
import { Text } from "./text";
import { api } from "./api";
import { usePrefs } from "./prefs";
import { color } from "./theme";
import { Button, Notice, s } from "./ui";
import type { MessageKey } from "./core/i18n";

type Cell = { enabled: boolean; locked: boolean; available: boolean };
type Channel = "email" | "sms" | "whatsapp" | "push";
type Row = { category: string; label: string; channels: Record<Channel, Cell> };
export type Prefs = { categories: Row[]; marketing_opt_in: boolean; phone_verified: boolean; has_push_device: boolean };

const CHANNELS: Channel[] = ["email", "sms", "whatsapp", "push"];

/** Per kind of message and per channel: how Mpanko may contact the customer. Saves each switch as it is changed. */
export function MessageSettings({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = usePrefs();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api<Prefs>("/notifications/preferences/").then((p) => { setPrefs(p); setError(false); }).catch(() => setError(true));
  }, [refreshKey]);

  const send = async (body: object) => {
    try {
      setPrefs(await api<Prefs>("/notifications/preferences/", { method: "PUT", body }));
      setError(false);
    } catch {
      setError(true);
    }
  };

  if (error && !prefs) return <Notice kind="error">{t("notifications.failed")}</Notice>;
  if (!prefs) return null;
  const name = (key: string) => t(`msg.${key}` as MessageKey);
  return (
    <View>
      <Text style={s.muted}>{t("msg.intro")}</Text>
      {error && <Notice kind="error">{t("notifications.failed")}</Notice>}
      <View style={[s.row, { marginTop: 12, marginBottom: 4 }]}>
        <Text style={{ flex: 1, color: color.ink, fontWeight: "600" }} importantForAccessibility="no" accessibilityElementsHidden>{t("msg.offersOptIn")}</Text>
        <Switch accessibilityLabel={t("msg.offersOptIn")} value={prefs.marketing_opt_in} onValueChange={(v) => send({ marketing_opt_in: v })} />
      </View>
      {prefs.categories.map((row) => (
        <View key={row.category} style={{ marginTop: 14 }}>
          <Text accessibilityRole="header" style={{ fontWeight: "700", color: color.ink, marginBottom: 4 }}>{name(row.category)}</Text>
          {CHANNELS.map((ch) => {
            const cell = row.channels[ch];
            const label = `${name(row.category)}: ${name(ch)}`;
            const blocked = row.category === "offers" && !prefs.marketing_opt_in;
            const off = blocked || (!cell.available && !cell.enabled);
            return (
              <View key={ch} style={[s.row, { minHeight: 44 }]}>
                <Text style={{ flex: 1, color: color.ink }} importantForAccessibility="no" accessibilityElementsHidden>{name(ch)}</Text>
                {cell.locked
                  ? <Text style={s.muted}>{t("msg.alwaysOn")}</Text>
                  : <Switch accessibilityLabel={label} value={cell.enabled} disabled={off} onValueChange={(v) => send({ categories: { [row.category]: { [ch]: v } } })} />}
              </View>
            );
          })}
        </View>
      ))}
      {!prefs.phone_verified && <Text style={[s.muted, { marginTop: 8, fontSize: 13 }]}>{t("msg.needPhone")}</Text>}
    </View>
  );
}

/** On a sold-out item: ask to be told when it is back. */
export function NotifyWhenBack({ variantId, signedIn }: { variantId: number; signedIn: boolean }) {
  const { t } = usePrefs();
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!signedIn) return;
    api<{ variant_id: number }[]>("/notifications/stock-alerts/").then((rows) => setOn(rows.some((r) => r.variant_id === variantId))).catch(() => undefined);
  }, [signedIn, variantId]);
  if (!signedIn) return <Text style={[s.muted, { marginTop: 8 }]}>{t("stock.signIn")}</Text>;
  const toggle = async () => {
    setBusy(true);
    try {
      if (on) await api(`/notifications/stock-alerts/?variant=${variantId}`, { method: "DELETE" });
      else await api("/notifications/stock-alerts/", { method: "POST", body: { variant: variantId } });
      setOn(!on);
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ marginTop: 8 }}>
      {on && <Text style={s.muted}>{t("stock.on")}</Text>}
      <Button kind="quiet" onPress={toggle} disabled={busy} title={on ? t("stock.stop") : t("stock.notify")} />
    </View>
  );
}
