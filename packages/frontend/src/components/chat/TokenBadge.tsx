import type { TokenUsage } from "@dispatch/shared";
import { Coins } from "lucide-react";

interface Props {
  tokens: TokenUsage;
}

export default function TokenBadge({ tokens }: Props) {
  return (
    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-accent text-xs text-muted-foreground">
      <Coins size={10} />
      <span>{tokens.total.toLocaleString()}</span>
    </span>
  );
}
