import twilio from 'twilio';
import { coopConfig } from '../config/coop.js';

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

let twilioClient: twilio.Twilio | null = null;

function getTwilioClient(): twilio.Twilio {
  if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN) {
    throw new Error('Twilio credentials not configured');
  }

  if (!twilioClient) {
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  }

  return twilioClient;
}

/**
 * Check if Twilio is configured
 */
export function isTwilioConfigured(): boolean {
  return !!(TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN && TWILIO_PHONE_NUMBER);
}

/**
 * Send SMS for a pending payment claim
 */
export async function sendClaimSMS(params: {
  recipientPhone: string;
  senderName: string;
  amountUSD: number;
  claimToken: string;
  note?: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { recipientPhone, senderName, amountUSD, claimToken, note } = params;

  if (!isTwilioConfigured()) {
    console.warn('Twilio not configured, skipping SMS');
    return { success: false, error: 'SMS not configured' };
  }

  try {
    const config = coopConfig();
    const claimUrl = `${config.appUrl}/claim/${claimToken}`;
    const formattedAmount = `$${amountUSD.toFixed(2)}`;

    let message = `${senderName} sent you ${formattedAmount} on ${config.shortName}!`;

    if (note) {
      message += ` "${note}"`;
    }

    message += `\n\nClaim your money here: ${claimUrl}`;
    message += `\n\nThis link expires in ${config.claimExpirationDays} days.`;

    // Format phone number for Twilio (E.164 format)
    const formattedPhone = formatPhoneForTwilio(recipientPhone);

    const result = await getTwilioClient().messages.create({
      body: message,
      to: formattedPhone,
      from: TWILIO_PHONE_NUMBER,
    });

    console.log(`✅ SMS sent to ${recipientPhone}: ${result.sid}`);

    return {
      success: true,
      messageId: result.sid,
    };
  } catch (error) {
    console.error('❌ Failed to send SMS:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send SMS',
    };
  }
}

/**
 * Send SMS reminder for unclaimed payment (called before expiration)
 */
export async function sendClaimReminderSMS(params: {
  recipientPhone: string;
  senderName: string;
  amountUSD: number;
  claimToken: string;
  daysRemaining: number;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { recipientPhone, senderName, amountUSD, claimToken, daysRemaining } = params;

  if (!isTwilioConfigured()) {
    console.warn('Twilio not configured, skipping SMS');
    return { success: false, error: 'SMS not configured' };
  }

  try {
    const config = coopConfig();
    const claimUrl = `${config.appUrl}/claim/${claimToken}`;
    const formattedAmount = `$${amountUSD.toFixed(2)}`;

    const message = `Reminder: ${senderName}'s ${formattedAmount} payment to you expires in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}!\n\nClaim it now: ${claimUrl}`;

    const formattedPhone = formatPhoneForTwilio(recipientPhone);

    const result = await getTwilioClient().messages.create({
      body: message,
      to: formattedPhone,
      from: TWILIO_PHONE_NUMBER,
    });

    console.log(`✅ Reminder SMS sent to ${recipientPhone}: ${result.sid}`);

    return {
      success: true,
      messageId: result.sid,
    };
  } catch (error) {
    console.error('❌ Failed to send reminder SMS:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send SMS',
    };
  }
}

/**
 * Send SMS notification when payment is claimed
 */
export async function sendClaimSuccessSMS(params: {
  senderPhone: string;
  recipientName: string;
  amountUSD: number;
  claimMethod: 'bank' | '???';
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { senderPhone, recipientName, amountUSD, claimMethod } = params;

  if (!isTwilioConfigured()) {
    console.warn('Twilio not configured, skipping SMS');
    return { success: false, error: 'SMS not configured' };
  }

  try {
    const config = coopConfig();
    const formattedAmount = `$${amountUSD.toFixed(2)}`;
    const claimMethodText = claimMethod === '???'
      ? `claimed your payment and joined ${config.shortName}`
      : 'claimed your payment to their bank';

    const message = `Good news! ${recipientName} ${claimMethodText}. Your ${formattedAmount} has been delivered.`;

    const formattedPhone = formatPhoneForTwilio(senderPhone);

    const result = await getTwilioClient().messages.create({
      body: message,
      to: formattedPhone,
      from: TWILIO_PHONE_NUMBER,
    });

    console.log(`✅ Claim success SMS sent to sender ${senderPhone}: ${result.sid}`);

    return {
      success: true,
      messageId: result.sid,
    };
  } catch (error) {
    console.error('❌ Failed to send claim success SMS:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send SMS',
    };
  }
}

/**
 * Send SMS notification when payment expires
 */
export async function sendPaymentExpiredSMS(params: {
  senderPhone: string;
  recipientPhone: string;
  amountUSD: number;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const { senderPhone, recipientPhone, amountUSD } = params;

  if (!isTwilioConfigured()) {
    console.warn('Twilio not configured, skipping SMS');
    return { success: false, error: 'SMS not configured' };
  }

  try {
    const config = coopConfig();
    const formattedAmount = `$${amountUSD.toFixed(2)}`;
    const message = `Your ${formattedAmount} payment to ${recipientPhone} expired and has been returned to your ${config.shortName} balance.`;

    const formattedPhone = formatPhoneForTwilio(senderPhone);

    const result = await getTwilioClient().messages.create({
      body: message,
      to: formattedPhone,
      from: TWILIO_PHONE_NUMBER,
    });

    console.log(`✅ Expiry SMS sent to sender ${senderPhone}: ${result.sid}`);

    return {
      success: true,
      messageId: result.sid,
    };
  } catch (error) {
    console.error('❌ Failed to send expiry SMS:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send SMS',
    };
  }
}

/**
 * Format phone number to E.164 format for Twilio
 * Assumes US phone numbers
 */
function formatPhoneForTwilio(phone: string): string {
  // Remove all non-digits
  const cleaned = phone.replace(/\D/g, '');

  // Add +1 for US if not present
  if (cleaned.length === 10) {
    return `+1${cleaned}`;
  }

  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }

  // Already has country code or is international
  if (cleaned.startsWith('+')) {
    return cleaned;
  }

  return `+${cleaned}`;
}

/**
 * Send a commons invitation by text. Phone numbers aren't verified in the
 * app, so the text only helps the recipient find the invitation; accepting
 * a phone invitation always goes to a steward for review.
 */
export async function sendCommonsInvitationSMS(params: {
  recipientPhone: string;
  text: string;
}): Promise<{ success: boolean; messageId?: string; error?: string }> {
  if (!isTwilioConfigured()) {
    console.warn('Twilio not configured, skipping commons invitation SMS');
    return { success: false, error: 'SMS not configured' };
  }

  try {
    const result = await getTwilioClient().messages.create({
      body: params.text,
      to: formatPhoneForTwilio(params.recipientPhone),
      from: TWILIO_PHONE_NUMBER,
    });
    return { success: true, messageId: result.sid };
  } catch (error) {
    console.error('❌ Failed to send commons invitation SMS:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send SMS',
    };
  }
}
