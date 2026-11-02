"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { apiPost, fetcher } from "@/lib/apiClient";
import { Card } from "@/components/ui/Card";
import { PlusIcon, RotateIcon } from "@/components/icons";
import BasketChart from "@/components/basket/BasketChart";
import HoldingSheet from "@/components/basket/HoldingSheet";
import { useCurrencyUnit } from "@/lib/currencyUnit";
import { BASKET_KIND_LABELS, type BasketKind } from "@/lib/basketCatalog";
import { BASKET_RANGES, BASKET_RANGE_LABELS, computeBasket, describeAge, formatQuantity, type BasketLine, type BasketRange } from "@/lib/basket";
import { fetchLivePrices, isLive, loadCachedPrices, type PriceBook } from "@/lib/priceClient";
import { toPersianDigits } from "@/lib/money";
import type { BasketHoldingDto, BasketPointDto } from "@/lib/schemas/basket";

type SheetState = { mode: "add" } | { mode: "edit"; line: BasketLine } | null;

/** The prices are read again when the app comes back to the front after this long. */
const REREAD_AFTER_MS = 5 * 60_000;

export default function BasketPage() {
  const { format } = useCurrencyUnit();
  const { data, mutate } = useSWR<{ holdings: BasketHoldingDto[] }>("/api/basket", fetcher);
  const holdings = useMemo(() => data?.holdings ?? [], [data]);
  const [range, setRange] = useState<BasketRange>("1m");
  const { data: history, mutate: mutateHistory } = useSWR<{ points: BasketPointDto[] }>(`/api/basket/history?range=${range}`, fetcher);

  // The prices in use: the last good answer remembered on this device, replaced by a fresh one whenever the server answers.
  const [book, setBook] = useState<PriceBook | null>(null);
  const [reading, setReading] = useState(true);
  const [answered, setAnswered] = useState(false); // the server answered during this visit
  const [live, setLive] = useState(false); // ...and its reading is recent
  const [now, setNow] = useState(() => Date.now());
  const lastReadAt = useRef(0);
  const [sheet, setSheet] = useState<SheetState>(null);

  const readPrices = useCallback(async () => {
    setReading(true);
    const fetched = await fetchLivePrices();
    if (fetched) {
      setBook({ prices: fetched.prices, asOf: fetched.asOf });
      setAnswered(true);
      setLive(isLive(fetched.ageSeconds));
    } else {
      setAnswered(false);
      setLive(false);
    }
    lastReadAt.current = Date.now();
    setNow(Date.now());
    setReading(false);
  }, []);

  useEffect(() => {
    setBook(loadCachedPrices());
    void readPrices();
  }, [readPrices]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastReadAt.current > REREAD_AFTER_MS) void readPrices();
    };
    document.addEventListener("visibilitychange", onVisible);
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(timer);
    };
  }, [readPrices]);

  const summary = useMemo(() => computeBasket(holdings, book?.prices ?? {}), [holdings, book]);

  // Today's value goes into the chart's history — but only from a live reading with every holding priced, and only once
  // per distinct set of holdings and prices, so the page does not write on every render.
  const recordedKey = useRef("");
  useEffect(() => {
    if (!live || !book || !data || !summary.complete) return;
    const key = JSON.stringify([holdings.map((h) => [h.id, h.quantity]), summary.lines.map((l) => [l.asset.id, l.price])]);
    if (recordedKey.current === key) return;
    recordedKey.current = key;
    apiPost("/api/basket/snapshot", { prices: book.prices })
      .then(() => mutateHistory())
      .catch(() => {
        recordedKey.current = "";
      });
  }, [live, book, data, holdings, summary, mutateHistory]);

  const groups = (["CURRENCY", "METAL"] as BasketKind[])
    .map((kind) => ({ kind, lines: summary.lines.filter((l) => l.asset.kind === kind) }))
    .filter((g) => g.lines.length > 0);
  const points = history?.points ?? [];
  const ageSeconds = book ? Math.max(0, Math.round((now - book.asOf) / 1000)) : 0;

  function priceStatus(): string {
    if (reading && !book) return "در حال گرفتن قیمت‌ها...";
    if (!book) return "قیمت لحظه‌ای در دسترس نیست؛ وقتی آنلاین شدی دوباره امتحان کن.";
    if (live) return `قیمت لحظه‌ای · ${describeAge(ageSeconds)}`;
    if (answered) return `قیمت‌ها به‌روز نیست · ${describeAge(ageSeconds)}`;
    return `آفلاین · آخرین قیمت ${describeAge(ageSeconds)}`;
  }

  function onSaved() {
    setSheet(null);
    void mutate();
  }

  return (
    <div className="px-4 py-6 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink">سبد دارایی</h1>
          <p className="text-xs text-muted mt-1 leading-relaxed">ارز، طلا، سکه و نقره‌ات را با قیمت روز ببین.</p>
        </div>
        <button type="button" onClick={() => setSheet({ mode: "add" })} className="shrink-0 flex items-center gap-1 text-sm bg-accent text-on-accent px-3 py-2 rounded-xl hover:opacity-90">
          <PlusIcon className="w-4 h-4" />
          افزودن
        </button>
      </div>

      {!data ? (
        <p className="text-sm text-muted text-center py-8">در حال بارگذاری...</p>
      ) : holdings.length === 0 ? (
        <Card className="p-5 space-y-2">
          <p className="text-sm text-ink font-medium">سبد دارایی‌ات هنوز خالی است.</p>
          <p className="text-xs text-muted leading-relaxed">
            هر چه از دلار، یورو، طلا، سکه و نقره داری اضافه کن و بگو چقدر است؛ ارزش روزش را با قیمت لحظه‌ای می‌بینی و از همین امروز نمودارِ ارزش سبدت شروع به ساخته شدن می‌کند.
          </p>
          <button type="button" onClick={() => setSheet({ mode: "add" })} className="rounded-xl bg-accent text-on-accent px-4 py-2 text-sm font-medium">
            اولین دارایی را اضافه کن
          </button>
        </Card>
      ) : (
        <>
          <Card className="p-5 space-y-1.5">
            <p className="text-xs text-muted">ارزش کل سبد</p>
            <p className="text-2xl font-bold text-ink">{summary.pricedCount > 0 ? format(summary.total, { withSuffix: true }) : "—"}</p>
            {summary.unpricedCount > 0 && summary.pricedCount > 0 && (
              <p className="text-xs text-waste">برای {toPersianDigits(summary.unpricedCount)} دارایی قیمتی در دسترس نیست؛ جمع بالا ناقص است.</p>
            )}
            <div className="flex items-center justify-between gap-2 pt-1">
              <p className={`text-xs ${live ? "text-accent" : "text-muted"}`}>{priceStatus()}</p>
              <button
                type="button"
                onClick={() => void readPrices()}
                disabled={reading}
                aria-label="به‌روزرسانی قیمت‌ها"
                className="flex items-center gap-1 text-xs text-accent disabled:opacity-40"
              >
                <RotateIcon className={`w-3.5 h-3.5 ${reading ? "animate-spin" : ""}`} />
                به‌روزرسانی
              </button>
            </div>
            <p className="text-[11px] text-muted leading-relaxed">این مبلغ جدا از موجودی حساب‌ها و بخش «دارایی‌ها» است و به آن‌ها اضافه نمی‌شود.</p>
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-ink text-sm">ارزش سبد در گذر زمان</h2>
              <div className="flex gap-1">
                {BASKET_RANGES.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => setRange(r)}
                    className={`text-xs px-2.5 py-1 rounded-lg transition ${range === r ? "bg-accent text-on-accent" : "bg-canvas text-muted"}`}
                  >
                    {BASKET_RANGE_LABELS[r]}
                  </button>
                ))}
              </div>
            </div>
            {points.length >= 2 ? (
              <BasketChart points={points} formatValue={(v) => format(v, { withSuffix: true })} />
            ) : points.length === 1 ? (
              <p className="text-xs text-muted text-center py-4 leading-relaxed">
                اولین نقطهٔ نمودار ثبت شد ({format(points[0].totalValue, { withSuffix: true })}). هر روز که سبد را با قیمت لحظه‌ای ببینی یک نقطه اضافه می‌شود.
              </p>
            ) : (
              <p className="text-xs text-muted text-center py-4 leading-relaxed">
                نمودار از اولین باری شروع می‌شود که سبد را با قیمت لحظه‌ای می‌بینی؛ هر روز یک نقطه.
              </p>
            )}
          </Card>

          {groups.map((group) => (
            <section key={group.kind} className="space-y-2">
              <h2 className="font-bold text-ink text-sm">{BASKET_KIND_LABELS[group.kind]}</h2>
              <Card>
                <ul className="divide-y divide-line">
                  {group.lines.map((line) => (
                    <li key={line.asset.id}>
                      <button type="button" onClick={() => setSheet({ mode: "edit", line })} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-right">
                        <span className="flex items-center gap-3 min-w-0">
                          <span className="text-2xl shrink-0">{line.asset.icon}</span>
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-ink truncate">{line.asset.name}</span>
                            <span className="block text-xs text-muted">
                              {formatQuantity(line.quantity)} {line.asset.unit}
                              {line.price !== null ? ` · هر ${line.asset.unit} ${format(line.price)}` : ""}
                            </span>
                          </span>
                        </span>
                        <span className={`text-sm font-bold shrink-0 ${line.value === null ? "text-muted" : "text-ink"}`}>
                          {line.value === null ? "قیمت نامشخص" : format(line.value, { withSuffix: true })}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}

          <p className="text-[11px] text-muted leading-relaxed text-center">قیمت‌ها از tgju.org گرفته می‌شود و فقط برای اطلاع است؛ قیمت خرید و فروش واقعی ممکن است فرق کند.</p>
        </>
      )}

      {sheet && (
        <HoldingSheet
          takenAssetIds={summary.lines.map((l) => l.asset.id)}
          line={sheet.mode === "edit" ? sheet.line : undefined}
          holding={sheet.mode === "edit" ? holdings.find((h) => h.id === sheet.line.holdingIds[0]) : undefined}
          onClose={() => setSheet(null)}
          onSaved={onSaved}
        />
      )}
    </div>
  );
}
