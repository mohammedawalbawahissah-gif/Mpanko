import { NavigationContainer, useNavigationContainerRef, type LinkingOptions } from "@react-navigation/native";
import * as Linking from "expo-linking";
import { useEffect } from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Text, View } from "react-native";
import { AuthProvider, useAuth } from "./src/auth";
import { AccountScreen } from "./src/screens-account";
import { ProfileScreen } from "./src/screens-profile";
import { PrefsProvider, usePrefs } from "./src/prefs";
import { ErrorBoundary } from "./src/crash";
import { installGlobalErrorReporting, setCurrentScreen } from "./src/report";
import { FindOrderScreen, GuestCheckoutScreen, GuestOrderScreen } from "./src/screens-guest";
import { BagScreen, CheckoutScreen, OrderDetailScreen, OrdersScreen, type RootParams } from "./src/screens-buy";
import { MenuScreen } from "./src/screens-menu";
import { ProductScreen, ShopList, type RootTabs, type ShopStack } from "./src/screens-shop";
import { NotificationBell, NotificationsScreen } from "./src/screens-notifications";
import { refreshUnread } from "./src/inbox";
import { ReturnScreen, SupportListScreen, SupportNewScreen, SupportThreadScreen } from "./src/screens-help";
import { color } from "./src/theme";
import { KenteBand } from "./src/ui";
import { Notifications } from "./src/push";

const Tabs = createBottomTabNavigator<RootTabs>();
const Shop = createNativeStackNavigator<ShopStack>();
const Root = createNativeStackNavigator<RootParams>();

const header = { headerStyle: { backgroundColor: color.ink }, headerTintColor: "#fff", headerTitleStyle: { fontWeight: "800" as const } };

function ShopNav() {
  return (
    <Shop.Navigator screenOptions={{ ...header, headerRight: () => <NotificationBell /> }}>
      <Shop.Screen name="List" component={ShopList} options={{ title: "Mpanko" }} />
      <Shop.Screen name="Product" component={ProductScreen} options={{ title: "Mpanko" }} />
      <Shop.Screen name="Menu" component={MenuScreen} options={{ title: "Mpanko" }} />
    </Shop.Navigator>
  );
}

function TabLabel({ text, focused }: { text: string; focused: boolean }) {
  return <Text style={{ fontSize: 12, fontWeight: focused ? "800" : "500", color: focused ? color.teal : color.muted, marginBottom: 6 }}>{text}</Text>;
}

/** Small tab icons drawn from plain Views, so the app needs no icon font. Decorative: the label beside each is what is read aloud. */
function TabIcon({ name, tint }: { name: keyof RootTabs; tint: string }) {
  const line = { borderColor: tint, borderWidth: 2 } as const;
  const box = { width: 22, height: 22, alignItems: "center" as const, justifyContent: "center" as const };
  if (name === "Shop")
    return (
      <View style={box} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={{ width: 20, height: 9, borderTopLeftRadius: 4, borderTopRightRadius: 4, backgroundColor: tint }} />
        <View style={[{ width: 16, height: 10, borderTopWidth: 0 }, line]} />
      </View>
    );
  if (name === "Bag")
    return (
      <View style={box} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={[{ width: 9, height: 7, borderBottomWidth: 0, borderTopLeftRadius: 5, borderTopRightRadius: 5, marginBottom: -1 }, line]} />
        <View style={{ width: 20, height: 13, borderRadius: 3, backgroundColor: tint }} />
      </View>
    );
  if (name === "Orders")
    return (
      <View style={box} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
        <View style={[{ width: 17, height: 20, borderRadius: 3, justifyContent: "space-evenly", paddingHorizontal: 3 }, line]}>
          <View style={{ height: 2, backgroundColor: tint }} />
          <View style={{ height: 2, backgroundColor: tint }} />
          <View style={{ height: 2, backgroundColor: tint }} />
        </View>
      </View>
    );
  return (
    <View style={box} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
      <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: tint }} />
      <View style={{ width: 19, height: 9, borderTopLeftRadius: 10, borderTopRightRadius: 10, backgroundColor: tint, marginTop: 2 }} />
    </View>
  );
}

function TabsNav() {
  const { cart, user, guestLines } = useAuth();
  const { t } = usePrefs();
  const count = user ? cart.reduce((n, i) => n + i.quantity, 0) : guestLines.reduce((n, l) => n + l.quantity, 0);
  return (
    <Tabs.Navigator screenOptions={({ route }) => ({ ...header, tabBarActiveTintColor: color.teal, tabBarInactiveTintColor: color.muted, headerRight: () => <NotificationBell />, headerBackground: () => (<View style={{ flex: 1, backgroundColor: color.ink, justifyContent: "flex-end" }}><KenteBand /></View>), tabBarIcon: ({ color: tint }) => <TabIcon name={route.name} tint={tint} /> })}>
      <Tabs.Screen name="Shop" component={ShopNav} options={{ headerShown: false, tabBarLabel: ({ focused }) => <TabLabel text={t("tab.shop")} focused={focused} /> }} />
      <Tabs.Screen name="Bag" component={BagScreen} options={{ title: t("tab.bag"), tabBarBadge: count > 0 ? count : undefined, tabBarLabel: ({ focused }) => <TabLabel text={t("tab.bag")} focused={focused} /> }} />
      <Tabs.Screen name="Orders" component={OrdersScreen} options={{ title: t("tab.orders"), tabBarLabel: ({ focused }) => <TabLabel text={t("tab.orders")} focused={focused} /> }} />
      <Tabs.Screen name="Account" component={AccountScreen} options={{ title: t("tab.account"), tabBarLabel: ({ focused }) => <TabLabel text={t("tab.account")} focused={focused} /> }} />
    </Tabs.Navigator>
  );
}

const prefix = Linking.createURL("/");
/** mpanko://orders/MP-1001, mpanko://support/SC-1A2B3C, mpanko://shop/kente-scarf, and the same paths on the shop's web address. */
const linking: LinkingOptions<RootParams> = {
  prefixes: [prefix, "mpanko://", ...(process.env.EXPO_PUBLIC_WEB_URL ? [process.env.EXPO_PUBLIC_WEB_URL] : [])],
  config: {
    screens: {
      Profile: "profile",
      Notifications: "notifications",
      Tabs: { screens: { Orders: "orders", Bag: "bag", Account: "account", Shop: { screens: { Product: "shop/:slug", Menu: "menu/:slug", List: "shop" } } } },
      GuestOrder: "orders/guest/:number",
      FindOrder: "orders/find",
      OrderDetail: "orders/:number",
      Return: "orders/:number/return",
      SupportList: "support",
      SupportThread: "support/:number",
      Checkout: "checkout",
    },
  },
};

/** Tapping a push notification opens the screen named in its link. */
function useOpenFromNotification() {
  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const url = (r.notification.request.content.data as { url?: string } | undefined)?.url;
      if (url) Linking.openURL(url);
    });
    const received = Notifications.addNotificationReceivedListener(() => void refreshUnread());
    return () => {
      sub.remove();
      received.remove();
    };
  }, []);
}

installGlobalErrorReporting();

function RootNav() {
  const { t } = usePrefs();
  return (
    <Root.Navigator screenOptions={header}>
      <Root.Screen name="Tabs" component={TabsNav} options={{ headerShown: false }} />
      <Root.Screen name="Checkout" component={CheckoutScreen} options={{ title: t("checkout.title") }} />
      <Root.Screen name="GuestCheckout" component={GuestCheckoutScreen} options={{ title: t("checkout.title") }} />
      <Root.Screen name="GuestOrder" component={GuestOrderScreen} options={{ title: t("orders.order") }} />
      <Root.Screen name="FindOrder" component={FindOrderScreen} options={{ title: t("guest.find") }} />
      <Root.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: t("orders.order") }} />
      <Root.Screen name="Return" component={ReturnScreen} options={{ title: t("m.returnItems") }} />
      <Root.Screen name="Notifications" component={NotificationsScreen} options={{ title: t("notifications.title") }} />
      <Root.Screen name="Profile" component={ProfileScreen} options={{ title: t("prefs.title") }} />
      <Root.Screen name="SupportList" component={SupportListScreen} options={{ title: t("m.helpSupport") }} />
      <Root.Screen name="SupportNew" component={SupportNewScreen} options={{ title: t("m.askUs") }} />
      <Root.Screen name="SupportThread" component={SupportThreadScreen} options={{ title: t("m.request") }} />
    </Root.Navigator>
  );
}

export default function App() {
  useOpenFromNotification();
  const navRef = useNavigationContainerRef<RootParams>();
  return (
    <ErrorBoundary>
    <SafeAreaProvider>
      <PrefsProvider>
      <AuthProvider>
        <NavigationContainer ref={navRef} linking={linking} onStateChange={() => setCurrentScreen(navRef.getCurrentRoute()?.name ?? "")}>
          <StatusBar style="light" />
          <RootNav />
        </NavigationContainer>
      </AuthProvider>
      </PrefsProvider>
    </SafeAreaProvider>
    </ErrorBoundary>
  );
}
