import { normalizePath } from 'obsidian';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type TraderJournalPlugin from '../../main';
import type { TraderJournalSettings } from '../../settings';

const SAVE_DEBOUNCE_MS = 400;
type FolderSettingKey = 'journalFolder' | 'liveJournalFolder' | 'planFolder' | 'setupFolder';

interface CommittedFolderSetting {
	value: string;
	onBlur: () => void;
	onChange: (event: ChangeEvent<HTMLInputElement>) => void;
	onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

export function useCommittedFolderSetting(
	plugin: TraderJournalPlugin,
	settingKey: FolderSettingKey,
): CommittedFolderSetting {
	const [value, setValue] = useState(plugin.settings[settingKey]);
	const valueRef = useRef(value);
	const timerRef = useRef<number | null>(null);

	const clearTimer = useCallback(() => {
		if (timerRef.current !== null) {
			window.clearTimeout(timerRef.current);
			timerRef.current = null;
		}
	}, []);

	const commit = useCallback(() => {
		clearTimer();
		const normalizedValue = normalizeFolderSetting(valueRef.current);
		if (!normalizedValue) {
			const savedValue = plugin.settings[settingKey];
			valueRef.current = savedValue;
			setValue(savedValue);
			return;
		}

		valueRef.current = normalizedValue;
		setValue(normalizedValue);
		if (plugin.settings[settingKey] === normalizedValue) {
			return;
		}

		plugin.settings[settingKey] = normalizedValue;
		void persistFolderSetting(plugin, settingKey);
	}, [clearTimer, plugin, settingKey]);

	const onChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const nextValue = event.target.value;
			valueRef.current = nextValue;
			setValue(nextValue);
			clearTimer();
			timerRef.current = window.setTimeout(commit, SAVE_DEBOUNCE_MS);
		},
		[clearTimer, commit],
	);

	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			if (event.key === 'Enter') {
				commit();
				event.currentTarget.blur();
			}
		},
		[commit],
	);

	useEffect(
		() => () => {
			clearTimer();
			commit();
		},
		[clearTimer, commit],
	);

	return { value, onBlur: commit, onChange, onKeyDown };
}

function normalizeFolderSetting(value: string): string {
	const trimmedValue = value.trim();
	return trimmedValue ? normalizePath(trimmedValue).replace(/\/$/, '') : '';
}

async function persistFolderSetting(
	plugin: TraderJournalPlugin,
	settingKey: keyof Pick<
		TraderJournalSettings,
		'journalFolder' | 'liveJournalFolder' | 'planFolder' | 'setupFolder'
	>,
): Promise<void> {
	try {
		await plugin.saveSettings();
		if (settingKey !== 'setupFolder') {
			await plugin.journalDataService.refreshIfStarted();
		}
		if (settingKey === 'planFolder' || settingKey === 'setupFolder') {
			await plugin.referenceDataService.refreshIfStarted();
		}
	} catch (error) {
		console.error(`Trader Journal failed to save ${settingKey}`, error);
	}
}
