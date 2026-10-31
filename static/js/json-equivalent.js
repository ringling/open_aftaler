// Builds the JSON a JSON-based generative-UI format would need for the same view, from the parse
// result OpenUI's Renderer reports (onParseResult). Used to compare token counts fairly:
//   components   -> {"type": "Card", "props": {...}}
//   plain values -> ordinary JSON
//   live values  -> {"$expr": "Count(tasks.rows)"} (queries, state, built-in functions)
//   plus "state", "queries" and "mutations" sections, keyed by name.
// The result is minified, which is the cheapest form of JSON, so the comparison stays conservative.

// Prints an expression from the parser's syntax tree back as compact source text.
function expr(n) {
  if (n == null) return "null";
  switch (n.k) {
    case "Str": return JSON.stringify(n.v);
    case "Num": case "Bool": return String(n.v);
    case "Null": return "null";
    case "Arr": return `[${(n.els || []).map(expr).join(", ")}]`;
    case "Obj": return `{${(n.entries || []).map(([k, v]) => `${k}: ${expr(v)}`).join(", ")}}`;
    case "RuntimeRef": case "Ref": case "StateRef": return n.n ?? n.name;
    case "Member": return `${expr(n.obj)}.${n.field}`;
    case "Index": return `${expr(n.obj)}[${expr(n.index)}]`;
    case "BinOp": return `${expr(n.left)} ${n.op} ${expr(n.right)}`;
    case "UnaryOp": case "Unary": return `${n.op}${expr(n.operand ?? n.arg)}`;
    case "Ternary": case "Cond": return `${expr(n.cond ?? n.test)} ? ${expr(n.then ?? n.consequent)} : ${expr(n.else ?? n.alternate)}`;
    case "Comp": return `${n.name}(${(n.args || []).map(expr).join(", ")})`;
    default: return JSON.stringify(n); // an expression kind this printer doesn't know: keep it whole
  }
}

// A syntax-tree value: plain data becomes JSON, anything live becomes {"$expr": "..."}.
function value(n) {
  if (n == null || typeof n !== "object") return n;
  if (n.type === "element") return element(n);
  if (Array.isArray(n)) return n.map(value);
  if (!("k" in n)) return Object.fromEntries(Object.entries(n).map(([k, v]) => [k, value(v)]));
  switch (n.k) {
    case "Str": case "Num": case "Bool": return n.v;
    case "Null": return null;
    case "Arr": return (n.els || []).map(value);
    case "Obj": return Object.fromEntries((n.entries || []).map(([k, v]) => [k, value(v)]));
    default: return { $expr: expr(n) };
  }
}

function element(node) {
  const props = {};
  for (const [k, v] of Object.entries(node.props || {})) if (v !== undefined) props[k] = value(v);
  return { type: node.typeName, props };
}

export function jsonEquivalent(parseResult) {
  if (!parseResult?.root) return null;
  const out = {};
  if (parseResult.stateDeclarations && Object.keys(parseResult.stateDeclarations).length) {
    out.state = parseResult.stateDeclarations;
  }
  const statements = (list, withDefaults) => Object.fromEntries((list || []).map((q) => [q.statementId, {
    tool: value(q.toolAST),
    args: value(q.argsAST),
    ...(withDefaults && q.defaultsAST ? { default: value(q.defaultsAST) } : {}),
  }]));
  if (parseResult.queryStatements?.length) out.queries = statements(parseResult.queryStatements, true);
  if (parseResult.mutationStatements?.length) out.mutations = statements(parseResult.mutationStatements, false);
  out.root = element(parseResult.root);
  return JSON.stringify(out);
}
