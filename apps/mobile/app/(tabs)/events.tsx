import { useState } from "react";
import { View, ScrollView, RefreshControl, TouchableOpacity } from "react-native";
import { Calendar, Clock, MapPin, Users, Gift } from "lucide-react-native";

import { Text } from "@/components/ui/text";
import { useCoin } from "@/contexts/platform-config-context";

// Mock events data
const UPCOMING_EVENTS = [
  {
    id: '1',
    title: 'Community Town Hall',
    description: 'Monthly meeting to discuss proposals and community updates.',
    date: 'Feb 15, 2026',
    time: '6:00 PM',
    location: 'Community Center',
    attendees: 45,
    scReward: 10,
    category: 'Meeting',
  },
  {
    id: '2',
    title: 'Financial Literacy Workshop',
    description: 'Learn about budgeting, saving, and building wealth.',
    date: 'Feb 20, 2026',
    time: '2:00 PM',
    location: 'Library Hall',
    attendees: 28,
    scReward: 15,
    category: 'Education',
  },
  {
    id: '3',
    title: 'Small Business Showcase',
    description: 'Local entrepreneurs present their businesses to the community.',
    date: 'Feb 25, 2026',
    time: '10:00 AM',
    location: 'Main Street Plaza',
    attendees: 120,
    scReward: 5,
    category: 'Business',
  },
  {
    id: '4',
    title: 'Volunteer Day: Park Cleanup',
    description: 'Help beautify our community park.',
    date: 'Mar 1, 2026',
    time: '9:00 AM',
    location: 'Central Park',
    attendees: 35,
    scReward: 25,
    category: 'Volunteer',
  },
];

const CATEGORIES = [
  { id: 'all', name: 'All Events' },
  { id: 'meeting', name: 'Meetings' },
  { id: 'education', name: 'Education' },
  { id: 'volunteer', name: 'Volunteer' },
  { id: 'business', name: 'Business' },
];

export default function EventsScreen() {
  const coin = useCoin();
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState('all');

  const onRefresh = async () => {
    setRefreshing(true);
    // TODO: Fetch events
    setRefreshing(false);
  };

  const filteredEvents = selectedCategory === 'all'
    ? UPCOMING_EVENTS
    : UPCOMING_EVENTS.filter(e => e.category.toLowerCase() === selectedCategory);

  return (
    <ScrollView
      className="flex-1"
      style={{ backgroundColor: '#FFFBEB' }}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#B45309" />
      }
    >
      {/* Header */}
      <View className="px-4 pt-14 pb-4">
        <Text className="text-xl font-bold text-gray-800">Community Events</Text>
        <Text className="text-gray-500 text-sm">Join events and earn {coin.symbol} rewards</Text>
      </View>

      {/* Categories Filter */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        className="px-4 mb-4"
      >
        {CATEGORIES.map((category) => (
          <TouchableOpacity
            key={category.id}
            onPress={() => setSelectedCategory(category.id)}
            className={`mr-3 px-4 py-2 rounded-full ${
              selectedCategory === category.id
                ? 'bg-amber-600'
                : 'bg-white border border-amber-200'
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                selectedCategory === category.id ? 'text-white' : 'text-gray-700'
              }`}
            >
              {category.name}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Events List */}
      <View className="px-4">
        {filteredEvents.map((event) => (
          <TouchableOpacity
            key={event.id}
            className="bg-white rounded-2xl p-4 mb-3 border border-amber-100"
            activeOpacity={0.7}
          >
            {/* Header with Category Badge and SC Reward */}
            <View className="flex-row justify-between items-start mb-2">
              <View className="bg-amber-100 px-2 py-1 rounded-full">
                <Text className="text-xs text-amber-700 font-medium">{event.category}</Text>
              </View>
              <View className="flex-row items-center bg-green-100 px-2 py-1 rounded-full">
                <Gift size={12} color="#16A34A" />
                <Text className="text-xs text-green-700 font-medium ml-1">+{event.scReward} {coin.symbol}</Text>
              </View>
            </View>

            {/* Title & Description */}
            <Text className="text-base font-semibold text-gray-800 mb-1">{event.title}</Text>
            <Text className="text-sm text-gray-600 mb-3">{event.description}</Text>

            {/* Event Details */}
            <View className="flex-row flex-wrap gap-3 mb-3">
              <View className="flex-row items-center">
                <Calendar size={14} color="#9CA3AF" />
                <Text className="text-sm text-gray-500 ml-1">{event.date}</Text>
              </View>
              <View className="flex-row items-center">
                <Clock size={14} color="#9CA3AF" />
                <Text className="text-sm text-gray-500 ml-1">{event.time}</Text>
              </View>
            </View>

            <View className="flex-row items-center mb-3">
              <MapPin size={14} color="#9CA3AF" />
              <Text className="text-sm text-gray-500 ml-1">{event.location}</Text>
            </View>

            {/* Footer */}
            <View className="flex-row justify-between items-center pt-3 border-t border-gray-100">
              <View className="flex-row items-center">
                <Users size={14} color="#9CA3AF" />
                <Text className="text-sm text-gray-500 ml-1">{event.attendees} attending</Text>
              </View>
              <TouchableOpacity className="bg-amber-600 px-4 py-2 rounded-full">
                <Text className="text-white text-sm font-medium">RSVP</Text>
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        ))}
      </View>

      {/* Info Card */}
      <View className="mx-4 mt-4 mb-8 bg-amber-50 rounded-2xl p-4 border border-amber-200">
        <Text className="text-amber-800 font-semibold mb-2">Earn SC by Participating</Text>
        <Text className="text-amber-700 text-sm">
          Attend community events to earn Cahootz Coin rewards. The more you participate, the more you earn!
        </Text>
      </View>
    </ScrollView>
  );
}
