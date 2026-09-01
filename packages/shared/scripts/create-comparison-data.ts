// 临时脚本：创建前端对照测验用的组织和用户（统一密码 password123）。
import { prisma } from "../src/db";
import { hash } from "bcryptjs";

async function main() {
  const password = await hash("password123", 12);

  // 1. 付费组织（Pro）——角色下拉应显示 10 个角色
  await prisma.organization.upsert({
    where: { id: "paid-pro-org" },
    update: { cloudConfig: { plan: "Pro" } },
    create: {
      id: "paid-pro-org",
      name: "对照-付费Pro组织",
      cloudConfig: { plan: "Pro" },
    },
  });

  // 2. 免费组织（Developer）——角色下拉应只显示 5 个基础角色
  await prisma.organization.upsert({
    where: { id: "free-dev-org" },
    update: { cloudConfig: { plan: "Developer" } },
    create: {
      id: "free-dev-org",
      name: "对照-免费Developer组织",
      cloudConfig: { plan: "Developer" },
    },
  });

  // 3. 用户 + 组织成员角色
  const users = [
    // 付费组织：不同角色，用于验证入口显隐 + DEVELOPER 升级 + 付费角色
    { id: "paid-owner", email: "owner-paid@example.com", name: "付费OWNER", orgId: "paid-pro-org", role: "OWNER" },
    { id: "paid-developer", email: "developer-paid@example.com", name: "付费DEVELOPER", orgId: "paid-pro-org", role: "DEVELOPER" },
    { id: "paid-member", email: "member-paid@example.com", name: "付费MEMBER", orgId: "paid-pro-org", role: "MEMBER" },
    { id: "paid-annotator", email: "annotator-paid@example.com", name: "付费ANNOTATOR", orgId: "paid-pro-org", role: "ANNOTATOR" },
    { id: "paid-viewer", email: "viewer-paid@example.com", name: "付费VIEWER", orgId: "paid-pro-org", role: "VIEWER" },
    // 免费组织：验证角色下拉只有 5 个
    { id: "free-owner", email: "owner-free@example.com", name: "免费OWNER", orgId: "free-dev-org", role: "OWNER" },
    { id: "free-member", email: "member-free@example.com", name: "免费MEMBER", orgId: "free-dev-org", role: "MEMBER" },
  ];

  for (const u of users) {
    await prisma.user.upsert({
      where: { id: u.id },
      update: { name: u.name, email: u.email, password },
      create: { id: u.id, name: u.name, email: u.email, password },
    });
    await prisma.organizationMembership.upsert({
      where: { orgId_userId: { orgId: u.orgId, userId: u.id } },
      update: { role: u.role as never },
      create: { orgId: u.orgId, userId: u.id, role: u.role as never },
    });
  }

  console.log("对照数据创建完成：");
  console.log("  付费组织: paid-pro-org (plan=Pro)，成员角色: OWNER/DEVELOPER/MEMBER/ANNOTATOR/VIEWER");
  console.log("  免费组织: free-dev-org (plan=Developer)，成员角色: OWNER/MEMBER");
  console.log("  所有用户密码: password123");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
