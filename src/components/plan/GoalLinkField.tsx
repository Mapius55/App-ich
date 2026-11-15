// «Gehört zu»: which goal or dream an entry or a habit belongs to. Dreams and goals are told
// apart (two groups once there are both); dropped goals and fulfilled dreams stay out, unless
// the entry already belongs to one (so it can be seen and unlinked).
import type { Goal } from "../../lib/types";

export interface GoalLinkOptions {
  dreams: Goal[];
  goals: Goal[];
}

/** what the select offers: open dreams and goals, plus the current one whatever its status */
export function goalLinkOptions(all: Goal[], current: string | null | undefined): GoalLinkOptions {
  const offered = all.filter((g) => g.id === current || (g.status !== "dropped" && !(g.kind === "dream" && g.status === "done")));
  return { dreams: offered.filter((g) => g.kind === "dream"), goals: offered.filter((g) => g.kind !== "dream") };
}

/** the field's words for what is offered */
export function goalLinkWords(o: GoalLinkOptions): { label: string; none: string } {
  if (o.dreams.length && o.goals.length) return { label: "Gehört zu", none: "Kein Ziel oder Traum" };
  if (o.dreams.length) return { label: "Gehört zu Traum", none: "Kein Traum" };
  return { label: "Gehört zu Ziel", none: "Kein Ziel" };
}

/** «Traum ansehen» or «Ziel ansehen» */
export const goalLinkView = (g: Pick<Goal, "kind"> | undefined): string => (g?.kind === "dream" ? "Traum ansehen" : "Ziel ansehen");

export function GoalLinkField({ goals, current, value, onChange }: { goals: Goal[]; current: string | null | undefined; value: string; onChange(id: string): void }) {
  const o = goalLinkOptions(goals, current);
  if (!o.dreams.length && !o.goals.length) return null;
  const words = goalLinkWords(o);
  const option = (g: Goal) => (
    <option key={g.id} value={g.id}>
      {g.title}
    </option>
  );
  return (
    <label className="sheet-field">
      <span>{words.label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{words.none}</option>
        {o.dreams.length && o.goals.length ? (
          <>
            <optgroup label="Träume">{o.dreams.map(option)}</optgroup>
            <optgroup label="Ziele">{o.goals.map(option)}</optgroup>
          </>
        ) : (
          [...o.dreams, ...o.goals].map(option)
        )}
      </select>
    </label>
  );
}
