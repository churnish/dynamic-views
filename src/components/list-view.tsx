import type { Settings } from '../types';

interface ListViewProps {
    results: any[];
    displayedCount: number;
    settings: Settings;
    containerRef: any;
    app: any;
    dc: any;
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
}: ListViewProps) {
    return (
        <ul
            ref={containerRef}
            className={`list-view marker-${settings.listMarker}`}
            style={settings.queryHeight > 0 ? { maxHeight: `${settings.queryHeight}px`, overflowY: 'auto' } : {}}
        >
            {results.slice(0, displayedCount).filter(p => p.$path).map((p, index) => {
                // Get title from property or fallback to filename - coerce to string to handle Literal objects
                let rawTitle = p.value(settings.titleProperty);
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
                                        app.workspace.openLinkText(p.$path, "", false);
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
                            // Duplicate detection: treat right as 'none' if both match
                            const effectiveRight = settings.metadataDisplayLeft !== 'none' && settings.metadataDisplayLeft === settings.metadataDisplayRight
                                ? 'none'
                                : settings.metadataDisplayRight;

                            return (settings.metadataDisplayLeft !== 'none' || effectiveRight !== 'none') && (
                                <span className="list-meta">
                                    {settings.metadataDisplayLeft === 'tags' && p.$tags && p.$tags.length > 0 ? (
                                        <>
                                            {p.$tags.map((tag: string) => (
                                                <a
                                                    key={tag}
                                                    href="#"
                                                    className="tag"
                                                    onClick={(e: MouseEvent) => {
                                                        e.preventDefault();
                                                        const searchPlugin = app.internalPlugins.plugins["global-search"];
                                                        if (searchPlugin && searchPlugin.instance) {
                                                            searchPlugin.instance.openGlobalSearch("tag:" + tag);
                                                        }
                                                    }}
                                                >
                                                    {tag.replace(/^#/, '')}
                                                </a>
                                            ))}
                                        </>
                                    ) : settings.metadataDisplayLeft === 'path' && folderPath ? (
                                        <span className="list-path">{folderPath}</span>
                                    ) : null}
                                    {effectiveRight === 'tags' && p.$tags && p.$tags.length > 0 ? (
                                        <>
                                            {p.$tags.map((tag: string) => (
                                                <a
                                                    key={tag}
                                                    href="#"
                                                    className="tag"
                                                    onClick={(e: MouseEvent) => {
                                                        e.preventDefault();
                                                        const searchPlugin = app.internalPlugins.plugins["global-search"];
                                                        if (searchPlugin && searchPlugin.instance) {
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
