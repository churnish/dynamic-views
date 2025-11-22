// JSX Runtime Proxy for Datacore Integration
// This module provides h() and Fragment() that delegate to Datacore's bundled Preact
// All JSX compiled by esbuild will use these functions

import type { ComponentType, VNode } from './types/datacore';

// Store reference to Datacore's Preact h and Fragment
let datacoreH: ((type: string | ComponentType, props: Record<string, unknown> | null, ...children: unknown[]) => VNode) | null = null;
let datacoreFragment: ComponentType | null = null;

/**
 * Initialize the JSX runtime with Datacore's Preact implementation.
 * Must be called before any components render.
 */
export function setDatacorePreact(preact: {
    h: (type: string | ComponentType, props: Record<string, unknown> | null, ...children: unknown[]) => VNode;
    Fragment: ComponentType;
}) {
    datacoreH = preact.h;
    datacoreFragment = preact.Fragment;
}

/**
 * Proxy h function that delegates to Datacore's Preact.
 * This is called by all esbuild-compiled JSX: <div> becomes h('div', ...)
 */
export function h(type: string | ComponentType, props: Record<string, unknown> | null, ...children: unknown[]): VNode {
    if (!datacoreH) {
        throw new Error(
            'Datacore Preact not initialized. ' +
            'Call setDatacorePreact(dc.preact) before rendering components.'
        );
    }
    // Delegate directly to Datacore's h - it handles VNode creation with all internal properties
    return datacoreH(type, props, ...children);
}

/**
 * Proxy Fragment that delegates to Datacore's Preact Fragment.
 * Used for JSX fragments: <>...</>
 */
export function Fragment(props: { children?: unknown }): VNode {
    if (!datacoreFragment) {
        throw new Error('Datacore Preact not initialized.');
    }
    return datacoreFragment(props) as VNode;
}

// Make h and Fragment globally available for esbuild-compiled JSX
if (typeof globalThis !== 'undefined') {
    (globalThis as Record<string, unknown>).h = h;
    (globalThis as Record<string, unknown>).Fragment = Fragment;
}
