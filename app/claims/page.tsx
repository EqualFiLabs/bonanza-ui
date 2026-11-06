import type { Metadata } from "next";

import { ClaimsView } from "@/components/claims/ClaimsView";
import { ProtocolGate } from "@/components/shell/ProtocolGate";

export const metadata: Metadata = { title: "Claims" };

export default function ClaimsPage() {
  return (
    <ProtocolGate>
      <ClaimsView />
    </ProtocolGate>
  );
}
