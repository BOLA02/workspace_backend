import prisma from "../src/config/prisma.js";

async function seedWorkspaceTypes() {
  try {
    const workspaceTypes = [
      { name: "Hot Desk", capacity: 20 },
      { name: "Private Office", capacity: 5 },
      { name: "Meeting Room", capacity: 8 },
      { name: "Conference Room", capacity: 15 },
      { name: "Virtual Office", capacity: 10 },
    ];

    console.log("🌱 Seeding workspace types...\n");

    for (const workspace of workspaceTypes) {
      const existing = await prisma.workspaceType.findFirst({
        where: { name: workspace.name },
      });

      if (!existing) {
        await prisma.workspaceType.create({
          data: workspace,
        });
        console.log(`✅ Created: ${workspace.name} (Default Capacity: ${workspace.capacity})`);
      } else {
        console.log(`⏭️  Already exists: ${workspace.name} (Capacity: ${existing.capacity})`);
      }
    }

    console.log("\n✅ Workspace types seeded successfully!");
    console.log("ℹ️  Admins can update capacities via: PUT /api/workspace-types/:id\n");

  } catch (error) {
    console.error("❌ Error seeding workspace types:", error);
  } finally {
    await prisma.$disconnect();
  }
}

seedWorkspaceTypes();