// Custom OpenUI components, added to the built-in chat library.
//
// A component is a name, a description and a Zod props schema (these go in the system
// prompt, so Claude knows how to call it) plus a React function that renders it.
// Prop order in the schema is the argument order in OpenUI Lang:
//   s = Stat("17×", "fewer gates than the best known circuit")
//
// The browser bundle doesn't export Zod or defineComponent, so Zod is loaded at the exact
// version the bundle uses (4.4.3), and defineComponent is replicated below.
import { z } from "https://cdn.jsdelivr.net/npm/zod@4.4.3/+esm";

const { React, openuiChatLibrary } = window.__OpenUI;
const h = React.createElement;

// Same shape as @openuidev/react-lang's defineComponent: `ref` lets other schemas use it as a child type.
function defineComponent(def) {
  return { ...def, ref: def.props };
}

// A key figure and what it measures, in Pearl's stat style (accent figure, muted caption).
const Stat = defineComponent({
  name: "Stat",
  description: "A headline number and a short caption saying what it measures. Use inside Stats.",
  props: z.object({
    figure: z.string(),
    caption: z.string(),
  }),
  component: ({ props }) =>
    h("div", { className: "pearl-stat" },
      h("span", { className: "pearl-stat__figure" }, props.figure),
      h("span", { className: "pearl-stat__caption" }, props.caption)),
});

// A row of Stat figures. renderNode renders child components, including ones still streaming in.
const Stats = defineComponent({
  name: "Stats",
  description: "A row of key figures. Lead with these when an answer is about numbers.",
  props: z.object({
    items: z.array(Stat.ref),
  }),
  component: ({ props, renderNode }) =>
    h("div", { className: "stats-row" }, renderNode(props.items)),
});

// Stats can go anywhere a Card child can; Stat is only listed, for use inside Stats.
export const library = openuiChatLibrary.extend({
  components: {
    add: [{ component: Stats, slots: ["Card.children"] }, Stat],
  },
});
