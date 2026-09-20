import React, { useState } from "react";
import { ActivityIndicator, ScrollView, Text, TextInput, TouchableOpacity, View } from "react-native";
import { router } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/auth-context";
import { api } from "@/lib/api";

export default function CommonsProposalDrafts() {
  const { sessionToken, user } = useAuth();
  const client = useQueryClient();
  const [edits, setEdits] = useState<Record<string, { title: string; body: string }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const query = useQuery({ queryKey: ["commons-proposal-drafts", sessionToken], queryFn: () => api.getCommonsProposalDrafts(sessionToken!), enabled: !!sessionToken });
  async function save(id: string, title: string, body: string) {
    if (!sessionToken) return;
    setBusy(id); setMessage("");
    try {
      await api.saveCommonsProposalDraft(id, title, body, sessionToken);
      await client.invalidateQueries({ queryKey: ["commons-proposal-drafts", sessionToken] });
      setMessage("Draft saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save draft."); }
    finally { setBusy(null); }
  }
  async function submit(id: string, title: string, body: string, coopId: string) {
    if (!user?.walletAddress || !sessionToken) { setMessage("Connect a wallet before submitting a proposal."); return; }
    setBusy(id); setMessage("");
    try {
      await api.saveCommonsProposalDraft(id, title, body, sessionToken);
      const proposal = await api.createProposal(`Proposal Title: ${title}\n\n${body}`, user.walletAddress, coopId);
      if (!proposal?.id) throw new Error("Proposal was created, but its receipt was unavailable. Check your proposals before trying again.");
      await api.markCommonsProposalDraftSubmitted(id, proposal.id, sessionToken);
      await client.invalidateQueries({ queryKey: ["commons-proposal-drafts", sessionToken] });
      setMessage("Proposal submitted for review.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not submit proposal."); }
    finally { setBusy(null); }
  }
  return <ScrollView style={{ flex: 1, backgroundColor: "#F6F7F8" }} contentContainerStyle={{ padding: 20, gap: 16 }}>
    <TouchableOpacity accessibilityRole="button" onPress={() => router.back()}><Text style={{ color: "#9A3412", fontWeight: "700" }}>← Back</Text></TouchableOpacity>
    <Text style={{ fontSize: 24, fontWeight: "800", color: "#111827" }}>Your proposal drafts</Text>
    <Text style={{ color: "#475569" }}>These are suggestions based on Commons discussions. Edit and submit only when they reflect what you want to propose.</Text>
    {!!message && <Text accessibilityRole="alert" style={{ color: "#9A3412" }}>{message}</Text>}
    {query.isLoading && <ActivityIndicator />}
    {query.data?.length === 0 && <Text style={{ color: "#64748B" }}>No drafts yet.</Text>}
    {query.data?.map((draft) => {
      const edit = edits[draft.id] ?? { title: draft.title, body: draft.body };
      return <View key={draft.id} style={{ backgroundColor: "white", borderWidth: 1, borderColor: "#E5E7EB", borderRadius: 12, padding: 16, gap: 10 }}>
        <Text style={{ color: "#64748B" }}>{draft.coopId}</Text>
        <TextInput accessibilityLabel="Proposal title" value={edit.title} onChangeText={(title) => setEdits((current) => ({ ...current, [draft.id]: { ...edit, title } }))} style={{ borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 8, padding: 10, color: "#111827" }} />
        <TextInput accessibilityLabel="Proposal body" multiline value={edit.body} onChangeText={(body) => setEdits((current) => ({ ...current, [draft.id]: { ...edit, body } }))} style={{ borderWidth: 1, borderColor: "#CBD5E1", borderRadius: 8, padding: 10, minHeight: 150, color: "#111827", textAlignVertical: "top" }} />
        <View style={{ flexDirection: "row", gap: 12 }}>
          <TouchableOpacity accessibilityRole="button" disabled={busy === draft.id} onPress={() => void save(draft.id, edit.title, edit.body)} style={{ padding: 12, borderRadius: 8, backgroundColor: "#E5E7EB" }}><Text style={{ fontWeight: "700" }}>Save</Text></TouchableOpacity>
          <TouchableOpacity accessibilityRole="button" disabled={busy === draft.id} onPress={() => void submit(draft.id, edit.title, edit.body, draft.coopId)} style={{ padding: 12, borderRadius: 8, backgroundColor: "#C2410C" }}><Text style={{ color: "white", fontWeight: "700" }}>Submit proposal</Text></TouchableOpacity>
        </View>
      </View>;
    })}
  </ScrollView>;
}
