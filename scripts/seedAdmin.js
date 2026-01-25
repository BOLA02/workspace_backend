import prisma from "../src/config/prisma.js";
import bcrypt from "bcrypt";

async function seedAdmin() {
  try {
    // Check if admin already exists
    const existingAdmin = await prisma.user.findFirst({
      where: { role: "ADMIN" },
    });

    if (existingAdmin) {
      console.log("✅ Admin user already exists:", existingAdmin.email);
      return;
    }

    // Create admin user
    const hashedPassword = await bcrypt.hash("admin123", 10);
    
    const admin = await prisma.user.create({
      data: {
        name: "Admin User",
        email: "admin@workspace.com",
        password: hashedPassword,
        role: "ADMIN",
      },
    });

    console.log("\n✅ Admin user created successfully!");
    console.log("📧 Email:", admin.email);
    console.log("🔑 Password: admin123");
    console.log("⚠️  IMPORTANT: Change this password after first login!\n");

  } catch (error) {
    console.error("❌ Error seeding admin:", error);
  } finally {
    await prisma.$disconnect();
  }
}

seedAdmin();