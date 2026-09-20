import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/lib/api";

export default function ResourceInvitations() {
  const { sessionToken } = useAuth();
  const client = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const query = useQuery({
    queryKey: ["resource-invitations", sessionToken],
    queryFn: () => api.getResourceInvitations(sessionToken!),
    enabled: !!sessionToken,
  });

  async function respond(resourceId: string, accept: boolean) {
    if (!sessionToken) return;
    setBusyId(resourceId); setError("");
    try {
      await api.respondToResourceInvitation(resourceId, accept, sessionToken);
      await client.invalidateQueries({ queryKey: ["resource-invitations", sessionToken] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not respond."); }
    finally { setBusyId(null); }
  }

  return <ScrollView style={{ flex: 1, backgroundColor: "#F6F7F8" }} contentContainerStyle={{ padding: 20, gap: 16 }}>
    <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text style={{ color: "#9A3412", fontWeight: "700" }}>← Back</Text></TouchableOpacity>
    <Text style={{ fontSize: 24, fontWeight: "800", color: "#111827" }}>Resource invitations</Text>
    <Text style={{ color: "#475569" }}>Accepting lets a platform admin review your listing before it appears in the Commons resource catalog.</Text>
    {!!error && <Text style={{ color: "#B91C1C" }}>{error}</Text>}
    {query.isLoading && <ActivityIndicator />}
    {query.isError && <Text style={{ color: "#B91C1C" }}>Could not load invitations.</Text>}
    {query.data?.length === 0 && <Text style={{ color: "#64748B" }}>No pending invitations.</Text>}
    {query.data?.map((item) => <View key={item.id} style={{ backgroundColor: "white", borderRadius: 12, padding: 16, gap: 10, borderWidth: 1, borderColor: "#E5E7EB" }}>
      <Text style={{ fontSize: 17, fontWeight: "700", color: "#111827" }}>{item.title}</Text>
      <Text style={{ color: "#475569" }}>{item.description}</Text>
      <Text style={{ color: "#64748B" }}>{item.coopId}</Text>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <TouchableOpacity accessibilityRole="button" disabled={busyId === item.id} onPress={() => void respond(item.id, true)} style={{ backgroundColor: "#C2410C", padding: 12, borderRadius: 8 }}><Text style={{ color: "white", fontWeight: "700" }}>Accept</Text></TouchableOpacity>
        <TouchableOpacity accessibilityRole="button" disabled={busyId === item.id} onPress={() => void respond(item.id, false)} style={{ backgroundColor: "#E5E7EB", padding: 12, borderRadius: 8 }}><Text style={{ color: "#111827", fontWeight: "700" }}>Decline</Text></TouchableOpacity>
      </View>
    </View>)}
  </ScrollView>;
}
