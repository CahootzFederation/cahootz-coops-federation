import type { ApplicationData } from './api';

export interface MobileApplicationFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  videoCID: string;
  photoCID: string;
  agreeToCoopValues: boolean;
  agreeToTerms: boolean;
  agreeToPrivacy: boolean;
  dynamicAnswers: Record<string, unknown>;
}

export function buildMobileApplicationSubmissionInput(
  coopId: string,
  formData: MobileApplicationFormData,
): ApplicationData {
  return {
    coopId,
    firstName: formData.firstName,
    lastName: formData.lastName,
    email: formData.email,
    phone: formData.phone,
    password: formData.password,
    confirmPassword: formData.confirmPassword,
    dynamicAnswers: formData.dynamicAnswers,
    videoCID: formData.videoCID || undefined,
    photoCID: formData.photoCID || undefined,
    agreeToCoopValues: formData.agreeToCoopValues,
    agreeToTerms: formData.agreeToTerms,
    agreeToPrivacy: formData.agreeToPrivacy,
  };
}
