import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, ScrollView, TextInput, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useLocalSearchParams } from 'expo-router';
import { ArrowLeft, Check, CheckCircle2, MapPin, Minus, Plus, Tag, Truck, Users } from 'lucide-react-native';

import CommercePaymentConfirmation from '@/components/commerce-payment-confirmation';
import { Text } from '@/components/ui/text';
import { DESIGN } from '@/constants/design';
import { useAuth } from '@/contexts/auth-context';
import { track } from '@/lib/analytics';
import { api, type MarketplaceOffer, type OfferCheckoutSession } from '@/lib/api';
import { getWebUrl } from '@/lib/config';
import { friendlyError } from '@/lib/friendly-error';
import { keyboardInsetScrollProps } from '@/lib/keyboard';
import { formatCents, formatOfferDate, formatOfferDateTime, offerStatusLine, offerTypeLabel } from '@/lib/offers';

const colors = {
  paper: DESIGN.paper,
  ink: DESIGN.ink,
  muted: DESIGN.muted,
  line: DESIGN.border,
  orange: '#E85D04',
  forest: '#245B45',
  forestSoft: '#E7F3ED',
  goldSoft: '#FFF1D6',
  red: '#B42318',
};

function stripeReturnUrl(path: string) {
  return `${getWebUrl().replace(/\/+$/, '')}${path}`;
}

export default function OfferDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sessionToken, user } = useAuth();
  const [offer, setOffer] = useState<MarketplaceOffer | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [shareContact, setShareContact] = useState(false);
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [payment, setPayment] = useState<OfferCheckoutSession | null>(null);

  const load = useCallback(async () => {
    if (!id || !sessionToken) return;
    try {
      setLoadError(null);
      const next = await api.getOffer(id, sessionToken);
      setOffer(next);
      setQuantity((current) => Math.min(Math.max(1, current), next.quantityPerMember));
    } catch (error) {
      setLoadError(friendlyError(error, "We couldn't load this offer."));
    }
  }, [id, sessionToken]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (offer) track('offer_viewed', { offer_type: offer.offerType, status: offer.status });
    // Only once per offer opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer?.id]);

  // Start with the phone on the account; the member can change it before committing.
  useEffect(() => {
    if (user?.phone) setPhone((current) => current || user.phone || '');
  }, [user?.phone]);

  if (loadError) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center px-6" style={{ backgroundColor: colors.paper }}>
        <Text className="text-center text-base font-black" style={{ color: colors.ink }}>{loadError}</Text>
        <TouchableOpacity accessibilityRole="button" onPress={load} className="mt-5 items-center justify-center rounded-xl px-6" style={{ backgroundColor: colors.ink, minHeight: 48 }}>
          <Text className="font-black text-white">Try again</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (!offer || !sessionToken) {
    return (
      <SafeAreaView className="flex-1 items-center justify-center" style={{ backgroundColor: colors.paper }}>
        <ActivityIndicator size="large" color={colors.orange} />
      </SafeAreaView>
    );
  }

  const isGroupBuy = offer.offerType === 'GROUP_BUY';
  const mine = offer.myCommitment;
  const committed = mine?.status === 'COMMITTED' || mine?.status === 'PAYMENT_PENDING';
  const paid = mine?.status === 'PAID' || mine?.status === 'FULFILLED';
  const unitsToBuy = isGroupBuy ? mine?.quantity ?? quantity : quantity;
  const totalCents = offer.memberPriceCents * unitsToBuy;
  const maxForMe = Math.min(offer.quantityPerMember, offer.spotsLeft ?? offer.quantityPerMember);

  async function commit() {
    if (!offer || !sessionToken) return;
    if (!shareContact) {
      setMessage({ tone: 'error', text: `Tick the box to share your name and phone with ${offer.vendor.name}. They need it to plan your order.` });
      return;
    }
    setBusy(true);
    setMessage(null);
    track('group_buy_commit_started', { offer_id: offer.id });
    try {
      const result = await api.commitToOffer({ offerId: offer.id, quantity, contactPhone: phone.trim() || undefined }, sessionToken);
      track('group_buy_committed', { offer_id: offer.id, quantity, threshold_reached: result.thresholdReached });
      setMessage({
        tone: 'ok',
        text: result.thresholdReached
          ? "You're in, and that hit the goal! We'll tell you when it's time to pay. You haven't been charged."
          : "You're in. You haven't been charged. We'll let you know if it reaches its goal.",
      });
      await load();
    } catch (error) {
      setMessage({ tone: 'error', text: friendlyError(error, "Your spot didn't save. Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  async function cancelSpot() {
    if (!offer || !sessionToken) return;
    setBusy(true);
    setMessage(null);
    try {
      await api.cancelOfferCommitment(offer.id, sessionToken);
      track('group_buy_commitment_cancelled', { offer_id: offer.id });
      setMessage({ tone: 'ok', text: "Your spot is cancelled. You weren't charged." });
      await load();
    } catch (error) {
      setMessage({ tone: 'error', text: friendlyError(error, "We couldn't cancel your spot. Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  async function startPayment() {
    if (!offer || !sessionToken) return;
    setBusy(true);
    setMessage(null);
    try {
      const hosted = Platform.OS !== 'web';
      const session = await api.startOfferCheckout(
        {
          offerId: offer.id,
          quantity: isGroupBuy ? undefined : quantity,
          paymentUi: hosted ? 'hosted_checkout' : 'payment_intent',
          successUrl: hosted ? stripeReturnUrl('/checkout/success') : undefined,
          cancelUrl: hosted ? stripeReturnUrl('/checkout/cancel') : undefined,
        },
        sessionToken,
      );
      track('offer_checkout_started', { offer_id: offer.id, offer_type: offer.offerType });
      setPayment(session);
    } catch (error) {
      setMessage({ tone: 'error', text: friendlyError(error, "We couldn't start checkout. Please try again.") });
    } finally {
      setBusy(false);
    }
  }

  function onPaid() {
    if (!offer || !payment) return;
    track('offer_checkout_completed', { offer_id: offer.id, offer_type: offer.offerType });
    setPayment(null);
    setMessage({ tone: 'ok', text: `Payment of ${formatCents(payment.totalChargedCents)} received. You saved ${formatCents(offer.savingsCents * unitsToBuy)}.` });
    // The webhook marks the order paid a moment later.
    setTimeout(() => void load(), 2500);
  }

  const detailRow = (icon: React.ReactNode, label: string, value: string | null | undefined) =>
    value ? (
      <View className="mt-3 flex-row">
        <View className="mt-0.5 w-6">{icon}</View>
        <View className="flex-1">
          <Text className="text-xs font-black" style={{ color: colors.muted }}>{label}</Text>
          <Text className="mt-0.5 text-sm" style={{ color: colors.ink }}>{value}</Text>
        </View>
      </View>
    ) : null;

  const stepper = (
    <View className="mt-4 flex-row items-center justify-between">
      <Text className="text-sm font-black" style={{ color: colors.ink }}>How many?</Text>
      <View className="h-10 flex-row items-center rounded-xl" style={{ backgroundColor: colors.ink }}>
        <TouchableOpacity accessibilityLabel="One fewer" disabled={quantity <= 1} onPress={() => setQuantity((q) => Math.max(1, q - 1))} className="h-10 w-10 items-center justify-center">
          <Minus size={16} color="#FFFFFF" />
        </TouchableOpacity>
        <Text accessibilityLabel={`Quantity ${quantity}`} className="min-w-[24px] text-center font-black text-white">{quantity}</Text>
        <TouchableOpacity accessibilityLabel="One more" disabled={quantity >= maxForMe} onPress={() => setQuantity((q) => Math.min(maxForMe, q + 1))} className="h-10 w-10 items-center justify-center">
          <Plus size={16} color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <SafeAreaView className="flex-1" edges={['top']} style={{ backgroundColor: colors.paper }}>
      <View className="flex-row items-center px-4 py-3">
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back" className="h-11 w-11 items-center justify-center">
          <ArrowLeft size={22} color={colors.ink} />
        </TouchableOpacity>
        <Text className="ml-2 flex-1 text-base font-black" style={{ color: colors.ink }} numberOfLines={1}>
          {offerTypeLabel(offer)}
        </Text>
      </View>

      <ScrollView {...keyboardInsetScrollProps} className="flex-1" contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <View className="self-start flex-row items-center rounded-full px-2.5 py-1" style={{ backgroundColor: isGroupBuy ? colors.goldSoft : colors.forestSoft }}>
          {isGroupBuy ? <Users size={13} color={colors.orange} /> : <Tag size={13} color={colors.forest} />}
          <Text className="ml-1 text-[11px] font-black" style={{ color: isGroupBuy ? colors.orange : colors.forest }}>{offerTypeLabel(offer)}</Text>
        </View>
        <Text className="mt-2 text-2xl font-black" style={{ color: colors.ink }}>{offer.title}</Text>
        <Text className="mt-1 text-sm font-semibold" style={{ color: colors.muted }}>From {offer.vendor.name}</Text>
        {offer.description ? <Text className="mt-3 text-sm" style={{ color: colors.ink }}>{offer.description}</Text> : null}

        <View className="mt-4 rounded-2xl border bg-white p-4" style={{ borderColor: colors.line }} accessibilityLabel="Price">
          <View className="flex-row justify-between">
            <Text className="text-sm" style={{ color: colors.muted }}>Regular price</Text>
            <Text className="text-sm line-through" style={{ color: colors.muted }}>{formatCents(offer.regularPriceCents)}</Text>
          </View>
          <View className="mt-1 flex-row justify-between">
            <Text className="text-base font-black" style={{ color: colors.ink }}>{isGroupBuy ? 'Group price' : 'Member price'}</Text>
            <Text className="text-base font-black" style={{ color: colors.ink }}>{formatCents(offer.memberPriceCents)}</Text>
          </View>
          <View className="mt-1 flex-row justify-between">
            <Text className="text-sm font-black" style={{ color: colors.forest }}>You save</Text>
            <Text className="text-sm font-black" style={{ color: colors.forest }}>
              {formatCents(offer.savingsCents)} ({offer.savingsPercent}%)
            </Text>
          </View>
          <Text className="mt-2 text-[11px]" style={{ color: colors.muted }}>Regular price: {offer.regularPriceSource}. No extra fees at checkout.</Text>
        </View>

        {isGroupBuy ? (
          <View className="mt-3 rounded-2xl border bg-white p-4" style={{ borderColor: colors.line }}>
            <Text className="text-sm font-black" style={{ color: colors.ink }} accessibilityLabel="Group buy progress">
              {offer.minimumCommitments && offer.committedQuantity >= offer.minimumCommitments
                ? `${offer.committedQuantity} committed · goal of ${offer.minimumCommitments} met`
                : `${offer.committedQuantity} of ${offer.minimumCommitments} committed`}
            </Text>
            <View className="mt-2 h-2 overflow-hidden rounded-full" style={{ backgroundColor: '#EEE3D3' }}>
              <View className="h-full rounded-full" style={{ width: `${Math.min(100, (offer.committedQuantity / (offer.minimumCommitments || 1)) * 100)}%`, backgroundColor: colors.orange }} />
            </View>
            <Text className="mt-2 text-xs" style={{ color: colors.muted }}>
              {offer.status === 'LIVE' ? `Commitments close ${formatOfferDateTime(offer.commitmentDeadline)}` : offerStatusLine(offer)}
            </Text>
          </View>
        ) : null}

        <View className="mt-3 rounded-2xl border bg-white p-4" style={{ borderColor: colors.line }}>
          {isGroupBuy && offer.status === 'LIVE'
            ? detailRow(<Users size={16} color={colors.muted} />, 'How it works', `Commit by ${formatOfferDateTime(offer.commitmentDeadline)}. You won't be charged unless ${offer.minimumCommitments} are committed and the vendor confirms. Then you'll have a set time to pay.`)
            : !isGroupBuy
              ? detailRow(<Tag size={16} color={colors.muted} />, 'Deal ends', formatOfferDateTime(offer.expiresAt))
              : null}
          {offer.offerType === 'MEMBER_DEAL' || offer.quantityPerMember > 1 ? detailRow(<Check size={16} color={colors.muted} />, 'Limit', `Up to ${offer.quantityPerMember} per household`) : null}
          {offer.fulfillmentMethod === 'PICKUP'
            ? detailRow(<MapPin size={16} color={colors.muted} />, 'Pickup', [offer.pickupLocation, offer.fulfillmentDate ? formatOfferDate(offer.fulfillmentDate) : null].filter(Boolean).join(' · ') || 'Details from the vendor')
            : detailRow(<Truck size={16} color={colors.muted} />, 'Delivery', [offer.serviceArea, offer.fulfillmentDate ? formatOfferDate(offer.fulfillmentDate) : null].filter(Boolean).join(' · ') || 'Details from the vendor')}
          {detailRow(<CheckCircle2 size={16} color={colors.muted} />, 'How to redeem', offer.redemptionRules)}
          {detailRow(<CheckCircle2 size={16} color={colors.muted} />, 'Refunds and cancelling', offer.refundPolicy)}
          {detailRow(<CheckCircle2 size={16} color={colors.muted} />, 'Substitutions', offer.substitutionPolicy)}
          {detailRow(<CheckCircle2 size={16} color={colors.muted} />, 'Other terms', offer.terms)}
        </View>

        {message ? (
          <View accessibilityRole="alert" className="mt-4 rounded-2xl p-4" style={{ backgroundColor: message.tone === 'ok' ? colors.forestSoft : '#FEE4E2' }}>
            <Text className="text-sm font-semibold" style={{ color: message.tone === 'ok' ? colors.forest : colors.red }}>{message.text}</Text>
          </View>
        ) : null}

        {/* What the member can do now */}
        <View className="mt-4">
          {paid ? (
            <View className="rounded-2xl p-4" style={{ backgroundColor: colors.forestSoft }}>
              <Text className="font-black" style={{ color: colors.forest }}>
                You paid for {mine!.quantity} and saved {formatCents(mine!.savingsCents)}.
              </Text>
            </View>
          ) : null}

          {offer.canCommit && !committed ? (
            <View className="rounded-2xl border bg-white p-4" style={{ borderColor: colors.line }}>
              {offer.quantityPerMember > 1 ? stepper : null}
              <TouchableOpacity
                accessibilityRole="checkbox"
                accessibilityState={{ checked: shareContact }}
                aria-checked={shareContact}
                accessibilityLabel={`Share my name and phone with ${offer.vendor.name}`}
                onPress={() => setShareContact((v) => !v)}
                className="mt-4 flex-row items-start"
              >
                <View className="mr-3 mt-0.5 h-5 w-5 items-center justify-center rounded border" style={{ borderColor: colors.ink, backgroundColor: shareContact ? colors.ink : '#FFFFFF' }}>
                  {shareContact ? <Check size={14} color="#FFFFFF" /> : null}
                </View>
                <Text className="flex-1 text-sm" style={{ color: colors.ink }}>
                  Share my name and phone with {offer.vendor.name} so they can plan my order.
                </Text>
              </TouchableOpacity>
              <TextInput
                accessibilityLabel="Phone for the vendor"
                value={phone}
                onChangeText={setPhone}
                placeholder="Phone (optional)"
                placeholderTextColor="#A6998A"
                keyboardType="phone-pad"
                className="mt-3 h-11 rounded-xl border px-3 text-sm"
                style={{ borderColor: colors.line, color: colors.ink }}
              />
              <Text className="mt-3 text-xs" style={{ color: colors.muted }}>
                You won&apos;t be charged now. If it happens, you&apos;ll pay {formatCents(offer.memberPriceCents * quantity)}.
              </Text>
              <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={commit} className="mt-3 items-center justify-center rounded-xl" style={{ backgroundColor: colors.ink, minHeight: 48, opacity: busy ? 0.6 : 1 }}>
                <Text className="font-black text-white">{busy ? 'Saving…' : 'Commit'}</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {committed && offer.status === 'LIVE' ? (
            <View className="rounded-2xl border bg-white p-4" style={{ borderColor: colors.line }}>
              <Text className="font-black" style={{ color: colors.ink }}>You&apos;re in for {mine!.quantity}.</Text>
              <Text className="mt-1 text-xs" style={{ color: colors.muted }}>
                No charge yet. You can cancel until {formatOfferDateTime(offer.commitmentDeadline)}.
              </Text>
              <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={cancelSpot} className="mt-3 items-center justify-center rounded-xl border" style={{ borderColor: colors.line, minHeight: 44 }}>
                <Text className="font-black" style={{ color: colors.red }}>Cancel my spot</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {(offer.canBuy && !paid) || offer.canPay ? (
            payment ? (
              <CommercePaymentConfirmation
                clientSecret={payment.clientSecret}
                checkoutUrl={payment.checkoutUrl}
                merchantName={offer.vendor.name}
                amountLabel={formatCents(payment.totalChargedCents)}
                accentColor={colors.orange}
                onSuccess={onPaid}
                onError={(text) => console.error('Offer payment error:', text)}
              />
            ) : (
              <View className="rounded-2xl border bg-white p-4" style={{ borderColor: colors.line }}>
                {offer.canBuy && maxForMe > 1 ? stepper : null}
                {offer.canPay ? (
                  <Text className="text-xs" style={{ color: colors.muted }}>Pay by {formatOfferDateTime(offer.paymentDeadline)} to keep your spot.</Text>
                ) : null}
                <TouchableOpacity accessibilityRole="button" disabled={busy} onPress={startPayment} className="mt-3 items-center justify-center rounded-xl" style={{ backgroundColor: colors.orange, minHeight: 48, opacity: busy ? 0.6 : 1 }}>
                  <Text className="font-black text-white">{busy ? 'Starting…' : `Pay ${formatCents(totalCents)}`}</Text>
                </TouchableOpacity>
              </View>
            )
          ) : null}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
