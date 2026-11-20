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
import { parseTarget } from "./src/core/links";
import { Notifications } from "./src/push";
import { AlertsScreen, LoginScreen, MeScreen, PaymentsScreen } from "./src/screens";
import { ListScreen, MoreScreen, RecordScreen } from "./src/screens-more";
import { AdjustScreen, DashboardScreen, OrderScreen, OrdersScreen, ShipmentScreen, ShipmentsScreen, StockScreen } from "./src/screens-ops";
import { MenuPricesScreen, ProductScreen, ProductsScreen, ShippingRulesScreen } from "./src/screens-catalog";
import { EmailsScreen, ReconciliationRunScreen, ReconciliationScreen, ReportsScreen, SecurityScreen } from "./src/screens-money";
import { byKey } from "./src/core/resources";
import { color } from "./src/theme";

type TabParams = { Dashboard: undefined; Alerts: undefined; Orders: undefined; More: undefined };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RootParams = Record<string, any>;

const Tabs = createBottomTabNavigator<TabParams>();
const Root = createNativeStackNavigator<RootParams>();
const navRef = createNavigationContainerRef<RootParams>();
const header = { headerStyle: { backgroundColor: color.ink }, headerTintColor: "#fff", headerTitleStyle: { fontWeight: "800" as const } };

const noIcon = { tabBarIcon: () => null, tabBarIconStyle: { display: "none" as const } };

function TabsNav() {
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
  return (
    <Tabs.Navigator
      screenListeners={{ state: refresh }}
      screenOptions={{ ...header, tabBarActiveTintColor: color.teal, tabBarLabelStyle: { fontSize: 12, fontWeight: "700", marginBottom: 4 } }}
    >
      <Tabs.Screen name="Dashboard" component={DashboardScreen} options={{ ...noIcon }} />
      <Tabs.Screen name="Alerts" component={AlertsScreen} options={{ tabBarBadge: unread > 0 ? unread : undefined, ...noIcon }} />
      <Tabs.Screen name="Orders" component={OrdersScreen} options={{ ...noIcon }} />
      <Tabs.Screen name="More" component={MoreScreen} options={{ ...noIcon }} />
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
    else if (t.screen === "payments") navRef.navigate("Payments" as never);
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
        <Root.Screen name="List" component={ListScreen as never} options={({ route }) => ({ title: byKey((route.params as { res: string }).res)?.title ?? "List" })} />
        <Root.Screen name="Record" component={RecordScreen as never} options={({ route }) => ({ title: (route.params as { id: string }).id === "new" ? "New" : "Details" })} />
        <Root.Screen name="Shipments" component={ShipmentsScreen} />
        <Root.Screen name="Shipment" component={ShipmentScreen as never} options={{ title: "Shipment" }} />
        <Root.Screen name="ShippingRules" component={ShippingRulesScreen} options={{ title: "Shipping rules" }} />
        <Root.Screen name="Products" component={ProductsScreen} />
        <Root.Screen name="Product" component={ProductScreen as never} options={{ title: "Product" }} />
        <Root.Screen name="MenuPrices" component={MenuPricesScreen} options={{ title: "QT Eatery menu" }} />
        <Root.Screen name="Stock" component={StockScreen} />
        <Root.Screen name="Adjust" component={AdjustScreen as never} options={{ title: "Adjust stock" }} />
        <Root.Screen name="Reconciliation" component={ReconciliationScreen} />
        <Root.Screen name="ReconciliationRun" component={ReconciliationRunScreen as never} options={{ title: "Reconciliation run" }} />
        <Root.Screen name="Reports" component={ReportsScreen} />
        <Root.Screen name="Emails" component={EmailsScreen} />
        <Root.Screen name="Security" component={SecurityScreen} />
        <Root.Screen name="Payments" component={PaymentsScreen} options={{ title: "Manual payments" }} />
        <Root.Screen name="Me" component={MeScreen} options={{ title: "Alerts and sign-in" }} />
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
