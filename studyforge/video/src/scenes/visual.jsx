import React from 'react';
import {useCurrentFrame, useVideoConfig} from 'remotion';
import {Frame, palette} from './layout.jsx';

export function DiagramScene({title, nodes, edges, illustrative, domainLabel}) {
  return <Frame label={illustrative ? 'Diagrama ilustrativo · não é dado de exemplo' : 'Diagrama derivado da fonte'} domainLabel={domainLabel} title={title}>
    <div style={{display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between', gap: 18}}>
      {nodes.map((node, index) => <React.Fragment key={`${index}-${node.label}`}>
        {index > 0 && edges.some(edge => edge.from === index - 1 && edge.to === index) && <div aria-hidden="true" style={{color: palette.accent, fontSize: 38}}>→</div>}
        <div style={{background: palette.panel, border: `2px solid ${index === 1 ? palette.gold : palette.accent}`, borderRadius: 18, padding: 25, flex: 1, minWidth: 0}}>
          <div style={{color: index === 1 ? palette.gold : palette.accent, fontSize: 25, fontWeight: 700}}>{node.label}</div>
          <div style={{fontSize: 23, lineHeight: 1.4, marginTop: 16, overflowWrap: 'anywhere'}}>{node.detail}</div>
        </div>
      </React.Fragment>)}
    </div>
  </Frame>;
}

export function ComparisonScene({title, rows, domainLabel}) {
  return <Frame label="Comparação extraída da aula" domainLabel={domainLabel} title={title}>
    <div style={{width: '100%'}}>{rows.map((row, index) => <div key={index} style={{display: 'grid', gridTemplateColumns: 'minmax(200px, 1fr) 3fr', gap: 20, background: palette.panel, padding: 20, marginBottom: 14, borderRadius: 12}}>
      <strong style={{color: palette.accent, fontSize: 24}}>{row.label}</strong><span style={{fontSize: 23, lineHeight: 1.4}}>{row.text}</span>
    </div>)}</div>
  </Frame>;
}

const tokenPattern = /(\s+|--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`[^`]*`|\b(?:select|from|where|join|on|and|or|not|null|as|with|case|when|then|else|end|create|table|insert|update|delete|group|by|order|limit|if|const|let|return|function|class|import|export|true|false)\b|\b\d+(?:\.\d+)?\b|[A-Za-z_$][\w$]*|.)/gim;
const keyword = /^(select|from|where|join|on|and|or|not|null|as|with|case|when|then|else|end|create|table|insert|update|delete|group|by|order|limit|if|const|let|return|function|class|import|export|true|false)$/i;
function styled(token, key) {
  if (/^\s+$/.test(token)) return token;
  if (/^(--|\/\*)/.test(token)) return <span key={key} style={{color: '#8290a7'}}>{token}</span>;
  if (/^[`'"]/.test(token)) return <span key={key} style={{color: '#a5df9b'}}>{token}</span>;
  if (keyword.test(token)) return <span key={key} style={{color: palette.accent, fontWeight: 700}}>{token}</span>;
  if (/^\d/.test(token)) return <span key={key} style={{color: palette.gold}}>{token}</span>;
  return <span key={key}>{token}</span>;
}
export function CodeScene({title, code, language = 'text', highlightLine = 0, reveal = false, domainLabel}) {
  const lines = String(code ?? '').split(/\r?\n/);
  const frame = useCurrentFrame();
  const {fps} = useVideoConfig();
  const rendered = lines.map((line, lineIndex) => <div key={lineIndex} style={{background: lineIndex === highlightLine ? '#17243c' : 'transparent', borderLeft: lineIndex === highlightLine ? `3px solid ${palette.gold}` : '3px solid transparent', padding: '0 10px'}}>
    {line.match(tokenPattern)?.map((token, index) => styled(token, `${lineIndex}-${index}`)) ?? line}
  </div>);
  const visibleLines = reveal ? Math.min(lines.length, Math.max(1, Math.ceil(lines.length * frame / Math.max(fps * 2, 1)))) : lines.length;
  return <Frame label={`Código · ${language}`} domainLabel={domainLabel} title={title}><pre style={{background: '#070b14', borderRadius: 16, padding: 24, fontSize: 25, lineHeight: 1.55, width: '100%', maxHeight: '65%', overflow: 'hidden', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere'}}>{rendered.slice(0, visibleLines)}</pre></Frame>;
}
