import type { Settings } from '../types';
import { getFirstDatacorePropertyValue } from '../utils/property';
import type { DatacoreAPI, DatacoreFile } from '../types/datacore';
import type { App } from 'obsidian';

// Extend App type to include internal plugins
declare module 'obsidian' {
    interface App {
        isMobile: boolean;
        internalPlugins: {
            plugins: Record<string, { enabled: boolean; instance?: { openGlobalSearch?: (query: string) => void; revealInFolder?: (file: unknown) => void } }>;
            getPluginById(id: string): { instance?: unknown } | null;
        };
    }
}

interface ListViewProps {
    results: DatacoreFile[];
    displayedCount: number;
    settings: Settings;
    containerRef: { current: HTMLElement | null };
    app: App;
    dc: DatacoreAPI;
    onLinkClick?: (path: string, newLeaf: boolean) => void;
}

export function ListView({
    results,
    displayedCount,
    settings,
    containerRef,
    app,
    dc,
    onLinkClick
}: ListViewProps): JSX.Element {
    return (
        <ul
            ref={containerRef}
            className={`list-view marker-${settings.listMarker}`}
            style={settings.queryHeight > 0 ? { maxHeight: `${settings.queryHeight}px`, overflowY: 'auto' } : {}}
        >
            {results.slice(0, displayedCount).filter(p => p.$path).map((p, index): JSX.Element => {
                // Get title from property (first available from comma-separated list) or fallback to filename
                let rawTitle = getFirstDatacorePropertyValue(p, settings.titleProperty);
                if (Array.isArray(rawTitle)) rawTitle = rawTitle[0];
                const titleValue = dc.coerce.string(rawTitle || p.$name);
                // Get folder path
                const folderPath = (p.$path || '').split('/').slice(0, -1).join('/');

                return (
                    <li key={p.$path} className="list-item">
                        <a
                            href={p.$path}
                            className="internal-link list-link"
                            onClick={(e: MouseEvent) => {
                                if (!e.metaKey && !e.ctrlKey && !e.shiftKey && p.$path) {
                                    e.preventDefault();
                                    if (onLinkClick) {
                                        onLinkClick(p.$path, false);
                                    } else {
                                        void app.workspace.openLinkText(p.$path, "", false);
                                    }
                                }
                            }}
                            onMouseEnter={(e: MouseEvent) => {
                                if (p.$path) {
                                    app.workspace.trigger('hover-link', {
                                        event: e,
                                        source: 'dynamic-views',
                                        hoverParent: e.currentTarget,
                                        targetEl: e.currentTarget,
                                        linktext: p.$path,
                                        sourcePath: p.$path
                                    });
                                }
                            }}
                        >
                            {titleValue}
                        </a>
                        {/* Metadata - show both left and right inline */}
                        {(() => {
                            // Apply winner logic: if both match and there's a winner, treat loser as 'none'
                            const effectiveLeft = settings.metadataDisplayWinner === 'right' &&
                                settings.metadataDisplayLeft !== 'none' &&
                                settings.metadataDisplayLeft === settings.metadataDisplayRight
                                    ? 'none'
                                    : settings.metadataDisplayLeft;

                            const effectiveRight = settings.metadataDisplayWinner === 'left' &&
                                settings.metadataDisplayRight !== 'none' &&
                                settings.metadataDisplayLeft === settings.metadataDisplayRight
                                    ? 'none'
                                    : settings.metadataDisplayRight;

                            // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- JSX.Element resolves to any due to Datacore's JSX runtime
                            return (effectiveLeft !== 'none' || effectiveRight !== 'none') && (
                                <span className="list-meta">
                                    {effectiveLeft === 'tags' && p.$tags && p.$tags.length > 0 ? (
                                        <>
                                            {p.$tags.map((tag: string): JSX.Element => (
                                                <a
                                                    key={tag}
                                                    href="#"
                                                    className="tag"
                                                    onClick={(e: MouseEvent) => {
                                                        e.preventDefault();
                                                        const searchPlugin = app.internalPlugins.plugins["global-search"];
                                                        if (searchPlugin?.instance?.openGlobalSearch) {
                                                            searchPlugin.instance.openGlobalSearch("tag:" + tag);
                                                        }
                                                    }}
                                                >
                                                    {tag.replace(/^#/, '')}
                                                </a>
                                            ))}
                                        </>
                                    ) : effectiveLeft === 'path' && folderPath ? (
                                        <span className="list-path">{folderPath}</span>
                                    ) : null}
                                    {effectiveRight === 'tags' && p.$tags && p.$tags.length > 0 ? (
                                        <>
                                            {p.$tags.map((tag: string): JSX.Element => (
                                                <a
                                                    key={tag}
                                                    href="#"
                                                    className="tag"
                                                    onClick={(e: MouseEvent) => {
                                                        e.preventDefault();
                                                        const searchPlugin = app.internalPlugins.plugins["global-search"];
                                                        if (searchPlugin?.instance?.openGlobalSearch) {
                                                            searchPlugin.instance.openGlobalSearch("tag:" + tag);
                                                        }
                                                    }}
                                                >
                                                    {tag.replace(/^#/, '')}
                                                </a>
                                            ))}
                                        </>
                                    ) : effectiveRight === 'path' && folderPath ? (
                                        <span className="list-path">{folderPath}</span>
                                    ) : null}
                                </span>
                            );
                        })()}
                    </li>
                );
            })}
        </ul>
    );
}
