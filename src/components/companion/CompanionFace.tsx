// Pure SVG rendering of the Companion's eight approved moods — no state, no fetch, no text.
// Geometry ported verbatim from doc/companion-preview.html (the approved visual reference); do
// not "improve" any curve here without re-approving against that file first. See
// moodTokens.ts for the color mapping and MOOD_FA_LABEL used as this component's aria fallback.
import type { CompanionMood } from "@/lib/companion";
import { MOOD_TOKENS, MOOD_FA_LABEL, RING_TRACK_COLOR, BLINDFOLD_BAND_COLOR, CONFETTI_COLORS } from "./moodTokens";

export interface CompanionFaceProps {
  mood: CompanionMood;
  completion: number; // 0..1+, clamped internally
  size?: number; // px, default 96
  variant?: "face" | "figure"; // default "face"
  label?: string; // aria-label; built from mood if not given
}

const RING_RADIUS = 44;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function Dot({ x, y, r, ink, fill, hi }: { x: number; y: number; r: number; ink: string; fill: string; hi: boolean }) {
  return (
    <>
      <circle cx={x} cy={y} r={r} fill={ink} stroke="none" />
      {hi && <circle cx={x + r * 0.36} cy={y - r * 0.36} r={r * 0.3} fill={fill} stroke="none" />}
    </>
  );
}

function Eyes({ x1, x2, y, mood, k, ink, fill }: { x1: number; x2: number; y: number; mood: CompanionMood; k: number; ink: string; fill: string }) {
  const w = 4.6 * k;
  const sw = 2.6 * k;
  const strokeProps = { fill: "none", stroke: ink, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  switch (mood) {
    case "ASLEEP":
      return (
        <>
          <path {...strokeProps} strokeWidth={sw} d={`M${x1 - w} ${y - k} q${w} ${4.4 * k} ${2 * w} 0`} />
          <path {...strokeProps} strokeWidth={sw} d={`M${x2 - w} ${y - k} q${w} ${4.4 * k} ${2 * w} 0`} />
        </>
      );
    case "CELEBRATING":
      return (
        <>
          <path {...strokeProps} strokeWidth={sw * 1.1} d={`M${x1 - w} ${y + 2 * k} q${w} ${-6.2 * k} ${2 * w} 0`} />
          <path {...strokeProps} strokeWidth={sw * 1.1} d={`M${x2 - w} ${y + 2 * k} q${w} ${-6.2 * k} ${2 * w} 0`} />
        </>
      );
    case "SLEEPY":
      return (
        <>
          <Dot x={x1} y={y + 1.3 * k} r={2.7 * k} ink={ink} fill={fill} hi={false} />
          <Dot x={x2} y={y + 1.3 * k} r={2.7 * k} ink={ink} fill={fill} hi={false} />
          <path {...strokeProps} strokeWidth={2.9 * k} d={`M${x1 - w} ${y - 0.6 * k} h${2 * w}`} />
          <path {...strokeProps} strokeWidth={2.9 * k} d={`M${x2 - w} ${y - 0.6 * k} h${2 * w}`} />
        </>
      );
    case "BLINDFOLDED": {
      const bx = x1 - w - 2.6 * k;
      const bw = x2 - x1 + 2 * w + 5.2 * k;
      const bh = 8.2 * k;
      return <rect x={bx} y={y - bh / 2} width={bw} height={bh} rx={bh / 2} fill={BLINDFOLD_BAND_COLOR} stroke="none" />;
    }
    case "HAPPY":
      return (
        <>
          <Dot x={x1} y={y} r={3.5 * k} ink={ink} fill={fill} hi />
          <Dot x={x2} y={y} r={3.5 * k} ink={ink} fill={fill} hi />
        </>
      );
    case "CONTENT":
      return (
        <>
          <Dot x={x1} y={y} r={3.1 * k} ink={ink} fill={fill} hi />
          <Dot x={x2} y={y} r={3.1 * k} ink={ink} fill={fill} hi />
        </>
      );
    case "FRESH":
      return (
        <>
          <Dot x={x1} y={y} r={3.0 * k} ink={ink} fill={fill} hi={false} />
          <Dot x={x2} y={y} r={3.0 * k} ink={ink} fill={fill} hi={false} />
        </>
      );
    default: // NEUTRAL
      return (
        <>
          <Dot x={x1} y={y} r={2.8 * k} ink={ink} fill={fill} hi={false} />
          <Dot x={x2} y={y} r={2.8 * k} ink={ink} fill={fill} hi={false} />
        </>
      );
  }
}

function Mouth({ x, y, mood, k, ink }: { x: number; y: number; mood: CompanionMood; k: number; ink: string }) {
  const sw = 2.9 * k;
  const strokeProps = { fill: "none", stroke: ink, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

  switch (mood) {
    case "ASLEEP":
      return <ellipse cx={x} cy={y} rx={2.3 * k} ry={1.9 * k} fill={ink} opacity={0.6} />;
    case "SLEEPY":
      return <ellipse cx={x} cy={y + 0.6 * k} rx={2.9 * k} ry={3.9 * k} fill={ink} opacity={0.75} />;
    case "FRESH":
      return <path {...strokeProps} strokeWidth={sw} d={`M${x - 4.6 * k} ${y} q${4.6 * k} ${2.3 * k} ${9.2 * k} 0`} />;
    case "BLINDFOLDED":
      return <path {...strokeProps} strokeWidth={sw} d={`M${x - 5 * k} ${y} q${2.5 * k} ${-2.4 * k} ${5 * k} 0 t${5 * k} 0`} />;
    case "CONTENT":
      return <path {...strokeProps} strokeWidth={sw} d={`M${x - 5.8 * k} ${y - 0.6 * k} q${5.8 * k} ${4.6 * k} ${11.6 * k} 0`} />;
    case "HAPPY":
      return <path {...strokeProps} strokeWidth={sw * 1.15} d={`M${x - 7.4 * k} ${y - 1.2 * k} q${7.4 * k} ${7.6 * k} ${14.8 * k} 0`} />;
    case "CELEBRATING":
      return <path fill={ink} stroke="none" d={`M${x - 7.8 * k} ${y - 1.6 * k} q${7.8 * k} ${10.4 * k} ${15.6 * k} 0 z`} />;
    default: // NEUTRAL
      return <path {...strokeProps} strokeWidth={sw} d={`M${x - 5.2 * k} ${y} h${10.4 * k}`} />;
  }
}

const CONFETTI_POINTS: [number, number][] = [
  [16, 20],
  [84, 22],
  [8, 58],
  [92, 56],
  [30, 6],
  [70, 4],
];

function Confetti() {
  return (
    <g style={{ transformOrigin: "50px 50px" }}>
      {CONFETTI_POINTS.map(([cx, cy], i) => (
        <circle
          key={i}
          cx={cx}
          cy={cy}
          r={2.6}
          fill={CONFETTI_COLORS[i % CONFETTI_COLORS.length]}
          className="companion-confetti-dot"
          style={{ animationDelay: `${i * 70}ms` }}
        />
      ))}
    </g>
  );
}

export default function CompanionFace({ mood, completion, size = 96, variant = "face", label }: CompanionFaceProps) {
  const { fill, ink, ring } = MOOD_TOKENS[mood];
  const pct = Math.max(0, Math.min(1, completion));
  const dashOffset = RING_CIRCUMFERENCE * (1 - pct);
  const ariaLabel = label ?? `آدمک: ${MOOD_FA_LABEL[mood]}`;
  const headProps = { fill, stroke: ink, strokeWidth: 1.8, strokeOpacity: 0.28 };

  let inner: React.ReactNode;
  if (variant === "figure") {
    const k = 0.74;
    const arms =
      mood === "CELEBRATING" ? (
        <>
          <path fill="none" stroke={ink} strokeWidth={4} strokeLinecap="round" d="M36 65 L26 52" />
          <path fill="none" stroke={ink} strokeWidth={4} strokeLinecap="round" d="M64 65 L74 52" />
        </>
      ) : (
        <>
          <path fill="none" stroke={ink} strokeWidth={4} strokeLinecap="round" d="M36 65 L27 73" />
          <path fill="none" stroke={ink} strokeWidth={4} strokeLinecap="round" d="M64 65 L73 73" />
        </>
      );
    inner = (
      <g className={mood === "CELEBRATING" ? "companion-bob" : undefined}>
        {arms}
        <path {...headProps} d="M36 58 h28 a13 13 0 0 1 13 13 v11 h-54 v-11 a13 13 0 0 1 13 -13 z" />
        <circle {...headProps} cx={50} cy={35} r={19.5} />
        <Eyes x1={43.4} x2={56.6} y={33} mood={mood} k={k} ink={ink} fill={fill} />
        <Mouth x={50} y={43.5} mood={mood} k={k} ink={ink} />
        {mood === "ASLEEP" && (
          <>
            <text x={76} y={14} fontSize={11} fill={ink} opacity={0.55} fontFamily="monospace" fontWeight={500}>
              z
            </text>
            <text x={86} y={6} fontSize={8} fill={ink} opacity={0.55} fontFamily="monospace" fontWeight={500}>
              z
            </text>
          </>
        )}
        {mood === "BLINDFOLDED" && (
          <text x={50} y={9} fontSize={15} fill={BLINDFOLD_BAND_COLOR} textAnchor="middle" fontWeight={700}>
            ؟
          </text>
        )}
      </g>
    );
  } else {
    const k = 1;
    inner = (
      <g>
        <circle {...headProps} cx={50} cy={50} r={30} />
        <Eyes x1={39.5} x2={60.5} y={45.5} mood={mood} k={k} ink={ink} fill={fill} />
        <Mouth x={50} y={61} mood={mood} k={k} ink={ink} />
        {mood === "ASLEEP" && (
          <>
            <text x={76} y={18} fontSize={11} fill={ink} opacity={0.55} fontFamily="monospace" fontWeight={500}>
              z
            </text>
            <text x={86} y={10} fontSize={8} fill={ink} opacity={0.55} fontFamily="monospace" fontWeight={500}>
              z
            </text>
          </>
        )}
        {mood === "BLINDFOLDED" && (
          <text x={50} y={6} fontSize={15} fill={BLINDFOLD_BAND_COLOR} textAnchor="middle" fontWeight={700}>
            ؟
          </text>
        )}
      </g>
    );
  }

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ overflow: "visible" }}
      className="companion-face"
      data-mood={mood}
    >
      <circle cx={50} cy={50} r={RING_RADIUS} fill="none" stroke={RING_TRACK_COLOR} strokeWidth={5} />
      <circle
        cx={50}
        cy={50}
        r={RING_RADIUS}
        fill="none"
        stroke={ring}
        strokeWidth={5}
        strokeLinecap="round"
        transform="rotate(-90 50 50)"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={dashOffset}
        className="companion-ring"
      />
      {mood === "CELEBRATING" && <Confetti />}
      {inner}
    </svg>
  );
}
