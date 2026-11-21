import { Component, type ReactNode } from "react";
import { Text, View } from "react-native";
import { color } from "./theme";
import { Button, s } from "./ui";

/** Shows a plain message and a Try again button if a screen crashes, instead of closing the app. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={{ flex: 1, padding: 20, justifyContent: "center", backgroundColor: color.paper }} accessibilityRole="alert">
        <Text accessibilityRole="header" style={s.h1}>Something went wrong</Text>
        <Text style={{ color: color.ink, marginBottom: 16 }}>This screen hit a problem. Try again. Nothing you saved has been lost.</Text>
        <Button title="Try again" onPress={() => this.setState({ failed: false })} />
      </View>
    );
  }
}
