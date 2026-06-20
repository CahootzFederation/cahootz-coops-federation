import { buildMobileApplicationSubmissionInput } from './application-submission';
import type { MobileApplicationFormData } from './application-submission';

describe('buildMobileApplicationSubmissionInput', () => {
  it('keeps account email separate from a custom email question answer', () => {
    const formData: MobileApplicationFormData = {
      firstName: 'Deon',
      lastName: 'Robinson',
      email: 'applicant@example.com',
      phone: '4159363880',
      password: 'password123',
      confirmPassword: 'password123',
      videoCID: '',
      photoCID: '',
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
      dynamicAnswers: {
        fullName: 'I want to join.',
        email: ['Member', 'Ally'],
      },
    };

    const input = buildMobileApplicationSubmissionInput('soulaan', formData);

    expect(input.email).toBe('applicant@example.com');
    expect(input.dynamicAnswers?.email).toEqual(['Member', 'Ally']);
    expect(input).not.toHaveProperty('fullName');
    expect(input.videoCID).toBeUndefined();
    expect(input.photoCID).toBeUndefined();
  });
});
