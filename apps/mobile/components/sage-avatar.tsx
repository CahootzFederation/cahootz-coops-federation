import { useId, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useReducedMotion } from 'react-native-reanimated';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Stop } from 'react-native-svg';

/**
 * How Sage's face moves:
 * - `still` (default): no animation. Use it in lists and small spots
 *   (feed, search, @mentions) so a screen full of Sage never wiggles at once.
 * - `blink`: blinks now and then. Use it where Sage is the focus
 *   (an open Sage chat, Sage's page, the Sage screens, a Sage alert).
 * - `thinking`: a gentle pulse with three dots, while Sage writes a reply.
 *
 * The animations are Reanimated keyframes, so they run on the UI thread and
 * only touch transform and opacity. The phone's Reduce Motion setting turns
 * them all off.
 */
export type SageAvatarMotion = 'still' | 'blink' | 'thinking';

// Blob, cheeks, glasses and mouth; the eyes are a separate layer so they can
// blink. Kept in sync with assets/images/sage/sage.svg.
function SageBody({ size }: { size: number }) {
  // Each avatar needs its own gradient id: on web every SVG shares one page,
  // and a duplicate id resolves to the first avatar, which may be hidden.
  const gradientId = `sageBlob${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FED7AA" />
          <Stop offset="1" stopColor="#FB923C" />
        </LinearGradient>
      </Defs>
      <Path d="M48 12 C72 8 92 26 90 50 C88 76 70 92 46 90 C22 88 8 70 10 46 C12 26 26 14 48 12 Z" fill={`url(#${gradientId})`} />
      <Ellipse cx="34" cy="28" rx="10" ry="6" fill="#FFFFFF" opacity={0.4} transform="rotate(-25 34 28)" />
      <Ellipse cx="28" cy="62" rx="6" ry="4" fill="#F472B6" opacity={0.55} />
      <Ellipse cx="72" cy="62" rx="6" ry="4" fill="#F472B6" opacity={0.55} />
      <G fill="#FFFFFF" fillOpacity={0.55} stroke="#7C2D12" strokeWidth={3}>
        <Circle cx="38" cy="50" r="10" />
        <Circle cx="62" cy="50" r="10" />
      </G>
      <Path d="M48 49 Q50 47 52 49" stroke="#7C2D12" strokeWidth={3} fill="none" />
      <Path d="M42 68 Q50 75 58 68" stroke="#1F2937" strokeWidth={3} fill="none" strokeLinecap="round" />
    </Svg>
  );
}

// The eyes sit on the vertical middle of the drawing (y = 50), so squashing
// this full-size layer around its center closes them in place.
function SageEyes({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Circle cx="38" cy="50" r="5.2" fill="#1F2937" />
      <Circle cx="62" cy="50" r="5.2" fill="#1F2937" />
      <Circle cx="39.8" cy="48" r="1.8" fill="#FFFFFF" />
      <Circle cx="63.8" cy="48" r="1.8" fill="#FFFFFF" />
    </Svg>
  );
}

const PULSE = { '50%': { transform: [{ scale: 1.05 }] } };
const DOT = { '0%': { opacity: 0.25 }, '50%': { opacity: 1 }, '100%': { opacity: 0.25 } };

export function SageAvatar({ size = 40, motion = 'still' }: { size?: number; motion?: SageAvatarMotion }) {
  const reduceMotion = useReducedMotion();
  const active = reduceMotion ? 'still' : motion;

  // Each blinking avatar gets its own rhythm (one blink every 5-9s), so two
  // on screen never blink in lockstep.
  const blink = useMemo(() => {
    const duration = 5000 + Math.round(Math.random() * 4000);
    const closeAt = 100 - (180 / duration) * 100;
    return {
      animationName: {
        [`${closeAt.toFixed(2)}%`]: { transform: [{ scaleY: 1 }] },
        [`${(closeAt + (100 - closeAt) / 2).toFixed(2)}%`]: { transform: [{ scaleY: 0.1 }] },
        '100%': { transform: [{ scaleY: 1 }] },
      },
      animationDuration: `${duration}ms` as const,
      animationIterationCount: 'infinite' as const,
    };
  }, []);

  const dot = Math.max(3, Math.round(size * 0.08));

  return (
    <Animated.View
      accessible
      accessibilityLabel={active === 'thinking' ? 'Sage is writing a reply' : 'Sage, the AI helper'}
      testID="sage-avatar"
      style={[
        { width: size, height: size },
        active === 'thinking'
          ? {
              animationName: PULSE,
              animationDuration: '1600ms',
              animationIterationCount: 'infinite',
              animationTimingFunction: 'ease-in-out',
            }
          : null,
      ]}
    >
      <SageBody size={size} />
      <Animated.View
        pointerEvents="none"
        style={[StyleSheet.absoluteFill, active === 'blink' ? blink : null]}
      >
        <SageEyes size={size} />
      </Animated.View>
      {active === 'thinking' ? (
        <View
          pointerEvents="none"
          testID="sage-avatar-thinking"
          style={{ position: 'absolute', top: size * 0.02, right: -dot, flexDirection: 'row', gap: dot * 0.5 }}
        >
          {[0, 200, 400].map((delay) => (
            <Animated.View
              key={delay}
              style={{
                width: dot,
                height: dot,
                borderRadius: dot / 2,
                backgroundColor: '#7C2D12',
                animationName: DOT,
                animationDuration: '1200ms',
                animationDelay: `${delay}ms`,
                animationIterationCount: 'infinite',
              }}
            />
          ))}
        </View>
      ) : null}
    </Animated.View>
  );
}
