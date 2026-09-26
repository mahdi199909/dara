"use client";

// One month of the story, laid out to be read: a chapter heading that stays in view while its days scroll past, a
// short summary of the month, then each day as a few paragraphs of prose — the person's own notes set apart as quotes.
import { TOP_BAR_HEIGHT_PX } from "@/lib/layoutConstants";
import type { JourneyChapter, JourneyDay, JourneyGap } from "@/lib/journeyTypes";

function DayView({ day }: { day: JourneyDay }) {
  return (
    <article aria-label={day.label}>
      <div className="flex items-center gap-2">
        {day.landmark && (
          <span aria-hidden className="text-accent text-xs">
            ◆
          </span>
        )}
        <h3 className="text-sm font-bold text-ink">{day.label}</h3>
        {day.relative && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] text-accent">{day.relative}</span>}
      </div>

      <div className="mt-1.5 space-y-3">
        {day.paragraphs.map((paragraph, i) => (
          <p key={i} className="text-[15px] leading-8 text-ink break-words">
            {paragraph}
          </p>
        ))}
        {day.notes.map((note, i) => (
          <div key={i}>
            <p className="text-[15px] leading-8 text-ink">{note.lead}:</p>
            <blockquote className="mt-0.5 border-r-2 border-accent/50 pr-3 text-[15px] leading-8 text-muted whitespace-pre-wrap break-words">{note.text}</blockquote>
          </div>
        ))}
      </div>
    </article>
  );
}

function GapView({ gap }: { gap: JourneyGap }) {
  return <p className="text-center text-xs text-muted/80">{gap.text}</p>;
}

export default function JourneyChapterView({ chapter }: { chapter: JourneyChapter }) {
  return (
    <section aria-labelledby={`chapter-${chapter.key}`} className="pb-10">
      <div className="sticky z-10 border-b border-line bg-canvas/95 px-4 py-2 backdrop-blur" style={{ top: TOP_BAR_HEIGHT_PX }}>
        <h2 id={`chapter-${chapter.key}`} className="text-base font-bold text-ink">
          {chapter.title}
        </h2>
        {chapter.subtitle && <p className="text-xs text-accent">{chapter.subtitle}</p>}
      </div>

      <div className="px-4">
        {chapter.summary && <p className="mt-3 text-sm leading-7 text-muted">{chapter.summary}</p>}
        {chapter.entries.length === 0 && !chapter.summary && <p className="mt-3 text-sm text-muted">در این ماه چیزی ثبت نکردم.</p>}
        <div className="mt-5 space-y-7">
          {chapter.entries.map((entry) => (entry.kind === "day" ? <DayView key={entry.key} day={entry} /> : <GapView key={`gap-${entry.from}`} gap={entry} />))}
        </div>
      </div>
    </section>
  );
}
