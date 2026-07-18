import type { ApmSpan } from "../types/monitoring";

interface SpanNode extends ApmSpan {
  children: SpanNode[];
  depth: number;
}

function buildTree(spans: ApmSpan[]): SpanNode[] {
  const byId = new Map<string, SpanNode>(spans.map((s) => [s.id, { ...s, children: [], depth: 0 }]));
  const roots: SpanNode[] = [];
  for (const node of byId.values()) {
    const parent = node.parent_span_id ? byId.get(node.parent_span_id) : undefined;
    if (parent) {
      node.depth = parent.depth + 1;
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  const flatten = (nodes: SpanNode[]): SpanNode[] =>
    nodes.flatMap((n) => [n, ...flatten(n.children)]);
  return flatten(roots);
}

/** A trace's span tree as a waterfall: one bar per span, indented by depth, width proportional to duration. */
export default function ApmSpanWaterfall({ spans }: { spans: ApmSpan[] }) {
  if (spans.length === 0) return <p className="hint">No spans recorded for this trace.</p>;
  const ordered = buildTree(spans);
  const maxDuration = Math.max(1, ...spans.map((s) => s.duration_ms));

  return (
    <div className="synthetic-waterfall">
      {ordered.map((s) => (
        <div key={s.id} className="synthetic-waterfall-row" style={{ paddingLeft: `${s.depth * 1}rem` }}>
          <span className="synthetic-waterfall-label">
            {s.name} <span className="hint">({s.kind})</span>
          </span>
          <span className="synthetic-waterfall-track">
            <span className="synthetic-waterfall-bar" style={{ width: `${Math.max(4, (s.duration_ms / maxDuration) * 100)}%` }} />
          </span>
          <span className="hint">{s.duration_ms}ms</span>
        </div>
      ))}
    </div>
  );
}
