// The build feature's goals and its line of praise. The HUD (src/features/hud) shows both in its own panel and
// style once it is there (showGoalsIn); without the HUD (lab/build.html) a plain box of its own shows them instead.
// Both hide while body has the class "photo".
//
//   const panel = goalsPanel();
//   panel.show(goals(state));          after every change
//   panel.praise("The dam holds.", "…");
//   showGoalsIn(view)                  the HUD takes the goals over: the plain box goes, the last list is shown at once
import type { Goal } from "./rules.ts";

export interface GoalsView {
  show(list: Goal[]): void;
  praise(line: string, more: string, seconds: number): void;
}

// One game per page, so one place the goals are shown.
let view: GoalsView | undefined, plain: (GoalsView & { remove(): void }) | undefined, last: Goal[] | undefined;

export function showGoalsIn(target: GoalsView) {
  plain?.remove();
  plain = undefined;
  view = target;
  if (last) target.show(last);
}

export function goalsPanel() {
  const target = () => view ?? (plain ??= plainBox());
  return {
    show(list: Goal[]) { last = list; target().show(list); },
    praise(line: string, more = "", seconds = 6) { target().praise(line, more, seconds); },
  };
}

const STYLE = `
#build-goals { position: fixed; left: 14px; top: 62px; z-index: 5; pointer-events: none; user-select: none;
  font: 13px/1.45 system-ui, -apple-system, sans-serif; color: #f4efe4; background: rgba(18, 22, 28, 0.74);
  border-radius: 12px; padding: 8px 12px 9px; }
#build-goals div.done { opacity: 0.5; text-decoration: line-through; }
#build-praise { position: fixed; left: 0; right: 0; top: 20%; z-index: 5; text-align: center; pointer-events: none;
  font: 600 32px/1.2 system-ui, -apple-system, sans-serif; color: #fff7e6; text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6);
  opacity: 0; transition: opacity 0.9s; }
#build-praise small { display: block; font-size: 16px; font-weight: 500; margin-top: 6px; }
#build-praise.on { opacity: 1; }
body.photo #build-goals, body.photo #build-praise { display: none; }
`;

/** The goals without the HUD: a plain list top left, praise across the middle. */
function plainBox(): GoalsView & { remove(): void } {
  const style = document.createElement("style");
  style.textContent = STYLE;
  const box = document.createElement("div"), praise = document.createElement("div");
  box.id = "build-goals";
  praise.id = "build-praise";
  document.head.append(style);
  document.body.append(box, praise);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return {
    show(list) {
      box.replaceChildren(...list.map((g) => Object.assign(document.createElement("div"), {
        className: g.done ? "done" : "", textContent: `${g.done ? "✓" : "·"} ${g.text}`,
      })));
    },
    praise(line, more, seconds) {
      praise.replaceChildren(line, Object.assign(document.createElement("small"), { textContent: more }));
      praise.classList.add("on");
      clearTimeout(timer);
      timer = setTimeout(() => praise.classList.remove("on"), seconds * 1000);
    },
    remove() { clearTimeout(timer); style.remove(); box.remove(); praise.remove(); },
  };
}
