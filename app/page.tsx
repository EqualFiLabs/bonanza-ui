import { Suspense } from "react";

import { RoundsView } from "@/components/rounds/RoundsView";
import { ProtocolGate } from "@/components/shell/ProtocolGate";

export default function RoundsPage() {
  return (
    <ProtocolGate>
      <Suspense>
        <RoundsView />
      </Suspense>
    </ProtocolGate>
  );
}
