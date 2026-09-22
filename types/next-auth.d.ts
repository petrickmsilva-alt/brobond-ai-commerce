import type { DefaultSession } from "next-auth";
import type { UserRole } from "@prisma/client";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role?: UserRole;
      organizationId?: string | null;
    } & DefaultSession["user"];
  }

  interface User {
    role?: UserRole;
    organizationId?: string | null;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: UserRole;
    organizationId?: string | null;
  }
}
