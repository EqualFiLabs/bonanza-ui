import type { Metadata } from "next";

import { ProtocolGate } from "@/components/shell/ProtocolGate";
import { TicketsView } from "@/components/tickets/TicketsView";

export const metadata: Metadata = { title: "My tickets" };

export default function TicketsPage() {
  return (
    <ProtocolGate>
      <TicketsView />
    </ProtocolGate>
  );
}
