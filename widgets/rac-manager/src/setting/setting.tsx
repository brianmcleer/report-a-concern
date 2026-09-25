/** @jsx jsx */
import { React, jsx, Immutable } from "jimu-core";
import { type AllWidgetSettingProps } from "jimu-for-builder";
import { TextInput, Switch } from "jimu-ui";
import { MapWidgetSelector } from "jimu-ui/advanced/setting-components";
import { useTokens, type Tokens } from "../runtime/theme";

// Theme tokens for a class component: a tiny function component reads the
// hook and hands the tokens down (handoff Section 11.2).
function Themed({ children }: { children: (tk: Tokens) => React.ReactNode }) {
    const tk = useTokens();
    return <React.Fragment>{children(tk)}</React.Fragment>;
}
interface Config {
    useMapWidgetIds?: string[];
    ticketsLayerTitle?: string;
    commentsTableName?: string;
    photosTableName?: string;
    surveyTableName?: string;
    orgName?: string;
    // Help button and first-run hint (handoff Section 10). Missing means on.
    showHelp?: boolean;
    // agolMediaTableUrl removed in v1.1.0 — photos now served from enterprise FeatureServer attachments
}
export default class Setting extends React.PureComponent<AllWidgetSettingProps<Config>, any> {
    onMapSelected = (ids: string[]) => {
        this.props.onSettingChange({
            id: this.props.id,
            config: this.props.config.set("useMapWidgetIds", ids),
        });
    };
    onChange = (field: string, e: any) => {
        this.props.onSettingChange({
            id: this.props.id,
            config: this.props.config.set(field, e.target.value),
        });
    };
    onToggle = (field: string, checked: boolean) => {
        this.props.onSettingChange({
            id: this.props.id,
            config: this.props.config.set(field, checked),
        });
    };
    render() {
        return <Themed>{(tk: Tokens) => this.renderBody(tk)}</Themed>;
    }
    renderBody(tk: Tokens) {
        const cfg = this.props.config;
        const fieldStyle: React.CSSProperties = { marginBottom: 12 };
        const labelStyle: React.CSSProperties = { fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 };
        const helpStyle: React.CSSProperties = { fontSize: 11, color: tk.textSecondary, marginTop: 2 };
        return (
            <div style={{ padding: 12 }}>
                <h6 style={{ marginBottom: 12 }}>RAC Manager Settings</h6>
                <div style={fieldStyle}>
                    <label style={labelStyle}>Map Widget</label>
                    <MapWidgetSelector
                        useMapWidgetIds={cfg.useMapWidgetIds}
                        onSelect={this.onMapSelected}
                    />
                    <div style={helpStyle}>Select the map that contains your RAC feature service layers.</div>
                </div>
                <div style={fieldStyle}>
                    <label style={labelStyle}>Tickets Layer Title</label>
                    <TextInput
                        size="sm"
                        value={cfg.ticketsLayerTitle || "Tickets"}
                        onChange={(e: any) => this.onChange("ticketsLayerTitle", e)}
                    />
                    <div style={helpStyle}>Must match the layer title exactly as it appears in the web map.</div>
                </div>
                <div style={fieldStyle}>
                    <label style={labelStyle}>Comments Table Name</label>
                    <TextInput
                        size="sm"
                        value={cfg.commentsTableName || "Ticket Comments"}
                        onChange={(e: any) => this.onChange("commentsTableName", e)}
                    />
                    <div style={helpStyle}>Token-based match — underscores and spaces are treated the same (case-insensitive).</div>
                </div>
                <div style={fieldStyle}>
                    <label style={labelStyle}>Photos Table Name</label>
                    <TextInput
                        size="sm"
                        value={cfg.photosTableName || "Ticket Photos"}
                        onChange={(e: any) => this.onChange("photosTableName", e)}
                    />
                    <div style={helpStyle}>Token-based match — underscores and spaces are treated the same (case-insensitive).</div>
                </div>
                <div style={fieldStyle}>
                    <label style={labelStyle}>Survey Table Name</label>
                    <TextInput
                        size="sm"
                        value={cfg.surveyTableName || "Survey Responses"}
                        onChange={(e: any) => this.onChange("surveyTableName", e)}
                    />
                    <div style={helpStyle}>Token-based match — underscores and spaces are treated the same (case-insensitive).</div>
                </div>
                <div style={fieldStyle}>
                    <label style={labelStyle}>Organization Name</label>
                    <TextInput
                        size="sm"
                        value={cfg.orgName || "GIS Division"}
                        onChange={(e: any) => this.onChange("orgName", e)}
                    />
                    <div style={helpStyle}>Shown as the author and subtitle of the Excel export.</div>
                </div>
                <div style={fieldStyle}>
                    <label style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span>Help button and guide</span>
                        <Switch
                            checked={cfg.showHelp !== false}
                            aria-label="Show the Help button and the first-run hint"
                            onChange={(e: any, checked: boolean) => this.onToggle("showHelp", checked)}
                        />
                    </label>
                    <div style={helpStyle}>Shows a Help button at the top right of the widget and a one-time hint for new users. Turn it off for kiosk or embedded uses.</div>
                </div>
                <div style={{ fontSize: 11, color: tk.text, marginTop: 16, lineHeight: 1.6, background: tk.infoBg, padding: "10px 12px", borderRadius: tk.radius, border: `1px solid ${tk.divider}`, borderLeft: `3px solid ${tk.primary}` }}>
                    <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 12 }}>⚙️ Required Web Map Setup</div>
                    <p style={{ margin: "0 0 6px" }}>
                        The Comments, Surveys, and Photos tables must be <strong>explicitly added to your web map</strong> in Portal Map Viewer — publishing the FeatureServer alone is not enough.
                    </p>
                    <ol style={{ margin: "0 0 6px", paddingLeft: 16 }}>
                        <li>Open your web map in Portal Map Viewer</li>
                        <li>Add layer → browse to <strong>ReportAConcern_Manager / FeatureServer</strong></li>
                        <li>Add each of these as <strong>tables</strong> (not layers):
                            <ul style={{ marginTop: 4, paddingLeft: 14 }}>
                                <li>Ticket_Comments</li>
                                <li>Survey_Responses</li>
                                <li>Ticket_Photos_Meta</li>
                            </ul>
                        </li>
                        <li>Save the web map</li>
                    </ol>
                    <p style={{ margin: "0 0 4px" }}>
                        <strong>To verify:</strong> Open the browser console after the widget loads and look for lines starting with <code style={{ background: tk.surface, padding: "0 3px", borderRadius: 2 }}>RAC Manager:</code>. Each table should show its title — if any say <em>NOT FOUND</em>, that table is missing from the web map.
                    </p>
                    <p style={{ margin: 0, color: tk.textSecondary }}>
                        All auth flows through the Portal session — no extra tokens needed. To restrict access, share the app with a Portal group.
                    </p>
                </div>
            </div>
        );
    }
} 