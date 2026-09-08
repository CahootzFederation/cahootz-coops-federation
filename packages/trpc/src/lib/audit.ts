import type { Prisma } from "@repo/db";

export function auditLogEntry(params: {
  actorId: string;
  action: string;
  resource: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
}): Prisma.AuditLogCreateArgs["data"] {
  return {
    actorId: params.actorId,
    actorType: "USER",
    action: params.action,
    resource: params.resource,
    resourceId: params.resourceId,
    metadata: (params.metadata ?? {}) as Prisma.InputJsonValue,
    status: "SUCCESS",
  };
}
