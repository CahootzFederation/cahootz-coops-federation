// Server-side only, so raw eventType/metadata (e.g. a missing tool key) never reaches the client.
export function describeSageAuditEvent(eventType: string, metadata: unknown): string {
  const reviewType = metadata && typeof metadata === "object" ? (metadata as { reviewType?: string }).reviewType : undefined;
  switch (eventType) {
    case "SUGGESTION_CREATED": return "Sage made a suggestion";
    case "REVIEW_APPROVED":
      if (reviewType === "PROVIDE_CONTEXT") return "Details were confirmed";
      if (reviewType === "CONSENT_TO_SHARE") return "Sharing was approved";
      if (reviewType === "ACCEPT_MATCH") return "The match was accepted";
      if (reviewType === "APPROVE_SUGGESTION") return "The suggestion was approved";
      return "A step was approved";
    case "REVIEW_DECLINED": return "The suggestion was declined";
    case "ESCALATED_TO_ADMIN": return "Sent to an admin to look at";
    case "ACTION_EXECUTED": return "Sage completed the suggestion";
    case "ACTION_FAILED": return "Sage couldn't complete this";
    case "MISSING_TOOL": return "Sage couldn't complete this";
    case "AUTO_PUBLISHED": return "Sage commented on its own";
    case "DUPLICATE_SKIPPED": return "Sage noticed this again and didn't suggest it twice";
    case "ACTION_REFUSED": return "Sage stopped because this was outside what it may do here";
    default: return "Update";
  }
}
