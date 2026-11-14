import { useCallback, useState } from "react";
import { FlatList, Pressable, Text, View } from "react-native";
import { useFocusEffect, useNavigation, type NavigationProp, type ParamListBase } from "@react-navigation/native";
import { api, type Page } from "./api";
import { routeForPath } from "./core/inbox";
import { badgeText } from "./core/inbox";
import { refreshUnread, useUnreadCount } from "./inbox";
import { useAuth } from "./auth";
import { usePrefs } from "./prefs";
import { color } from "./theme";
import type { RootParams } from "./screens-buy";
import { Busy, Button, ErrorRetry, s } from "./ui";

type Paged<T> = Page<T> & { next: string | null };
interface Item { id: number; title: string; body: string; path: string; is_read: boolean; created_at: string }
type Nav = NavigationProp<RootParams>;

/** The bell in a screen's header: opens the list, with the unread count on it. Shows only when signed in. */
export function NotificationBell() {
  const { user } = useAuth();
  const { t } = usePrefs();
  const nav = useNavigation<Nav>();
  const n = useUnreadCount();
  const label = n ? `${t("notifications.title")}, ${t("notifications.unread", { n })}` : t("notifications.title");
  if (!user) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={10} onPress={() => nav.navigate("Notifications")} style={{ paddingHorizontal: 14, paddingVertical: 6 }}>
      <View style={{ width: 22, height: 22, alignItems: "center", justifyContent: "flex-end" }}>
        <View style={{ width: 16, height: 15, borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottomLeftRadius: 2, borderBottomRightRadius: 2, backgroundColor: "#fff" }} />
        <View style={{ width: 22, height: 3, borderRadius: 2, backgroundColor: "#fff", marginTop: -1 }} />
        <View style={{ width: 6, height: 3, borderBottomLeftRadius: 3, borderBottomRightRadius: 3, backgroundColor: "#fff", marginTop: 1 }} />
      </View>
      {n > 0 && (
        <View style={{ position: "absolute", top: 0, right: 6, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: color.bad, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 }}>
          <Text style={{ color: "#fff", fontSize: 11, fontWeight: "800" }}>{badgeText(n)}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function NotificationsScreen() {
  const { t } = usePrefs();
  const nav = useNavigation<Nav>();
  const [items, setItems] = useState<Item[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (p: number) => {
    try {
      const r = await api<Paged<Item>>(`/notifications/inbox/?page=${p}`);
      setItems((cur) => (p === 1 ? r.results : [...cur, ...r.results]));
      setMore(!!r.next);
      setPage(p);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("notifications.failed"));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [t]);
  useFocusEffect(useCallback(() => { void load(1); void refreshUnread(); }, [load]));

  const unread = items.filter((i) => !i.is_read).length;
  const open = async (item: Item) => {
    if (!item.is_read) {
      setItems((cur) => cur.map((i) => (i.id === item.id ? { ...i, is_read: true } : i)));
      await api(`/notifications/inbox/${item.id}/read/`, { method: "POST", body: {} }).catch(() => undefined);
      void refreshUnread();
    }
    const to = routeForPath(item.path);
    if (to.screen === "Orders") (nav as unknown as NavigationProp<ParamListBase>).navigate("Tabs", { screen: "Orders" });
    else if (to.screen === "SupportList") nav.navigate("SupportList");
    else if (to.screen === "SupportThread") nav.navigate("SupportThread", to.params);
    else nav.navigate("OrderDetail", to.params);
  };
  const markAll = async () => {
    setItems((cur) => cur.map((i) => ({ ...i, is_read: true })));
    await api("/notifications/inbox/read-all/", { method: "POST", body: {} }).catch(() => undefined);
    void refreshUnread();
  };
  const remove = async (id: number) => {
    setItems((cur) => cur.filter((i) => i.id !== id));
    await api(`/notifications/inbox/${id}/`, { method: "DELETE" }).catch(() => undefined);
    void refreshUnread();
  };

  return (
    <FlatList
      style={s.screen}
      contentContainerStyle={s.pad}
      data={items}
      keyExtractor={(i) => String(i.id)}
      refreshing={refreshing}
      onRefresh={() => { setRefreshing(true); void load(1); }}
      ListHeaderComponent={
        <View>
          {!!error && <ErrorRetry message={error} onRetry={() => void load(1)} />}
          {items.length > 0 && (
            <View style={[s.row, { marginBottom: 10 }]}>
              <Text style={[s.muted, { flex: 1 }]}>{t("notifications.unread", { n: unread })}</Text>
              {unread > 0 && <Pressable accessibilityRole="button" onPress={markAll} hitSlop={8}><Text style={{ color: color.teal, fontWeight: "700" }}>{t("notifications.markAll")}</Text></Pressable>}
            </View>
          )}
        </View>
      }
      ListEmptyComponent={loading ? <Busy /> : error ? undefined : <Text style={s.muted}>{t("notifications.empty")}</Text>}
      ListFooterComponent={more ? <View style={{ marginTop: 8 }}><Button title={t("notifications.more")} kind="quiet" onPress={() => void load(page + 1)} /></View> : undefined}
      renderItem={({ item }) => (
        <Pressable accessibilityRole="button" onPress={() => void open(item)} style={[s.card, s.cardPad, !item.is_read && { borderLeftWidth: 5, borderLeftColor: color.gold }]}>
          <Text style={{ fontWeight: item.is_read ? "600" : "800", color: color.ink, fontSize: 16 }}>{item.title}</Text>
          {!!item.body && <Text style={{ color: color.ink, marginTop: 2 }}>{item.body}</Text>}
          <View style={[s.row, { marginTop: 6 }]}>
            <Text style={[s.muted, { flex: 1, fontSize: 13 }]}>{new Date(item.created_at).toLocaleString()}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={t("notifications.delete")} hitSlop={10} onPress={() => void remove(item.id)}>
              <Text style={{ color: color.muted, fontWeight: "600" }}>{t("notifications.delete")}</Text>
            </Pressable>
          </View>
        </Pressable>
      )}
    />
  );
}
