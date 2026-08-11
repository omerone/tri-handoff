import { Num } from '@/components/ui/kpi';

/**
 * One budget, as a dial.
 *
 * A bar would have done the arithmetic just as well, and it is the wrong shape for this: a
 * budget has a hard end, and a dial is the instrument people already read as "how far toward
 * the limit". The needle is the point — a number alone makes you compare two figures, the
 * angle makes you see it.
 *
 * The face runs to a quarter *past* the ceiling, and that last stretch is tinted red. Giving
 * the overrun its own painted sector is what lets the needle keep meaning something after the
 * money runs out: "over" and "over by half again" are different situations, and a gauge that
 * pins at full says neither. It also puts the limit somewhere you can see before you reach it,
 * which a fill that simply runs out of track does not.
 *
 * The scale is linear the whole way round — the same degrees per shekel inside the budget and
 * past it — so the red is a change of colour, not a change of rate.
 *
 * Server-rendered SVG: no measuring, no animation, no client bundle. The colours come from
 * theme tokens so it follows light, dark and all three display styles without knowing which.
 */

/** Degrees either side of straight up. 250° in total, open at the bottom. */
const SWEEP = 125;
/** How far past the ceiling the face runs, and where the needle stops. */
const OVERRUN = 0.25;
/** Degrees per 1.0 of ratio, so that 0 sits at one end of the face and 1.25 at the other. */
const PER_RATIO = (SWEEP * 2) / (1 + OVERRUN);

const CENTER = { x: 60, y: 52 };
const RADIUS = 44;

function point(degrees: number): [number, number] {
  const radians = (degrees * Math.PI) / 180;
  return [
    Number((CENTER.x + RADIUS * Math.sin(radians)).toFixed(2)),
    Number((CENTER.y - RADIUS * Math.cos(radians)).toFixed(2)),
  ];
}

function arc(from: number, to: number): string {
  const [x0, y0] = point(from);
  const [x1, y1] = point(to);
  return `M ${x0} ${y0} A ${RADIUS} ${RADIUS} 0 ${to - from > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

const angleFor = (ratio: number) => -SWEEP + Math.min(Math.max(ratio, 0), 1 + OVERRUN) * PER_RATIO;

/** The budget itself, and the stretch past it. */
const SCALE = arc(-SWEEP, angleFor(1));
const OVER = arc(angleFor(1), SWEEP);

export function BudgetGauge({
  ratio,
  label,
  value,
  caption,
  tone,
}: {
  /** Spent ÷ budget, uncapped. 1 is exactly at the ceiling. */
  ratio: number;
  label: string;
  /** The headline figure — what is left, or what it went over by. */
  value: string;
  caption: string;
  tone: 'ok' | 'close' | 'over';
}) {
  const filled = Math.min(1, Math.max(0, ratio));
  const spilled = Math.min(1, Math.max(0, ratio - 1) / OVERRUN);

  const COLOR = { ok: 'var(--tri-pos)', close: 'var(--tri-warn)', over: 'var(--tri-neg)' }[tone];

  return (
    <div className="flex flex-col items-center gap-1">
      <svg viewBox="0 0 120 86" className="w-full max-w-[9rem]" role="img" aria-label={label}>
        {/* The empty face. Drawn whole, so the room left in the allowance stays visible. */}
        <path d={SCALE} fill="none" stroke="var(--tri-line)" strokeWidth={9} strokeLinecap="round" />
        {/* The overrun sector is always painted, faintly: the limit is worth seeing early. */}
        <path d={OVER} fill="none" stroke="var(--tri-neg)" strokeWidth={9} strokeLinecap="round" opacity={0.22} />

        {filled > 0 ? (
          <path
            d={SCALE}
            pathLength={100}
            fill="none"
            stroke={COLOR}
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={`${filled * 100} 100`}
          />
        ) : null}

        {spilled > 0 ? (
          <path
            d={OVER}
            pathLength={100}
            fill="none"
            stroke="var(--tri-neg)"
            strokeWidth={9}
            strokeLinecap="round"
            strokeDasharray={`${spilled * 100} 100`}
          />
        ) : null}

        {/* The needle, and the pin it turns on. */}
        <g transform={`rotate(${angleFor(ratio).toFixed(2)} ${CENTER.x} ${CENTER.y})`}>
          <line
            x1={CENTER.x}
            y1={CENTER.y}
            x2={CENTER.x}
            y2={CENTER.y - 34}
            stroke={COLOR}
            strokeWidth={2.5}
            strokeLinecap="round"
          />
        </g>
        <circle cx={CENTER.x} cy={CENTER.y} r={4.5} fill={COLOR} />
      </svg>

      <div className="text-dim -mt-1 text-[11px] font-semibold">{label}</div>
      <div
        className={`text-[15px] font-bold ${
          tone === 'over' ? 'text-neg' : tone === 'close' ? 'text-warn' : 'text-text'
        }`}
      >
        <Num>{value}</Num>
      </div>
      <div className="text-dim text-[10px]">{caption}</div>
    </div>
  );
}
