import { formatDateInTimeZone } from './api';
import type { EconomicCalendarEvent, EconomicImpact } from './types';

export function filterEconomicCalendarEvents(
	events: EconomicCalendarEvent[],
	countries: string[],
	impacts: EconomicImpact[],
): EconomicCalendarEvent[] {
	const allowedCountries = new Set(countries.map((country) => country.toUpperCase()));
	const allowedImpacts = new Set(impacts);

	return events.filter(
		(event) => allowedCountries.has(event.country) && allowedImpacts.has(event.impact),
	);
}

export function groupEconomicEventsByDate(
	events: EconomicCalendarEvent[],
	timeZone: string,
): Record<string, EconomicCalendarEvent[]> {
	const eventsByDate: Record<string, EconomicCalendarEvent[]> = {};
	for (const event of events) {
		const dateKey = formatDateInTimeZone(new Date(event.date), timeZone);
		(eventsByDate[dateKey] ??= []).push(event);
	}

	for (const dayEvents of Object.values(eventsByDate)) {
		dayEvents.sort((left, right) => Date.parse(left.date) - Date.parse(right.date));
	}

	return eventsByDate;
}

export function formatEconomicEventTime(
	event: EconomicCalendarEvent,
	timeZone: string,
	locale: string | undefined,
): string {
	return new Date(event.date).toLocaleTimeString(locale, {
		timeZone,
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23',
	});
}
