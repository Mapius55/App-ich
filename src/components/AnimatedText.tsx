import { memo } from "react";

// Words surface softly: each one fades in out of a slight blur. While the
// coach is still writing, new words animate as they arrive; for a message
// loaded from history, `stagger` lets the words follow one another.
export const AnimatedText = memo(function AnimatedText({ text, stagger = false }: { text: string; stagger?: boolean }) {
  const parts = text.split(/(\s+)/);
  let word = 0;
  return (
    <>
      {parts.map((p, i) => {
        if (/^\s+$/.test(p) || p === "") return p;
        const delay = stagger ? Math.min(word++ * 45, 2200) : 0;
        return (
          <span key={i} className="w" style={delay ? { animationDelay: `${delay}ms` } : undefined}>
            {p}
          </span>
        );
      })}
    </>
  );
});
