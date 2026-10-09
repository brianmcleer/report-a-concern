/** @jsx jsx */
import { React, jsx, Immutable } from "jimu-core";
import { type AllWidgetSettingProps } from "jimu-for-builder";
import { TextInput, Switch } from "jimu-ui";
import { MapWidgetSelector } from "jimu-ui/advanced/setting-components";
import { useTokens, type Tokens } from "../runtime/theme";
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
    __setIntl((this.props as any).intl)
    __i18nIntl = (this.props as any).intl
        return <Themed>{(tk: Tokens) => this.renderBody(tk)}</Themed>;
    }
    renderBody(tk: Tokens) {
        const cfg = this.props.config;
        const fieldStyle: React.CSSProperties = { marginBottom: 12 };
        const labelStyle: React.CSSProperties = { fontWeight: 600, fontSize: 13, display: "block", marginBottom: 4 };
        const helpStyle: React.CSSProperties = { fontSize: 11, color: tk.textSecondary, marginTop: 2 };
        return (
            <div style={{ padding: 12 }}>
                <h6 style={{ marginBottom: 12 }}>{__t("uiRacManagerSettings")}</h6>
                <div style={fieldStyle}>
                    <label style={labelStyle}>{__t("uiMapWidget")}</label>
                    <MapWidgetSelector
                        useMapWidgetIds={cfg.useMapWidgetIds}
                        onSelect={this.onMapSelected}
                    />
                    <div style={helpStyle}>{__t("uiSelectTheMapThatContainsYour")}</div>
                </div>
                <div style={fieldStyle}>
                    <label style={labelStyle}>{__t("uiTicketsLayerTitle")}</label>
                    <TextInput
                        size="sm"
                        value={__tc(cfg.ticketsLayerTitle, "tickets")}
                        onChange={(e: any) => this.onChange("ticketsLayerTitle", e)}
                    />
                    <div style={helpStyle}>{__t("uiMustMatchTheLayerTitleExactly")}</div>
                </div>
                <div style={fieldStyle}>
                    <label style={labelStyle}>{__t("uiCommentsTableName")}</label>
                    <TextInput
                        size="sm"
                        value={cfg.commentsTableName || "Ticket Comments"}
                        onChange={(e: any) => this.onChange("commentsTableName", e)}
                    />
                    <div style={helpStyle}>{__t("uiTokenBasedMatchUnderscoresAndSpaces")}</div>
                </div>
                <div style={fieldStyle}>
                    <label style={labelStyle}>{__t("uiPhotosTableName")}</label>
                    <TextInput
                        size="sm"
                        value={cfg.photosTableName || "Ticket Photos"}
                        onChange={(e: any) => this.onChange("photosTableName", e)}
                    />
                    <div style={helpStyle}>{__t("uiTokenBasedMatchUnderscoresAndSpaces")}</div>
                </div>
                <div style={fieldStyle}>
                    <label style={labelStyle}>{__t("uiSurveyTableName")}</label>
                    <TextInput
                        size="sm"
                        value={cfg.surveyTableName || "Survey Responses"}
                        onChange={(e: any) => this.onChange("surveyTableName", e)}
                    />
                    <div style={helpStyle}>{__t("uiTokenBasedMatchUnderscoresAndSpaces")}</div>
                </div>
                <div style={fieldStyle}>
                    <label style={labelStyle}>{__t("uiOrganizationName")}</label>
                    <TextInput
                        size="sm"
                        value={cfg.orgName || "GIS Division"}
                        onChange={(e: any) => this.onChange("orgName", e)}
                    />
                    <div style={helpStyle}>{__t("uiShownAsTheAuthorAndSubtitle")}</div>
                </div>
                <div style={fieldStyle}>
                    <label style={{ ...labelStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <span>{__t("uiHelpButtonAndGuide")}</span>
                        <Switch
                            checked={cfg.showHelp !== false}
                            aria-label={__t("uiShowTheHelpButtonAndThe")}
                            onChange={(e: any, checked: boolean) => this.onToggle("showHelp", checked)}
                        />
                    </label>
                    <div style={helpStyle}>{__t("uiShowsAHelpButtonAtThe")}</div>
                </div>
                <div style={{ fontSize: 11, color: tk.text, marginTop: 16, lineHeight: 1.6, background: tk.infoBg, padding: "10px 12px", borderRadius: tk.radius, border: `1px solid ${tk.divider}`, borderLeft: `3px solid ${tk.primary}` }}>
                    <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 12 }}>{__t("uiRequiredWebMapSetup")}</div>
                    <p style={{ margin: "0 0 6px" }}>
                        {__t("uiTheCommentsSurveysAndPhotosTables")} <strong>{__t("uiExplicitlyAddedToYourWebMap")}</strong> {__t("uiInPortalMapViewerPublishingThe")}
                    </p>
                    <ol style={{ margin: "0 0 6px", paddingLeft: 16 }}>
                        <li>{__t("uiOpenYourWebMapInPortal")}</li>
                        <li>{__t("uiAddLayerBrowseTo")} <strong>{__t("uiReportaconcernManagerFeatureserver")}</strong></li>
                        <li>{__t("uiAddEachOfTheseAs")} <strong>{__t("uiTables")}</strong> {__t("uiNotLayers")}
                            <ul style={{ marginTop: 4, paddingLeft: 14 }}>
                                <li>{__t("uiTicketComments")}</li>
                                <li>{__t("uiSurveyResponses")}</li>
                                <li>{__t("uiTicketPhotosMeta")}</li>
                            </ul>
                        </li>
                        <li>{__t("uiSaveTheWebMap")}</li>
                    </ol>
                    <p style={{ margin: "0 0 4px" }}>
                        <strong>{__t("uiToVerify")}</strong> {__t("uiOpenTheBrowserConsoleAfterThe")} <code style={{ background: tk.surface, padding: "0 3px", borderRadius: 2 }}>{__t("uiRacManager")}</code>{__t("eachTableShouldShowItsTitle")} <em>{__t("uiNotFound")}</em>{__t("uiThatTableIsMissingFromThe")}
                    </p>
                    <p style={{ margin: 0, color: tk.textSecondary }}>
                        {__t("uiAllAuthFlowsThroughThePortal")}
                    </p>
                </div>
            </div>
        );
    }
} 