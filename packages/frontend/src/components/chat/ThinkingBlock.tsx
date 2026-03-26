import { useState } from "react";
import { Brain, ChevronDown, ChevronRight } from "lucide-react";

interface Props {
  thinking: string;
}

export default function ThinkingBlock({ thinking }: Props) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mb-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <Brain size={12} />
        <span>Thinking</span>
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
      </button>
      {expanded && (
        <pre className="text-xs text-muted-foreground bg-background rounded p-2 mt-1 whitespace-pre-wrap max-h-48 overflow-y-auto">
          {thinking}
        </pre>
      )}
    </div>
  );
}
