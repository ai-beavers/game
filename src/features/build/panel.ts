import type { Goal } from "./rules.ts";

interface GoalsView {
  show(list: Goal[]): void;
  praise(line: string, more: string, seconds: number): void;
}

let view: GoalsView | undefined, last: Goal[] = [];

export function showGoalsIn(target: GoalsView) {
  view = target;
  target.show(last);
}

export function goalsPanel() {
  return {
    show(list: Goal[]) { last = list; view?.show(list); },
    praise(line: string, more = "", seconds = 6) { view?.praise(line, more, seconds); },
  };
}
