import { ScrollView, View } from "react-native";
import { Text } from "./text";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";
import { api } from "./api";
import { usePrefs } from "./prefs";
import { color } from "./theme";
import { Busy, ErrorRetry, Notice, s, useAsync, readable } from "./ui";
import type { RootParams } from "./screens-buy";

interface LegalPage { slug: string; title: string; body: string; version: number; updated_at: string | null; is_draft: boolean }

/** Plain text with "# heading" lines and blank-line paragraphs, as the store writes it. Shown as text, never as HTML. */
export function blocks(body: string): { heading?: string; text: string }[] {
  return body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).map((b) => {
    if (!b.startsWith("# ")) return { text: b };
    const [head, ...rest] = b.split("\n");
    return { heading: head.replace(/^#\s+/, ""), text: rest.join("\n").trim() };
  });
}

export function LegalScreen({ route }: NativeStackScreenProps<RootParams, "Legal">) {
  const { t } = usePrefs();
  const { slug } = route.params;
  const page = useAsync(() => api<LegalPage>(`/pages/${slug}/`), [slug]);
  if (page.loading) return <View style={s.screen}><Busy /></View>;
  if (page.error || !page.data) return <View style={[s.screen, s.pad]}><ErrorRetry message={t("m.legalMissing")} onRetry={page.reload} /></View>;
  const d = page.data;
  return (
    <ScrollView style={s.screen} contentContainerStyle={[{ padding: 16, paddingBottom: 32 }, readable]}>
      <Text accessibilityRole="header" style={s.h1}>{d.title}</Text>
      {d.is_draft && <Notice kind="info">{t("m.legalDraft")}</Notice>}
      {d.updated_at && <Text style={[s.muted, { marginBottom: 12 }]}>{t("m.legalUpdated", { date: new Date(d.updated_at).toLocaleDateString() })}</Text>}
      {blocks(d.body).map((b, i) => (
        <View key={i} style={{ marginBottom: 12 }}>
          {b.heading && <Text accessibilityRole="header" style={[s.h2, { color: color.ink }]}>{b.heading}</Text>}
          {!!b.text && <Text style={{ color: color.ink, lineHeight: 22 }}>{b.text}</Text>}
        </View>
      ))}
    </ScrollView>
  );
}
