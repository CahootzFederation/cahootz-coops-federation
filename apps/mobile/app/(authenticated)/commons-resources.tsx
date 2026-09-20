import React from "react";
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/lib/api";

export default function CommonsResources() {
  const { coopId } = useLocalSearchParams<{ coopId: string }>();
  const { sessionToken } = useAuth();
  const query = useQuery({ queryKey: ["commons-resources", coopId, sessionToken],
    queryFn: () => api.getCommonsResources(coopId, sessionToken!), enabled: !!coopId && !!sessionToken });
  return <ScrollView style={{ flex: 1, backgroundColor: "#F6F7F8" }} contentContainerStyle={{ padding: 20, gap: 16 }}>
    <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text style={{ color: "#9A3412", fontWeight: "700" }}>← Back</Text></TouchableOpacity>
    <Text style={{ fontSize: 24, fontWeight: "800", color: "#111827" }}>Commons resources</Text>
    <Text style={{ color: "#475569" }}>Verified resources shared with {coopId} members.</Text>
    {query.isLoading && <ActivityIndicator />}
    {query.isError && <Text style={{ color: "#B91C1C" }}>Could not load resources.</Text>}
    {query.data?.length === 0 && <Text style={{ color: "#64748B" }}>No verified resources yet.</Text>}
    {query.data?.map((resource) => <View key={resource.id} style={{ padding: 16, borderRadius: 12, backgroundColor: "white", borderWidth: 1, borderColor: "#E5E7EB", gap: 7 }}>
      <Text style={{ color: "#9A3412", fontWeight: "700", fontSize: 12 }}>{resource.kind}</Text>
      <Text style={{ color: "#111827", fontWeight: "800", fontSize: 17 }}>{resource.title}</Text>
      <Text style={{ color: "#475569", lineHeight: 22 }}>{resource.description}</Text>
    </View>)}
  </ScrollView>;
}
