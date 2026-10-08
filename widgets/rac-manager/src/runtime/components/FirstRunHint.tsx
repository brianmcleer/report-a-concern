import { React } from 'jimu-core'
import { Button } from 'jimu-ui'
import { CalciteIcon } from 'calcite-components'
import { useTokens } from '../theme'
import { hooks as __exbI18nHooks } from 'jimu-core';
import __exbI18nMessages from '../translations/default';


/**
 * First-run hint (handoff Section 10.5): a tinted banner with a 3px accent bar,
 * a lightbulb, a bold lead-in, one sentence, an inline link that opens the
 * guide and an icon-only dismiss. Strings are passed in so the same file works
 * for a class component reading defaultMessages directly.
 */
export interface FirstRunHintProps {
  title: string
  body: string
  linkLabel: string
  dismissLabel: string
  onOpenHelp: () => void
  onDismiss: () => void
}

const FirstRunHint: React.FC<FirstRunHintProps> = ({ title, body, linkLabel, dismissLabel, onOpenHelp, onDismiss }) => {
  const t = __exbI18nHooks.useTranslation(__exbI18nMessages);
  const tokens = useTokens()
  return (
    <div role="note" style={{ margin: '10px 8px 0 8px', padding: '10px 12px', display: 'flex', alignItems: 'flex-start', gap: '10px', background: tokens.infoBg, color: tokens.text, border: `1px solid ${tokens.divider}`, borderLeft: `3px solid ${tokens.primary}`, borderRadius: tokens.radius, fontSize: '12px', lineHeight: 1.5 }}>
      <span style={{ color: tokens.primary, marginTop: '1px' }} aria-hidden="true"><CalciteIcon icon="lightbulb" scale="s" /></span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <strong style={{ display: 'block', marginBottom: '2px' }}>{title}</strong>
        {body}
        {' '}
        <button type="button" onClick={onOpenHelp} style={{ border: 'none', background: 'transparent', padding: 0, color: tokens.primary, cursor: 'pointer', textDecoration: 'underline', font: 'inherit' }}>{linkLabel}</button>
      </span>
      <Button size="sm" type="tertiary" icon onClick={onDismiss} title={dismissLabel} aria-label={dismissLabel}>
        <CalciteIcon icon="x" scale="s" />
      </Button>
    </div>
  )
}

export default FirstRunHint
