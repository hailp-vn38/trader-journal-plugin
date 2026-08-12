import { useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type TraderJournalPlugin from '../../main';
import type { TraderJournalLanguage } from '../../settings';
import {
	ECONOMIC_CALENDAR_SETTINGS_CHANGE_EVENT,
	normalizeCountry,
} from '../../settings';
import { getTranslator } from '../../i18n';
import { ECONOMIC_IMPACTS } from '../../economicCalendar/types';
import type { EconomicImpact } from '../../economicCalendar/types';

const FALLBACK_TIME_ZONES = [
	'Asia/Ho_Chi_Minh',
	'UTC',
	'America/New_York',
	'America/Chicago',
	'America/Los_Angeles',
	'Europe/London',
	'Europe/Berlin',
	'Asia/Tokyo',
	'Asia/Shanghai',
	'Asia/Hong_Kong',
	'Asia/Singapore',
	'Asia/Bangkok',
	'Australia/Sydney',
] as const;

const intlWithSupportedValues = Intl as typeof Intl & {
	supportedValuesOf?: (key: 'timeZone') => string[];
};
const ECONOMIC_CALENDAR_TIME_ZONES = [
	...new Set([
		'Asia/Ho_Chi_Minh',
		'UTC',
		...(intlWithSupportedValues.supportedValuesOf?.('timeZone') ?? FALLBACK_TIME_ZONES),
	]),
].sort();

const ECONOMIC_IMPACT_TRANSLATION_KEYS: Record<
	EconomicImpact,
	'impact.high' | 'impact.medium' | 'impact.low' | 'impact.holiday'
> = {
	High: 'impact.high',
	Medium: 'impact.medium',
	Low: 'impact.low',
	Holiday: 'impact.holiday',
};

export function EconomicCalendarSettings({
	language,
	plugin,
}: {
	language: TraderJournalLanguage;
	plugin: TraderJournalPlugin;
}) {
	const [enabled, setEnabled] = useState(plugin.settings.economicCalendarEnabled);
	const [showAll, setShowAll] = useState(plugin.settings.economicCalendarShowAll);
	const [timeZone, setTimeZone] = useState(plugin.settings.economicCalendarTimeZone);
	const [countries, setCountries] = useState(plugin.settings.economicCalendarCountries);
	const [newCountry, setNewCountry] = useState('');
	const [impacts, setImpacts] = useState(plugin.settings.economicCalendarImpacts);
	const tr = getTranslator(language);

	const saveEnabled = (value: boolean) => {
		setEnabled(value);
		plugin.settings.economicCalendarEnabled = value;
		void plugin.saveSettings();
		notifySettingsChange(plugin);
	};

	const saveTimeZone = (value: string) => {
		setTimeZone(value);
		plugin.settings.economicCalendarTimeZone = value;
		void plugin.saveSettings();
		notifySettingsChange(plugin);
	};

	const saveShowAll = (value: boolean) => {
		setShowAll(value);
		plugin.settings.economicCalendarShowAll = value;
		void plugin.saveSettings();
		notifySettingsChange(plugin);
	};

	const saveCountries = (nextCountries: string[]) => {
		if (nextCountries.length === 0) {
			return;
		}

		setCountries(nextCountries);
		plugin.settings.economicCalendarCountries = nextCountries;
		void plugin.saveSettings();
		notifySettingsChange(plugin);
	};

	const addCountry = () => {
		const country = normalizeCountry(newCountry);
		if (!country || countries.includes(country)) {
			setNewCountry('');
			return;
		}

		saveCountries([...countries, country]);
		setNewCountry('');
	};

	const removeCountry = (country: string) => {
		if (countries.length <= 1) {
			return;
		}

		saveCountries(countries.filter((item) => item !== country));
	};

	const toggleImpact = (impact: EconomicImpact, checked: boolean) => {
		const nextImpacts = checked
			? ECONOMIC_IMPACTS.filter((item) => impacts.includes(item) || item === impact)
			: impacts.filter((item) => item !== impact);
		if (nextImpacts.length === 0) {
			return;
		}

		setImpacts(nextImpacts);
		plugin.settings.economicCalendarImpacts = nextImpacts;
		void plugin.saveSettings();
		notifySettingsChange(plugin);
	};

	const handleAddKey = (event: KeyboardEvent<HTMLInputElement>) => {
		if (event.key !== 'Enter') {
			return;
		}

		event.preventDefault();
		addCountry();
	};

	return (
		<>
			<section className="trader-journal-setting">
				<div>
					<div className="trader-journal-setting__label">{tr('settings.economicCalendarLabel')}</div>
					<div className="trader-journal-setting__description">
						{tr('settings.economicCalendarDescription')}
					</div>
				</div>
				<label className="trader-journal-toggle">
					<input
						type="checkbox"
						checked={enabled}
						onChange={(event: ChangeEvent<HTMLInputElement>) => saveEnabled(event.target.checked)}
					/>
					<span>{tr('settings.enableEconomicCalendar')}</span>
				</label>
			</section>

			<section className="trader-journal-setting">
				<div>
					<div className="trader-journal-setting__label">{tr('settings.economicShowAllLabel')}</div>
					<div className="trader-journal-setting__description">
						{tr('settings.economicShowAllDescription')}
					</div>
				</div>
				<label className="trader-journal-toggle">
					<input
						type="checkbox"
						checked={showAll}
						disabled={!enabled}
						onChange={(event: ChangeEvent<HTMLInputElement>) => saveShowAll(event.target.checked)}
					/>
					<span>{tr('settings.showAllEconomicEvents')}</span>
				</label>
			</section>

			<label className="trader-journal-setting">
				<span className="trader-journal-setting__label">{tr('settings.economicTimeZoneLabel')}</span>
				<span className="trader-journal-setting__description">
					{tr('settings.economicTimeZoneDescription')}
				</span>
				<select
					value={timeZone}
					disabled={!enabled}
					onChange={(event: ChangeEvent<HTMLSelectElement>) => saveTimeZone(event.target.value)}
				>
					{!ECONOMIC_CALENDAR_TIME_ZONES.includes(timeZone) ? (
						<option value={timeZone}>{timeZone}</option>
					) : null}
					{ECONOMIC_CALENDAR_TIME_ZONES.map((option) => (
						<option value={option} key={option}>
							{option}
						</option>
					))}
				</select>
			</label>

			<section className="trader-journal-setting trader-journal-setting--list">
				<div>
					<div className="trader-journal-setting__label">{tr('settings.economicCountriesLabel')}</div>
					<div className="trader-journal-setting__description">
						{tr('settings.economicCountriesDescription')}
					</div>
				</div>
				<div className="trader-journal-setting__control">
					<div className="trader-journal-add-row">
						<input
							type="text"
							value={newCountry}
							placeholder="USD"
							disabled={!enabled || showAll}
							onChange={(event: ChangeEvent<HTMLInputElement>) => setNewCountry(event.target.value)}
							onKeyDown={handleAddKey}
						/>
						<button type="button" disabled={!enabled || showAll} onClick={addCountry}>
							{tr('action.add')}
						</button>
					</div>
					<div className="trader-journal-pill-list">
						{countries.map((country) => (
							<span className="trader-journal-pill" key={country}>
								<span>{country}</span>
								<button
									type="button"
									aria-label={`${tr('action.remove')} ${country}`}
									disabled={!enabled || showAll || countries.length <= 1}
									onClick={() => removeCountry(country)}
								>
									{tr('action.remove')}
								</button>
							</span>
						))}
					</div>
				</div>
			</section>

			<section className="trader-journal-setting">
				<div>
					<div className="trader-journal-setting__label">{tr('settings.economicImpactsLabel')}</div>
					<div className="trader-journal-setting__description">
						{tr('settings.economicImpactsDescription')}
					</div>
				</div>
				<div className="trader-journal-setting__checkbox-list">
					{ECONOMIC_IMPACTS.map((impact) => (
						<label key={impact}>
							<input
								type="checkbox"
								checked={impacts.includes(impact)}
								disabled={!enabled || showAll || (impacts.length === 1 && impacts.includes(impact))}
								onChange={(event: ChangeEvent<HTMLInputElement>) =>
									toggleImpact(impact, event.target.checked)
								}
							/>
							<span>{tr(ECONOMIC_IMPACT_TRANSLATION_KEYS[impact])}</span>
						</label>
					))}
				</div>
			</section>
		</>
	);
}

function notifySettingsChange(plugin: TraderJournalPlugin): void {
	plugin.app.workspace.trigger(ECONOMIC_CALENDAR_SETTINGS_CHANGE_EVENT);
}
