"use client";

/**
 * Full-page component view.
 *
 * Same content as the catalog drawer, just with more breathing room and
 * a back link to the catalog. The drawer and the page share the same
 * `<ComponentSurface>` so behavior stays identical.
 */

import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { ComponentSurface } from "../component-surface";

export default function ComponentPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = params?.id;

  // The catalog API returns 401 if the cookie is missing — middleware
  // handles redirects globally, but if a request slips through (e.g.
  // expired cookie), surface that as a hard back-to-login.
  useEffect(() => {
    if (!id) router.replace("/dashboard/components");
  }, [id, router]);

  if (!id) return null;

  return (
    <div>
      <ComponentSurface componentId={id} layout="page" />
    </div>
  );
}
