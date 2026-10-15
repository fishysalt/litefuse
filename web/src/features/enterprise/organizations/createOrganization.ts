import { auditLog } from "@/src/features/audit-logs/auditLog";
import { organizationNameSchema } from "@/src/features/organizations/utils/organizationNameSchema";
import { prisma, type Prisma } from "@langfuse/shared/src/db";
import { logger } from "@langfuse/shared/src/server";
import { type NextApiRequest, type NextApiResponse } from "next";

type MetadataResult =
  | { ok: true; value: Prisma.InputJsonValue | undefined }
  | { ok: false; error: string };

function parseOrganizationMetadata(metadata: unknown): MetadataResult {
  if (metadata === undefined) {
    return { ok: true, value: undefined };
  }

  let value = metadata;
  if (typeof metadata === "string") {
    try {
      value = JSON.parse(metadata);
    } catch (error) {
      return {
        ok: false,
        error: `Invalid metadata. Should be a valid JSON object: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return {
      ok: false,
      error: "Invalid metadata. Should be a valid JSON object.",
    };
  }

  return { ok: true, value: value as Prisma.InputJsonValue };
}

export async function createOrganization(
  req: NextApiRequest,
  res: NextApiResponse,
) {
  const parsedBody = organizationNameSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({
      error: "Invalid request body",
      details: parsedBody.error.format(),
    });
  }

  const metadata = parseOrganizationMetadata(req.body?.metadata);
  if (!metadata.ok) {
    return res.status(400).json({ error: metadata.error });
  }

  const organization = await prisma.organization.create({
    data: {
      name: parsedBody.data.name,
      metadata: metadata.value,
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      metadata: true,
      projects: {
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          metadata: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  await auditLog({
    apiKeyId: "admin-api",
    orgId: organization.id,
    resourceType: "organization",
    resourceId: organization.id,
    action: "create",
    after: organization,
  });

  logger.info(`Created organization ${organization.id}`);

  return res.status(201).json({
    ...organization,
    metadata: organization.metadata ?? {},
  });
}
