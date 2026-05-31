import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt"; // Use your existing encryption setup

const prisma = new PrismaClient();

async function main() {
  console.log("Cleaning database tables...");
  await prisma.inflow.deleteMany({});
  await prisma.expense.deleteMany({});
  await prisma.usageRecord.deleteMany({});
  await prisma.workspaceType.deleteMany({});
  await prisma.user.deleteMany({});

  console.log("Generating secured password credentials...");
  const hashedPassword = await bcrypt.hash("password123", 10);

  console.log("Seeding real users into mapped table targets...");
  const admin = await prisma.user.create({
    data: {
      name: "Admin User",
      email: "admin@workspace.com",
      password: hashedPassword,
      role: "ADMIN"
    }
  });

  const staff = await prisma.user.create({
    data: {
      name: "Sarah Connor",
      email: "sarah@workspace.com",
      password: hashedPassword,
      role: "STAFF"
    }
  });

  console.log("Seeding workspaces with explicit defaults...");
  const hotDesk = await prisma.workspaceType.create({
    data: { name: "Dedicated Hot Desk", capacity: 20, isActive: true }
  });
  const privateSuite = await prisma.workspaceType.create({
    data: { name: "Private Executive Suite", capacity: 4, isActive: true }
  });
  const meetingHall = await prisma.workspaceType.create({
    data: { name: "Conference Meeting Hall", capacity: 12, isActive: true }
  });

  console.log("Seeding transaction records matching relational structures...");
  // Record 1: High-Value Executive Suite matching CUID relationships
  await prisma.usageRecord.create({
    data: {
      customerName: "Aliko Dangote",
      customerPhone: "+2348031111111",
      amountPaid: 150000.00,
      paymentMethod: "TRANSFER",
      usageDate: new Date("2026-05-10T08:00:00Z"),
      endDateTime: new Date("2026-06-10T18:00:00Z"),
      duration: "Custom Duration",
      staffId: staff.id,
      workspaceTypeId: privateSuite.id
    }
  });

  // Record 2: Hot desk transaction
  await prisma.usageRecord.create({
    data: {
      customerName: "Chinedu Okafor",
      customerPhone: "+2348092222222",
      amountPaid: 15000.00,
      paymentMethod: "POS",
      usageDate: new Date("2026-05-15T09:00:00Z"),
      endDateTime: new Date("2026-05-15T17:00:00Z"),
      duration: "Day",
      staffId: staff.id,
      workspaceTypeId: hotDesk.id
    }
  });

  // Record 3: Conference Hall Booking
  await prisma.usageRecord.create({
    data: {
      customerName: "Funmi Oladele",
      customerPhone: "+2348123333333",
      amountPaid: 65000.00,
      paymentMethod: "TRANSFER",
      usageDate: new Date("2026-05-28T10:00:00Z"),
      endDateTime: new Date("2026-05-28T14:00:00Z"),
      duration: "Day",
      staffId: admin.id,
      workspaceTypeId: meetingHall.id
    }
  });

  console.log("Seeding cost records with default tags...");
  await prisma.expense.create({
    data: {
      description: "Fiber-Optic Internet Base Station Renewal",
      amount: 45000.00,
      category: "UTILITIES",
      expenseDate: new Date("2026-05-02T10:00:00Z"),
      createdById: admin.id
    }
  });

  console.log("Seeding database transaction flow finished successfully!");
}

main()
  .catch((e) => {
    console.error("Seeding procedure structural failure:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
