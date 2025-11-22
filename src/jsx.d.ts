// JSX type definitions for datacorejsx context (non-React)
/* eslint-disable @typescript-eslint/no-explicit-any */
declare namespace JSX {
    interface IntrinsicElements {
        [elemName: string]: any;
    }
    type Element = any;
    interface ElementClass {
        render: any;
    }
    interface ElementAttributesProperty {
        props: object;
    }
    interface ElementChildrenAttribute {
        children: object;
    }
}

// Declare global h and Fragment functions
declare function h(type: any, props: any, ...children: any[]): any;
declare const Fragment: any;
