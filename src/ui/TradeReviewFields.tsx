import type { ChangeEvent } from 'react';
import type { Translator } from '../i18n';
import {
	TRADE_REVIEW_CONTEXTS,
	TRADE_REVIEW_ENTRY_TIMINGS,
	TRADE_REVIEW_MISTAKE_TAGS,
	TRADE_REVIEW_PLAN_ADHERENCE_OPTIONS,
	normalizeTradeReview,
} from '../trades/review';
import type {
	TradeReview,
	TradeReviewContext,
	TradeReviewEntryTiming,
	TradeReviewMistakeTag,
	TradeReviewPlanAdherence,
} from '../trades/types';

export interface TradeReviewFormState {
	context: TradeReviewContext | '';
	entryTiming: TradeReviewEntryTiming | '';
	planAdherence: TradeReviewPlanAdherence | '';
	mistakeTags: TradeReviewMistakeTag[];
	whatWentWell: string;
	lesson: string;
	nextAction: string;
	reviewedAt: string;
}

interface TradeReviewFieldsProps {
	value: TradeReviewFormState;
	onChange: (value: TradeReviewFormState) => void;
	tr: Translator;
	compact?: boolean;
}

export function TradeReviewFields({ value, onChange, tr, compact = false }: TradeReviewFieldsProps) {
	const updateField = <K extends keyof TradeReviewFormState>(field: K, nextValue: TradeReviewFormState[K]) => {
		onChange({ ...value, [field]: nextValue });
	};
	const toggleMistake = (tag: TradeReviewMistakeTag) => {
		updateField(
			'mistakeTags',
			value.mistakeTags.includes(tag)
				? value.mistakeTags.filter((item) => item !== tag)
				: [...value.mistakeTags, tag],
		);
	};

	return (
		<section className={`trader-journal-review-form${compact ? ' trader-journal-review-form--compact' : ''}`}>
			<div className="trader-journal-review-form__header">
				<h3>{tr('review.title')}</h3>
				<p>{tr(compact ? 'review.requiredHint' : 'review.optionalHint')}</p>
			</div>
			<div className="trader-journal-review-form__grid">
				<label className="trader-journal-field">
					<span>{tr('review.context')}</span>
					<select
						value={value.context}
						onChange={(event: ChangeEvent<HTMLSelectElement>) =>
							updateField('context', event.target.value as TradeReviewContext | '')
						}
					>
						<option value="">{tr('review.select')}</option>
						{TRADE_REVIEW_CONTEXTS.map((option) => (
							<option value={option} key={option}>{tr(getContextKey(option))}</option>
						))}
					</select>
				</label>
				<label className="trader-journal-field">
					<span>{tr('review.entryTiming')}</span>
					<select
						value={value.entryTiming}
						onChange={(event: ChangeEvent<HTMLSelectElement>) =>
							updateField('entryTiming', event.target.value as TradeReviewEntryTiming | '')
						}
					>
						<option value="">{tr('review.select')}</option>
						{TRADE_REVIEW_ENTRY_TIMINGS.map((option) => (
							<option value={option} key={option}>{tr(getEntryTimingKey(option))}</option>
						))}
					</select>
				</label>
				<label className="trader-journal-field">
					<span>{tr('review.planAdherence')}</span>
					<select
						value={value.planAdherence}
						onChange={(event: ChangeEvent<HTMLSelectElement>) =>
							updateField('planAdherence', event.target.value as TradeReviewPlanAdherence | '')
						}
					>
						<option value="">{tr('review.select')}</option>
						{TRADE_REVIEW_PLAN_ADHERENCE_OPTIONS.map((option) => (
							<option value={option} key={option}>{tr(getPlanAdherenceKey(option))}</option>
						))}
					</select>
				</label>
			</div>

			<div className="trader-journal-review-form__mistakes">
				<span>{tr('review.mistakes')}</span>
				<div className="trader-journal-review-form__chips">
					{TRADE_REVIEW_MISTAKE_TAGS.map((tag) => (
						<button
							type="button"
							className={value.mistakeTags.includes(tag) ? 'is-selected' : ''}
							aria-pressed={value.mistakeTags.includes(tag)}
							onClick={() => toggleMistake(tag)}
							key={tag}
						>
							{tr(getMistakeKey(tag))}
						</button>
					))}
				</div>
			</div>

			<label className="trader-journal-field">
				<span>{tr('review.whatWentWell')}</span>
				<textarea rows={compact ? 2 : 3} value={value.whatWentWell} onChange={(event) => updateField('whatWentWell', event.target.value)} />
			</label>
			<label className="trader-journal-field">
				<span>{tr('review.lesson')}</span>
				<textarea rows={compact ? 2 : 3} value={value.lesson} onChange={(event) => updateField('lesson', event.target.value)} />
			</label>
			<label className="trader-journal-field">
				<span>{tr('review.nextAction')}</span>
				<textarea rows={compact ? 2 : 3} value={value.nextAction} onChange={(event) => updateField('nextAction', event.target.value)} />
			</label>
		</section>
	);
}

export function createTradeReviewFormState(value: unknown): TradeReviewFormState {
	const review = normalizeTradeReview(value);
	return {
		context: review?.context ?? '',
		entryTiming: review?.entry_timing ?? '',
		planAdherence: review?.plan_adherence ?? '',
		mistakeTags: review?.mistake_tags ?? [],
		whatWentWell: review?.what_went_well ?? '',
		lesson: review?.lesson ?? '',
		nextAction: review?.next_action ?? '',
		reviewedAt: review?.reviewed_at ?? '',
	};
}

export function buildTradeReview(value: TradeReviewFormState, reviewedAt: string): TradeReview | undefined {
	const whatWentWell = value.whatWentWell.trim();
	const lesson = value.lesson.trim();
	const nextAction = value.nextAction.trim();
	const hasContent = Boolean(
		value.context ||
		value.entryTiming ||
		value.planAdherence ||
		value.mistakeTags.length ||
		whatWentWell ||
		lesson ||
		nextAction,
	);
	if (!hasContent) {
		return undefined;
	}

	return {
		schema_version: 1,
		...(value.context ? { context: value.context } : {}),
		...(value.entryTiming ? { entry_timing: value.entryTiming } : {}),
		...(value.planAdherence ? { plan_adherence: value.planAdherence } : {}),
		...(value.mistakeTags.length ? { mistake_tags: value.mistakeTags } : {}),
		...(whatWentWell ? { what_went_well: whatWentWell } : {}),
		...(lesson ? { lesson } : {}),
		...(nextAction ? { next_action: nextAction } : {}),
		reviewed_at: value.reviewedAt || reviewedAt,
	};
}

export function isTradeReviewFormEmpty(value: TradeReviewFormState): boolean {
	return !buildTradeReview(value, 'pending');
}

export function getContextKey(value: TradeReviewContext) {
	return `review.context.${value}` as const;
}

export function getEntryTimingKey(value: TradeReviewEntryTiming) {
	return `review.entryTiming.${value}` as const;
}

export function getPlanAdherenceKey(value: TradeReviewPlanAdherence) {
	return `review.planAdherence.${value}` as const;
}

export function getMistakeKey(value: TradeReviewMistakeTag) {
	return `review.mistake.${value}` as const;
}
