import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { Text } from "react-native";
import { AuthProvider, useAuth } from "./src/auth";
import { AccountScreen } from "./src/screens-account";
import { BagScreen, CheckoutScreen, OrderDetailScreen, OrdersScreen, type RootParams } from "./src/screens-buy";
import { ProductScreen, ShopList, type RootTabs, type ShopStack } from "./src/screens-shop";
import { color } from "./src/theme";

const Tabs = createBottomTabNavigator<RootTabs>();
const Shop = createNativeStackNavigator<ShopStack>();
const Root = createNativeStackNavigator<RootParams>();

const header = { headerStyle: { backgroundColor: color.ink }, headerTintColor: "#fff", headerTitleStyle: { fontWeight: "800" as const } };

function ShopNav() {
  return (
    <Shop.Navigator screenOptions={header}>
      <Shop.Screen name="List" component={ShopList} options={{ title: "Mpanko" }} />
      <Shop.Screen name="Product" component={ProductScreen} options={{ title: "" }} />
    </Shop.Navigator>
  );
}

function TabLabel({ text, focused }: { text: string; focused: boolean }) {
  return <Text style={{ fontSize: 12, fontWeight: focused ? "800" : "500", color: focused ? color.indigo : color.muted, marginBottom: 6 }}>{text}</Text>;
}

function TabsNav() {
  const { cart } = useAuth();
  const count = cart.reduce((n, i) => n + i.quantity, 0);
  return (
    <Tabs.Navigator screenOptions={{ ...header, tabBarIcon: () => null, tabBarActiveTintColor: color.indigo }}>
      <Tabs.Screen name="Shop" component={ShopNav} options={{ headerShown: false, tabBarLabel: ({ focused }) => <TabLabel text="Shop" focused={focused} /> }} />
      <Tabs.Screen name="Bag" component={BagScreen} options={{ title: "Bag", tabBarBadge: count > 0 ? count : undefined, tabBarLabel: ({ focused }) => <TabLabel text="Bag" focused={focused} /> }} />
      <Tabs.Screen name="Orders" component={OrdersScreen} options={{ tabBarLabel: ({ focused }) => <TabLabel text="Orders" focused={focused} /> }} />
      <Tabs.Screen name="Account" component={AccountScreen} options={{ tabBarLabel: ({ focused }) => <TabLabel text="Account" focused={focused} /> }} />
    </Tabs.Navigator>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <NavigationContainer>
          <StatusBar style="light" />
          <Root.Navigator screenOptions={header}>
            <Root.Screen name="Tabs" component={TabsNav} options={{ headerShown: false }} />
            <Root.Screen name="Checkout" component={CheckoutScreen} options={{ title: "Checkout" }} />
            <Root.Screen name="OrderDetail" component={OrderDetailScreen} options={{ title: "Order" }} />
          </Root.Navigator>
        </NavigationContainer>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
