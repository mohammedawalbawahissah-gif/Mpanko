import { Component, type ErrorInfo, type ReactNode } from "react";
import { Text, View } from "react-native";
import { reportError } from "./report";
import { color } from "./theme";
import { Button, s } from "./ui";

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, info.componentStack ?? "");
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={[s.screen, s.pad, { justifyContent: "center" }]} accessibilityRole="alert">
        <Text style={s.h1}>Something went wrong</Text>
        <Text style={{ color: color.ink, marginBottom: 16 }}>We have been told about it. Try again; your bag is saved.</Text>
        <Button title="Try again" onPress={() => this.setState({ failed: false })} />
      </View>
    );
  }
}
