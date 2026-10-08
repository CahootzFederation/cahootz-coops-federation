import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Switch, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { LoadError } from "@/components/load-error";
import { api } from "@/lib/api";
import { friendlyError } from "@/lib/friendly-error";

export default function CommonsResources() {
  const { coopId } = useLocalSearchParams<{ coopId: string }>();
  const { sessionToken } = useAuth();
  const client = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["commons-resources", coopId, sessionToken],
    queryFn: () => api.getCommonsResources(coopId, sessionToken!), enabled: !!coopId && !!sessionToken });
  const settings = useQuery({ queryKey: ["commons-resource-settings", coopId, sessionToken],
    queryFn: () => api.getResourceSettings(coopId, sessionToken!), enabled: !!coopId && !!sessionToken });
  const isSteward = !!settings.data?.isSteward;
  const pending = useQuery({ queryKey: ["commons-resources-pending", coopId, sessionToken],
    queryFn: () => api.getResourcesAwaitingReview(coopId, sessionToken!), enabled: !!coopId && !!sessionToken && isSteward });

  async function run(key: string, work: () => Promise<unknown>, fallback: string) {
    setBusy(key); setError("");
    try {
      await work();
      await Promise.all(["commons-resources", "commons-resource-settings", "commons-resources-pending"]
        .map((name) => client.invalidateQueries({ queryKey: [name, coopId] })));
    } catch (cause) {
      console.error(fallback, cause);
      setError(friendlyError(cause, fallback));
    } finally { setBusy(null); }
  }

  return <ScrollView style={{ flex: 1, backgroundColor: "#F6F7F8" }} contentContainerStyle={{ padding: 20, gap: 16 }}>
    <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text style={{ color: "#9A3412", fontWeight: "700" }}>← Back</Text></TouchableOpacity>
    <Text style={{ fontSize: 24, fontWeight: "800", color: "#111827" }}>Commons resources</Text>
    <Text style={{ color: "#475569" }}>Skills, services and things members have offered to each other.</Text>
    {!!error && <Text style={{ color: "#B91C1C" }}>{error}</Text>}

    {isSteward && settings.data && <View style={{ padding: 16, borderRadius: 12, backgroundColor: "white", borderWidth: 1, borderColor: "#E5E7EB", gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={{ color: "#111827", fontWeight: "800" }}>List member offers automatically</Text>
          <Text style={{ color: "#475569" }}>
            {settings.data.autoListResources
              ? "When a member accepts Sage's invitation, their offer is listed right away."
              : "Stewards review each offer before it's listed."}
          </Text>
        </View>
        <Switch
          accessibilityLabel="List member offers automatically"
          aria-checked={settings.data.autoListResources}
          value={settings.data.autoListResources}
          disabled={busy === "auto-list"}
          onValueChange={(enabled) => void run("auto-list", () => api.setResourceAutoList(coopId, enabled, sessionToken!), "We couldn't change this setting.")}
        />
      </View>
      {!!pending.data?.length && <View style={{ gap: 10 }}>
        <Text style={{ color: "#111827", fontWeight: "800" }}>Waiting for review</Text>
        {pending.data.map((item) => <View key={item.id} style={{ gap: 6, paddingTop: 10, borderTopWidth: 1, borderColor: "#F1F5F9" }}>
          <Text style={{ color: "#111827", fontWeight: "700" }}>{item.title}</Text>
          <Text style={{ color: "#475569" }}>{item.description}</Text>
          <View style={{ flexDirection: "row", gap: 12 }}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Approve ${item.title}`} disabled={busy === item.id}
              onPress={() => void run(item.id, () => api.reviewResource(item.id, true, sessionToken!), "We couldn't list this offer.")}
              style={{ backgroundColor: "#C2410C", padding: 10, borderRadius: 8 }}><Text style={{ color: "white", fontWeight: "700" }}>Approve</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Don't list ${item.title}`} disabled={busy === item.id}
              onPress={() => void run(item.id, () => api.reviewResource(item.id, false, sessionToken!), "We couldn't update this offer.")}
              style={{ backgroundColor: "#E5E7EB", padding: 10, borderRadius: 8 }}><Text style={{ color: "#111827", fontWeight: "700" }}>Don&apos;t list</Text></TouchableOpacity>
          </View>
        </View>)}
      </View>}
    </View>}

    {query.isLoading && <ActivityIndicator />}
    {query.isError && !query.data && (
      <LoadError
        message={friendlyError(query.error, "We couldn't load the resources.")}
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    )}
    {query.data?.length === 0 && <Text style={{ color: "#64748B" }}>Nothing listed yet.</Text>}
    {query.data?.map((resource) => <View key={resource.id} style={{ padding: 16, borderRadius: 12, backgroundColor: "white", borderWidth: 1, borderColor: "#E5E7EB", gap: 7 }}>
      <Text style={{ color: "#9A3412", fontWeight: "700", fontSize: 12 }}>{resource.kind}</Text>
      <Text style={{ color: "#111827", fontWeight: "800", fontSize: 17 }}>{resource.title}</Text>
      <Text style={{ color: "#475569", lineHeight: 22 }}>{resource.description}</Text>
    </View>)}
  </ScrollView>;
}
