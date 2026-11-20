import { createNavigationContainerRef, NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import * as Linking from "expo-linking";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { api } from "./src/api";
import { AuthProvider, useAuth } from "./src/auth";
import { PAYMENT_ROLES } from "./src/core/format";
import { parseTarget } from "./src/core/links";
import { Notifications } from "./src/push";
import { AlertsScreen, LoginScreen, MeScreen, OrderScreen, OrdersScreen, PaymentsScreen } from "./src/screens";
import { color } from "./src/theme";

type TabParams = { Alerts: undefined; Orders: undefined; Payments: undefined; Me: undefined };
type RootParams = { Tabs: undefined; Order: { number: string } };

const Tabs = createBottomTabNavigator<TabParams>();
const Root = createNativeStackNavigator<RootParams>();
const navRef = createNavigationContainerRef<RootParams>();
const header = { headerStyle: { backgroundColor: color.ink }, headerTintColor: "#fff", headerTitleStyle: { fontWeight: "800" as const } };

function TabsNav() {
  const { user } = useAuth();
  const [unread, setUnread] = useState(0);
  const refresh = useCallback(() => {
    api<{ count: number }>("/notifications/inbox/unread-count/").then((r) => setUnread(r.count)).catch(() => undefined);
  }, []);
  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, 60000);
    const sub = Notifications.addNotificationReceivedListener(refresh);
    return () => { clearInterval(timer); sub.remove(); };
  }, [refresh]);
  const canSeePayments = !!user && PAYMENT_ROLES.includes(user.role);
  return (
    <Tabs.Navigator
      screenListeners={{ state: refresh }}
      screenOptions={{ ...header, tabBarActiveTintColor: color.teal, tabBarLabelStyle: { fontSize: 12, fontWeight: "700", marginBottom: 4 } }}
    >
      <Tabs.Screen name="Alerts" component={AlertsScreen} options={{ tabBarBadge: unread > 0 ? unread : undefined, tabBarIcon: () => null, tabBarIconStyle: { display: "none" } }} />
      <Tabs.Screen name="Orders" component={OrdersScreen} options={{ tabBarIcon: () => null, tabBarIconStyle: { display: "none" } }} />
      {canSeePayments ? <Tabs.Screen name="Payments" component={PaymentsScreen} options={{ title: "Payments", tabBarIcon: () => null, tabBarIconStyle: { display: "none" } }} /> : null}
      <Tabs.Screen name="Me" component={MeScreen} options={{ tabBarIcon: () => null, tabBarIconStyle: { display: "none" } }} />
    </Tabs.Navigator>
  );
}

function Gate() {
  const { user, ready } = useAuth();
  const [navReady, setNavReady] = useState(false);
  const pending = useRef<string | null>(null);

  const open = useCallback((url: string | null | undefined) => {
    const t = parseTarget(url);
    if (!navRef.isReady()) { pending.current = url ?? null; return; }
    if (t.screen === "order" && t.ref) navRef.navigate("Order", { number: t.ref });
    else if (t.screen === "orders") navRef.navigate("Tabs", { screen: "Orders" } as never);
    else if (t.screen === "payments") navRef.navigate("Tabs", { screen: "Payments" } as never);
    else navRef.navigate("Tabs", { screen: "Alerts" } as never);
  }, []);

  useEffect(() => {
    const fromNotification = Notifications.addNotificationResponseReceivedListener((r) => open(String(r.notification.request.content.data?.url ?? "")));
    const fromLink = Linking.addEventListener("url", (e) => open(e.url));
    Notifications.getLastNotificationResponseAsync().then((r) => { if (r) pending.current = String(r.notification.request.content.data?.url ?? ""); }).catch(() => undefined);
    return () => { fromNotification.remove(); fromLink.remove(); };
  }, [open]);

  useEffect(() => {
    if (user && navReady && pending.current !== null) {
      const url = pending.current;
      pending.current = null;
      open(url);
    }
  }, [user, navReady, open]);

  if (!ready) return <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}><ActivityIndicator accessibilityLabel="Loading" color={color.teal} /></View>;
  if (!user) return <LoginScreen />;
  return (
    <NavigationContainer ref={navRef} onReady={() => setNavReady(true)}>
      <Root.Navigator screenOptions={header}>
        <Root.Screen name="Tabs" component={TabsNav} options={{ title: "Mpanko Admin" }} />
        <Root.Screen name="Order" component={OrderScreen as never} options={({ route }) => ({ title: `Order ${(route.params as { number: string }).number}` })} />
      </Root.Navigator>
    </NavigationContainer>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </SafeAreaProvider>
  );
}
