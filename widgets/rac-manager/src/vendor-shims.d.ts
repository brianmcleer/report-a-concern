// vendor-shims.d.ts
// Report a Concern widgets
//
// Widget-specific editor declarations for the RAC Manager widget. Sits beside the
// untouched master copy of exb-editor-shims.d.ts (copied from widgets\_vs) so
// the master can stay byte-identical across widgets. Editor only: emits
// nothing, the Experience Builder webpack build never reads this file.
//
// Keep this file a script (no top-level import/export) so every block below
// stays ambient and merges with the master shim's declarations. tsconfig.json
// lists this file before the master in "files" so its full declarations win
// over the master's shorthand ones (jimu-for-builder, jimu-ui/*).

// The master shim declares 'jimu-for-builder' in shorthand form, which makes
// AllWidgetSettingProps a namespace rather than a type (TS2709). Give it a shape.
declare module 'jimu-for-builder' {
    export type AllWidgetSettingProps<T = any> = {
        id: string
        config: T & { set: (key: any, value: any) => any; [key: string]: any }
        onSettingChange: (settings: any, ...rest: any[]) => void
        useDataSources?: any
        useMapWidgetIds?: any
        intl?: any
        theme?: any
        portalUrl?: string
        [key: string]: any
    }
    export const getAppConfigAction: any
    export const builderAppSync: any
}

// Calcite wrapper supplied by Experience Builder (used by the help guide).
declare module 'calcite-components' {
    export const CalciteIcon: any
    export const CalciteChip: any
    const mod: any
    export default mod
}

// Classic JSX (tsconfig "jsx": "react"): files with the /** @jsx jsx */ pragma
// emit through jsx from jimu-core, which is typed any, so TypeScript falls back
// to this global JSX namespace. Pragma-less files compile through
// React.createElement, in scope from the jimu-core React import.
declare namespace JSX {
    type Element = any
    interface IntrinsicElements { [elemName: string]: any }
    interface ElementClass { render (): any }
    interface ElementAttributesProperty { props: {} }
    interface ElementChildrenAttribute { children: {} }
    interface IntrinsicAttributes { [key: string]: any }
    interface IntrinsicClassAttributes<T> { [key: string]: any }
}
