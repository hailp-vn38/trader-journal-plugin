import { setIcon } from 'obsidian';
import { useEffect, useRef } from 'react';

interface DashboardIconButtonProps {
	icon: string;
	label: string;
	onClick: () => void;
	primary?: boolean;
	size?: 'default' | 'compact';
}

export function DashboardIconButton({
	icon,
	label,
	onClick,
	primary = false,
	size = 'default',
}: DashboardIconButtonProps) {
	const iconRef = useRef<HTMLSpanElement>(null);

	useEffect(() => {
		if (!iconRef.current) {
			return;
		}

		iconRef.current.replaceChildren();
		setIcon(iconRef.current, icon);
	}, [icon]);

	return (
		<button
			type="button"
			className={[
				'trader-journal-dashboard-icon-button',
				primary ? 'trader-journal-dashboard-icon-button--primary' : '',
				size === 'compact' ? 'trader-journal-dashboard-icon-button--compact' : '',
			]
				.filter(Boolean)
				.join(' ')}
			aria-label={label}
			title={label}
			onClick={onClick}
		>
			<span ref={iconRef} aria-hidden="true" />
		</button>
	);
}
