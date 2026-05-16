import type { SVGProps } from "react";

export function TallyMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 120 120" focusable="false" {...props}>
      <g fill="none" stroke="currentColor" strokeLinecap="square" strokeWidth="6">
        <line x1="34" y1="30" x2="34" y2="90" />
        <line x1="48" y1="30" x2="48" y2="90" />
        <line x1="62" y1="30" x2="62" y2="90" />
        <line x1="76" y1="30" x2="76" y2="90" />
        <line x1="24" y1="82" x2="86" y2="38" />
      </g>
    </svg>
  );
}
