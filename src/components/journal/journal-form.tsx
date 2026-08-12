'use client';

import { SuggestField } from '@/components/ui/suggest-field';

import { useActionState } from 'react';
import { Star } from 'lucide-react';
import { useState } from 'react';
import { FormMessage, SubmitButton } from '@/components/ui/form';

/** What both save actions answer with. */
export type JournalFormState = { error?: string; notice?: string };

export type JournalLabels = {
  note: string;
  notePlaceholder: string;
  tags: string;
  tagsHint: string;
  rating: string;
  ratingNone: string;
  mood: string;
  moodPlaceholder: string;
  strategy: string;
  strategyPlaceholder: string;
  save: string;
};

export type JournalValues = {
  id: string;
  note: string;
  tags: string;
  rating: number | null;
  mood: string;
  strategy: string;
};

const field =
  'border-line bg-raised text-text placeholder:text-dim/60 rounded-[10px] border px-3 py-2 text-sm';

/**
 * The journal (SPEC §1.1). Free text throughout, with suggestions drawn from what the trader
 * has already written — the same reasoning as the finance categories: a fixed vocabulary is
 * wrong for one user per tenant, and no vocabulary at all turns "Breakout", "breakout" and
 * "break-out" into three strategies inside a month.
 *
 * The save action is a prop, because there are two books and one journal. A synced trade and a
 * long-term holding are different rows in different tables with different lifecycles, and the
 * *form* is not: the same five fields, the same star widget that clears on a second click, the
 * same shared vocabulary. Copying it to serve the second book would have meant two of those
 * behaviours to keep in step, and this one is fiddly enough that they would have drifted.
 */
export function JournalForm({
  values,
  labels,
  vocabulary,
  save,
}: {
  values: JournalValues;
  labels: JournalLabels;
  vocabulary: { strategies: string[]; tags: string[]; moods: string[] };
  /** The server action that writes it — one per book. */
  save: (prev: JournalFormState, formData: FormData) => Promise<JournalFormState>;
}) {
  const [state, action] = useActionState<JournalFormState, FormData>(save, {});
  const [rating, setRating] = useState<number | null>(values.rating);

  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={values.id} />
      <input type="hidden" name="rating" value={rating ?? ''} />
      <FormMessage error={state.error} notice={state.notice} />

      <label className="flex flex-col gap-1.5">
        <span className="text-dim text-xs font-semibold">{labels.note}</span>
        <textarea
          name="note"
          rows={5}
          defaultValue={values.note}
          placeholder={labels.notePlaceholder}
          maxLength={4000}
          className={field}
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-dim text-xs font-semibold">{labels.strategy}</span>
          <SuggestField
            name="strategy"
            options={vocabulary.strategies}
            defaultValue={values.strategy}
            placeholder={labels.strategyPlaceholder}
            className={field}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-dim text-xs font-semibold">{labels.mood}</span>
          <SuggestField
            name="mood"
            options={vocabulary.moods}
            defaultValue={values.mood}
            placeholder={labels.moodPlaceholder}
            className={field}
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <span className="text-dim text-xs font-semibold">
          {labels.tags} <span className="font-normal">· {labels.tagsHint}</span>
        </span>
        <SuggestField
          name="tags"
          options={vocabulary.tags}
          defaultValue={values.tags}
          maxLength={500}
          multiple
          className={field}
        />
      </label>

      <div className="flex flex-col gap-1.5">
        <span className="text-dim text-xs font-semibold">{labels.rating}</span>
        <div className="flex items-center gap-1">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              // Clicking the current rating clears it: "not rated" is a real state, distinct
              // from one star, and there would otherwise be no way back to it.
              onClick={() => setRating(rating === star ? null : star)}
              aria-label={`${labels.rating} ${star}`}
              aria-pressed={rating !== null && star <= rating}
              className="p-0.5"
            >
              <Star
                size={20}
                className={rating !== null && star <= rating ? 'text-warn' : 'text-dim/40'}
                fill={rating !== null && star <= rating ? 'currentColor' : 'none'}
              />
            </button>
          ))}
          {rating === null ? <span className="text-dim ms-2 text-xs">{labels.ratingNone}</span> : null}
        </div>
      </div>

      <div>
        <SubmitButton>{labels.save}</SubmitButton>
      </div>
    </form>
  );
}
