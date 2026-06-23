import {
  formatApplicationAnswer,
  getApplicationAnswerEntries,
} from "./application-display";

describe("application display helpers", () => {
  it("reads nested dynamic answers without treating account email as a custom answer", () => {
    const entries = getApplicationAnswerEntries({
      firstName: "Deon",
      email: "applicant@example.com",
      dynamicAnswers: {
        email: ["Member", "Ally"],
        fullName: "I want to join.",
        optional: "",
      },
    });

    expect(entries).toEqual([
      ["email", ["Member", "Ally"]],
      ["fullName", "I want to join."],
    ]);
  });

  it("keeps older root-level custom answers visible", () => {
    const entries = getApplicationAnswerEntries({
      firstName: "Deon",
      whyJoin: "I can help.",
      spendingCategories: ["Retail", "Food"],
    });

    expect(entries).toEqual([["whyJoin", "I can help."]]);
    expect(formatApplicationAnswer(["Retail", "Food"])).toBe("Retail, Food");
  });
});
