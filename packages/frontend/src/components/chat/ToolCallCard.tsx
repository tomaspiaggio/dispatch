import { useState } from "react";
import type { ToolCallRecord } from "@dispatch/shared";
import { ChevronDown, ChevronRight, Wrench, Check, X, Loader2 } from "lucide-react";

interface Props {
  toolCall: ToolCallRecord;
}

export default function ToolCallCard({ toolCall }: Props) {
  const [expanded, setExpanded] = useState(false);

  const statusIcon = {
    pending: <Loader2 size={14} className="animate-spin text-warning" />,
    success: <Check size={14} className="text-success" />,
    error: <X size={14} className="text-destructive" />,
  }[toolCall.status] ?? <Loader2 size={14} className="animate-spin" />;

  return (
    <div className="border border-border rounded-md bg-card/50 text-sm">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-accent/50 transition-colors"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Wrench size={14} className="text-muted-foreground" />
        <span className="font-mono text-xs">{toolCall.name}</span>
        <span className="flex-1" />
        {statusIcon}
        {toolCall.durationMs != null && (
          <span className="text-xs text-muted-foreground">
            {toolCall.durationMs}ms
          </span>
        )}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2 border-t border-border/50">
          <div>
            <span className="text-xs text-muted-foreground">Args:</span>
            <pre className="text-xs bg-background rounded p-2 mt-1 overflow-x-auto">
              {JSON.stringify(toolCall.args, null, 2)}
            </pre>
          </div>
          {toolCall.result !== undefined && (
            <div>
              <span className="text-xs text-muted-foreground">Result:</span>
              <pre className="text-xs bg-background rounded p-2 mt-1 overflow-x-auto max-h-48 overflow-y-auto">
                {typeof toolCall.result === "string"
                  ? toolCall.result
                  : JSON.stringify(toolCall.result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
