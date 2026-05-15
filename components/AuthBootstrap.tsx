"use client";

import { useEffect } from "react";
import { useAuthStore } from "@/lib/auth-store";

export default function AuthBootstrap() {
  const ensureUser = useAuthStore((state) => state.ensureUser);

  useEffect(() => {
    void ensureUser();
  }, [ensureUser]);

  return null;
}
