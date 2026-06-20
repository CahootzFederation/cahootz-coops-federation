export type ApplicationAnswer = string | string[];

export interface MemberApplicationFormData {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  confirmPassword: string;
  agreeToCoopValues: boolean;
  agreeToTerms: boolean;
  agreeToPrivacy: boolean;
  dynamicAnswers: Record<string, ApplicationAnswer>;
}

export function buildApplicationSubmissionInput(
  coopId: string,
  formData: MemberApplicationFormData,
) {
  return {
    coopId,
    firstName: formData.firstName.trim(),
    lastName: formData.lastName.trim(),
    email: formData.email.trim(),
    phone: formData.phone.trim(),
    password: formData.password,
    confirmPassword: formData.confirmPassword,
    dynamicAnswers: formData.dynamicAnswers,
    agreeToCoopValues: formData.agreeToCoopValues,
    agreeToTerms: formData.agreeToTerms,
    agreeToPrivacy: formData.agreeToPrivacy,
  };
}
