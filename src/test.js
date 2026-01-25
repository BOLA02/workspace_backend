import prisma from "./config/prisma.js";

async function test() {
  try {
    const users = await prisma.user.findMany();
    console.log(users);
  } catch (error) {
    console.error("Error fetching users:", error);
  } finally {
    await prisma.$disconnect();
  }
}

test();

