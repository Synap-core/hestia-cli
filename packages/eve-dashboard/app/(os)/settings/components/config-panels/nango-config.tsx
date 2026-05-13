"use client";

import { useEffect, useState } from "react";
import { Spinner, Chip } from "@heroui/react";
import { Key, Plug } from "lucide-react";
import type { NangoInfo } from "@/app/api/components/nango/info/route";

export function NangoConfigPanel() {
  const [info, setInfo] = useState<NangoInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/components/nango/info", { credentials: "include" });
      if (res.ok) setInfo(await res.json());
      setLoading(false);
    })();
  }, []);

  if (loading || !info) {
    return <div className="rounded-lg border border-divider bg-content2/40 p-4"><Spinner size="sm" /></div>;
  }

  return (
    <div className="space-y-4">
      {/* Secret key */}
      <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
          <Key className="h-3.5 w-3.5" />
          <span>Secret key</span>
        </div>
        <div className="flex items-center gap-3">
          {info.secretKeyPresent ? (
            <>
              <code className="flex-1 font-mono text-xs text-foreground bg-content1 border border-divider rounded-md px-3 py-2 truncate">
                {info.secretKeyPreview}
              </code>
              <Chip size="sm" color="success" variant="flat" radius="sm">configured</Chip>
            </>
          ) : (
            <Chip size="sm" color="warning" variant="flat" radius="sm">not set</Chip>
          )}
        </div>
        {info.installedAt && (
          <p className="text-xs text-default-400">
            Installed {new Date(info.installedAt).toLocaleDateString(undefined, { dateStyle: "medium" })}
          </p>
        )}
        <p className="text-xs text-default-500">
          The secret key is stored in <code className="font-mono">secrets.json</code> and injected into the container at startup. To rotate, run <code className="font-mono">eve add nango</code> again.
        </p>
      </div>

      {/* OAuth apps */}
      <div className="rounded-lg border border-divider bg-content2/40 p-4 space-y-3">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-default-500">
          <Plug className="h-3.5 w-3.5" />
          <span>OAuth integrations</span>
        </div>
        {info.oauthApps.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {info.oauthApps.map(app => (
              <Chip key={app} size="sm" variant="flat" radius="sm" color="primary">
                {app}
              </Chip>
            ))}
          </div>
        ) : (
          <p className="text-sm text-default-500">No OAuth apps configured yet.</p>
        )}
        <p className="text-xs text-default-500">
          Register OAuth credentials for each service in{" "}
          <a href="/settings/connections" className="text-primary hover:underline">Settings → Connections</a>.
        </p>
      </div>
    </div>
  );
}
