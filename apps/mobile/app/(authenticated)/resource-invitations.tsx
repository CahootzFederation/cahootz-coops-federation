import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { LoadError } from "@/components/load-error";
import { api } from "@/lib/api";
import { friendlyError } from "@/lib/friendly-error";

// Offers that can also be run as a shop. Information and space listings stay catalog-only.
const SHOP_KINDS = new Set(["SERVICE", "SKILL", "PERSON", "EQUIPMENT", "ORGANIZATION"]);

export default function ResourceInvitations() {
  const { sessionToken } = useAuth();
  const client = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const query = useQuery({
    queryKey: ["resource-invitations", sessionToken],
    queryFn: () => api.getResourceInvitations(sessionToken!),
    enabled: !!sessionToken,
  });

  async function respond(item: { id: string; coopName: string }, accept: boolean) {
    if (!sessionToken) return;
    setBusyId(item.id); setError(""); setResult("");
    try {
      const response = await api.respondToResourceInvitation(item.id, accept, sessionToken);
      if (accept) setResult(response.listed
        ? `Listed in ${item.coopName}. Members can find it under Commons resources.`
        : `Sent to the stewards of ${item.coopName}. It will be listed once they approve it.`);
      await client.invalidateQueries({ queryKey: ["resource-invitations", sessionToken] });
    } catch (cause) {
      console.error("Failed to respond to resource invitation:", cause);
      setError(friendlyError(cause, accept ? "We couldn't list your offer." : "We couldn't dismiss this."));
    }
    finally { setBusyId(null); }
  }

  return <ScrollView style={{ flex: 1, backgroundColor: "#F6F7F8" }} contentContainerStyle={{ padding: 20, gap: 16 }}>
    <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text style={{ color: "#9A3412", fontWeight: "700" }}>← Back</Text></TouchableOpacity>
    <Text style={{ fontSize: 24, fontWeight: "800", color: "#111827" }}>Your offers</Text>
    <Text style={{ color: "#475569" }}>Sage noticed you offered something members could use. List it so people can find it, open a shop to take orders and payments, or both.</Text>
    {!!error && <Text style={{ color: "#B91C1C" }}>{error}</Text>}
    {!!result && <Text style={{ color: "#166534", fontWeight: "700" }}>{result}</Text>}
    {query.isLoading && <ActivityIndicator />}
    {query.isError && !query.data && (
      <LoadError
        message={friendlyError(query.error, "We couldn't load your offers.")}
        retrying={query.isFetching}
        onRetry={() => void query.refetch()}
      />
    )}
    {query.data?.length === 0 && !result && <Text style={{ color: "#64748B" }}>You have no offers to review right now.</Text>}
    {query.data?.map((item) => <View key={item.id} style={{ backgroundColor: "white", borderRadius: 12, padding: 16, gap: 10, borderWidth: 1, borderColor: "#E5E7EB" }}>
      <Text style={{ color: "#64748B", fontWeight: "700", fontSize: 12 }}>{item.coopName}</Text>
      <Text style={{ fontSize: 17, fontWeight: "700", color: "#111827" }}>{item.title}</Text>
      <Text style={{ color: "#475569" }}>{item.description}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`List ${item.title}`} disabled={busyId === item.id} onPress={() => void respond(item, true)} style={{ backgroundColor: "#C2410C", padding: 12, borderRadius: 8 }}><Text style={{ color: "white", fontWeight: "700" }}>List it for members</Text></TouchableOpacity>
        {SHOP_KINDS.has(item.kind) && <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open a shop for ${item.title}`} disabled={busyId === item.id}
          onPress={() => router.push({ pathname: "/(authenticated)/apply-store", params: { coopId: item.coopId, name: item.title, description: item.description } })}
          style={{ backgroundColor: "#111827", padding: 12, borderRadius: 8 }}><Text style={{ color: "white", fontWeight: "700" }}>Open a shop</Text></TouchableOpacity>}
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Not now for ${item.title}`} disabled={busyId === item.id} onPress={() => void respond(item, false)} style={{ backgroundColor: "#E5E7EB", padding: 12, borderRadius: 8 }}><Text style={{ color: "#111827", fontWeight: "700" }}>Not now</Text></TouchableOpacity>
      </View>
    </View>)}
  </ScrollView>;
}
