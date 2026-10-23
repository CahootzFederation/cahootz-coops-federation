import { useEffect, useRef, useState } from 'react';
import { NativeScrollEvent, NativeSyntheticEvent, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { ArrowRight, HandHeart, Lightbulb, MessageCircle, UserCircle, Users } from 'lucide-react-native';

const INTRO_CAROUSEL_INTERVAL_MS = 4500;

const appIntroItems = [
  {
    title: 'Post on your community feeds',
    body: 'Introduce yourself, ask a question, share an idea, or tell people what you are working on.',
    visual: '💬',
    visualBg: '#EFF6FF',
    Icon: MessageCircle,
  },
  {
    title: 'Join commons',
    body: 'Commons are shared spaces where people with a real connection can post, ask for help, offer support, plan things, and build trust over time.',
    visual: '🤝',
    visualBg: '#F0FDF4',
    Icon: Users,
  },
  {
    title: 'Ask for help and offer help',
    body: 'People can share needs, skills, time, tools, advice, rides, space, or support.',
    visual: '🛠️',
    visualBg: '#FFF7ED',
    Icon: HandHeart,
  },
  {
    title: 'Turn good conversations into action',
    body: 'Start simple. A useful post can become a meetup, project, event, service, or local connection.',
    visual: '💡',
    visualBg: '#FEFCE8',
    Icon: Lightbulb,
  },
] as const;

export default function OnboardingWelcome({ onContinue }: { onContinue: () => void }) {
  const { width } = useWindowDimensions();
  const introCarouselRef = useRef<ScrollView>(null);
  const [introCarouselIndex, setIntroCarouselIndex] = useState(0);
  const introCardWidth = Math.max(width - 40, 280);

  useEffect(() => {
    const interval = setInterval(() => {
      setIntroCarouselIndex((currentIndex) => {
        const nextIndex = (currentIndex + 1) % appIntroItems.length;
        introCarouselRef.current?.scrollTo({ x: nextIndex * introCardWidth, animated: true });
        return nextIndex;
      });
    }, INTRO_CAROUSEL_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [introCardWidth]);

  const updateIntroCarouselIndex = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / introCardWidth);
    setIntroCarouselIndex(Math.min(Math.max(nextIndex, 0), appIntroItems.length - 1));
  };

  const goToIntroSlide = (index: number) => {
    introCarouselRef.current?.scrollTo({ x: index * introCardWidth, animated: true });
    setIntroCarouselIndex(index);
  };

    return (
      <SafeAreaView style={introStyles.screen}>
        <ScrollView style={introStyles.scroll} contentContainerStyle={introStyles.content}>
          <View style={introStyles.header}>
            <View style={introStyles.badge}>
              <UserCircle color="#FF6B00" size={18} strokeWidth={2.4} />
              <Text style={introStyles.badgeText}>Welcome to Cahootz</Text>
            </View>
            <Text style={introStyles.title}>A community app for everyday help and action</Text>
            <Text style={introStyles.subtitle}>
              Cahootz is a place to meet people, share what you need, offer what you can, and start real conversations.
            </Text>
          </View>

          <View style={introStyles.appIntro}>
            <ScrollView
              ref={introCarouselRef}
              horizontal
              pagingEnabled
              snapToInterval={introCardWidth}
              decelerationRate="fast"
              showsHorizontalScrollIndicator={false}
              onMomentumScrollEnd={updateIntroCarouselIndex}
              style={introStyles.carousel}
            >
              {appIntroItems.map(({ title, body, visual, visualBg, Icon }) => (
                <View key={title} style={[introStyles.carouselCard, { width: introCardWidth }]}>
                  <View style={[introStyles.carouselVisual, { backgroundColor: visualBg }]}>
                    <Text style={introStyles.carouselEmoji}>{visual}</Text>
                    <View style={introStyles.carouselIcon}>
                      <Icon color="#FF6B00" size={20} strokeWidth={2.5} />
                    </View>
                  </View>
                  <Text style={introStyles.carouselTitle}>{title}</Text>
                  <Text style={introStyles.carouselBody}>{body}</Text>
                </View>
              ))}
            </ScrollView>

            <View style={introStyles.carouselDots}>
              {appIntroItems.map((item, index) => {
                const active = introCarouselIndex === index;

                return (
                  <Pressable
                    key={item.title}
                    accessibilityRole="button"
                    accessibilityLabel={`Show ${item.title}`}
                    onPress={() => goToIntroSlide(index)}
                    style={[introStyles.carouselDot, active && introStyles.carouselDotActive]}
                  />
                );
              })}
            </View>
          </View>
        </ScrollView>

        <View style={introStyles.footer}>
          <Pressable
            accessibilityRole="button"
            onPress={onContinue}
            style={introStyles.submitButton}
          >
            <Text style={introStyles.submitText}>Continue</Text>
            <ArrowRight color="#FFFFFF" size={20} strokeWidth={2.6} />
          </Pressable>
        </View>
      </SafeAreaView>
    );
}

const introStyles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 12,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: '#F0F2F5',
    backgroundColor: '#FFFFFF',
  },
  header: {
    paddingTop: 8,
    paddingBottom: 18,
  },
  badge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    backgroundColor: '#FFF7ED',
    borderWidth: 1,
    borderColor: '#FED7AA',
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 18,
  },
  badgeText: {
    color: '#C2410C',
    fontSize: 13,
    fontWeight: '700',
  },
  title: {
    color: '#0F172A',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '900',
    letterSpacing: 0,
  },
  subtitle: {
    color: '#64748B',
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
  },
  appIntro: {
    marginBottom: 20,
  },
  carousel: {
    overflow: 'visible',
  },
  carouselCard: {
    minHeight: 300,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: '#F0F2F5',
    backgroundColor: '#FFFFFF',
    padding: 18,
    justifyContent: 'center',
  },
  carouselVisual: {
    height: 132,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    position: 'relative',
  },
  carouselEmoji: {
    fontSize: 60,
    lineHeight: 72,
  },
  carouselIcon: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#FED7AA',
  },
  carouselTitle: {
    color: '#0F172A',
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '900',
  },
  carouselBody: {
    color: '#64748B',
    fontSize: 15,
    lineHeight: 22,
    marginTop: 8,
  },
  carouselDots: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 14,
  },
  carouselDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#CBD5E1',
  },
  carouselDotActive: {
    width: 22,
    backgroundColor: '#FF6B00',
  },
  submitButton: {
    minHeight: 58,
    borderRadius: 16,
    backgroundColor: '#FF6B00',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  submitText: {
    color: '#FFFFFF',
    fontSize: 17,
    lineHeight: 22,
    fontWeight: '900',
  },
});
