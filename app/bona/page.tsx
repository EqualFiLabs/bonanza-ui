import type { Metadata } from "next";

import { BonaView } from "@/components/bona/BonaView";
import { ProtocolGate } from "@/components/shell/ProtocolGate";

export const metadata: Metadata = { title: "BONA" };

export default function BonaPage() {
  return (
    <ProtocolGate>
      <BonaView />
    </ProtocolGate>
  );
}
