/**
 * RAC Ticket Manager - help guide content. The only per-widget file of the
 * help pattern; HelpPopup.tsx and theme.ts are copied unchanged (handoff
 * Section 10).
 *
 * Sections: start, find, views, edit, comments, photos, survey, export, keep,
 * trouble, tips. Every line is gated by the same checks the UI uses, so the
 * guide never describes a button that is not there.
 */
import type { HelpSection } from './components/HelpPopup'

/** Flags the widget computes from config and live status (helpFeatures() in widget.tsx). */
export interface HelpFeatures {
  /** A map widget is linked, so map click, hover highlight and Map extent exist. */
  mapConnected: boolean
  /** The comments table was found in the web map: Has Comments, comment sorts, the comment box. */
  comments: boolean
  /** The survey table was found in the web map: Has Survey, survey sorts, the Survey tab content. */
  survey: boolean
  /** The widget sits inside a resizable sidebar, so the panel width is remembered. */
  sidebar: boolean
}

type T = (id: string, values?: Record<string, string>) => string

export function buildHelpSections (t: T, f: HelpFeatures): HelpSection[] {
  const when = (on: boolean, ...ids: string[]): string[] => (on ? ids.map((id: string) => t(id)) : [])
  const listOf = (parts: string[]): string =>
    parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} ${t('helpAnd')} ${parts[parts.length - 1]}`
  // The badge filter row (Has Comments / Has Survey / Has Photos) only renders
  // when at least one of the two tables was found, same test as widget.tsx.
  const badgeRow = f.comments || f.survey

  const sortOrders = listOf([t('helpFindSortBase'), ...when(f.comments, 'helpFindSortComments'), ...when(f.survey, 'helpFindSortSurvey')])
  const badges = listOf([...when(f.comments, 'helpViewsBadgeComments'), t('helpViewsBadgePhotos'), ...when(f.survey, 'helpViewsBadgeSurvey')])
  const sheets = listOf([...when(f.comments, 'helpExportSheetComments'), t('helpExportSheetPhotos'), ...when(f.survey, 'helpExportSheetSurveys')])

  const comments: HelpSection[] = f.comments
    ? [{
        key: 'comments',
        icon: 'speech-bubble',
        title: t('helpCommentsTitle'),
        body: [t('helpCommentsBox'), t('helpCommentsVisibility'), t('helpCommentsType'), t('helpCommentsPhoto'), t('helpCommentsTab')]
      }]
    : []

  const survey: HelpSection[] = f.survey
    ? [{ key: 'survey', icon: 'star', title: t('helpSurveyTitle'), body: [t('helpSurveyTab'), t('helpSurveyTick')] }]
    : []

  return [
    { key: 'start', icon: 'play', title: t('helpStartTitle'), ordered: true, body: [f.mapConnected ? t('helpStart1Map') : t('helpStart1'), t('helpStart2'), t('helpStart3')] },
    {
      key: 'find',
      icon: 'search',
      title: t('helpFindTitle'),
      body: [
        t('helpFindSearch'), t('helpFindButtons'),
        ...when(f.comments, 'helpFindComments'), ...when(f.survey, 'helpFindSurvey'), ...when(badgeRow, 'helpFindPhotos'),
        t('helpFindDate'), t('helpFindSort', { orders: sortOrders }),
        ...when(f.mapConnected, 'helpFindExtent'),
        t('helpFindClear'), t('helpFindPages')
      ]
    },
    {
      key: 'views',
      icon: 'list-check',
      title: t('helpViewsTitle'),
      body: [t('helpViewsCards'), t('helpViewsTable'), t('helpViewsSort'), t('helpViewsFunnel'), t('helpViewsResize'), t('helpViewsBadges', { badges }), ...when(f.mapConnected, 'helpViewsHover')]
    },
    {
      key: 'edit',
      icon: 'pencil',
      title: t('helpEditTitle'),
      intro: t('helpEditIntro'),
      body: [t('helpEditRouting'), t('helpEditSubcategory'), t('helpEditWarning'), t('helpEditNote'), t('helpEditDate'), t('helpEditCounter'), ...when(f.comments, 'helpEditAudit')]
    },
    ...comments,
    { key: 'photos', icon: 'image', title: t('helpPhotosTitle'), body: [t('helpPhotosTab'), t('helpPhotosViewer'), ...when(f.comments, 'helpPhotosLimits')] },
    ...survey,
    { key: 'export', icon: 'download', title: t('helpExportTitle'), body: [t('helpExportAll'), t('helpExportWait'), t('helpExportSheets', { sheets })] },
    { key: 'keep', icon: 'folder', title: t('helpKeepTitle'), body: [t('helpKeepFilters'), ...when(f.sidebar, 'helpKeepSidebar'), t('helpKeepClear'), t('helpKeepLink')] },
    {
      key: 'trouble',
      icon: 'exclamation-mark-triangle',
      title: t('helpTroubleTitle'),
      body: [
        t('helpTroubleMap'), t('helpTroubleLayer'), t('helpTroubleTables'), t('helpTroubleSave'),
        ...when(f.comments, 'helpTroublePhoto'), t('helpTroubleExport'), t('helpTroubleStale'), t('helpTroubleContact')
      ]
    },
    { key: 'tips', icon: 'lightbulb', title: t('helpTipsTitle'), body: [t('helpTips1'), t('helpTips2'), t('helpTips3')] }
  ]
}
