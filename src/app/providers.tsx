"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { I18nProvider } from "@/lib/i18n";
import { AUTH_EXPIRED_EVENT } from "@/lib/supabase/client";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";

export function Providers({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const redirectedRef = useRef(false);
  const onLoginPath = pathname === "/login" || pathname?.startsWith("/login/");

  useEffect(() => {
    if (!onLoginPath) {
      redirectedRef.current = false;
    }
  }, [onLoginPath]);

  useEffect(() => {
    function handleAuthExpired() {
      if (AUTH_BYPASS_ENABLED) return;
      if (redirectedRef.current) return;
      if (onLoginPath) return;
      redirectedRef.current = true;
      router.push("/login?expired=1");
    }

    window.addEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    return () => {
      window.removeEventListener(AUTH_EXPIRED_EVENT, handleAuthExpired);
    };
  }, [onLoginPath, router]);

  return (
    <I18nProvider>
      <ServiceWorkerRegistration />
      {children}
    </I18nProvider>
  );
}
