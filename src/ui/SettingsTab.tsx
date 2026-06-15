import type { App } from 'obsidian';
import { PluginSettingTab } from 'obsidian';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChangeEvent, KeyboardEvent } from 'react';
import type { Root } from 'react-dom/client';
import type TraderJournalPlugin from '../main';
import { normalizeSymbol, normalizeTimeframe } from '../settings';

interface SettingsViewProps {
	plugin: TraderJournalPlugin;
}

function SettingsView({ plugin }: SettingsViewProps) {
	const [journalFolder, setJournalFolder] = useState(plugin.settings.journalFolder);
	const [symbols, setSymbols] = useState(plugin.settings.symbols);
	const [newSymbol, setNewSymbol] = useState('');
	const [timeframes, setTimeframes] = useState(plugin.settings.timeframes);
	const [newTimeframe, setNewTimeframe] = useState('');

	const saveJournalFolder = (value: string) => {
		setJournalFolder(value);
		plugin.settings.journalFolder = value;
		void plugin.saveSettings();
	};

	const saveSymbols = (nextSymbols: string[]) => {
		setSymbols(nextSymbols);
		plugin.settings.symbols = nextSymbols;
		void plugin.saveSettings();
	};

	const saveTimeframes = (nextTimeframes: string[]) => {
		setTimeframes(nextTimeframes);
		plugin.settings.timeframes = nextTimeframes;
		void plugin.saveSettings();
	};

	const addSymbol = () => {
		const symbol = normalizeSymbol(newSymbol);
		if (!symbol || symbols.includes(symbol)) {
			setNewSymbol('');
			return;
		}

		saveSymbols([...symbols, symbol]);
		setNewSymbol('');
	};

	const removeSymbol = (symbol: string) => {
		saveSymbols(symbols.filter((item) => item !== symbol));
	};

	const addTimeframe = () => {
		const timeframe = normalizeTimeframe(newTimeframe);
		if (!timeframe || timeframes.includes(timeframe)) {
			setNewTimeframe('');
			return;
		}

		saveTimeframes([...timeframes, timeframe]);
		setNewTimeframe('');
	};

	const removeTimeframe = (timeframe: string) => {
		saveTimeframes(timeframes.filter((item) => item !== timeframe));
	};

	const handleAddKey = (event: KeyboardEvent<HTMLInputElement>, addItem: () => void) => {
		if (event.key !== 'Enter') {
			return;
		}

		event.preventDefault();
		addItem();
	};

	return (
		<div className="trader-journal-settings">
			<h2>Trader Journal settings</h2>

			<label className="trader-journal-setting">
				<span className="trader-journal-setting__label">Journal folder</span>
				<span className="trader-journal-setting__description">
					Root folder for symbol daily notes.
				</span>
				<input
					type="text"
					value={journalFolder}
					placeholder="Trading/Backtests"
					onChange={(event: ChangeEvent<HTMLInputElement>) => saveJournalFolder(event.target.value)}
				/>
			</label>

			<section className="trader-journal-setting trader-journal-setting--list">
				<div>
					<div className="trader-journal-setting__label">Symbols</div>
					<div className="trader-journal-setting__description">
						Symbols available in the trade modal.
					</div>
				</div>
				<div className="trader-journal-setting__control">
					<div className="trader-journal-add-row">
						<input
							type="text"
							value={newSymbol}
							placeholder="NQ"
							onChange={(event: ChangeEvent<HTMLInputElement>) => setNewSymbol(event.target.value)}
							onKeyDown={(event) => handleAddKey(event, addSymbol)}
						/>
						<button type="button" onClick={addSymbol}>
							Add
						</button>
					</div>
					<div className="trader-journal-pill-list">
						{symbols.map((symbol) => (
							<span className="trader-journal-pill" key={symbol}>
								<span>{symbol}</span>
								<button type="button" aria-label={`Remove ${symbol}`} onClick={() => removeSymbol(symbol)}>
									Remove
								</button>
							</span>
						))}
					</div>
				</div>
			</section>

			<section className="trader-journal-setting trader-journal-setting--list">
				<div>
					<div className="trader-journal-setting__label">Timeframes</div>
					<div className="trader-journal-setting__description">
						Timeframes available in the trade modal.
					</div>
				</div>
				<div className="trader-journal-setting__control">
					<div className="trader-journal-add-row">
						<input
							type="text"
							value={newTimeframe}
							placeholder="5m"
							onChange={(event: ChangeEvent<HTMLInputElement>) => setNewTimeframe(event.target.value)}
							onKeyDown={(event) => handleAddKey(event, addTimeframe)}
						/>
						<button type="button" onClick={addTimeframe}>
							Add
						</button>
					</div>
					<div className="trader-journal-pill-list">
						{timeframes.map((timeframe) => (
							<span className="trader-journal-pill" key={timeframe}>
								<span>{timeframe}</span>
								<button
									type="button"
									aria-label={`Remove ${timeframe}`}
									onClick={() => removeTimeframe(timeframe)}
								>
									Remove
								</button>
							</span>
						))}
					</div>
				</div>
			</section>
		</div>
	);
}

export class TraderJournalSettingTab extends PluginSettingTab {
	private readonly plugin: TraderJournalPlugin;
	private root: Root | null = null;

	constructor(app: App, plugin: TraderJournalPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.root?.unmount();
		this.containerEl.empty();

		const mountEl = this.containerEl.createDiv({
			cls: 'trader-journal-settings-root',
		});
		this.root = createRoot(mountEl);
		this.root.render(
			<StrictMode>
				<SettingsView plugin={this.plugin} />
			</StrictMode>,
		);
	}

	hide(): void {
		this.root?.unmount();
		this.root = null;
		this.containerEl.empty();
	}
}
