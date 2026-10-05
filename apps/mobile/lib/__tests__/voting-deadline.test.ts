import { describe, expect, it } from "@jest/globals";

import { calendarDaysUntil, clockTime, votingDeadlineLine, votingDeadlineShort } from "../voting-deadline";

// Dates are built in local time so the wording doesn't depend on the test machine's time zone.
const NOW = new Date(2026, 9, 11, 9, 30); // Sun, Oct 11 2026, 9:30 AM
const at = (month: number, day: number, hour = 17, minute = 0, year = 2026) =>
  new Date(year, month, day, hour, minute).toISOString();

describe("votingDeadlineLine", () => {
  it("says when voting closes and how long is left", () => {
    expect(votingDeadlineLine({ status: "votable", votingEndsAt: at(9, 14) }, NOW)).toBe(
      "Voting closes Wed, Oct 14 at 5:00 PM (in 3 days)",
    );
  });

  it("says today when voting closes later today", () => {
    expect(votingDeadlineLine({ status: "votable", votingEndsAt: at(9, 11, 21, 5) }, NOW)).toBe(
      "Voting closes Sun, Oct 11 at 9:05 PM (today)",
    );
  });

  it("says tomorrow when voting closes tomorrow, even in the morning", () => {
    expect(votingDeadlineLine({ status: "votable", votingEndsAt: at(9, 12, 8, 0) }, NOW)).toBe(
      "Voting closes Mon, Oct 12 at 8:00 AM (tomorrow)",
    );
  });

  it("shows the year when voting closes in another year", () => {
    expect(votingDeadlineLine({ status: "votable", votingEndsAt: at(0, 2, 12, 0, 2027) }, NOW)).toBe(
      "Voting closes Sat, Jan 2, 2027 at 12:00 PM (in 83 days)",
    );
  });

  it("says voting closed once the end date has passed", () => {
    expect(votingDeadlineLine({ status: "votable", votingEndsAt: at(9, 8) }, NOW)).toBe("Voting closed Oct 8");
    expect(votingDeadlineLine({ status: "votable", votingEndsAt: at(9, 11, 9, 0) }, NOW)).toBe(
      "Voting closed Oct 11",
    );
  });

  it("says when a decided proposal was decided, using the earlier date", () => {
    expect(
      votingDeadlineLine({ status: "approved", votingEndsAt: at(9, 14), updatedAt: at(9, 9, 10) }, NOW),
    ).toBe("Decided Oct 9");
    expect(votingDeadlineLine({ status: "rejected", votingEndsAt: at(9, 6), updatedAt: at(9, 10) }, NOW)).toBe(
      "Decided Oct 6",
    );
    expect(votingDeadlineLine({ status: "funded", updatedAt: at(9, 10) }, NOW)).toBe("Decided Oct 10");
  });

  it("shows nothing for drafts, proposals in review, withdrawn proposals, or missing dates", () => {
    expect(votingDeadlineLine({ status: "submitted", votingEndsAt: at(9, 14) }, NOW)).toBeNull();
    expect(votingDeadlineLine({ status: "draft" }, NOW)).toBeNull();
    expect(votingDeadlineLine({ status: "withdrawn", votingEndsAt: at(9, 14) }, NOW)).toBeNull();
    expect(votingDeadlineLine({ status: "votable" }, NOW)).toBeNull();
    expect(votingDeadlineLine({ status: "votable", votingEndsAt: null }, NOW)).toBeNull();
    expect(votingDeadlineLine({ status: "votable", votingEndsAt: "not a date" }, NOW)).toBeNull();
    expect(votingDeadlineLine({ status: "approved" }, NOW)).toBeNull();
  });
});

describe("votingDeadlineShort", () => {
  it("counts down in days", () => {
    expect(votingDeadlineShort({ status: "votable", votingEndsAt: at(9, 14) }, NOW)).toBe("Closes in 3 days");
    expect(votingDeadlineShort({ status: "votable", votingEndsAt: at(9, 12, 8) }, NOW)).toBe("Closes tomorrow");
    expect(votingDeadlineShort({ status: "votable", votingEndsAt: at(9, 11, 23, 59) }, NOW)).toBe("Closes today");
  });

  it("says voting closed once the end date has passed", () => {
    expect(votingDeadlineShort({ status: "votable", votingEndsAt: at(9, 1) }, NOW)).toBe("Voting closed");
  });

  it("shows nothing unless the proposal is open with an end date", () => {
    expect(votingDeadlineShort({ status: "votable" }, NOW)).toBeNull();
    expect(votingDeadlineShort({ status: "approved", votingEndsAt: at(9, 14) }, NOW)).toBeNull();
    expect(votingDeadlineShort({ status: "submitted", votingEndsAt: at(9, 14) }, NOW)).toBeNull();
  });
});

describe("helpers", () => {
  it("formats times on a 12-hour clock", () => {
    expect(clockTime(new Date(2026, 9, 11, 0, 5))).toBe("12:05 AM");
    expect(clockTime(new Date(2026, 9, 11, 12, 0))).toBe("12:00 PM");
    expect(clockTime(new Date(2026, 9, 11, 17, 45))).toBe("5:45 PM");
  });

  it("counts calendar days, not 24-hour periods", () => {
    expect(calendarDaysUntil(new Date(2026, 9, 12, 0, 1), new Date(2026, 9, 11, 23, 59))).toBe(1);
    expect(calendarDaysUntil(new Date(2026, 9, 11, 23, 59), new Date(2026, 9, 11, 0, 1))).toBe(0);
  });
});
