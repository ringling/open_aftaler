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

// The components below take plain arrays, like OpenUI's own Col(), so they work with live tool data:
//   Column("Open", tasks.rows.title, tasks.rows.priority)
// While a Query is loading, or a reply is still streaming, an argument can be missing; list() and
// text() keep that from breaking the render.
const list = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const text = (v) => (v == null ? "" : String(v));
const textOrNumber = z.union([z.string(), z.number()]);

// ISO dates such as "2026-10-28T09:15:00Z" are shown as "28 Oct 2026"; anything else as written.
function formatDate(v) {
  const s = text(v);
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return s;
  const d = new Date(s);
  return isNaN(d) ? s : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// A progress meter: label, "value / max", and a recessed track with an accent fill.
const Meter = defineComponent({
  name: "Meter",
  description: "Progress toward a goal, as a labelled bar, e.g. Meter(\"Tasks done\", 7, 10). max defaults to 100.",
  props: z.object({
    label: z.string(),
    value: z.number(),
    max: z.number().optional(),
    caption: z.string().optional(),
  }),
  component: ({ props }) => {
    const max = Number(props.max) > 0 ? Number(props.max) : 100;
    const value = Math.max(0, Number(props.value) || 0);
    const pct = Math.min(100, Math.round((100 * value) / max));
    return h("div", { className: "ui-meter" },
      h("div", { className: "ui-meter__head" },
        h("span", { className: "ui-meter__label" }, text(props.label)),
        h("span", { className: "ui-meter__value" }, max === 100 ? `${pct}%` : `${value} / ${max}`)),
      h("div", { className: "ui-meter__track", role: "progressbar", "aria-valuenow": value, "aria-valuemin": 0, "aria-valuemax": max, "aria-label": text(props.label) },
        h("div", { className: "ui-meter__fill", style: { width: `${pct}%` } })),
      props.caption ? h("div", { className: "ui-meter__caption" }, props.caption) : null);
  },
});

// A vertical timeline of dated events, newest or oldest first as given.
const Timeline = defineComponent({
  name: "Timeline",
  description: "Dated events on a vertical line, for plans, histories and roadmaps. Arrays are matched by position; dates may be ISO strings.",
  props: z.object({
    dates: z.array(z.string()),
    titles: z.array(z.string()),
    details: z.array(z.string()).optional(),
  }),
  component: ({ props }) => {
    const dates = list(props.dates), details = list(props.details);
    return h("ol", { className: "ui-timeline" },
      list(props.titles).map((title, i) =>
        h("li", { key: i, className: "ui-timeline__item" },
          h("span", { className: "ui-timeline__date" }, formatDate(dates[i])),
          h("span", { className: "ui-timeline__title" }, text(title)),
          details[i] ? h("span", { className: "ui-timeline__detail" }, text(details[i])) : null)));
  },
});

// A two-column list of labels and values, separated by engraved rules.
const Facts = defineComponent({
  name: "Facts",
  description: "Label/value pairs for the details of one record, e.g. Facts([\"Owner\", \"Due\"], [\"Thomas\", \"Friday\"]).",
  props: z.object({
    labels: z.array(z.string()),
    values: z.array(textOrNumber),
  }),
  component: ({ props }) => {
    const values = list(props.values);
    return h("dl", { className: "ui-facts" },
      list(props.labels).flatMap((label, i) => [
        h("dt", { key: `l${i}` }, text(label)),
        h("dd", { key: `v${i}` }, /^\d{4}-\d{2}-\d{2}T/.test(text(values[i])) ? formatDate(values[i]) : text(values[i])),
      ]));
  },
});

// One Kanban column: a title, a count and a card per item, with an optional tag per card.
const Column = defineComponent({
  name: "Column",
  description: "One column of a Board: a title, item names, and an optional tag per item (e.g. priority). The item count is shown automatically, so don't put it in the title. Use inside Board.",
  props: z.object({
    title: z.string(),
    items: z.array(z.string()),
    tags: z.array(z.string()).optional(),
  }),
  component: ({ props }) => {
    const items = list(props.items), tags = list(props.tags);
    return h("section", { className: "ui-column" },
      h("div", { className: "ui-column__head" },
        h("span", null, text(props.title)),
        h("span", { className: "ui-column__count" }, items.length)),
      items.length
        ? items.map((item, i) =>
            h("div", { key: i, className: "ui-column__card pearl-engrave" },
              h("span", null, text(item)),
              tags[i] ? h("span", { className: "pearl-tag ui-column__tag" }, text(tags[i])) : null))
        : h("div", { className: "ui-column__empty" }, "Nothing here"));
  },
});

// A Kanban board: Columns side by side, wrapping on narrow screens.
const Board = defineComponent({
  name: "Board",
  description: "A Kanban board of Columns, e.g. tasks by status. Feed Columns with Query results.",
  props: z.object({
    columns: z.array(Column.ref),
  }),
  component: ({ props, renderNode }) => h("div", { className: "ui-board" }, renderNode(props.columns)),
});

// Stats, Meter, Timeline, Facts and Board can go anywhere a Card child can. Stat and Column are only
// listed, for use inside Stats and Board.
export const library = openuiChatLibrary.extend({
  components: {
    add: [
      { component: Stats, slots: ["Card.children"] },
      Stat,
      { component: Meter, slots: ["Card.children"] },
      { component: Timeline, slots: ["Card.children"] },
      { component: Facts, slots: ["Card.children"] },
      { component: Board, slots: ["Card.children"] },
      Column,
    ],
  },
});
