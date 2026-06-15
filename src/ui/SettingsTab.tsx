import type { App } from 'obsidian';
import { PluginSettingTab } from 'obsidian';
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChangeEvent } from 'react';
import type { Root } from 'react-dom/client';
import type TraderJournalPlugin from '../main';

interface SettingsViewProps {
	plugin: TraderJournalPlugin;
}

function SettingsView({ plugin }: SettingsViewProps) {
	const [mySetting, setMySetting] = useState(plugin.settings.mySetting);

	const handleMySettingChange = (event: ChangeEvent<HTMLInputElement>) => {
		const value = event.target.value;
		setMySetting(value);
		plugin.settings.mySetting = value;
		void plugin.saveSettings();
	};

	return (
		<div className="trader-journal-settings">
			<h2>Trader journal settings</h2>
			<label className="trader-journal-setting">
				<span className="trader-journal-setting__label">Settings #1</span>
				<span className="trader-journal-setting__description">
					It's a secret
				</span>
				<input
					type="text"
					value={mySetting}
					placeholder="Enter your secret"
					onChange={handleMySettingChange}
				/>
			</label>
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
