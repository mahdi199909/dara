"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { toPersianDigits } from "@/lib/money";
import type { BasketPointDto } from "@/lib/schemas/basket";

// A day key is already a Jalali "jy-jm-jd" string (see jalaliDateKey in src/lib/jalali.ts) — no conversion needed.
function shortDay(key: string): string {
  const [, jm, jd] = key.split("-").map(Number);
  return toPersianDigits(`${jd}/${jm}`);
}

function longDay(key: string): string {
  const [jy, jm, jd] = key.split("-").map(Number);
  return toPersianDigits(`${jy}/${String(jm).padStart(2, "0")}/${String(jd).padStart(2, "0")}`);
}

/** The basket's value, one point per recorded day. The vertical scale is hidden on purpose: the figures are in the tooltip and the summary. */
export default function BasketChart({ points, formatValue }: { points: BasketPointDto[]; formatValue: (toman: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height={190}>
      <LineChart data={points} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
        <XAxis dataKey="date" tickFormatter={shortDay} tick={{ fontSize: 10 }} interval="preserveStartEnd" tickLine={false} />
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Tooltip labelFormatter={(key) => longDay(String(key))} formatter={(value: number) => [formatValue(value), "ارزش سبد"]} />
        <Line type="monotone" dataKey="totalValue" stroke="#279183" strokeWidth={2} dot={points.length <= 31} />
      </LineChart>
    </ResponsiveContainer>
  );
}
