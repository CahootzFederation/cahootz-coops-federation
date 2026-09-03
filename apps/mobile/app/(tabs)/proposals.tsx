import { useState } from 'react';
import { ScrollView, TouchableOpacity, View } from 'react-native';
import { CheckCircle2, CircleDollarSign, Clock, MessageCircle, PencilLine, Plus, Vote } from 'lucide-react-native';

import { Text } from '@/components/ui/text';

const PROPOSALS = [
  {
    id: '1',
    title: 'After-school food support',
    description: 'Coordinate families, stores, and volunteers so students have reliable food after school.',
    stage: 'Conversation',
    next: 'Find 3 helpers',
    funding: '$650 minimum',
    support: 18,
    comments: 9,
    color: '#15803D',
  },
  {
    id: '2',
    title: 'Shared repair fund',
    description: 'Pool small pledges for urgent home and storefront repairs before they become larger emergencies.',
    stage: 'Resource plan',
    next: 'Estimate costs',
    funding: '$2.4K pledged',
    support: 31,
    comments: 14,
    color: '#B45309',
  },
  {
    id: '3',
    title: 'Youth tech nights',
    description: 'Use donated space and member mentors to run weekly skill-building sessions for young people.',
    stage: 'Ready for vote',
    next: 'Open vote',
    funding: '$1.2K needed',
    support: 42,
    comments: 21,
    color: '#DC2626',
  },
];

const FILTERS = ['All', 'Conversation', 'Resource plan', 'Ready for vote'] as const;

export default function ProposalsScreen() {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('All');

  const filteredProposals =
    filter === 'All' ? PROPOSALS : PROPOSALS.filter((proposal) => proposal.stage === filter);

  return (
    <ScrollView className="flex-1 bg-stone-50" contentContainerStyle={{ paddingBottom: 32 }}>
      <View className="px-5 pt-14 pb-5" style={{ backgroundColor: '#12362D' }}>
        <View className="mb-5 h-11 w-11 items-center justify-center rounded-xl bg-white/15">
          <Vote size={24} color="#F9F7EF" />
        </View>
        <Text className="text-3xl font-black text-white">Turn conversations into decisions</Text>
        <Text className="mt-3 text-base leading-6 text-white/75">
          Vote when the question is clear. Before that, gather context, shape options, and understand the money.
        </Text>
      </View>

      <View className="px-5 py-5">
        <TouchableOpacity className="rounded-xl bg-red-600 p-4" activeOpacity={0.8}>
          <View className="flex-row items-center gap-3">
            <View className="h-10 w-10 items-center justify-center rounded-xl bg-white/20">
              <PencilLine size={20} color="white" />
            </View>
            <View className="flex-1">
              <Text className="font-black text-white">Submit from chat</Text>
              <Text className="mt-1 text-sm leading-5 text-white/80">
                Commons AI can draft the need, options, people, budget, and vote language.
              </Text>
            </View>
            <Plus size={20} color="white" />
          </View>
        </TouchableOpacity>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mt-5">
          <View className="flex-row gap-2">
            {FILTERS.map((item) => (
              <TouchableOpacity
                key={item}
                onPress={() => setFilter(item)}
                className={`rounded-full px-4 py-2 ${
                  filter === item ? 'bg-emerald-900' : 'border border-stone-200 bg-white'
                }`}
              >
                <Text className={`text-sm font-semibold ${filter === item ? 'text-white' : 'text-stone-700'}`}>
                  {item}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        <View className="mt-5 gap-3">
          {filteredProposals.map((proposal) => (
            <TouchableOpacity key={proposal.id} className="rounded-xl border border-stone-200 bg-white p-4" activeOpacity={0.75}>
              <View className="mb-3 flex-row items-start justify-between gap-3">
                <View className="flex-1">
                  <Text className="text-lg font-black text-gray-900">{proposal.title}</Text>
                  <Text className="mt-2 text-sm leading-5 text-gray-600">{proposal.description}</Text>
                </View>
                <View className="rounded-full px-3 py-1" style={{ backgroundColor: `${proposal.color}18` }}>
                  <Text className="text-xs font-bold" style={{ color: proposal.color }}>
                    {proposal.stage}
                  </Text>
                </View>
              </View>

              <View className="gap-2 rounded-xl bg-stone-50 p-3">
                <View className="flex-row items-center gap-2">
                  <CheckCircle2 size={16} color="#15803D" />
                  <Text className="text-sm text-gray-700">Next: {proposal.next}</Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <CircleDollarSign size={16} color="#B45309" />
                  <Text className="text-sm text-gray-700">{proposal.funding}</Text>
                </View>
              </View>

              <View className="mt-3 flex-row items-center justify-between">
                <View className="flex-row items-center gap-4">
                  <View className="flex-row items-center gap-1">
                    <Vote size={14} color="#78716C" />
                    <Text className="text-xs font-semibold text-stone-600">{proposal.support} support</Text>
                  </View>
                  <View className="flex-row items-center gap-1">
                    <MessageCircle size={14} color="#78716C" />
                    <Text className="text-xs font-semibold text-stone-600">{proposal.comments}</Text>
                  </View>
                </View>
                <View className="flex-row items-center gap-1">
                  <Clock size={14} color="#78716C" />
                  <Text className="text-xs font-semibold text-stone-600">Open</Text>
                </View>
              </View>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}
