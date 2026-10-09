// @ts-nocheck
/** @jsx jsx */
import { React, jsx } from "jimu-core";
import type { AllWidgetSettingProps } from "jimu-for-builder";
import {
    SettingSection,
    SettingRow,
    MapWidgetSelector,
} from "jimu-ui/advanced/setting-components";
import { TextInput, TextArea, NumericInput, Switch, Select, Option } from "jimu-ui";
import type { IMConfig } from "../config";
import defaultMessages from "./translations/default";
import __i18nDefaults from './translations/default'
import { __setIntl, __tc } from './i18n-t'
let __i18nIntl: any = null
/** Module translator: app language via the widget intl, English from default.ts, {name} values filled. */
const __t = (id: string, values?: { [key: string]: any }): string => {
  const msg: string = (__i18nDefaults as any)[id] ?? id
  if (__i18nIntl && typeof __i18nIntl.formatMessage === 'function') {
    try { return __i18nIntl.formatMessage({ id, defaultMessage: msg }, values) } catch (e) { }
  }
  return msg.replace(/\{(\w+)\}/g, (m: string, k: string) => (values && values[k] != null ? String(values[k]) : m))
}


/**
 * Panel colors read from the builder theme, with the same paths and fallbacks as
 * src/runtime/theme.ts (useTokens). The settings panel is a class component and
 * cannot call the hook, so the reads are repeated here. Nothing under src/setting
 * may import esri modules (handoff Section 12, item 1); this reads only the theme
 * object the builder passes in props.
 */
function panelColors(theme: any) {
    const sys = theme?.sys ?? {};
    const color = sys.color ?? {};
    const primary: string = color.primary?.main ?? "#0079c1";
    return {
        primary,
        primaryText: (color.primary?.text ?? "#ffffff") as string,
        surface: (color.surface?.paper ?? "#ffffff") as string,
        background: (color.surface?.background ?? "#f7f8fa") as string,
        text: (color.surface?.paperText ?? "#1b1f24") as string,
        textSecondary: (color.surface?.paperHint ?? "#5a6572") as string,
        divider: (color.divider?.secondary ?? color.divider?.primary ?? "#e1e5e9") as string,
        danger: (color.error?.main ?? "#d64545") as string,
        warning: (color.warning?.main ?? "#8a6100") as string,
    };
}

interface SubtypeOption {
    code: number;
    name: string;
    subOptions: Array<{ code: string; name: string }>;
}

interface SettingState {
    /** True while fetching subtypes from writeEndpointUrl. */
    loadingMeta: boolean;
    /** Last error from metadata fetch (empty when fine). */
    metaError: string;
    /** Subtypes parsed from the Tickets layer JSON. */
    subtypes: SubtypeOption[];
    /** Status message after an import/export action (empty when idle). */
    importStatus: string;
    /** True when the last importStatus represents an error. */
    importIsError: boolean;
}

export default class Setting extends React.PureComponent<
    AllWidgetSettingProps<IMConfig>,
    SettingState
> {
    // exb-i18n-kit translator: the app locale via the widget's intl, English from default.ts
    // as the fallback (with {placeholders} filled) when intl is not there.
    nls = (id: string, values?: { [key: string]: any }): string => {
        const intl = (this.props as any).intl;
        const msg: string = (defaultMessages as any)[id] ?? id;
        if (intl && typeof intl.formatMessage === "function") return intl.formatMessage({ id, defaultMessage: msg }, values);
        return msg.replace(/\{(\w+)\}/g, (m: string, k: string) => (values && values[k] != null ? String(values[k]) : m));
    };

    state: SettingState = {
        loadingMeta: false,
        metaError: "",
        subtypes: [],
        importStatus: "",
        importIsError: false,
    };

    componentDidMount() {
        this.fetchMetadata();
    }

    componentDidUpdate(prevProps: AllWidgetSettingProps<IMConfig>) {
        const prev = (prevProps.config as any)?.categoryMetadataUrl ?? "";
        const cur = (this.props.config as any)?.categoryMetadataUrl ?? "";
        const prevW = (prevProps.config as any)?.writeEndpointUrl ?? "";
        const curW = (this.props.config as any)?.writeEndpointUrl ?? "";
        if (prev !== cur || prevW !== curW) {
            this.fetchMetadata();
        }
    }

    /**
     * Fetch layer metadata from writeEndpointUrl and parse subtypes +
     * subcategory domain. Uses native fetch (?f=json) — same-origin cookies
     * are sent automatically for authenticated portal sessions.
     */
    fetchMetadata = async (): Promise<void> => {
        // Prefer categoryMetadataUrl (always a real REST URL). Fall back to
        // writeEndpointUrl only if it's also a REST URL (not a proxy path).
        const cfgAny = this.props.config as any;
        const metaUrl = (cfgAny?.categoryMetadataUrl ?? "").trim();
        const writeUrl = (cfgAny?.writeEndpointUrl ?? "").trim();
        const isRest = (u: string) => /\/(FeatureServer|MapServer)\//i.test(u);
        const url = metaUrl || (isRest(writeUrl) ? writeUrl : "");
        if (!url) {
            this.setState({ subtypes: [], metaError: "", loadingMeta: false });
            return;
        }
        this.setState({ loadingMeta: true, metaError: "" });
        try {
            const cleaned = url.replace(/\/$/, "");
            const sep = cleaned.includes("?") ? "&" : "?";
            const response = await fetch(`${cleaned}${sep}f=json`, {
                credentials: "include",
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const json = await response.json();
            if (json?.error) {
                throw new Error(json.error.message || `Code ${json.error.code}`);
            }
            const rawSubtypes = Array.isArray(json?.subtypes) ? json.subtypes : [];
            const subtypes: SubtypeOption[] = rawSubtypes.map((st: any) => {
                const dom = st?.domains?.subcategory || st?.domains?.Subcategory;
                const cvs = Array.isArray(dom?.codedValues) ? dom.codedValues : [];
                return {
                    code: st.code,
                    name: String(st.name ?? ""),
                    subOptions: cvs.map((cv: any) => ({
                        code: String(cv.code),
                        name: String(cv.name ?? ""),
                    })),
                };
            });
            this.setState({ subtypes, loadingMeta: false, metaError: "" });
        } catch (e: any) {
            this.setState({
                subtypes: [],
                loadingMeta: false,
                metaError: e?.message || String(e),
            });
        }
    };

    private fileInputRef = React.createRef<HTMLInputElement>();

    onMapWidgetSelected = (useMapWidgetIds: string[]) => {
        this.props.onSettingChange({
            id: this.props.id,
            config: this.props.config.set("useMapWidgetIds", useMapWidgetIds),
        });
    };

    setConfig = (key: string, value: any) => {
        this.props.onSettingChange({
            id: this.props.id,
            config: this.props.config.set(key, value),
        });
    };

    handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            this.setConfig("headerImageUrl", reader.result as string);
        };
        reader.readAsDataURL(file);
        // Reset input so the same file can be re-selected after removal
        e.target.value = "";
    };

    clearHeaderImage = () => {
        this.setConfig("headerImageUrl", "");
    };

    // ── Critical-Issue Alerts ──────────────────────────────────
    //
    // Each alert can route the citizen to one or more phone numbers.
    // The new `phones` array is preferred. Legacy single-phone configs
    // (with just a `phone` scalar) are still accepted by the runtime
    // widget. Once edited and saved in this settings panel, alerts get
    // migrated to the `phones` array shape on the way back out.
    getCriticalAlerts = (): Array<{
        category: string;
        subcategory: string;
        // Legacy — preserved on read for backward compat.
        phone?: string;
        phones?: Array<{ label: string; name: string; number: string }>;
        message?: string;
    }> => {
        const v = (this.props.config as any)?.criticalAlerts;
        if (!v) return [];
        // jimu-core ImmutableObject → plain array of plain objects
        const arr = (v.asMutable ? v.asMutable({ deep: true }) : v) as any[];
        return Array.isArray(arr) ? arr : [];
    };

    /** Set a scalar field (category/subcategory/message) on one alert row. */
    setCriticalAlertField = (idx: number, field: string, value: string) => {
        const current = this.getCriticalAlerts();
        const next = current.map((row, i) =>
            i === idx ? { ...row, [field]: value } : row
        );
        this.setConfig("criticalAlerts", next);
    };

    /** Return the phones array for one alert, normalized from legacy if needed. */
    getAlertPhones = (idx: number): Array<{ label: string; name: string; number: string }> => {
        const alerts = this.getCriticalAlerts();
        const row = alerts[idx];
        if (!row) return [];
        if (Array.isArray(row.phones) && row.phones.length > 0) {
            return row.phones.map((p: any) => ({
                label: p?.label || "",
                name: p?.name || "",
                number: p?.number || "",
            }));
        }
        // Legacy single-phone fallback — surface it as a one-row phones array
        // so the UI is consistent. The legacy `phone` field stays in the
        // underlying config until the user saves a phones-array edit.
        if (row.phone && row.phone.trim()) {
            return [{ label: "", name: "", number: row.phone.trim() }];
        }
        return [];
    };

    /** Write the phones array for one alert. Also clears legacy `phone`. */
    setAlertPhones = (
        idx: number,
        phones: Array<{ label: string; name: string; number: string }>
    ) => {
        const current = this.getCriticalAlerts();
        const next = current.map((row, i) => {
            if (i !== idx) return row;
            const { phone, ...rest } = row as any; // drop legacy field
            return { ...rest, phones };
        });
        this.setConfig("criticalAlerts", next);
    };

    setAlertPhoneField = (
        alertIdx: number,
        phoneIdx: number,
        field: "label" | "name" | "number",
        value: string
    ) => {
        const phones = this.getAlertPhones(alertIdx);
        const next = phones.map((p, j) => (j === phoneIdx ? { ...p, [field]: value } : p));
        this.setAlertPhones(alertIdx, next);
    };

    addAlertPhone = (alertIdx: number) => {
        const phones = this.getAlertPhones(alertIdx);
        this.setAlertPhones(alertIdx, [...phones, { label: "", name: "", number: "" }]);
    };

    removeAlertPhone = (alertIdx: number, phoneIdx: number) => {
        const phones = this.getAlertPhones(alertIdx).filter((_, j) => j !== phoneIdx);
        this.setAlertPhones(alertIdx, phones);
    };

    moveAlertPhone = (alertIdx: number, phoneIdx: number, dir: -1 | 1) => {
        const phones = this.getAlertPhones(alertIdx);
        const target = phoneIdx + dir;
        if (target < 0 || target >= phones.length) return;
        const next = phones.slice();
        [next[phoneIdx], next[target]] = [next[target], next[phoneIdx]];
        this.setAlertPhones(alertIdx, next);
    };

    addCriticalAlert = () => {
        const current = this.getCriticalAlerts();
        const next = [
            ...current,
            // New alerts use the phones array shape from day one.
            { category: "", subcategory: "", phones: [{ label: "", name: "", number: "" }], message: "" },
        ];
        this.setConfig("criticalAlerts", next);
    };

    removeCriticalAlert = (idx: number) => {
        const current = this.getCriticalAlerts();
        const next = current.filter((_, i) => i !== idx);
        this.setConfig("criticalAlerts", next);
    };

    // ── Settings Import / Export ───────────────────────────────
    // Allows transferring widget settings between device views
    // (desktop, tablet, mobile) within the same Experience.
    // useMapWidgetIds is intentionally excluded — that reference
    // is view-specific and must stay bound to each view's own map.

    /** Scalar config fields included in export, with their expected types. */
    private static readonly EXPORT_SCALAR_TYPES: Record<string, "string" | "number" | "boolean"> = {
        ticketsLayerIndex: "number",
        boundariesLayerIndex: "number",
        boundariesLayerUrl: "string",
        boundaryIdField: "string",
        enableCategoryFiltering: "boolean",
        lookupTableIndex: "number",
        lookupTableUrl: "string",
        invalidCategoryBehavior: "string",
        populateBoundaryId: "boolean",
        ticketBoundaryIdField: "string",
        writeEndpointUrl: "string",
        enableGeocoder: "boolean",
        geocoderUrl: "string",
        submitButtonLabel: "string",
        successMessage: "string",
        headerTitle: "string",
        outsideBoundaryMessage: "string",
        headerImageUrl: "string",
        headerImageAlt: "string",
        headerImageLink: "string",
        headerTitleAlign: "string",
        headerTitleSize: "number",
        maxPhotoSizeMB: "number",
        maxPhotos: "number",
        mobileMode: "boolean",
        criticalAlertDefaultMessage: "string",
        categoryMetadataUrl: "string",
        statusQueryUrl: "string",
        commentsTableUrl: "string",
        commentsTableName: "string",
        commentsTableIndex: "number",
    };

    /** XML-escape special characters in element text content. */
    private escapeXml = (s: any): string => {
        return String(s ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&apos;");
    };

    /** Serialize current config to XML and trigger a file download. */
    exportConfigAsXML = () => {
        try {
            const cfg = this.props.config as any;
            const lines: string[] = [];
            lines.push('<?xml version="1.0" encoding="UTF-8"?>');
            lines.push('<RACSubmitConfig version="1">');

            for (const key of Object.keys(Setting.EXPORT_SCALAR_TYPES)) {
                const val = cfg[key];
                if (val === undefined || val === null) continue;
                lines.push(`  <${key}>${this.escapeXml(val)}</${key}>`);
            }

            const alerts = this.getCriticalAlerts();
            lines.push("  <criticalAlerts>");
            for (const a of alerts) {
                lines.push("    <alert>");
                lines.push(`      <category>${this.escapeXml(a.category)}</category>`);
                lines.push(`      <subcategory>${this.escapeXml(a.subcategory)}</subcategory>`);

                // Prefer the new phones array. Fall back to legacy single
                // phone if that's all the alert has (e.g. unmigrated config).
                let phones: Array<{ label: string; name: string; number: string }> = [];
                if (Array.isArray((a as any).phones) && (a as any).phones.length > 0) {
                    phones = (a as any).phones.map((p: any) => ({
                        label: p?.label || "",
                        name: p?.name || "",
                        number: p?.number || "",
                    }));
                } else if (a.phone && a.phone.trim()) {
                    phones = [{ label: "", name: "", number: a.phone.trim() }];
                }

                lines.push("      <phones>");
                for (const p of phones) {
                    lines.push("        <phone>");
                    lines.push(`          <label>${this.escapeXml(p.label)}</label>`);
                    lines.push(`          <name>${this.escapeXml(p.name)}</name>`);
                    lines.push(`          <number>${this.escapeXml(p.number)}</number>`);
                    lines.push("        </phone>");
                }
                lines.push("      </phones>");
                lines.push(`      <message>${this.escapeXml(a.message ?? "")}</message>`);
                lines.push("    </alert>");
            }
            lines.push("  </criticalAlerts>");
            lines.push("</RACSubmitConfig>");

            const xml = lines.join("\n");
            const blob = new Blob([xml], { type: "application/xml" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
            a.href = url;
            a.download = `rac-submit-config-${stamp}.xml`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.setState({
                importStatus: `Exported settings to rac-submit-config-${stamp}.xml.`,
                importIsError: false,
            });
        } catch (err: any) {
            this.setState({
                importStatus: `Export failed: ${__tc(err?.message, "unknownError")}`,
                importIsError: true,
            });
        }
    };

    /** File input handler — reads selected XML and applies it after confirm. */
    handleConfigImport = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        // Reset input so the same file can be re-selected on a later try.
        const inputEl = e.target;

        const ok = window.confirm(
            `Importing "${file.name}" will overwrite the current widget settings ` +
            `for this view. The map widget selection will NOT be changed. ` +
            `\n\nContinue?`
        );
        if (!ok) {
            inputEl.value = "";
            return;
        }

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = String(reader.result || "");
                const count = this.parseAndApplyConfigXML(text);
                this.setState({
                    importStatus: `Imported ${count} setting${count === 1 ? "" : "s"} from ${file.name}.`,
                    importIsError: false,
                });
            } catch (err: any) {
                this.setState({
                    importStatus: `Import failed: ${__tc(err?.message, "unknownError")}`,
                    importIsError: true,
                });
            } finally {
                inputEl.value = "";
            }
        };
        reader.onerror = () => {
            this.setState({
                importStatus: "Import failed: could not read the selected file.",
                importIsError: true,
            });
            inputEl.value = "";
        };
        reader.readAsText(file);
    };

    /**
     * Parse an XML config payload, validate it, and merge it into the
     * current config in a single onSettingChange call. Returns the count
     * of fields applied.
     */
    private parseAndApplyConfigXML = (xmlText: string): number => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(xmlText, "application/xml");

        // DOMParser returns a doc with a <parsererror> element on bad XML.
        const errNode = doc.querySelector("parsererror");
        if (errNode) {
            throw new Error("XML is not well-formed");
        }

        const root = doc.documentElement;
        if (!root || root.tagName !== "RACSubmitConfig") {
            throw new Error(
                `Expected root element <RACSubmitConfig>, got <${root?.tagName ?? "empty"}>`
            );
        }

        // Build all changes onto a single Immutable config object, then
        // commit once so undo history shows a single step.
        let updated = this.props.config as any;
        let appliedCount = 0;

        for (const [key, type] of Object.entries(Setting.EXPORT_SCALAR_TYPES)) {
            // Use direct child lookup so nested elements with the same
            // tag name (none exist today, but be safe) don't get picked up.
            const el = Array.from(root.children).find((c) => c.tagName === key);
            if (!el) continue;
            const raw = el.textContent ?? "";

            let val: any;
            if (type === "number") {
                const n = Number(raw);
                if (!Number.isFinite(n)) continue;
                val = n;
            } else if (type === "boolean") {
                val = raw === "true" || raw === "1";
            } else {
                val = raw;
            }
            updated = updated.set(key, val);
            appliedCount++;
        }

        // criticalAlerts array
        const alertsRoot = Array.from(root.children).find(
            (c) => c.tagName === "criticalAlerts"
        );
        if (alertsRoot) {
            const alertEls = Array.from(alertsRoot.children).filter(
                (c) => c.tagName === "alert"
            );
            const alerts = alertEls.map((el) => {
                const getText = (tag: string): string => {
                    const child = Array.from(el.children).find((c) => c.tagName === tag);
                    return (child?.textContent ?? "").trim();
                };

                // Parse the new <phones> array if present.
                const phonesEl = Array.from(el.children).find(
                    (c) => c.tagName === "phones"
                );
                let phones: Array<{ label: string; name: string; number: string }> = [];
                if (phonesEl) {
                    phones = Array.from(phonesEl.children)
                        .filter((c) => c.tagName === "phone")
                        .map((pEl) => {
                            const subText = (tag: string): string => {
                                const sub = Array.from(pEl.children).find(
                                    (c) => c.tagName === tag
                                );
                                return (sub?.textContent ?? "").trim();
                            };
                            return {
                                label: subText("label"),
                                name: subText("name"),
                                number: subText("number"),
                            };
                        })
                        .filter((p) => p.number); // drop entries with no number
                }

                // Legacy single <phone> element (no nested <phones> wrapper)
                // is still accepted. If both shapes are present, the new
                // <phones> wins.
                const legacyPhone = (() => {
                    if (phones.length > 0) return "";
                    // Only look at direct <phone> children of <alert>, not
                    // grandchildren under <phones>.
                    const direct = Array.from(el.children).find(
                        (c) => c.tagName === "phone"
                    );
                    return direct ? (direct.textContent ?? "").trim() : "";
                })();

                // Migrate the legacy scalar into the new shape so the
                // settings UI always renders the phones-array editor.
                if (legacyPhone && phones.length === 0) {
                    phones = [{ label: "", name: "", number: legacyPhone }];
                }

                return {
                    category: getText("category"),
                    subcategory: getText("subcategory"),
                    phones,
                    message: getText("message"),
                };
            });
            updated = updated.set("criticalAlerts", alerts);
            appliedCount++;
        }

        this.props.onSettingChange({
            id: this.props.id,
            config: updated,
        });

        return appliedCount;
    };


    render() {
    __setIntl((this.props as any).intl)
    __i18nIntl = (this.props as any).intl
        const cfg = this.props.config;
        const c = panelColors(this.props.theme);
        const { importStatus, importIsError } = this.state;

        return (
            <div className="widget-setting-report-a-concern p-2">
                {/* ── Settings Import / Export ───────────────────── */}
                <SettingSection title={this.nls('settingsImportExport')}>
                    <SettingRow flow="wrap">
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", width: "100%" }}>
                            <button
                                type="button"
                                onClick={this.exportConfigAsXML}
                                style={{
                                    background: c.surface,
                                    border: `1px solid ${c.primary}`,
                                    color: c.primary,
                                    borderRadius: 3,
                                    padding: "6px 14px",
                                    fontSize: 12,
                                    cursor: "pointer",
                                    fontWeight: 600,
                                }}
                                title={this.nls('downloadCurrentSettingsAsAnXml')}
                            >
                                {this.nls('exportToXml')}
                            </button>
                            <label
                                style={{
                                    background: c.surface,
                                    border: `1px solid ${c.primary}`,
                                    color: c.primary,
                                    borderRadius: 3,
                                    padding: "6px 14px",
                                    fontSize: 12,
                                    cursor: "pointer",
                                    fontWeight: 600,
                                    display: "inline-flex",
                                    alignItems: "center",
                                    marginBottom: 0,
                                }}
                                title={this.nls('importSettingsFromAPreviouslyExported')}
                            >
                                {this.nls('importFromXml')}
                                <input
                                    type="file"
                                    accept=".xml,application/xml,text/xml"
                                    onChange={this.handleConfigImport}
                                    style={{ display: "none" }}
                                />
                            </label>
                        </div>
                        <span className="setting-text-level-3" style={{ marginTop: 6, display: "block" }}>
                            {this.nls('exportToCopyTheseSettingsTo')}
                        </span>
                    </SettingRow>
                    {importStatus && (
                        <SettingRow>
                            <span
                                style={{
                                    fontSize: 11,
                                    fontWeight: 500,
                                    color: importIsError ? c.danger : "#15803d",
                                }}
                            >
                                {importStatus}
                            </span>
                        </SettingRow>
                    )}
                </SettingSection>

                {/* ── Map Source ─────────────────────────────────── */}
                <SettingSection title={this.nls('mapSource')}>
                    <SettingRow label={this.nls('selectMapWidget')} flow="wrap">
                        <MapWidgetSelector
                            useMapWidgetIds={cfg.useMapWidgetIds as any}
                            onSelect={this.onMapWidgetSelected}
                        />
                    </SettingRow>
                </SettingSection>

                {/* ── Layer Configuration ─────────────────────────── */}
                <SettingSection title={this.nls('layerConfiguration')}>
                    <SettingRow label={this.nls('ticketsLayerIndex')}>
                        <NumericInput
                            value={cfg.ticketsLayerIndex ?? 0}
                            min={0} max={50} step={1}
                            onChange={(val: number) => this.setConfig("ticketsLayerIndex", val)}
                            style={{ width: 80 }} size="sm"
                        />
                    </SettingRow>
                    <SettingRow>
                        <span className="text-truncate setting-text-level-3">
                            {this.nls('sublayerIndexOfTheTicketsFeature')}
                        </span>
                    </SettingRow>
                </SettingSection>

                {/* ── Geofencing / Boundaries ─────────────────────── */}
                <SettingSection title={this.nls('geofencingServiceBoundaries')}>
                    <SettingRow label={this.nls('serviceBoundariesLayerUrl')} flow="wrap">
                        <TextInput
                            className="w-100" size="sm"
                            placeholder="https://your-server/rest/services/.../FeatureServer/1"
                            value={cfg.boundariesLayerUrl ?? ""}
                            onChange={(e) => this.setConfig("boundariesLayerUrl", e.target.value)}
                        />
                        <span className="setting-text-level-3" style={{ marginTop: 4, display: "block" }}>
                            {this.nls('restUrlToTheServiceBoundaries')}
                        </span>
                    </SettingRow>

                    <SettingRow label={this.nls('boundariesLayerIndexFallback')}>
                        <NumericInput
                            value={cfg.boundariesLayerIndex ?? 1}
                            min={0} max={50} step={1}
                            onChange={(val: number) => this.setConfig("boundariesLayerIndex", val)}
                            style={{ width: 80 }} size="sm"
                        />
                    </SettingRow>
                    <SettingRow>
                        <span className="text-truncate setting-text-level-3">
                            {this.nls('onlyUsedIfTheUrlAbove')}
                        </span>
                    </SettingRow>

                    <SettingRow label={this.nls('boundaryIdField')} flow="wrap">
                        <TextInput
                            className="w-100" size="sm"
                            placeholder="boundary_id"
                            value={cfg.boundaryIdField ?? "boundary_id"}
                            onChange={(e) => this.setConfig("boundaryIdField", e.target.value)}
                        />
                        <span className="setting-text-level-3" style={{ marginTop: 4, display: "block" }}>
                            {this.nls('fieldNameOnServiceBoundariesThat')}
                        </span>
                    </SettingRow>

                    <SettingRow label={this.nls('outsideBoundaryMessage')} flow="wrap">
                        <TextArea
                            className="w-100" height={80}
                            value={__tc(cfg.outsideBoundaryMessage, "thisLocationIsOutsideTheService")}
                            onAcceptValue={(val: string) => this.setConfig("outsideBoundaryMessage", val)}
                        />
                    </SettingRow>
                </SettingSection>

                {/* ── Category ↔ Boundary Filtering ───────────────── */}
                <SettingSection title={this.nls('categoryFilteringByBoundary')}>
                    <SettingRow label={this.nls('enableCategoryFiltering')}>
                        <Switch
                            checked={cfg.enableCategoryFiltering ?? true}
                            onChange={(evt) =>
                                this.setConfig("enableCategoryFiltering", evt.target.checked)
                            }
                        />
                    </SettingRow>
                    <SettingRow>
                        <span className="setting-text-level-3">
                            {this.nls('whenEnabledOnlyCategoriesThatAre')}
                        </span>
                    </SettingRow>

                    {(cfg.enableCategoryFiltering ?? true) && (
                        <React.Fragment>
                            <SettingRow label={this.nls('lookupTableUrl')} flow="wrap">
                                <TextInput
                                    className="w-100" size="sm"
                                    placeholder="https://your-server/.../MapServer/2 or FeatureServer/2"
                                    value={cfg.lookupTableUrl ?? ""}
                                    onChange={(e) =>
                                        this.setConfig("lookupTableUrl", e.target.value)
                                    }
                                />
                                <span className="setting-text-level-3"
                                    style={{ marginTop: 4, display: "block" }}>
                                    {this.nls('restUrlToCategoryBoundaryLookup')}
                                </span>
                            </SettingRow>

                            <SettingRow label={this.nls('lookupTableSublayerIndexFallback')}>
                                <NumericInput
                                    value={cfg.lookupTableIndex ?? 2}
                                    min={0} max={50} step={1}
                                    onChange={(val: number) =>
                                        this.setConfig("lookupTableIndex", val)
                                    }
                                    style={{ width: 80 }} size="sm"
                                />
                            </SettingRow>
                            <SettingRow>
                                <span className="text-truncate setting-text-level-3">
                                    {this.nls('sublayerIndexOfCategoryBoundaryLookup')}
                                </span>
                            </SettingRow>

                            <SettingRow label={this.nls('invalidCategoryBehavior')} flow="wrap">
                                <Select
                                    value={cfg.invalidCategoryBehavior ?? "show_message"}
                                    onChange={(e) =>
                                        this.setConfig("invalidCategoryBehavior", e.target.value)
                                    }
                                    size="sm" className="w-100"
                                >
                                    <Option value="hide">
                                        {this.nls('hideDoNotShowInvalidCategories')}
                                    </Option>
                                    <Option value="show_message">
                                        {this.nls('showDisabledWithRedirectMessage')}
                                    </Option>
                                </Select>
                                <span className="setting-text-level-3"
                                    style={{ marginTop: 4, display: "block" }}>
                                    {this.nls('controlsHowCategoriesWithIsValid')}
                                </span>
                            </SettingRow>
                        </React.Fragment>
                    )}
                </SettingSection>

                {/* ── Ticket Boundary Population ──────────────────── */}
                <SettingSection title={this.nls('ticketBoundaryField')}>
                    <SettingRow label={this.nls('autoPopulateBoundaryIdOnTickets')}>
                        <Switch
                            checked={cfg.populateBoundaryId ?? true}
                            onChange={(evt) =>
                                this.setConfig("populateBoundaryId", evt.target.checked)
                            }
                        />
                    </SettingRow>

                    {(cfg.populateBoundaryId ?? true) && (
                        <React.Fragment>
                            <SettingRow label={this.nls('ticketBoundaryFieldName')} flow="wrap">
                                <TextInput
                                    className="w-100" size="sm"
                                    placeholder="boundary_id"
                                    value={cfg.ticketBoundaryIdField ?? "boundary_id"}
                                    onChange={(e) =>
                                        this.setConfig("ticketBoundaryIdField", e.target.value)
                                    }
                                />
                                <span className="setting-text-level-3"
                                    style={{ marginTop: 4, display: "block" }}>
                                    {this.nls('fieldOnTheTicketsFeatureClass')}
                                </span>
                            </SettingRow>
                        </React.Fragment>
                    )}
                </SettingSection>

                {/* ── Write Endpoint (Secured FeatureServer) ────── */}
                <SettingSection title={this.nls('writeEndpointSecuredFeatureServer')}>
                    <SettingRow label={this.nls('ticketsWriteUrl')} flow="wrap">
                        <TextInput
                            className="w-100" size="sm"
                            placeholder="https://portal/sharing/proxy?https://server/.../FeatureServer/0"
                            value={cfg.writeEndpointUrl ?? ""}
                            onChange={(e) =>
                                this.setConfig("writeEndpointUrl", e.target.value)
                            }
                        />
                        <span className="setting-text-level-3"
                            style={{ marginTop: 4, display: "block" }}>
                            {this.nls('urlForWritingTicketsAllFields')}
                            <br />
                            <code style={{ fontSize: 10, wordBreak: "break-all" }}>
                                {__t("uiHttpsPortalSharingProxyHttpsServer")}
                            </code>
                            <br />
                            {this.nls('theFeatureServerShouldBeSecuredShared')}
                        </span>
                    </SettingRow>
                </SettingSection>


                {/* ── Public Comments Table ───────────────────────── */}
                <SettingSection title={this.nls('publicCommentsTicketStatusView')}>
                    <SettingRow label={this.nls('publicCommentsTableUrl')} flow="wrap">
                        <TextInput
                            className="w-100" size="sm"
                            placeholder="https://your-server/arcgis/rest/services/.../MapServer/0"
                            value={cfg.commentsTableUrl ?? ""}
                            onChange={(e) =>
                                this.setConfig("commentsTableUrl", e.target.value)
                            }
                        />
                        <span className="setting-text-level-3"
                            style={{ marginTop: 4, display: "block" }}>
                            {this.nls('restUrlToThePublicFacing')}
                        </span>
                    </SettingRow>
                </SettingSection>

                {/* ── Geocoder / Address Search ───────────────────── */}
                <SettingSection title={this.nls('addressSearch')}>
                    <SettingRow label={this.nls('enableGeocoder')}>
                        <Switch
                            checked={cfg.enableGeocoder ?? true}
                            onChange={(evt) =>
                                this.setConfig("enableGeocoder", evt.target.checked)
                            }
                        />
                    </SettingRow>

                    {cfg.enableGeocoder && (
                        <SettingRow label={this.nls('customGeocoderUrl')} flow="wrap">
                            <TextInput
                                className="w-100" size="sm"
                                placeholder={this.nls('leaveBlankForArcGISWorldGeocoder')}
                                value={cfg.geocoderUrl ?? ""}
                                onChange={(e) =>
                                    this.setConfig("geocoderUrl", e.target.value)
                                }
                            />
                            <span className="setting-text-level-3"
                                style={{ marginTop: 4, display: "block" }}>
                                {this.nls('optionallyPointToYourOrganizationS')}
                            </span>
                        </SettingRow>
                    )}
                </SettingSection>

                {/* ── Display Options ─────────────────────────────── */}
                <SettingSection title={this.nls('displayOptions')}>
                    <SettingRow label={this.nls('mobileOptimizedLocationStep')}>
                        <Switch
                            checked={cfg.mobileMode ?? false}
                            onChange={(evt) =>
                                this.setConfig("mobileMode", evt.target.checked)
                            }
                        />
                    </SettingRow>
                    <SettingRow>
                        <span className="setting-text-level-3">
                            {this.nls('whenEnabledThePlacePinOn')}
                        </span>
                    </SettingRow>
                </SettingSection>

                {/* ── Widget Labels ───────────────────────────────── */}
                <SettingSection title={this.nls('widgetLabelsAmpHeader')}>
                    <SettingRow label={this.nls('headerTitle')} flow="wrap">
                        <TextInput
                            className="w-100" size="sm"
                            value={__tc(cfg.headerTitle, "reportAConcern")}
                            onChange={(e) => this.setConfig("headerTitle", e.target.value)}
                        />
                    </SettingRow>

                    <SettingRow label={this.nls('headerTitleSizePx')}>
                        <NumericInput
                            value={cfg.headerTitleSize ?? 20}
                            min={10} max={48} step={1}
                            onChange={(val: number) => this.setConfig("headerTitleSize", val)}
                            style={{ width: 80 }} size="sm"
                        />
                    </SettingRow>

                    <SettingRow label={this.nls('headerImage')} flow="wrap">
                        {/* Hidden file input */}
                        <input
                            ref={this.fileInputRef}
                            type="file"
                            accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif"
                            aria-label={this.nls('uploadHeaderImage')}
                            style={{ display: "none" }}
                            onChange={this.handleImageUpload}
                        />

                        {cfg.headerImageUrl ? (
                            /* ── Preview + remove ─────────────────────── */
                            <div style={{
                                display: "flex", alignItems: "center", gap: 10,
                                padding: "8px 10px", background: c.background,
                                borderRadius: 4, width: "100%", boxSizing: "border-box",
                            }}>
                                <img
                                    src={cfg.headerImageUrl}
                                    alt={cfg.headerImageAlt ?? this.nls('headerImagePreview')}
                                    style={{
                                        maxHeight: 40, maxWidth: 120,
                                        objectFit: "contain", flexShrink: 0,
                                        border: `1px solid ${c.divider}`, borderRadius: 2,
                                        background: c.surface, padding: 2,
                                    }}
                                />
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <button
                                        type="button"
                                        onClick={() => this.fileInputRef.current?.click()}
                                        style={{
                                            display: "block", width: "100%",
                                            padding: "4px 8px", marginBottom: 4,
                                            fontSize: 12, cursor: "pointer",
                                            background: c.surface, border: "1px solid #999",
                                            borderRadius: 3,
                                        }}
                                    >
                                        {this.nls('replaceImage')}
                                    </button>
                                    <button
                                        type="button"
                                        onClick={this.clearHeaderImage}
                                        style={{
                                            display: "block", width: "100%",
                                            padding: "4px 8px",
                                            fontSize: 12, cursor: "pointer",
                                            background: c.surface, border: `1px solid ${c.danger}`,
                                            borderRadius: 3, color: c.danger,
                                        }}
                                    >
                                        {this.nls('removeImage')}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* ── Upload prompt ────────────────────────── */
                            <button
                                type="button"
                                onClick={() => this.fileInputRef.current?.click()}
                                style={{
                                    width: "100%", padding: "10px 8px",
                                    fontSize: 13, cursor: "pointer",
                                    background: c.surface,
                                    border: "2px dashed #aaa", borderRadius: 4,
                                    color: c.textSecondary, textAlign: "center",
                                }}
                            >
                                {this.nls('clickToUploadImagePngJpg')}
                            </button>
                        )}
                        <span className="setting-text-level-3" style={{ marginTop: 4, display: "block" }}>
                            {this.nls('logoDisplayedToTheLeftOf')}
                        </span>
                    </SettingRow>

                    <SettingRow label={this.nls('headerTitleAlignment')} flow="wrap">
                        <div style={{ display: "flex", gap: 6, width: "100%" }} role="group" aria-label={this.nls('headerTitleAlignment')}>
                            {(["left", "center", "right"] as const).map((align) => (
                                <button
                                    key={align}
                                    type="button"
                                    aria-pressed={cfg.headerTitleAlign === align || (!cfg.headerTitleAlign && align === "left")}
                                    onClick={() => this.setConfig("headerTitleAlign", align)}
                                    style={{
                                        flex: 1, padding: "5px 0",
                                        fontSize: 12, cursor: "pointer",
                                        borderRadius: 3, border: "1px solid",
                                        borderColor: (cfg.headerTitleAlign ?? "left") === align ? c.primary : "#aaa",
                                        background: (cfg.headerTitleAlign ?? "left") === align ? c.primary : c.surface,
                                        color: (cfg.headerTitleAlign ?? "left") === align ? c.primaryText : c.text,
                                        fontWeight: (cfg.headerTitleAlign ?? "left") === align ? 700 : 400,
                                        textTransform: "capitalize",
                                    }}
                                >
                                    {align}
                                </button>
                            ))}
                        </div>
                        <span className="setting-text-level-3" style={{ marginTop: 4, display: "block" }}>
                            {this.nls('positionOfTheTitleTextWithin')}
                        </span>
                    </SettingRow>

                    <SettingRow label={this.nls('headerImageAltText')} flow="wrap">
                        <TextInput
                            className="w-100" size="sm"
                            placeholder={this.nls('cityOfExample')}
                            value={cfg.headerImageAlt ?? ""}
                            onChange={(e) => this.setConfig("headerImageAlt", e.target.value)}
                        />
                        <span className="setting-text-level-3" style={{ marginTop: 4, display: "block" }}>
                            {this.nls('requiredForWcag21Aa')}
                        </span>
                    </SettingRow>

                    <SettingRow label={this.nls('headerImageLinkUrlOptional')} flow="wrap">
                        <TextInput
                            className="w-100" size="sm"
                            placeholder="https://www.example.gov"
                            value={cfg.headerImageLink ?? ""}
                            onChange={(e) => this.setConfig("headerImageLink", e.target.value)}
                        />
                        <span className="setting-text-level-3" style={{ marginTop: 4, display: "block" }}>
                            {this.nls('ifSetTheImageBecomesA')}
                        </span>
                    </SettingRow>

                    <SettingRow label={this.nls('submitButtonLabel')} flow="wrap">
                        <TextInput
                            className="w-100" size="sm"
                            value={__tc(cfg.submitButtonLabel, "submitReport")}
                            onChange={(e) =>
                                this.setConfig("submitButtonLabel", e.target.value)
                            }
                        />
                    </SettingRow>

                    <SettingRow label={this.nls('successMessage')} flow="wrap">
                        <TextArea
                            className="w-100" height={80}
                            value={__tc(cfg.successMessage, "thankYouYourConcernHasBeen")}
                            onAcceptValue={(val: string) =>
                                this.setConfig("successMessage", val)
                            }
                        />
                    </SettingRow>

                    <SettingRow label={this.nls('maxPhotoSizeMb')}>
                        <NumericInput
                            value={cfg.maxPhotoSizeMB ?? 10}
                            min={1} max={25} step={1}
                            onChange={(val: number) =>
                                this.setConfig("maxPhotoSizeMB", val)
                            }
                            style={{ width: 80 }} size="sm"
                        />
                    </SettingRow>
                </SettingSection>

                {/* ── Critical Issue Alerts ──────────────────────── */}
                <SettingSection title={this.nls('criticalIssueAlerts')}>
                    <SettingRow>
                        <span className="setting-text-level-3">
                            {this.nls('forCategorySubcategoryCombinationsThatNeed')}
                        </span>
                    </SettingRow>

                    <SettingRow label={this.nls('categoryMetadataUrl')} flow="wrap">
                        <TextInput
                            className="w-100" size="sm"
                            placeholder="https://gis.example.gov/arcgis/rest/services/RAC/ReportAConcern_Reporter/FeatureServer/0"
                            value={(cfg as any).categoryMetadataUrl ?? ""}
                            onChange={(e) =>
                                this.setConfig("categoryMetadataUrl", e.target.value)
                            }
                        />
                        <span className="setting-text-level-3" style={{ marginTop: 4, display: "block" }}>
                            {this.nls('fullRestUrlToTheTickets')}
                        </span>
                    </SettingRow>

                    {/* Metadata status — ALWAYS VISIBLE for diagnostics */}
                    {(() => {
                        const cfgAny2 = cfg as any;
                        const metaUrl = (cfgAny2.categoryMetadataUrl ?? "").trim();
                        const writeUrl = (cfgAny2.writeEndpointUrl ?? "").trim();
                        const isRest = (u: string) => /\/(FeatureServer|MapServer)\//i.test(u);
                        const url = metaUrl || (isRest(writeUrl) ? writeUrl : "");
                        const loading = this.state.loadingMeta;
                        const err = this.state.metaError;
                        const n = this.state.subtypes.length;

                        let label = "";
                        let color = c.textSecondary;
                        if (loading) { label = this.nls('loadingCategoriesFromLayer'); color = c.textSecondary; }
                        else if (err) { label = this.nls('errorErr', { err }); color = c.danger; }
                        else if (!url) { label = this.nls('noLayerUrlAvailableSetCategory'); color = c.warning; }
                        else if (n === 0) { label = this.nls('fetchedLayerJsonButFound0'); color = c.warning; }
                        else { label = (n === 1 ? this.nls('nCategoryLoaded', { n }) : this.nls('nCategoriesLoaded', { n })); color = "#080"; }

                        return (
                            <SettingRow>
                                <div style={{ width: "100%", fontSize: 12 }}>
                                    <div style={{ color, marginBottom: 4 }}>
                                        <strong>{this.nls('pickers')}</strong> {label}
                                    </div>
                                    <div style={{ color: c.textSecondary, wordBreak: "break-all", fontSize: 11 }}>
                                        {this.nls('url')} {url || this.nls('none')}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={this.fetchMetadata}
                                        style={{
                                            marginTop: 4, background: "transparent", border: "none",
                                            color: c.primary, textDecoration: "underline",
                                            cursor: "pointer", padding: 0, fontSize: 12,
                                        }}
                                    >
                                        {this.nls('refreshMetadata')}
                                    </button>
                                </div>
                            </SettingRow>
                        );
                    })()}

                    <SettingRow label={this.nls('defaultWarningMessage')} flow="wrap">
                        <TextArea
                            className="w-100" height={80}
                            value={__tc(cfg.criticalAlertDefaultMessage, "forTheFastestResponsePleaseCall")}
                            onAcceptValue={(val: string) =>
                                this.setConfig("criticalAlertDefaultMessage", val)
                            }
                        />
                        <span className="setting-text-level-3" style={{ marginTop: 4, display: "block" }}>
                            {this.nls('shownAboveThePhoneNumberWhen')}
                        </span>
                    </SettingRow>

                    {this.getCriticalAlerts().map((row, i) => (
                        <div key={i} style={{
                            border: `1px solid ${c.divider}`,
                            borderRadius: 4,
                            padding: 8,
                            marginTop: 8,
                            marginBottom: 4,
                            background: "rgba(0,0,0,0.02)",
                        }}>
                            <div style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: 6,
                            }}>
                                <strong style={{ fontSize: 12 }}>
                                    {this.nls('alertI', { i: i + 1 })}
                                </strong>
                                <button
                                    type="button"
                                    onClick={() => this.removeCriticalAlert(i)}
                                    style={{
                                        background: "transparent",
                                        border: `1px solid ${c.danger}`,
                                        color: c.danger,
                                        borderRadius: 3,
                                        padding: "2px 8px",
                                        fontSize: 11,
                                        cursor: "pointer",
                                    }}
                                    aria-label={this.nls('removeAlertI', { i: i + 1 })}
                                >
                                    {this.nls('remove')}
                                </button>
                            </div>

                            <SettingRow label={this.nls('category')} flow="wrap">
                                {this.state.subtypes.length === 0 ? (
                                    <TextInput
                                        className="w-100" size="sm"
                                        placeholder={this.nls('sewer')}
                                        value={row.category ?? ""}
                                        onChange={(e) =>
                                            this.setCriticalAlertField(i, "category", e.target.value)
                                        }
                                    />
                                ) : (
                                    <select
                                        className="w-100"
                                        style={{
                                            height: 28, fontSize: 13, padding: "2px 6px",
                                            border: `1px solid ${c.divider}`, borderRadius: 2,
                                            background: c.surface, width: "100%",
                                        }}
                                        value={row.category ?? ""}
                                        onChange={(e) => {
                                            this.setCriticalAlertField(i, "category", e.target.value);
                                            // Clearing category invalidates the subcategory
                                            if (!e.target.value) {
                                                this.setCriticalAlertField(i, "subcategory", "");
                                            }
                                        }}
                                    >
                                        <option value="">{this.nls('selectCategory')}</option>
                                        {this.state.subtypes.map((st) => (
                                            <option key={st.code} value={st.name}>{st.name}</option>
                                        ))}
                                        {row.category &&
                                            !this.state.subtypes.some(
                                                (st) => st.name.toLowerCase() === (row.category || "").toLowerCase()
                                            ) && (
                                                <option value={row.category}>
                                                    {this.nls('categoryNotInLayer', { category: row.category })}
                                                </option>
                                            )}
                                    </select>
                                )}
                            </SettingRow>

                            <SettingRow label={this.nls('subcategory')} flow="wrap">
                                {(() => {
                                    const match = this.state.subtypes.find(
                                        (st) => st.name.toLowerCase() === (row.category || "").toLowerCase()
                                    );
                                    if (!match || this.state.subtypes.length === 0) {
                                        return (
                                            <TextInput
                                                className="w-100" size="sm"
                                                placeholder={this.nls('overflowSpillBlankWholeCategory')}
                                                value={row.subcategory ?? ""}
                                                onChange={(e) =>
                                                    this.setCriticalAlertField(i, "subcategory", e.target.value)
                                                }
                                            />
                                        );
                                    }
                                    const subOpts = match.subOptions || [];
                                    const inList = !!row.subcategory && subOpts.some(
                                        (so) => so.name.toLowerCase() === (row.subcategory || "").toLowerCase()
                                    );
                                    return (
                                        <select
                                            className="w-100"
                                            style={{
                                                height: 28, fontSize: 13, padding: "2px 6px",
                                                border: `1px solid ${c.divider}`, borderRadius: 2,
                                                background: c.surface, width: "100%",
                                            }}
                                            value={row.subcategory ?? ""}
                                            onChange={(e) =>
                                                this.setCriticalAlertField(i, "subcategory", e.target.value)
                                            }
                                        >
                                            <option value="">{this.nls('anySubcategoryWholeCategory')}</option>
                                            {subOpts.map((so) => (
                                                <option key={so.code} value={so.name}>{so.name}</option>
                                            ))}
                                            {row.subcategory && !inList && (
                                                <option value={row.subcategory}>
                                                    {this.nls('subcategoryNotInDomain', { subcategory: row.subcategory })}
                                                </option>
                                            )}
                                        </select>
                                    );
                                })()}
                            </SettingRow>

                            <SettingRow label={this.nls('phoneNumbers')} flow="wrap">
                                <span className="setting-text-level-3" style={{ marginTop: 0, marginBottom: 6, display: "block" }}>
                                    {this.nls('oneOrMoreNumbersShownTo')}
                                </span>

                                {this.getAlertPhones(i).map((p, j, arr) => (
                                    <div key={j} style={{
                                        border: "1px dashed #bbb",
                                        borderRadius: 3,
                                        padding: 6,
                                        marginBottom: 6,
                                        background: c.surface,
                                    }}>
                                        <div style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            marginBottom: 4,
                                        }}>
                                            <em style={{ fontSize: 11, color: c.textSecondary }}>
                                                {this.nls('phoneJ', { j: j + 1 })}
                                            </em>
                                            <div style={{ display: "flex", gap: 4 }}>
                                                <button
                                                    type="button"
                                                    title={this.nls('moveUp')}
                                                    disabled={j === 0}
                                                    onClick={() => this.moveAlertPhone(i, j, -1)}
                                                    style={{
                                                        background: "transparent",
                                                        border: "1px solid #999",
                                                        color: c.text,
                                                        borderRadius: 3,
                                                        padding: "0px 6px",
                                                        fontSize: 11,
                                                        cursor: j === 0 ? "not-allowed" : "pointer",
                                                        opacity: j === 0 ? 0.4 : 1,
                                                    }}
                                                    aria-label={this.nls('movePhoneJUp', { j: j + 1 })}
                                                >▲</button>
                                                <button
                                                    type="button"
                                                    title={this.nls('moveDown')}
                                                    disabled={j === arr.length - 1}
                                                    onClick={() => this.moveAlertPhone(i, j, 1)}
                                                    style={{
                                                        background: "transparent",
                                                        border: "1px solid #999",
                                                        color: c.text,
                                                        borderRadius: 3,
                                                        padding: "0px 6px",
                                                        fontSize: 11,
                                                        cursor: j === arr.length - 1 ? "not-allowed" : "pointer",
                                                        opacity: j === arr.length - 1 ? 0.4 : 1,
                                                    }}
                                                    aria-label={this.nls('movePhoneJDown', { j: j + 1 })}
                                                >▼</button>
                                                <button
                                                    type="button"
                                                    onClick={() => this.removeAlertPhone(i, j)}
                                                    style={{
                                                        background: "transparent",
                                                        border: `1px solid ${c.danger}`,
                                                        color: c.danger,
                                                        borderRadius: 3,
                                                        padding: "0px 8px",
                                                        fontSize: 11,
                                                        cursor: "pointer",
                                                    }}
                                                    aria-label={this.nls('removePhoneJ', { j: j + 1 })}
                                                >{this.nls('remove')}</button>
                                            </div>
                                        </div>

                                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                            <div style={{ flex: "1 1 220px", minWidth: 180 }}>
                                                <label style={{ fontSize: 11, color: c.textSecondary, display: "block", marginBottom: 2 }}>
                                                    {this.nls('whenOptional')}
                                                </label>
                                                <TextInput
                                                    className="w-100" size="sm"
                                                    placeholder={this.nls('mondayFriday8AmTo5')}
                                                    value={p.label}
                                                    onChange={(e) =>
                                                        this.setAlertPhoneField(i, j, "label", e.target.value)
                                                    }
                                                />
                                            </div>
                                            <div style={{ flex: "1 1 180px", minWidth: 140 }}>
                                                <label style={{ fontSize: 11, color: c.textSecondary, display: "block", marginBottom: 2 }}>
                                                    {this.nls('whoOptional')}
                                                </label>
                                                <TextInput
                                                    className="w-100" size="sm"
                                                    placeholder={this.nls('customerService')}
                                                    value={p.name}
                                                    onChange={(e) =>
                                                        this.setAlertPhoneField(i, j, "name", e.target.value)
                                                    }
                                                />
                                            </div>
                                            <div style={{ flex: "1 1 150px", minWidth: 130 }}>
                                                <label style={{ fontSize: 11, color: c.textSecondary, display: "block", marginBottom: 2 }}>
                                                    {this.nls('number')}
                                                </label>
                                                <TextInput
                                                    className="w-100" size="sm"
                                                    placeholder="(970) 244-1579"
                                                    value={p.number}
                                                    onChange={(e) =>
                                                        this.setAlertPhoneField(i, j, "number", e.target.value)
                                                    }
                                                />
                                            </div>
                                        </div>
                                    </div>
                                ))}

                                <button
                                    type="button"
                                    onClick={() => this.addAlertPhone(i)}
                                    style={{
                                        background: "transparent",
                                        border: `1px dashed ${c.primary}`,
                                        color: c.primary,
                                        borderRadius: 3,
                                        padding: "4px 10px",
                                        fontSize: 11,
                                        cursor: "pointer",
                                        fontWeight: 600,
                                    }}
                                >{this.nls('addAnotherPhone')}</button>
                            </SettingRow>

                            <SettingRow label={this.nls('customMessageOptional')} flow="wrap">
                                <TextArea
                                    className="w-100" height={70}
                                    value={row.message ?? ""}
                                    onAcceptValue={(val: string) =>
                                        this.setCriticalAlertField(i, "message", val)
                                    }
                                />
                                <span className="setting-text-level-3" style={{ marginTop: 4, display: "block" }}>
                                    {this.nls('optionalContextShownAboveThePhone')}
                                </span>
                            </SettingRow>
                        </div>
                    ))}

                    <SettingRow>
                        <button
                            type="button"
                            onClick={this.addCriticalAlert}
                            style={{
                                background: c.primary,
                                border: `1px solid ${c.primary}`,
                                color: c.primaryText,
                                borderRadius: 3,
                                padding: "6px 14px",
                                fontSize: 12,
                                cursor: "pointer",
                                fontWeight: 600,
                            }}
                        >
                            {this.nls('addCriticalAlert')}
                        </button>
                    </SettingRow>
                </SettingSection>
            </div>
        );
    }
}