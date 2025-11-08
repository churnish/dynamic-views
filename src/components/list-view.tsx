import type { Settings } from '../types';
import { getFirstDatacorePropertyValue } from '../utils/property';
import type { DatacoreAPI, DatacoreFile } from '../types/datacore';
import type { App } from 'obsidian';
import { datacoreResultToCardData } from '../shared/data-transform';
import type { CardData } from '../shared/card-renderer';

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
                        {/* Metadata - inline display (list view doesn't use 2-row layout) */}
                        {(() => {
                            // Transform to get resolved metadata
                            const card: CardData = datacoreResultToCardData(p, dc, settings, 'mtime-desc', false);

                            // Check if any metadata has content
                            const hasMetadata = card.metadata1 || card.metadata2 || card.metadata3 || card.metadata4;

                            if (!hasMetadata) return null;

                            // eslint-disable-next-line @typescript-eslint/no-unsafe-return -- JSX.Element resolves to any due to Datacore's JSX runtime
                            return (
                                <span className="list-meta">
                                    {card.metadata1 === 'tags' && p.$tags && p.$tags.length > 0 ? (
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
                                    ) : card.metadata1 ? (
                                        <span className="list-text">{card.metadata1}</span>
                                    ) : null}
                                    {card.metadata2 === 'tags' && p.$tags && p.$tags.length > 0 ? (
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
                                    ) : card.metadata2 ? (
                                        <span className="list-text">{card.metadata2}</span>
                                    ) : null}
                                    {card.metadata3 === 'tags' && p.$tags && p.$tags.length > 0 ? (
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
                                    ) : card.metadata3 ? (
                                        <span className="list-text">{card.metadata3}</span>
                                    ) : null}
                                    {card.metadata4 === 'tags' && p.$tags && p.$tags.length > 0 ? (
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
                                    ) : card.metadata4 ? (
                                        <span className="list-text">{card.metadata4}</span>
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
