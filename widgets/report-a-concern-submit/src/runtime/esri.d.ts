// esri.d.ts
// Report a Concern submit widget
//
// Resolves the global `__esri` namespace for editors that cannot read the
// ArcGIS Maps SDK ambient types through the pnpm layout (Visual Studio
// otherwise reports TS2503 "Cannot find namespace '__esri'").
//
// Declared as open interfaces with an index signature rather than
// `type X = any` so that, if the real @arcgis/core declarations DO load,
// these merge with them instead of producing TS2300 "Duplicate identifier".
// IDE-only: the EB webpack build resolves the real JSAPI types on its own.
// No runtime effect.
//
// Location: src/runtime/esri.d.ts  (next to widget.tsx).

declare global {
    namespace __esri {
        interface FeatureLayer { [key: string]: any }
        interface Graphic { [key: string]: any }
        interface Handle { [key: string]: any }
        interface MapView { [key: string]: any }
        interface Point { [key: string]: any }
        interface Sublayer { [key: string]: any }
        interface WebMap { [key: string]: any }
        interface CodedValueDomain { [key: string]: any }
        interface ViewClickEvent { [key: string]: any }
    }
}

export {};
