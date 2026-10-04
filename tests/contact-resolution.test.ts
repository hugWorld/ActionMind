import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { resolveContact } from "../src/server/contacts";

// Gate 4 — Contact Resolution
// 必须正确处理：Unique / Not Found / Ambiguous / Email Match / Phone Match

describe("Task 4: Contact Resolution", () => {
  const suffix = Date.now().toString(36);
  const created: string[] = [];

  afterAll(async () => {
    // 逐个清理（禁止批量删除）
    for (const id of created) {
      await prisma.contact.delete({ where: { id } }).catch(() => {});
    }
    await prisma.$disconnect();
  });

  const mkContact = async (data: {
    name: string;
    organization?: string;
    emails?: string[];
    phones?: string[];
    emailActive?: boolean;
  }) => {
    const contact = await prisma.contact.create({
      data: {
        name: data.name,
        organization: data.organization,
        emails: {
          create: (data.emails ?? []).map((email) => ({
            email,
            verified: false,
            active: data.emailActive ?? true,
            source: "test",
          })),
        },
        phones: {
          create: (data.phones ?? []).map((phone) => ({
            phone,
            verified: false,
            active: true,
            source: "test",
          })),
        },
      },
    });
    created.push(contact.id);
    return contact;
  };

  it("Unique：按姓名唯一命中", async () => {
    const c = await mkContact({ name: `王强-${suffix}` });
    const r = await resolveContact({ name: `王强-${suffix}` });
    expect(r.status).toBe("unique");
    if (r.status === "unique") {
      expect(r.contact.id).toBe(c.id);
      expect(r.contact.name).toBe(`王强-${suffix}`);
    }
  });

  it("Not Found：无匹配联系人", async () => {
    const r = await resolveContact({ name: `不存在的人-${suffix}` });
    expect(r.status).toBe("not_found");
  });

  it("Ambiguous：同姓名两人 → 候选列表", async () => {
    const a = await mkContact({ name: `王伟-${suffix}`, emails: ["a@amb.com"] });
    const b = await mkContact({ name: `王伟-${suffix}`, emails: ["b@amb.com"] });
    const r = await resolveContact({ name: `王伟-${suffix}` });
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") {
      expect(r.candidates).toHaveLength(2);
      expect(r.candidates.map((c) => c.id).sort()).toEqual([a.id, b.id].sort());
    }
  });

  it("Email Match：大小写/空白归一后命中", async () => {
    const c = await mkContact({
      name: `李梅-${suffix}`,
      emails: ["Case.Test@Example.COM"],
    });
    const r = await resolveContact({ email: "  case.test@example.com  " });
    expect(r.status).toBe("unique");
    if (r.status === "unique") {
      expect(r.contact.id).toBe(c.id);
      expect(r.contact.emails[0].email).toBe("Case.Test@Example.COM");
    }
  });

  it("Phone Match：格式归一（空格/连字符）后命中", async () => {
    const c = await mkContact({
      name: `陈晨-${suffix}`,
      phones: ["138 0013-8000"],
    });
    const r = await resolveContact({ phone: "1380013 8000" });
    expect(r.status).toBe("unique");
    if (r.status === "unique") {
      expect(r.contact.id).toBe(c.id);
    }
  });

  it("Ambiguous：同一邮箱被两个联系人使用", async () => {
    await mkContact({ name: `共享甲-${suffix}`, emails: ["shared@amb.com"] });
    await mkContact({ name: `共享乙-${suffix}`, emails: ["shared@amb.com"] });
    const r = await resolveContact({ email: "SHARED@amb.com" });
    expect(r.status).toBe("ambiguous");
    if (r.status === "ambiguous") {
      expect(r.candidates).toHaveLength(2);
    }
  });

  it("Inactive：失效邮箱不参与解析 → not_found", async () => {
    await mkContact({
      name: `停用-${suffix}`,
      emails: ["old@inactive.com"],
      emailActive: false,
    });
    const r = await resolveContact({ email: "old@inactive.com" });
    expect(r.status).toBe("not_found");
  });

  it("优先级：邮箱命中覆盖姓名指向（邮箱 > 姓名）", async () => {
    const a = await mkContact({ name: `赵一-${suffix}`, emails: ["zhao@prio.com"] });
    await mkContact({ name: `赵二-${suffix}`, emails: ["er@prio.com"] });
    const r = await resolveContact({
      name: `赵一-${suffix}`,
      email: "er@prio.com",
    });
    expect(r.status).toBe("unique");
    if (r.status === "unique") {
      expect(r.contact.id).not.toBe(a.id); // 邮箱指向赵二
      expect(r.contact.name).toBe(`赵二-${suffix}`);
    }
  });

  it("空输入 → not_found", async () => {
    const r = await resolveContact({});
    expect(r.status).toBe("not_found");
  });
});
