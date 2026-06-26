import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Seed real admin user
  await prisma.user.upsert({
    where: { email: "admin@cahootz.coop" },
    update: {},
    create: {
      email: "admin@cahootz.coop",
      name: "Deon Robinson",
      role: "admin",
      status: "ACTIVE",
    },
  });

  console.log("✅ Admin user seeded successfully");
  console.log("   Email: admin@cahootz.coop");
  console.log("   Name: Deon Robinson");
  console.log("   Role: admin");
  console.log("   Status: ACTIVE");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
