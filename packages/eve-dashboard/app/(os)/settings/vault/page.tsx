"use client";

import { PodConnectGate } from "../../components/auth/PodConnectGate";
import { VaultApp } from "./vault-components";

export default function VaultPage() {
  return (
    <PodConnectGate>
      <VaultApp />
    </PodConnectGate>
  );
}
