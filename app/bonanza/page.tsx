import type { Metadata } from "next";

import { BonanzaView } from "@/components/bonanza/BonanzaView";
import { ProtocolGate } from "@/components/shell/ProtocolGate";

export const metadata: Metadata = { title: "BONANZA" };

export default function BonanzaPage() {
  return (
    <ProtocolGate>
      <BonanzaView />
    </ProtocolGate>
  );
}
