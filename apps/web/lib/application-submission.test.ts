import { buildApplicationSubmissionInput } from "./application-submission";
import type { MemberApplicationFormData } from "./application-submission";

describe("buildApplicationSubmissionInput", () => {
  it("keeps applicant email separate from a custom question that also uses the email id", () => {
    const formData: MemberApplicationFormData = {
      firstName: " Deon ",
      lastName: " Robinson ",
      email: " applicant@example.com ",
      phone: " 4159363880 ",
      password: "password123",
      confirmPassword: "password123",
      agreeToCoopValues: true,
      agreeToTerms: true,
      agreeToPrivacy: true,
      dynamicAnswers: {
        fullName: "I want to join Soulaan Co-op.",
        email: ["Member", "Ally"],
        occupation: "Entrepreneur",
      },
    };

    const input = buildApplicationSubmissionInput("soulaan", formData);

    expect(input.email).toBe("applicant@example.com");
    expect(input.dynamicAnswers.email).toEqual(["Member", "Ally"]);
    expect(input).not.toHaveProperty("fullName");
  });
});
